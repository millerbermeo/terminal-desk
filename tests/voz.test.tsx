import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { elegirFormato, formatoTiempo, type EstadoVoz, type ResultadoVoz } from '@shared/voz'
import { Grabadora, type DependenciasGrabadora, type EstadoGrabacion, type Grabador, type TextoDictado } from '../src/renderer/agente/grabadora'
import { BarraGrabacion, BotonMicrofono } from '../src/renderer/components/GrabadorVoz'
import type { ControlGrabadora } from '../src/renderer/agente/grabadora'
import { ErrorServidor, ErrorSesion } from '../src/main/servidor/cliente'
import { ServicioVoz } from '../src/main/voz'

/** Micrófono, MediaRecorder, reloj y backend falsos: se controla a mano cuándo pasa cada cosa. */
function montar(opciones: { estado?: EstadoVoz; resultado?: ResultadoVoz | Promise<ResultadoVoz>; microfono?: 'ok' | 'denegado'; admite?: (m: string) => boolean } = {}) {
  let t = 0
  let tic: (() => void) | undefined
  const pistas = { paradas: 0 }
  const grabadores: (Grabador & { estado: string })[] = []
  const textos: TextoDictado[] = []
  const transcribir = vi.fn(async () => opciones.resultado ?? ({ ok: true, texto: 'Arregla el login.', original: 'eh arregla el el login', mejorado: true } as ResultadoVoz))
  const estadoVoz = vi.fn(async () => opciones.estado ?? ({ ok: true, maxSegundos: 180, maxBytes: 5 * 1024 * 1024 } as EstadoVoz))
  const pedirMicrofono = vi.fn(async () => {
    if (opciones.microfono === 'denegado') throw new DOMException('Permission denied', 'NotAllowedError')
    return { getTracks: () => [{ stop: () => void pistas.paradas++ }] } as unknown as MediaStream
  })
  const d: DependenciasGrabadora = {
    estadoVoz,
    pedirMicrofono,
    admite: opciones.admite ?? ((m) => m === 'audio/webm;codecs=opus'),
    crearGrabador: () => {
      const g: Grabador & { estado: string } = {
        estado: 'inactivo',
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start() {
          this.estado = 'grabando'
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
    transcribir,
    ahora: () => t,
    cadaIntervalo: (fn) => {
      tic = fn
      return () => (tic = undefined)
    }
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
    esperar: () => new Promise((r) => setTimeout(r, 0))
  }
}

describe('grabadora de voz', () => {
  it('graba, al terminar transcribe UNA vez y entrega el texto mejorado (no envía nada) y apaga el micrófono', async () => {
    const m = montar()
    await m.g.iniciar()
    expect(m.g.actual.fase).toBe('grabando')
    m.avanzar(4200)
    expect(m.g.actual.ms).toBe(4200)
    m.g.terminar()
    await m.esperar()
    await m.esperar()
    expect(m.transcribir).toHaveBeenCalledTimes(1)
    const [audio, mime, ms, mejorar] = m.transcribir.mock.calls[0] as unknown as [Uint8Array, string, number, boolean]
    expect(audio.byteLength).toBe(3000)
    expect(mime).toBe('audio/webm;codecs=opus')
    expect(ms).toBe(4200)
    expect(mejorar).toBe(true)
    expect(m.textos).toEqual([{ texto: 'Arregla el login.', original: 'eh arregla el el login', mejorado: true }])
    expect(m.g.actual.fase).toBe('inactivo')
    expect(m.pistas.paradas).toBe(1)
  })

  it('sin GROQ_API_KEY en el servidor no abre el micrófono y muestra las instrucciones', async () => {
    const m = montar({ estado: { ok: false, codigo: 'VOZ_SIN_CLAVE', mensaje: 'Añade GROQ_API_KEY al .env del backend y reinicia el API.' } })
    await m.g.iniciar()
    expect(m.pedirMicrofono).not.toHaveBeenCalled()
    expect(m.g.actual).toMatchObject({ fase: 'error', error: { codigo: 'VOZ_SIN_CLAVE' } })
    expect(m.transcribir).not.toHaveBeenCalled()
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
    soltar({ ok: true, texto: 'tarde', original: 'tarde', mejorado: false })
    await m.esperar()
    expect(m.textos).toEqual([])
    expect(m.g.actual.fase).toBe('inactivo')
  })

  it('se para sola al llegar al máximo que permite el servidor', async () => {
    const m = montar({ estado: { ok: true, maxSegundos: 10, maxBytes: 1e6 } })
    await m.g.iniciar()
    expect(m.g.actual.maxMs).toBe(10_000)
    m.avanzar(10_500)
    await m.esperar()
    await m.esperar()
    expect(m.grabadores[0]!.estado).toBe('parado')
    expect((m.transcribir.mock.calls[0] as unknown as unknown[])[2]).toBe(10_000)
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

  it('micrófono denegado, error del backend y sin conexión: error legible y se puede volver a intentar', async () => {
    const sinMic = montar({ microfono: 'denegado' })
    await sinMic.g.iniciar()
    expect(sinMic.g.actual.error?.codigo).toBe('VOZ_MICROFONO')
    const limite = montar({ resultado: { ok: false, codigo: 'VOZ_LIMITE', mensaje: 'Se alcanzó el límite gratuito de Groq.' } })
    await limite.g.iniciar()
    limite.avanzar(2000)
    limite.g.terminar()
    await limite.esperar()
    await limite.esperar()
    expect(limite.g.actual).toMatchObject({ fase: 'error', error: { codigo: 'VOZ_LIMITE' } })
    const caido = montar()
    caido.estadoVoz.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await caido.g.iniciar()
    expect(caido.g.actual.error?.codigo).toBe('VOZ_SIN_CONEXION')
    await caido.g.iniciar() // reintento: ahora sí hay servidor
    expect(caido.g.actual.fase).toBe('grabando')
  })

  it('elige el formato comprimido que admita el equipo', () => {
    expect(elegirFormato((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(elegirFormato((m) => m === 'audio/mp4')).toBe('audio/mp4')
    expect(elegirFormato(() => false)).toBeUndefined()
    expect(formatoTiempo(75_400)).toBe('1:15')
  })
})

describe('ServicioVoz (proceso principal)', () => {
  const cliente = (get: () => Promise<unknown>, binario: () => Promise<unknown> = async () => ({})) => ({ get: vi.fn(get), binario: vi.fn(binario) }) as never

  it('traduce el estado del backend sin exponer nada de la clave', async () => {
    expect(await new ServicioVoz(cliente(async () => ({ disponible: true, maxSegundos: 180, maxBytes: 5e6 }))).estado()).toEqual({ ok: true, maxSegundos: 180, maxBytes: 5e6 })
    expect(await new ServicioVoz(cliente(async () => ({ disponible: false, codigo: 'VOZ_SIN_CLAVE', mensaje: 'Falta GROQ_API_KEY', maxSegundos: 180, maxBytes: 5e6 }))).estado()).toEqual({ ok: false, codigo: 'VOZ_SIN_CLAVE', mensaje: 'Falta GROQ_API_KEY' })
    expect(await new ServicioVoz(cliente(async () => Promise.reject(new ErrorServidor('No se pudo conectar con el servidor.')))).estado()).toMatchObject({ ok: false, codigo: 'VOZ_SIN_CONEXION' })
    expect(await new ServicioVoz(cliente(async () => Promise.reject(new ErrorServidor('Not Found', 404)))).estado()).toMatchObject({ ok: false, mensaje: expect.stringMatching(/actualiza el backend/) })
    expect(await new ServicioVoz(cliente(async () => Promise.reject(new ErrorSesion()))).estado()).toMatchObject({ ok: false, codigo: 'VOZ_SESION' })
  })

  it('sube el audio en binario con su duración, y los errores del backend llegan con su código', async () => {
    const c = cliente(async () => ({}), async () => ({ texto: 'Hola.', original: 'hola', mejorado: true }))
    const s = new ServicioVoz(c)
    expect(await s.transcribir(new Uint8Array(2000), 'audio/webm;codecs=opus', 4321.6, false)).toEqual({ ok: true, texto: 'Hola.', original: 'hola', mejorado: true })
    expect((c as unknown as { binario: ReturnType<typeof vi.fn> }).binario).toHaveBeenCalledWith('/voz/transcribir?mejorar=0', expect.any(Uint8Array), 'audio/webm', { 'x-duracion-ms': '4322' })
    const falla = new ServicioVoz(cliente(async () => ({}), async () => Promise.reject(new ErrorServidor('Falta la clave', 503, 'VOZ_SIN_CLAVE'))))
    expect(await falla.transcribir(new Uint8Array(2000), 'audio/webm', 1000, true)).toEqual({ ok: false, codigo: 'VOZ_SIN_CLAVE', mensaje: 'Falta la clave' })
  })

  it('no sube nada inválido', async () => {
    const c = cliente(async () => ({}))
    const s = new ServicioVoz(c)
    expect((await s.transcribir(new Uint8Array(0), 'audio/webm', 1000, true)).ok).toBe(false)
    expect(await s.transcribir(new Uint8Array(6 * 1024 * 1024), 'audio/webm', 1000, true)).toMatchObject({ codigo: 'VOZ_TAMANO' })
    expect(await s.transcribir(new Uint8Array(10), 'text/html', 1000, true)).toMatchObject({ codigo: 'VOZ_FORMATO' })
    expect((c as unknown as { binario: ReturnType<typeof vi.fn> }).binario).not.toHaveBeenCalled()
  })
})

describe('interfaz del dictado', () => {
  const control = (estado: Partial<EstadoGrabacion>): ControlGrabadora => ({
    estado: { fase: 'inactivo', ms: 0, maxMs: 180_000, ...estado },
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
    expect(renderToString(<BarraGrabacion voz={control({ fase: 'procesando' })} />)).toContain('Transcribiendo y corrigiendo')
    expect(renderToString(<BotonMicrofono voz={control({ fase: 'procesando' })} />)).toMatch(/<button[^>]*disabled/)
  })

  it('sin clave: aviso de configuración con las instrucciones del servidor', () => {
    const html = renderToString(<BarraGrabacion voz={control({ fase: 'error', error: { codigo: 'VOZ_SIN_CLAVE', mensaje: 'Añade GROQ_API_KEY al .env del backend (terminal-desk-api) y reinicia el API.' } })} />)
    expect(html).toContain('Dictado por voz no configurado')
    expect(html).toContain('GROQ_API_KEY')
    expect(html).toContain('role="alert"')
  })
})
