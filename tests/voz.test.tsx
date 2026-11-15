import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LIMITES_GRABACION, elegirFormato, formatoTiempo, type EstadoVoz, type ResultadoVoz } from '@shared/voz'
import { Grabadora, type DependenciasGrabadora, type EstadoGrabacion, type Grabador, type TextoDictado } from '../src/renderer/agente/grabadora'
import { BarraGrabacion, BotonMicrofono } from '../src/renderer/components/GrabadorVoz'
import type { ControlGrabadora } from '../src/renderer/agente/grabadora'
import { ServicioVoz, type MotorVoz } from '../src/main/voz'

/** Micrófono, MediaRecorder, reloj y backend falsos: se controla a mano cuándo pasa cada cosa. */
function montar(opciones: { estado?: EstadoVoz; resultado?: ResultadoVoz | Promise<ResultadoVoz>; microfono?: 'ok' | 'denegado'; admite?: (m: string) => boolean; conEspera?: boolean; niveles?: number[] } = {}) {
  let t = 0
  let tic: (() => void) | undefined
  const pistas = { paradas: 0 }
  const grabadores: (Grabador & { estado: string; pidioDatos: number })[] = []
  const pistaFalsa: { onended: (() => void) | null; stop: () => void } = { onended: null, stop: () => void pistas.paradas++ }
  const esperas: (() => void)[] = []
  const niveles = [...(opciones.niveles ?? [])]
  const textos: TextoDictado[] = []
  const transcribir = vi.fn(async () => opciones.resultado ?? ({ ok: true, texto: 'eh arregla el el login' } as ResultadoVoz))
  const estadoVoz = vi.fn(async () => opciones.estado ?? ({ ok: true, maxSegundos: 180, modeloListo: true } as EstadoVoz))
  const pedirMicrofono = vi.fn(async () => {
    if (opciones.microfono === 'denegado') throw new DOMException('Permission denied', 'NotAllowedError')
    return { getTracks: () => [pistaFalsa], getAudioTracks: () => [pistaFalsa] } as unknown as MediaStream
  })
  const d: DependenciasGrabadora = {
    estadoVoz,
    pedirMicrofono,
    admite: opciones.admite ?? ((m) => m === 'audio/webm;codecs=opus'),
    crearGrabador: () => {
      const g: Grabador & { estado: string; pidioDatos: number } = {
        estado: 'inactivo',
        pidioDatos: 0,
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start() {
          this.estado = 'grabando'
        },
        requestData() {
          this.pidioDatos++
        },
        stop() {
          this.estado = 'parado'
          this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: 'audio/webm' }) })
          this.onstop?.()
        }
      }
      grabadores.push(g)
      return g
    },
    decodificar: vi.fn(async (b: Blob) => new Float32Array(b.size)),
    transcribir,
    ahora: () => t,
    cadaIntervalo: (fn) => {
      tic = fn
      return () => (tic = undefined)
    },
    ...(opciones.conEspera ? { esperar: (ms: number) => (ms === LIMITES_GRABACION.colaMs ? new Promise<void>((ok) => esperas.push(ok)) : Promise.resolve()) } : {}),
    ...(opciones.niveles ? { medirNivel: () => ({ leer: () => niveles.shift() ?? 0, cerrar: () => undefined }) } : {})
  }
  const g = new Grabadora(d, (x) => textos.push(x))
  return {
    g,
    textos,
    transcribir,
    estadoVoz,
    pedirMicrofono,
    pistas,
    grabadores,
    avanzar: (ms: number) => {
      t += ms
      tic?.()
    },
    esperar: () => new Promise((r) => setTimeout(r, 0)),
    /** Deja pasar las pausas (calentamiento y cola) que el reloj falso no avanza solo. */
    liberarEspera: async () => {
      while (esperas.length) esperas.shift()!()
      await new Promise((r) => setTimeout(r, 0))
    },
    desconectarMicrofono: () => pistaFalsa.onended?.()
  }
}

describe('grabadora de voz', () => {
  it('graba, al terminar transcribe UNA vez y entrega la transcripción literal (no envía nada) y apaga el micrófono', async () => {
    const m = montar()
    await m.g.iniciar()
    expect(m.g.actual.fase).toBe('grabando')
    m.avanzar(4200)
    expect(m.g.actual.ms).toBe(4200)
    m.g.terminar()
    await m.esperar()
    await m.esperar()
    expect(m.transcribir).toHaveBeenCalledTimes(1)
    const [pcm, ms] = m.transcribir.mock.calls[0] as unknown as [Float32Array, number]
    expect(pcm).toBeInstanceOf(Float32Array)
    expect(pcm.length).toBe(3000)
    expect(ms).toBe(4200)
    expect(m.textos).toEqual([{ texto: 'eh arregla el el login' }]) // literal: no se reescribe
    expect(m.g.actual.fase).toBe('inactivo')
    expect(m.pistas.paradas).toBe(1)
  })

  it('si el dictado no está disponible no abre el micrófono', async () => {
    const m = montar({ estado: { ok: false, codigo: 'VOZ_ERROR', mensaje: 'No disponible.' } })
    await m.g.iniciar()
    expect(m.pedirMicrofono).not.toHaveBeenCalled()
    expect(m.g.actual).toMatchObject({ fase: 'error', error: { codigo: 'VOZ_ERROR' } })
    expect(m.transcribir).not.toHaveBeenCalled()
  })

  it('sin el modelo en el equipo avisa de la descarga mientras transcribe', async () => {
    let soltar: (r: ResultadoVoz) => void = () => undefined
    const m = montar({ estado: { ok: true, maxSegundos: 180, modeloListo: false }, resultado: new Promise<ResultadoVoz>((r) => (soltar = r)) })
    await m.g.iniciar()
    m.avanzar(2000)
    m.g.terminar()
    await m.esperar()
    await m.esperar()
    expect(m.g.actual).toMatchObject({ fase: 'procesando', descargaModelo: true })
    soltar({ ok: true, texto: 'hola' })
    await m.esperar()
    expect(m.g.actual).toMatchObject({ fase: 'inactivo', descargaModelo: false })
  })

  it('cancelar descarta lo grabado: ni se transcribe ni se escribe nada', async () => {
    const m = montar()
    await m.g.iniciar()
    m.avanzar(3000)
    m.g.cancelar()
    await m.esperar()
    expect(m.transcribir).not.toHaveBeenCalled()
    expect(m.textos).toEqual([])
    expect(m.g.actual.fase).toBe('inactivo')
    expect(m.pistas.paradas).toBe(1)
  })

  it('cancelar mientras se procesa ignora el resultado que llega tarde', async () => {
    let soltar: (r: ResultadoVoz) => void = () => undefined
    const m = montar({ resultado: new Promise<ResultadoVoz>((r) => (soltar = r)) })
    await m.g.iniciar()
    m.avanzar(2000)
    m.g.terminar()
    await m.esperar()
    expect(m.g.actual.fase).toBe('procesando')
    m.g.cancelar()
    soltar({ ok: true, texto: 'tarde' })
    await m.esperar()
    expect(m.textos).toEqual([])
    expect(m.g.actual.fase).toBe('inactivo')
  })

  it('se para sola al llegar al máximo que permite el servidor', async () => {
    const m = montar({ estado: { ok: true, maxSegundos: 10, modeloListo: true } })
    await m.g.iniciar()
    expect(m.g.actual.maxMs).toBe(10_000)
    m.avanzar(10_500)
    await m.esperar()
    await m.esperar()
    expect(m.grabadores[0]!.estado).toBe('parado')
    expect((m.transcribir.mock.calls[0] as unknown as unknown[])[1]).toBe(10_000)
  })

  it('una grabación de un clic (demasiado corta) no gasta una transcripción', async () => {
    const m = montar()
    await m.g.iniciar()
    m.avanzar(200)
    m.g.terminar()
    await m.esperar()
    expect(m.transcribir).not.toHaveBeenCalled()
    expect(m.g.actual.error?.codigo).toBe('VOZ_VACIO')
  })

  it('micrófono denegado, fallo del modelo y estado caído: error legible y se puede volver a intentar', async () => {
    const sinMic = montar({ microfono: 'denegado' })
    await sinMic.g.iniciar()
    expect(sinMic.g.actual.error?.codigo).toBe('VOZ_MICROFONO')
    const limite = montar({ resultado: { ok: false, codigo: 'VOZ_MODELO', mensaje: 'No se pudo preparar el modelo de voz.' } })
    await limite.g.iniciar()
    limite.avanzar(2000)
    limite.g.terminar()
    await limite.esperar()
    await limite.esperar()
    expect(limite.g.actual).toMatchObject({ fase: 'error', error: { codigo: 'VOZ_MODELO' } })
    const caido = montar()
    caido.estadoVoz.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await caido.g.iniciar()
    expect(caido.g.actual.error?.codigo).toBe('VOZ_ERROR')
    await caido.g.iniciar() // reintento
    expect(caido.g.actual.fase).toBe('grabando')
  })

  it('sigue grabando un instante tras «Terminar» (para no cortar la última palabra) y pide lo pendiente antes de parar', async () => {
    const m = montar({ conEspera: true })
    await m.g.iniciar()
    m.avanzar(3000)
    m.g.terminar()
    expect(m.grabadores[0]!.estado).toBe('grabando') // aún en la cola
    m.g.terminar() // un segundo clic no hace nada
    await m.liberarEspera()
    await m.esperar()
    expect(m.grabadores[0]!.estado).toBe('parado')
    expect(m.grabadores[0]!.pidioDatos).toBe(1)
    expect(m.transcribir).toHaveBeenCalledTimes(1)
  })

  it('cancelar durante la cola no transcribe nada', async () => {
    const m = montar({ conEspera: true })
    await m.g.iniciar()
    m.avanzar(3000)
    m.g.terminar()
    m.g.cancelar()
    await m.liberarEspera()
    await m.esperar()
    expect(m.transcribir).not.toHaveBeenCalled()
    expect(m.textos).toEqual([])
  })

  it('muestra el nivel del micrófono y avisa si pasados 3 s no se oye nada', async () => {
    const callado = montar({ niveles: [0, 0, 0] })
    await callado.g.iniciar()
    callado.avanzar(1000)
    expect(callado.g.actual.sinSonido).toBe(false)
    callado.avanzar(2500)
    expect(callado.g.actual.sinSonido).toBe(true)
    const habla = montar({ niveles: [0, 0.4, 0.2] })
    await habla.g.iniciar()
    habla.avanzar(1000)
    expect(habla.g.actual.nivel).toBe(0)
    habla.avanzar(1000)
    expect(habla.g.actual.nivel).toBe(0.4)
    habla.avanzar(2500)
    expect(habla.g.actual.sinSonido).toBe(false)
  })

  it('si el micrófono se desconecta grabando, avisa en vez de entregar un audio cortado', async () => {
    const m = montar()
    await m.g.iniciar()
    m.avanzar(2000)
    m.desconectarMicrofono()
    expect(m.g.actual).toMatchObject({ fase: 'error', error: { codigo: 'VOZ_MICROFONO' } })
    await m.esperar()
    expect(m.transcribir).not.toHaveBeenCalled()
  })

  it('elige el formato comprimido que admita el equipo', () => {
    expect(elegirFormato((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(elegirFormato((m) => m === 'audio/mp4')).toBe('audio/mp4')
    expect(elegirFormato(() => false)).toBeUndefined()
    expect(formatoTiempo(75_400)).toBe('1:15')
  })
})

describe('ServicioVoz (proceso principal)', () => {
  const motor = (transcribir: MotorVoz['transcribir'] = async () => 'hola', listo = true): MotorVoz & { transcribir: ReturnType<typeof vi.fn> } =>
    ({ listo: () => listo, transcribir: vi.fn(transcribir) }) as never

  it('informa si el modelo ya está descargado, sin pedir claves', () => {
    expect(new ServicioVoz(motor()).estado()).toEqual({ ok: true, maxSegundos: 180, modeloListo: true })
    expect(new ServicioVoz(motor(undefined, false)).estado()).toMatchObject({ modeloListo: false })
  })

  it('transcribe en local y devuelve el texto literal', async () => {
    const m = motor(async () => 'arregla el login')
    expect(await new ServicioVoz(m).transcribir(new Float32Array(32_000), 2000)).toEqual({ ok: true, texto: 'arregla el login' })
    expect(m.transcribir).toHaveBeenCalledTimes(1)
    expect(await new ServicioVoz(motor(async () => '')).transcribir(new Float32Array(32_000), 2000)).toMatchObject({ ok: false, codigo: 'VOZ_VACIO' })
    expect(await new ServicioVoz(motor(async () => Promise.reject(new Error('x')))).transcribir(new Float32Array(32_000), 2000)).toMatchObject({ ok: false, codigo: 'VOZ_ERROR' })
  })

  it('no procesa nada inválido', async () => {
    const m = motor()
    const s = new ServicioVoz(m)
    expect(await s.transcribir(new Uint8Array(10), 1000)).toMatchObject({ codigo: 'VOZ_FORMATO' })
    expect(await s.transcribir(new Float32Array(0), 1000)).toMatchObject({ codigo: 'VOZ_VACIO' })
    expect(await s.transcribir(new Float32Array(16_000 * 200), 1000)).toMatchObject({ codigo: 'VOZ_DURACION' })
    expect(m.transcribir).not.toHaveBeenCalled()
  })
})

describe('interfaz del dictado', () => {
  const control = (estado: Partial<EstadoGrabacion>): ControlGrabadora => ({
    estado: { fase: 'inactivo', ms: 0, maxMs: 180_000, nivel: 0, sinSonido: false, ...estado },
    iniciar: () => undefined,
    terminar: () => undefined,
    cancelar: () => undefined,
    descartarError: () => undefined
  })

  it('en reposo solo está el botón del micrófono', () => {
    expect(renderToString(<BarraGrabacion voz={control({})} />)).toBe('')
    expect(renderToString(<BotonMicrofono voz={control({})} />)).toContain('aria-label="Dictar por voz"')
  })

  it('grabando: indicador, temporizador, cancelar y terminar', () => {
    const html = renderToString(<BarraGrabacion voz={control({ fase: 'grabando', ms: 65_000 })} />)
    expect(html).toContain('ag-voz-punto')
    expect(html).toContain('1:05<!-- --> / <!-- -->3:00')
    expect(html).toContain('Cancelar')
    expect(html).toContain('Terminar')
    expect(renderToString(<BotonMicrofono voz={control({ fase: 'grabando' })} />)).toContain('aria-pressed="true"')
  })

  it('procesando: estado visible y el botón no deja lanzar otra grabación', () => {
    expect(renderToString(<BarraGrabacion voz={control({ fase: 'procesando' })} />)).toContain('Transcribiendo…')
    expect(renderToString(<BotonMicrofono voz={control({ fase: 'procesando' })} />)).toMatch(/<button[^>]*disabled/)
  })

  it('primera vez: avisa de la descarga del modelo', () => {
    expect(renderToString(<BarraGrabacion voz={control({ fase: 'procesando', descargaModelo: true })} />)).toContain('Descargando el modelo de voz')
  })

  it('error: aviso con el mensaje', () => {
    const html = renderToString(<BarraGrabacion voz={control({ fase: 'error', error: { codigo: 'VOZ_MODELO', mensaje: 'No se pudo preparar el modelo de voz.' } })} />)
    expect(html).toContain('No se pudo dictar')
    expect(html).toContain('modelo de voz')
    expect(html).toContain('role="alert"')
  })
})
