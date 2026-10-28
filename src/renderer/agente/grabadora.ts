import { useEffect, useRef, useSyncExternalStore } from 'react'
import { LIMITES_GRABACION, elegirFormato, type CodigoVoz, type EstadoVoz, type ResultadoVoz } from '@shared/voz'

export type FaseGrabacion = 'inactivo' | 'preparando' | 'grabando' | 'procesando' | 'error'

export interface EstadoGrabacion {
  fase: FaseGrabacion
  /** Tiempo grabado (se actualiza ~4 veces por segundo). */
  ms: number
  maxMs: number
  error?: { codigo: CodigoVoz; mensaje: string }
}

/** Lo mínimo de MediaRecorder que se usa (así se prueba sin navegador). */
export interface Grabador {
  start(): void
  stop(): void
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
}

export interface DependenciasGrabadora {
  estadoVoz(): Promise<EstadoVoz>
  pedirMicrofono(): Promise<MediaStream>
  admite(mime: string): boolean
  crearGrabador(stream: MediaStream, mime: string, bitsPorSegundo: number): Grabador
  transcribir(audio: Uint8Array, mime: string, duracionMs: number, mejorar: boolean): Promise<ResultadoVoz>
  ahora(): number
  cadaIntervalo(fn: () => void, ms: number): () => void
}

export interface TextoDictado {
  texto: string
  original: string
  mejorado: boolean
}

/**
 * Ciclo de una grabación: comprueba que el servidor tenga el dictado configurado ANTES de abrir el micrófono, graba Opus mono
 * comprimido, se para sola al llegar al máximo, y manda UNA sola petición de transcripción. Nunca envía el mensaje: entrega el texto.
 */
export class Grabadora {
  private estado: EstadoGrabacion = { fase: 'inactivo', ms: 0, maxMs: LIMITES_GRABACION.maxMs }
  private readonly oyentes = new Set<() => void>()
  private grabador?: Grabador
  private stream?: MediaStream
  private trozos: Blob[] = []
  private mime = ''
  private inicio = 0
  private pararReloj?: () => void
  private cancelada = false
  /** Cada grabación tiene su número: un resultado que llega tarde (cancelada mientras se procesaba) se descarta. */
  private turno = 0

  constructor(
    private readonly d: DependenciasGrabadora,
    private readonly alTexto: (t: TextoDictado) => void,
    private readonly mejorar: () => boolean = () => true
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
    this.fijar({ fase: 'error', ms: 0, error: { codigo, mensaje } })
  }

  async iniciar(): Promise<void> {
    if (this.estado.fase !== 'inactivo' && this.estado.fase !== 'error') return
    const turno = ++this.turno
    this.cancelada = false
    this.fijar({ fase: 'preparando', ms: 0 })
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
    g.start()
    this.inicio = this.d.ahora()
    this.fijar({ fase: 'grabando', ms: 0, maxMs })
    this.pararReloj = this.d.cadaIntervalo(() => {
      const ms = this.d.ahora() - this.inicio
      if (ms >= maxMs) return this.terminar() // se para sola al llegar al máximo
      this.fijar({ ms })
    }, 250)
  }

  /** Para y procesa lo grabado. */
  terminar(): void {
    if (this.estado.fase !== 'grabando' || !this.grabador) return
    this.fijar({ ms: Math.min(this.d.ahora() - this.inicio, this.estado.maxMs) })
    this.pararReloj?.()
    this.pararReloj = undefined
    this.grabador.stop()
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
    this.fijar({ fase: 'inactivo', ms: 0 })
  }

  /** Cierra el aviso de error. */
  descartarError(): void {
    if (this.estado.fase === 'error') this.fijar({ fase: 'inactivo', ms: 0 })
  }

  private async alParar(turno: number): Promise<void> {
    const ms = this.estado.ms
    const audio = new Blob(this.trozos, { type: this.mime })
    this.liberar()
    if (turno !== this.turno || this.cancelada) return
    if (ms < LIMITES_GRABACION.minMs || audio.size === 0) return this.fallar('VOZ_VACIO', 'La grabación es demasiado corta: habla y pulsa «Terminar» cuando acabes.')
    this.fijar({ fase: 'procesando' })
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const r = await this.d.transcribir(bytes, this.mime, ms, this.mejorar()).catch((): ResultadoVoz => ({ ok: false, codigo: 'VOZ_SIN_CONEXION', mensaje: 'No se pudo conectar con el servidor.' }))
    if (turno !== this.turno || this.cancelada) return
    if (!r.ok) return this.fallar(r.codigo, r.mensaje)
    this.fijar({ fase: 'inactivo', ms: 0 })
    this.alTexto({ texto: r.texto, original: r.original, mejorado: r.mejorado })
  }

  /** Apaga el micrófono (el indicador del sistema desaparece) y suelta lo grabado. */
  private liberar(): void {
    this.pararReloj?.()
    this.pararReloj = undefined
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
    this.grabador = undefined
    this.trozos = []
  }
}

const dependenciasNavegador = (): DependenciasGrabadora => ({
  estadoVoz: () => window.api.voz.estado(),
  pedirMicrofono: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
  admite: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  crearGrabador: (stream, mime, bits) => new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: bits }) as unknown as Grabador,
  transcribir: (audio, mime, ms, mejorar) => window.api.voz.transcribir(audio, mime, ms, mejorar),
  ahora: () => performance.now(),
  cadaIntervalo: (fn, ms) => {
    const id = window.setInterval(fn, ms)
    return () => window.clearInterval(id)
  }
})

/** Grabadora de la interfaz: una por chat. Al desmontar se cancela (el micrófono nunca queda abierto). */
export function useGrabadora(alTexto: (t: TextoDictado) => void, mejorar: () => boolean = () => true) {
  const alTextoRef = useRef(alTexto)
  alTextoRef.current = alTexto
  const mejorarRef = useRef(mejorar)
  mejorarRef.current = mejorar
  const g = useRef<Grabadora>(undefined as unknown as Grabadora)
  g.current ??= new Grabadora(dependenciasNavegador(), (t) => alTextoRef.current(t), () => mejorarRef.current())
  const estado = useSyncExternalStore(g.current.suscribir, () => g.current.actual)
  useEffect(() => () => g.current.cancelar(), [])
  return { estado, iniciar: () => void g.current.iniciar(), terminar: () => g.current.terminar(), cancelar: () => g.current.cancelar(), descartarError: () => g.current.descartarError() }
}

export type ControlGrabadora = ReturnType<typeof useGrabadora>
