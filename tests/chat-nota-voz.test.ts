import { describe, expect, it } from 'vitest'
import { MAX_NOTA_VOZ_MS } from '@shared/chat'
import { AVISO_MIC_DESCONECTADO, AVISO_SIN_SONIDO, GrabadorNota, LIMITES_NOTA, type DependenciasNota, type FaseNota, type GrabadorNotaNativo, type NotaGrabada, type PistaNota } from '../src/renderer/chat/nota-voz'

class PistaFalsa implements PistaNota {
  readyState = 'live'
  detenida = false
  onended: (() => void) | null = null
  stop(): void {
    this.detenida = true
    this.readyState = 'ended'
  }
  desconectar(): void {
    this.readyState = 'ended'
    this.onended?.()
  }
}

class GrabadorFalso implements GrabadorNotaNativo {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  /** Bytes «captados» en cada tramo grabando; al parar se entregan (como hace Chromium). */
  pendiente = 0
  start(): void {
    this.state = 'recording'
  }
  pause(): void {
    this.state = 'paused'
  }
  resume(): void {
    this.state = 'recording'
  }
  stop(): void {
    this.state = 'inactive'
    queueMicrotask(() => {
      if (this.pendiente > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(this.pendiente)]) })
      this.onstop?.()
    })
  }
}

function montar(op: { nivel?: number; fallaAbrir?: unknown; sinMedidor?: boolean } = {}) {
  let reloj = 0
  const pista = new PistaFalsa()
  const grabadores: GrabadorFalso[] = []
  const esperas: { ms: number; ok: () => void }[] = []
  let abrir!: () => void
  const errores: string[] = []
  const fases: FaseNota[] = []
  const automaticas: NotaGrabada[] = []
  let medidorCerrado = false
  const d: DependenciasNota = {
    abrir: () =>
      new Promise((ok, mal) => {
        abrir = () => {
          if (op.fallaAbrir) return mal(op.fallaAbrir)
          pista.readyState = 'live'
          pista.detenida = false
          ok({ getTracks: () => [pista], getAudioTracks: () => [pista] })
        }
      }),
    grabador: () => {
      const g = new GrabadorFalso()
      grabadores.push(g)
      return g
    },
    admite: (m) => m === 'audio/webm;codecs=opus',
    medidor: op.sinMedidor ? undefined : () => ({ nivel: () => op.nivel ?? 0.4, cerrar: () => void (medidorCerrado = true) }),
    esperar: (ms) => new Promise<void>((ok) => esperas.push({ ms, ok })),
    ahora: () => reloj,
    explicar: (e) => `error: ${(e as Error).name}`
  }
  const g = new GrabadorNota(d, { fase: (f) => fases.push(f), error: (m) => errores.push(m), automatica: (n) => automaticas.push(n) })
  const tic = () => new Promise((r) => setTimeout(r, 0))
  /** Abre el micrófono y pasa el calentamiento: queda grabando. */
  const empezar = async (): Promise<GrabadorFalso> => {
    const p = g.iniciar()
    abrir()
    await tic()
    esperas.shift()!.ok()
    await p
    return grabadores.at(-1)!
  }
  return {
    g,
    pista,
    errores,
    fases,
    automaticas,
    esperas,
    grabadores,
    abrir: () => abrir(),
    empezar,
    tic,
    avanzar: (ms: number) => void (reloj += ms),
    medidorCerrado: () => medidorCerrado
  }
}

describe('nota de voz del chat (GrabadorNota)', () => {
  it('espera el calentamiento del micrófono antes de grabar y no pierde el final: sigue grabando la cola tras «Enviar»', async () => {
    const m = montar()
    const p = m.g.iniciar()
    m.abrir()
    await m.tic()
    expect(m.grabadores).toHaveLength(0) // aún calentando
    expect(m.esperas[0]!.ms).toBe(LIMITES_NOTA.calentamientoMs)
    m.esperas.shift()!.ok()
    await p
    const rec = m.grabadores[0]!
    expect(rec.state).toBe('recording')
    expect(m.g.fase).toBe('grabando')

    m.avanzar(2000)
    rec.pendiente = 500
    const nota = m.g.terminar()
    expect(m.g.terminar()).toBe(nota) // doble clic: misma promesa
    expect(m.g.fase).toBe('cerrando')
    await m.tic()
    expect(rec.state).toBe('recording') // la cola todavía graba
    expect(m.esperas[0]!.ms).toBe(LIMITES_NOTA.colaMs)
    m.esperas.shift()!.ok()
    const n = await nota
    expect(n).not.toBeNull()
    expect(n!.datos.byteLength).toBe(500)
    expect(n!.mime).toBe('audio/webm;codecs=opus')
    expect(n!.duracionMs).toBe(2000 + LIMITES_NOTA.colaMs)
    expect(m.pista.detenida).toBe(true) // se suelta el micrófono
    expect(m.medidorCerrado()).toBe(true)
    expect(m.g.fase).toBe('inactiva')
  })

  it('cancelar mientras se abre el micrófono no empieza a grabar y lo suelta', async () => {
    const m = montar()
    const p = m.g.iniciar()
    m.g.cancelar()
    expect(m.g.fase).toBe('inactiva')
    m.abrir()
    await p
    expect(m.grabadores).toHaveLength(0)
    expect(m.pista.detenida).toBe(true)
    expect(m.g.fase).toBe('inactiva')
  })

  it('cancelar durante el calentamiento tampoco graba', async () => {
    const m = montar()
    const p = m.g.iniciar()
    m.abrir()
    await m.tic()
    m.g.cancelar()
    m.esperas.shift()!.ok()
    await p
    expect(m.grabadores).toHaveLength(0)
    expect(m.pista.detenida).toBe(true)
  })

  it('al llegar al máximo la nota se cierra y se entrega para enviarse (antes se perdía)', async () => {
    const m = montar()
    const rec = await m.empezar()
    rec.pendiente = 100
    m.avanzar(MAX_NOTA_VOZ_MS + 500)
    m.g.revisar()
    await m.tic()
    m.esperas.shift()!.ok()
    await m.tic()
    await m.tic()
    expect(m.automaticas).toHaveLength(1)
    expect(m.automaticas[0]!.duracionMs).toBe(MAX_NOTA_VOZ_MS) // nunca pasa del tope (el servidor la rechazaría)
  })

  it('pausar no cuenta el tiempo en pausa y se puede enviar pausada', async () => {
    const m = montar()
    const rec = await m.empezar()
    m.avanzar(1500)
    m.g.pausar()
    expect(rec.state).toBe('paused')
    m.avanzar(10_000)
    expect(m.g.transcurrido()).toBe(1500)
    m.g.pausar()
    m.avanzar(500)
    m.g.pausar()
    rec.pendiente = 10
    const n = await m.g.terminar() // pausada: sin cola
    expect(n!.duracionMs).toBe(2000)
  })

  it('una nota demasiado corta o sin bytes no se envía', async () => {
    const m = montar()
    const rec = await m.empezar()
    m.avanzar(100)
    rec.pendiente = 50
    m.g.pausar()
    expect(await m.g.terminar()).toBeNull()
    const rec2 = await m.empezar()
    m.avanzar(3000)
    m.g.pausar()
    rec2.pendiente = 0
    expect(await m.g.terminar()).toBeNull()
  })

  it('avisa si en 3 s no llega sonido del micrófono, una sola vez', async () => {
    const m = montar({ nivel: 0.001 })
    await m.empezar()
    m.avanzar(1000)
    m.g.revisar()
    expect(m.errores).toEqual([])
    m.avanzar(LIMITES_NOTA.silencioMs)
    m.g.revisar()
    m.g.revisar()
    expect(m.errores).toEqual([AVISO_SIN_SONIDO])
  })

  it('con sonido no avisa', async () => {
    const m = montar({ nivel: 0.3 })
    await m.empezar()
    m.g.revisar()
    m.avanzar(5000)
    m.g.revisar()
    expect(m.errores).toEqual([])
  })

  it('si se desconecta el micrófono pausa, avisa y no deja reanudar; lo grabado se puede enviar', async () => {
    const m = montar()
    const rec = await m.empezar()
    m.avanzar(2000)
    m.pista.desconectar()
    expect(m.g.fase).toBe('pausada')
    expect(m.errores).toEqual([AVISO_MIC_DESCONECTADO])
    m.g.pausar()
    expect(m.g.fase).toBe('pausada')
    rec.pendiente = 30
    const n = await m.g.terminar()
    expect(n!.duracionMs).toBe(2000)
  })

  it('sin permiso del micrófono informa el error y vuelve a inactiva', async () => {
    const err = Object.assign(new Error('x'), { name: 'NotAllowedError' })
    const m = montar({ fallaAbrir: err })
    const p = m.g.iniciar()
    m.abrir()
    await p
    expect(m.errores).toEqual(['error: NotAllowedError'])
    expect(m.g.fase).toBe('inactiva')
  })

  it('un clic doble en el micrófono no abre dos grabaciones', async () => {
    const m = montar()
    const p1 = m.g.iniciar()
    const p2 = m.g.iniciar()
    m.abrir()
    await m.tic()
    m.esperas.shift()!.ok()
    await Promise.all([p1, p2])
    expect(m.grabadores).toHaveLength(1)
  })

  it('cancelar a mitad descarta y la siguiente grabación empieza limpia', async () => {
    const m = montar()
    const rec = await m.empezar()
    rec.pendiente = 999
    m.avanzar(4000)
    m.g.cancelar()
    await m.tic()
    expect(m.g.fase).toBe('inactiva')
    const rec2 = await m.empezar()
    m.avanzar(1200)
    m.g.pausar()
    rec2.pendiente = 7
    const n = await m.g.terminar()
    expect(n!.datos.byteLength).toBe(7)
    expect(n!.duracionMs).toBe(1200)
  })
})
