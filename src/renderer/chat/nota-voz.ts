import { MAX_NOTA_VOZ_MS } from '@shared/chat'
import { elegirFormato } from '@shared/voz'

/** Grabación de notas de voz del chat, sin React ni APIs del navegador (se inyectan): así se puede probar. */

export interface NotaGrabada {
  datos: Uint8Array
  mime: string
  duracionMs: number
}

/** `cerrando`: ya se pulsó «Enviar» y se recoge la cola del audio antes de parar. */
export type FaseNota = 'inactiva' | 'preparando' | 'grabando' | 'pausada' | 'cerrando'

export interface PistaNota {
  stop(): void
  readyState?: string
  onended: (() => void) | null
}
export interface FlujoNota {
  getTracks(): PistaNota[]
  getAudioTracks(): PistaNota[]
}
export interface GrabadorNotaNativo {
  readonly state: 'inactive' | 'recording' | 'paused'
  readonly mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((e: unknown) => void) | null
  start(trozoMs?: number): void
  stop(): void
  pause(): void
  resume(): void
}

export interface DependenciasNota {
  abrir(): Promise<FlujoNota>
  grabador(flujo: FlujoNota, mime: string | undefined): GrabadorNotaNativo
  admite(mime: string): boolean
  /** Volumen 0..1 del micrófono; null si no se puede medir. */
  medidor?(flujo: FlujoNota): { nivel(): number; cerrar(): void } | null
  esperar(ms: number): Promise<void>
  ahora(): number
  /** Texto para la persona a partir del error de `getUserMedia`/`MediaRecorder`. */
  explicar(err: unknown): string
}

export interface EventosNota {
  fase(f: FaseNota): void
  error(mensaje: string): void
  /** La nota se cerró sola al llegar al tope de duración: hay que enviarla. */
  automatica(n: NotaGrabada): void
}

export const LIMITES_NOTA = {
  minMs: 700,
  /** Micrófono abierto antes de grabar: el control de ganancia tarda en asentarse y sin esto se pierde el comienzo. */
  calentamientoMs: 250,
  /** Tras «Enviar» se sigue grabando un instante: lo último dicho aún va por el sistema de audio. */
  colaMs: 300,
  /** Si en este tiempo el volumen nunca pasa de `umbral`, se avisa de que no llega sonido. */
  silencioMs: 3000,
  umbral: 0.02
} as const

export const AVISO_SIN_SONIDO = 'No llega sonido del micrófono. Revisa que no esté silenciado y que sea el correcto en los ajustes de sonido del sistema.'
export const AVISO_MIC_DESCONECTADO = 'Se desconectó el micrófono. Puedes enviar lo grabado o descartarlo.'
export const AVISO_FALLO_GRABACION = 'La grabación falló. Inténtalo de nuevo.'

export class GrabadorNota {
  private faseActual: FaseNota = 'inactiva'
  /** Sube al empezar y al cancelar: lo que llegue tarde de una grabación anterior se ignora. */
  private sesion = 0
  private flujo: FlujoNota | null = null
  private g: GrabadorNotaNativo | null = null
  private med: { nivel(): number; cerrar(): void } | null = null
  private trozos: Blob[] = []
  private acumulado = 0 // ms grabados hasta la última pausa
  private desde = 0 // inicio del tramo actual
  private pico = 0
  private avisoSilencio = false
  private micPerdido = false
  private cierre: Promise<NotaGrabada | null> | null = null
  private resolver: ((n: NotaGrabada | null) => void) | null = null

  constructor(
    private readonly d: DependenciasNota,
    private readonly ev: EventosNota
  ) {}

  get fase(): FaseNota {
    return this.faseActual
  }

  /** Ms grabados (sin pausas), con tope en el máximo. */
  transcurrido(): number {
    const tramo = this.faseActual === 'grabando' ? this.d.ahora() - this.desde : 0
    return Math.min(MAX_NOTA_VOZ_MS, this.acumulado + tramo)
  }

  async iniciar(): Promise<void> {
    if (this.faseActual !== 'inactiva') return
    const s = ++this.sesion
    this.micPerdido = false
    this.poner('preparando')
    let flujo: FlujoNota
    try {
      flujo = await this.d.abrir()
    } catch (err) {
      if (s !== this.sesion) return
      this.soltar()
      this.ev.error(this.d.explicar(err))
      return
    }
    if (s !== this.sesion) {
      // se canceló (o se cerró la pantalla) mientras se pedía el micrófono: soltarlo ya
      flujo.getTracks().forEach((t) => t.stop())
      return
    }
    this.flujo = flujo
    this.med = this.d.medidor?.(flujo) ?? null
    const pista = flujo.getAudioTracks()[0]
    if (pista) pista.onended = () => this.perderMicrofono(s)

    await this.d.esperar(LIMITES_NOTA.calentamientoMs)
    if (s !== this.sesion) return
    if (this.micPerdido || pista?.readyState === 'ended') {
      this.soltar()
      this.ev.error('Se desconectó el micrófono.')
      return
    }

    const mime = elegirFormato((m) => this.d.admite(m))
    let g: GrabadorNotaNativo
    try {
      g = this.d.grabador(flujo, mime)
    } catch (err) {
      this.soltar()
      this.ev.error(this.d.explicar(err))
      return
    }
    this.g = g
    this.trozos = []
    this.acumulado = 0
    this.pico = 0
    this.avisoSilencio = false
    g.ondataavailable = (e) => {
      if (s === this.sesion && e.data.size > 0) this.trozos.push(e.data)
    }
    g.onstop = () => void this.alParar(s, g, mime)
    g.onerror = () => {
      if (s !== this.sesion) return
      this.cancelar()
      this.ev.error(AVISO_FALLO_GRABACION)
    }
    try {
      g.start(250)
    } catch (err) {
      this.soltar()
      this.ev.error(this.d.explicar(err))
      return
    }
    this.desde = this.d.ahora()
    this.poner('grabando')
  }

  pausar(): void {
    const g = this.g
    if (!g) return
    if (this.faseActual === 'grabando' && g.state === 'recording') {
      this.acumulado += this.d.ahora() - this.desde
      g.pause()
      this.poner('pausada')
    } else if (this.faseActual === 'pausada' && g.state === 'paused' && !this.micPerdido) {
      this.desde = this.d.ahora()
      g.resume()
      this.poner('grabando')
    }
  }

  /** Para y devuelve la nota (null si es demasiado corta, está vacía o se canceló). Llamarla dos veces da la misma promesa. */
  terminar(): Promise<NotaGrabada | null> {
    if (this.cierre) return this.cierre
    const g = this.g
    if (!g || g.state === 'inactive' || (this.faseActual !== 'grabando' && this.faseActual !== 'pausada')) return Promise.resolve(null)
    const s = this.sesion
    const grabando = this.faseActual === 'grabando'
    if (grabando) this.acumulado += this.d.ahora() - this.desde
    this.poner('cerrando')
    this.cierre = new Promise((ok) => (this.resolver = ok))
    void (async () => {
      if (grabando && !this.micPerdido) {
        await this.d.esperar(LIMITES_NOTA.colaMs)
        this.acumulado += LIMITES_NOTA.colaMs
      }
      if (s === this.sesion && g.state !== 'inactive') g.stop()
    })()
    return this.cierre
  }

  /** Descarta lo grabado (también mientras se prepara el micrófono). */
  cancelar(): void {
    if (this.faseActual === 'inactiva') return
    this.sesion++
    const r = this.resolver
    this.resolver = null
    r?.(null)
    const g = this.g
    if (g && g.state !== 'inactive') g.stop()
    this.soltar()
  }

  /** Llamar en cada fotograma de la interfaz: mide el volumen, avisa si no llega sonido y cierra la nota en el tope. */
  revisar(): number {
    if (this.faseActual !== 'grabando') return 0
    const nivel = this.med?.nivel() ?? 0
    this.pico = Math.max(this.pico, nivel)
    const t = this.transcurrido()
    if (this.med && !this.avisoSilencio && t >= LIMITES_NOTA.silencioMs && this.pico < LIMITES_NOTA.umbral) {
      this.avisoSilencio = true
      this.ev.error(AVISO_SIN_SONIDO)
    }
    if (t >= MAX_NOTA_VOZ_MS) void this.terminar().then((n) => n && this.ev.automatica(n))
    return nivel
  }

  private perderMicrofono(s: number): void {
    if (s !== this.sesion || this.faseActual === 'inactiva' || this.faseActual === 'cerrando') return
    this.micPerdido = true
    if (this.faseActual === 'preparando') return // `iniciar` lo ve al acabar el calentamiento
    if (this.faseActual === 'grabando') this.pausar()
    this.ev.error(AVISO_MIC_DESCONECTADO)
  }

  private async alParar(s: number, g: GrabadorNotaNativo, mime: string | undefined): Promise<void> {
    if (s !== this.sesion) return // cancelada: `cancelar` ya resolvió y soltó
    const resolver = this.resolver
    this.resolver = null
    const duracionMs = Math.min(MAX_NOTA_VOZ_MS, Math.round(this.acumulado))
    const tipo = g.mimeType || mime || 'audio/webm'
    const blob = new Blob(this.trozos, { type: tipo })
    this.soltar()
    if (duracionMs < LIMITES_NOTA.minMs || blob.size === 0) return resolver?.(null)
    resolver?.({ datos: new Uint8Array(await blob.arrayBuffer()), mime: tipo, duracionMs })
  }

  private soltar(): void {
    this.flujo?.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
    this.flujo = null
    this.med?.cerrar()
    this.med = null
    this.g = null
    this.trozos = []
    this.cierre = null
    this.acumulado = 0
    this.poner('inactiva')
  }

  private poner(f: FaseNota): void {
    if (this.faseActual === f) return
    this.faseActual = f
    this.ev.fase(f)
  }
}
