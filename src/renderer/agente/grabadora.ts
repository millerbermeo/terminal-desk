import { useEffect, useRef, useSyncExternalStore } from 'react'
import { LIMITES_GRABACION, UMBRAL_SONIDO, elegirFormato, type CodigoVoz, type EstadoVoz, type ResultadoVoz } from '@shared/voz'

export type FaseGrabacion = 'inactivo' | 'preparando' | 'grabando' | 'procesando' | 'error'

export interface EstadoGrabacion {
  fase: FaseGrabacion
  /** Tiempo grabado (se actualiza ~4 veces por segundo). */
  ms: number
  maxMs: number
  /** Volumen que capta el micrófono ahora (0–1), para el indicador de nivel. */
  nivel: number
  /** Pasados unos segundos no se ha oído nada: el micrófono no capta sonido. */
  sinSonido: boolean
  error?: { codigo: CodigoVoz; mensaje: string }
}

/** Lo mínimo de MediaRecorder que se usa (así se prueba sin navegador). */
export interface Grabador {
  start(timeslice?: number): void
  stop(): void
  /** Entrega lo grabado hasta ahora (se pide justo antes de parar para no perder el final). */
  requestData?(): void
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
}

export interface DependenciasGrabadora {
  estadoVoz(): Promise<EstadoVoz>
  pedirMicrofono(): Promise<MediaStream>
  admite(mime: string): boolean
  crearGrabador(stream: MediaStream, mime: string, bitsPorSegundo: number): Grabador
  transcribir(audio: Uint8Array, mime: string, duracionMs: number): Promise<ResultadoVoz>
  ahora(): number
  cadaIntervalo(fn: () => void, ms: number): () => void
  /** Pausa (calentamiento antes de grabar y cola tras «Terminar»). Sin ella no se espera. */
  esperar?(ms: number): Promise<void>
  /** Mide el volumen del micrófono: `leer()` da el pico desde la lectura anterior (0–1). */
  medirNivel?(stream: MediaStream): { leer(): number; cerrar(): void }
}

export interface TextoDictado {
  /** Transcripción literal, tal cual la devuelve el reconocedor de voz. */
  texto: string
}

/**
 * Ciclo de una grabación: comprueba que el servidor tenga el dictado configurado ANTES de abrir el micrófono, graba Opus mono
 * comprimido, se para sola al llegar al máximo, y manda UNA sola petición de transcripción. Nunca envía el mensaje: entrega el texto
 * literal (sin pasar por ninguna IA de redacción) para que se edite en el campo.
 */
export class Grabadora {
  private estado: EstadoGrabacion = { fase: 'inactivo', ms: 0, maxMs: LIMITES_GRABACION.maxMs, nivel: 0, sinSonido: false }
  private readonly oyentes = new Set<() => void>()
  private grabador?: Grabador
  private stream?: MediaStream
  private trozos: Blob[] = []
  private mime = ''
  private inicio = 0
  private pararReloj?: () => void
  private cancelada = false
  private cerrando = false
  private medidor?: { leer(): number; cerrar(): void }
  private picoTotal = 0
  /** Cada grabación tiene su número: un resultado que llega tarde (cancelada mientras se procesaba) se descarta. */
  private turno = 0

  constructor(
    private readonly d: DependenciasGrabadora,
    private readonly alTexto: (t: TextoDictado) => void
  ) {}

  get actual(): EstadoGrabacion {
    return this.estado
  }

  suscribir = (cb: () => void): (() => void) => {
    this.oyentes.add(cb)
    return () => this.oyentes.delete(cb)
  }

  /** Al pasar a una fase que no es de error, el error anterior desaparece. */
  private fijar(cambio: Partial<EstadoGrabacion>): void {
    const { error: _anterior, ...sinError } = this.estado
    this.estado = { ...(cambio.fase && cambio.fase !== 'error' ? sinError : this.estado), ...cambio }
    for (const o of this.oyentes) o()
  }

  private fallar(codigo: CodigoVoz, mensaje: string): void {
    this.liberar()
    this.fijar({ fase: 'error', ms: 0, nivel: 0, sinSonido: false, error: { codigo, mensaje } })
  }

  async iniciar(): Promise<void> {
    if (this.estado.fase !== 'inactivo' && this.estado.fase !== 'error') return
    const turno = ++this.turno
    this.cancelada = false
    this.cerrando = false
    this.picoTotal = 0
    this.fijar({ fase: 'preparando', ms: 0, nivel: 0, sinSonido: false })
    const e = await this.d.estadoVoz().catch((): EstadoVoz => ({ ok: false, codigo: 'VOZ_SIN_CONEXION', mensaje: 'No se pudo conectar con el servidor.' }))
    if (turno !== this.turno || this.cancelada) return
    if (!e.ok) return this.fallar(e.codigo, e.mensaje)
    const maxMs = Math.min(LIMITES_GRABACION.maxMs, e.maxSegundos * 1000)
    const mime = elegirFormato((m) => this.d.admite(m))
    if (!mime) return this.fallar('VOZ_FORMATO', 'Este equipo no puede grabar audio comprimido.')
    try {
      this.stream = await this.d.pedirMicrofono()
    } catch {
      return this.fallar('VOZ_MICROFONO', 'No se pudo usar el micrófono. Revisa que esté conectado y que el sistema permita a la aplicación usarlo.')
    }
    if (turno !== this.turno || this.cancelada) return this.liberar()
    // Si el micrófono se desconecta a mitad de la grabación, se avisa en vez de entregar un audio cortado.
    for (const pista of this.stream.getAudioTracks?.() ?? []) {
      pista.onended = () => {
        if (this.estado.fase !== 'grabando') return
        this.turno++
        this.fallar('VOZ_MICROFONO', 'El micrófono se desconectó durante la grabación.')
      }
    }
    this.medidor = this.d.medirNivel?.(this.stream)
    // El control de ganancia del micrófono tarda un instante en estabilizarse: sin esta espera se pierde el comienzo de la frase.
    await this.d.esperar?.(LIMITES_GRABACION.calentamientoMs)
    if (turno !== this.turno || this.cancelada) return this.liberar()
    this.mime = mime
    this.trozos = []
    const g = this.d.crearGrabador(this.stream, mime, LIMITES_GRABACION.bitsPorSegundo)
    g.ondataavailable = (ev) => ev.data.size > 0 && this.trozos.push(ev.data)
    g.onerror = () => {
      this.turno++ // lo que llegue después (onstop) ya no cuenta
      this.fallar('VOZ_MICROFONO', 'La grabación se interrumpió.')
    }
    g.onstop = () => void this.alParar(turno)
    this.grabador = g
    g.start(1000) // entrega trozos cada segundo: si algo falla, lo ya grabado no se pierde
    this.inicio = this.d.ahora()
    this.fijar({ fase: 'grabando', ms: 0, maxMs })
    this.pararReloj = this.d.cadaIntervalo(() => {
      const ms = this.d.ahora() - this.inicio
      if (ms >= maxMs) return this.terminar() // se para sola al llegar al máximo
      const nivel = this.medidor?.leer() ?? 0
      this.picoTotal = Math.max(this.picoTotal, nivel)
      this.fijar({ ms, nivel, sinSonido: Boolean(this.medidor) && ms >= 3000 && this.picoTotal < UMBRAL_SONIDO })
    }, 250)
  }

  /** Para y procesa lo grabado. Sigue grabando un instante más para no cortar la última palabra. */
  terminar(): void {
    if (this.estado.fase !== 'grabando' || !this.grabador || this.cerrando) return
    this.cerrando = true
    this.fijar({ ms: Math.min(this.d.ahora() - this.inicio, this.estado.maxMs) })
    this.pararReloj?.()
    this.pararReloj = undefined
    const turno = this.turno
    const parar = (): void => {
      if (turno !== this.turno || !this.grabador) return // se canceló durante la espera
      this.grabador.requestData?.()
      this.grabador.stop()
    }
    if (this.d.esperar) void this.d.esperar(LIMITES_GRABACION.colaMs).then(parar)
    else parar()
  }

  /** Descarta la grabación (o ignora el resultado si ya se estaba procesando). No se envía nada. */
  cancelar(): void {
    this.cancelada = true
    this.turno++
    if (this.grabador && this.estado.fase === 'grabando') {
      this.grabador.onstop = null
      this.grabador.stop()
    }
    this.liberar()
    this.fijar({ fase: 'inactivo', ms: 0, nivel: 0, sinSonido: false })
  }

  /** Cierra el aviso de error. */
  descartarError(): void {
    if (this.estado.fase === 'error') this.fijar({ fase: 'inactivo', ms: 0, nivel: 0, sinSonido: false })
  }

  private async alParar(turno: number): Promise<void> {
    const ms = this.estado.ms
    const audio = new Blob(this.trozos, { type: this.mime })
    this.liberar()
    if (turno !== this.turno || this.cancelada) return
    if (ms < LIMITES_GRABACION.minMs || audio.size === 0) return this.fallar('VOZ_VACIO', 'La grabación es demasiado corta: habla y pulsa «Terminar» cuando acabes.')
    this.fijar({ fase: 'procesando', nivel: 0, sinSonido: false })
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const r = await this.d.transcribir(bytes, this.mime, ms).catch((): ResultadoVoz => ({ ok: false, codigo: 'VOZ_SIN_CONEXION', mensaje: 'No se pudo conectar con el servidor.' }))
    if (turno !== this.turno || this.cancelada) return
    if (!r.ok) return this.fallar(r.codigo, r.mensaje)
    this.fijar({ fase: 'inactivo', ms: 0 })
    this.alTexto({ texto: r.texto })
  }

  /** Apaga el micrófono (el indicador del sistema desaparece) y suelta lo grabado. */
  private liberar(): void {
    this.pararReloj?.()
    this.pararReloj = undefined
    this.medidor?.cerrar()
    this.medidor = undefined
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
    this.grabador = undefined
    this.trozos = []
  }
}

const dependenciasNavegador = (): DependenciasGrabadora => ({
  estadoVoz: () => window.api.voz.estado(),
  pedirMicrofono: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
  admite: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  crearGrabador: (stream, mime, bits) => new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: bits }) as unknown as Grabador,
  transcribir: (audio, mime, ms) => window.api.voz.transcribir(audio, mime, ms),
  esperar: (ms) => new Promise((ok) => window.setTimeout(ok, ms)),
  medirNivel: (stream) => {
    // Pico de volumen entre lecturas: se muestrea rápido (cada 50 ms) para no perder una sílaba corta.
    const Contexto = window.AudioContext
    const ctx = new Contexto()
    const analizador = ctx.createAnalyser()
    analizador.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analizador)
    const datos = new Uint8Array(analizador.fftSize)
    let pico = 0
    const id = window.setInterval(() => {
      analizador.getByteTimeDomainData(datos)
      let max = 0
      for (const v of datos) max = Math.max(max, Math.abs(v - 128) / 128)
      pico = Math.max(pico, max)
    }, 50)
    return {
      leer: () => {
        const p = pico
        pico = 0
        return Math.min(1, p)
      },
      cerrar: () => {
        window.clearInterval(id)
        void ctx.close().catch(() => undefined)
      }
    }
  },
  ahora: () => performance.now(),
  cadaIntervalo: (fn, ms) => {
    const id = window.setInterval(fn, ms)
    return () => window.clearInterval(id)
  }
})

/** Grabadora de la interfaz: una por chat. Al desmontar se cancela (el micrófono nunca queda abierto). */
export function useGrabadora(alTexto: (t: TextoDictado) => void) {
  const alTextoRef = useRef(alTexto)
  alTextoRef.current = alTexto
  const g = useRef<Grabadora>(undefined as unknown as Grabadora)
  g.current ??= new Grabadora(dependenciasNavegador(), (t) => alTextoRef.current(t))
  const estado = useSyncExternalStore(g.current.suscribir, () => g.current.actual)
  useEffect(() => () => g.current.cancelar(), [])
  return { estado, iniciar: () => void g.current.iniciar(), terminar: () => g.current.terminar(), cancelar: () => g.current.cancelar(), descartarError: () => g.current.descartarError() }
}

export type ControlGrabadora = ReturnType<typeof useGrabadora>
