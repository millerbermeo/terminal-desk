import { describe, expect, it, vi } from 'vitest'
import { IDIOMAS_VOZ, esIdiomaVoz, type ResultadoVoz } from '@shared/voz'
import { Grabadora, type DependenciasGrabadora, type Grabador } from '../src/renderer/agente/grabadora'
import { ServicioVoz, type MotorVoz } from '../src/main/voz'

const pausa = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Grabadora con micrófono, reloj y reconocedor falsos; `resolver` decide cuándo termina cada transcripción. */
function montar(respuestas: (ResultadoVoz | Error)[]) {
  let t = 0
  let tic: (() => void) | undefined
  const pendientes: ((r: ResultadoVoz | Error) => void)[] = []
  const parciales: (string | null)[] = []
  const finales: string[] = []
  const transcribir = vi.fn(
    () =>
      new Promise<ResultadoVoz>((ok, mal) => {
        const siguiente = respuestas.shift()
        const fin = (r: ResultadoVoz | Error): void => (r instanceof Error ? mal(r) : ok(r))
        if (siguiente) fin(siguiente)
        else pendientes.push(fin)
      })
  )
  const d: DependenciasGrabadora = {
    estadoVoz: async () => ({ ok: true, maxSegundos: 180, modeloListo: true }),
    pedirMicrofono: async () => ({ getTracks: () => [{ stop: () => undefined }], getAudioTracks: () => [{ onended: null }] }) as unknown as MediaStream,
    admite: () => true,
    crearGrabador: () => {
      const g: Grabador = {
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start() {
          this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)]) })
        },
        stop() {
          this.onstop?.()
        }
      }
      return g
    },
    decodificar: async (b) => new Float32Array(b.size),
    transcribir,
    ahora: () => t,
    cadaIntervalo: (fn) => {
      tic = fn
      return () => (tic = undefined)
    },
    esperar: () => Promise.resolve()
  }
  const g = new Grabadora(d, (x) => finales.push(x.texto), (p) => parciales.push(p))
  return {
    g,
    parciales,
    finales,
    transcribir,
    pendientes,
    avanzar: async (ms: number) => {
      t += ms
      tic?.()
      await pausa()
    }
  }
}

describe('dictado en tiempo real', () => {
  it('mientras se graba entrega texto parcial y al terminar el final', async () => {
    const m = montar([{ ok: true, texto: 'arregla' }, { ok: true, texto: 'arregla el login' }])
    await m.g.iniciar()
    await m.avanzar(1000)
    expect(m.parciales).toEqual([]) // aún es muy corto
    await m.avanzar(1000)
    await pausa()
    expect(m.parciales).toEqual(['arregla'])
    m.g.terminar()
    await pausa()
    await pausa()
    expect(m.finales).toEqual(['arregla el login'])
    expect(m.g.actual.fase).toBe('inactivo')
  })

  it('no lanza otra transcripción parcial mientras hay una en curso', async () => {
    const m = montar([])
    await m.g.iniciar()
    await m.avanzar(2000)
    await m.avanzar(3000)
    await m.avanzar(3000)
    expect(m.transcribir).toHaveBeenCalledTimes(1)
    m.pendientes.shift()!({ ok: true, texto: 'hola' })
    await pausa()
    await pausa()
    expect(m.parciales).toEqual(['hola'])
    await m.avanzar(3000) // ya terminó: se puede pedir el siguiente
    expect(m.transcribir).toHaveBeenCalledTimes(2)
  })

  it('un parcial que llega después de «Terminar» no pisa el resultado final', async () => {
    const m = montar([])
    await m.g.iniciar()
    await m.avanzar(2000)
    expect(m.transcribir).toHaveBeenCalledTimes(1)
    m.g.terminar()
    await pausa()
    m.pendientes.shift()!({ ok: true, texto: 'parcial tardío' })
    await pausa()
    expect(m.parciales).toEqual([])
    m.pendientes.shift()!({ ok: true, texto: 'final' })
    await pausa()
    await pausa()
    expect(m.finales).toEqual(['final'])
  })

  it('si falla un parcial se sigue grabando sin mostrar error', async () => {
    const m = montar([new Error('boom'), { ok: false, codigo: 'VOZ_VACIO', mensaje: 'nada' }])
    await m.g.iniciar()
    await m.avanzar(2000)
    await pausa()
    expect(m.g.actual.fase).toBe('grabando')
    expect(m.parciales).toEqual([])
    await m.avanzar(3000)
    await pausa()
    expect(m.g.actual.fase).toBe('grabando')
  })

  it('al cancelar avisa con null para que el campo vuelva a como estaba', async () => {
    const m = montar([{ ok: true, texto: 'algo' }])
    await m.g.iniciar()
    await m.avanzar(2000)
    await pausa()
    m.g.cancelar()
    expect(m.parciales).toEqual(['algo', null])
    expect(m.finales).toEqual([])
  })

  it('un error de la grabación también descarta lo mostrado', async () => {
    const m = montar([])
    await m.g.iniciar()
    m.g.cancelar()
    expect(m.parciales).toEqual([null])
  })
})

describe('idioma del dictado', () => {
  const motor = (): MotorVoz & { transcribir: ReturnType<typeof vi.fn> } => ({ listo: () => true, transcribir: vi.fn(async () => 'hola') }) as never
  const pcm = new Float32Array(32_000)

  it('usa español por defecto y el idioma pedido cuando es válido', async () => {
    const m = motor()
    const s = new ServicioVoz(m)
    await s.transcribir(pcm, 2000)
    await s.transcribir(pcm, 2000, 'en')
    await s.transcribir(pcm, 2000, 'auto')
    expect(m.transcribir.mock.calls.map((c) => c[1])).toEqual(['spanish', 'english', undefined])
  })

  it('un idioma desconocido o de otro tipo cae a español (no llega a Whisper)', async () => {
    const m = motor()
    const s = new ServicioVoz(m)
    await s.transcribir(pcm, 2000, 'klingon')
    await s.transcribir(pcm, 2000, { language: 'x' })
    await s.transcribir(pcm, 2000, '__proto__')
    expect(m.transcribir.mock.calls.map((c) => c[1])).toEqual(['spanish', 'spanish', 'spanish'])
  })

  it('esIdiomaVoz solo acepta claves propias', () => {
    expect(esIdiomaVoz('es')).toBe(true)
    expect(esIdiomaVoz('toString')).toBe(false)
    expect(Object.keys(IDIOMAS_VOZ)).toContain('auto')
  })
})

describe('límite de los parciales', () => {
  it('pasado el tope ya no se piden transcripciones parciales', async () => {
    const m = montar([{ ok: true, texto: 'uno' }, { ok: true, texto: 'dos' }, { ok: true, texto: 'tres' }])
    await m.g.iniciar()
    await m.avanzar(44_000)
    await pausa()
    const antes = m.transcribir.mock.calls.length
    await m.avanzar(10_000) // 54 s: fuera del tope
    await m.avanzar(10_000)
    expect(m.transcribir.mock.calls.length).toBe(antes)
  })
})
