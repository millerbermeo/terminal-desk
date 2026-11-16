/**
 * Grabación de una llamada como la de Meet: un solo video con lo que se ve (pantalla compartida o cámara del otro en grande, las
 * cámaras en miniatura, o los nombres si es de voz) y el audio de los dos mezclado. Se compone en un `<canvas>` y se graba con
 * `MediaRecorder`; los trozos (1 s) van a main, que los escribe en disco según llegan: una llamada larga no se acumula en memoria
 * y, si la app se cierra de golpe, lo grabado hasta ahí queda en el archivo.
 */

export interface EscenaLlamada {
  /** Audio y cámara del otro. */
  remoto?: MediaStream
  camaraRemota: boolean
  /** Solo si el otro está compartiendo. */
  pantallaRemota?: MediaStream
  /** Mi micrófono y mi cámara. */
  local?: MediaStream
  miCamara: boolean
  pantallaLocal?: MediaStream
  otro: string
}

const ANCHO = 1280
const ALTO = 720
const FPS = 25
const FORMATOS = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
const MINI = { ancho: 256, alto: 144, margen: 16 }

const pistaVideo = (f?: MediaStream): MediaStreamTrack | undefined => f?.getVideoTracks().find((t) => t.readyState === 'live')
const inicial = (nombre: string): string => (nombre.trim()[0] ?? '?').toUpperCase()

export class GrabadorLlamada {
  private readonly lienzo = document.createElement('canvas')
  private c2d?: CanvasRenderingContext2D
  /** Un `<video>` (fuera del DOM) por pista que se dibuja. */
  private readonly videos = new Map<string, HTMLVideoElement>()
  private audio?: AudioContext
  private destino?: MediaStreamAudioDestinationNode
  private readonly conectadas = new Set<string>()
  private rec?: MediaRecorder
  private id?: string
  private cola: Promise<void> = Promise.resolve()
  private fallo = false
  private reloj?: number
  private inicio = 0

  constructor(
    private readonly escena: () => EscenaLlamada,
    /** Falló la escritura (disco lleno…): la llamada debe parar la grabación. */
    private readonly alFallo: (mensaje: string) => void
  ) {}

  get segundos(): number {
    return this.inicio ? Math.round((Date.now() - this.inicio) / 1000) : 0
  }

  async iniciar(con: string): Promise<void> {
    if (typeof MediaRecorder === 'undefined') throw new Error('este sistema no puede grabar')
    const { id } = await window.api.chat.operar('grabacionIniciar', { con })
    this.id = id
    try {
      this.lienzo.width = ANCHO
      this.lienzo.height = ALTO
      const c = this.lienzo.getContext('2d', { alpha: false })
      if (!c) throw new Error('sin lienzo')
      this.c2d = c
      this.audio = new AudioContext()
      void this.audio.resume().catch(() => undefined)
      this.destino = this.audio.createMediaStreamDestination()
      this.conectarAudio()
      this.dibujar()
      const flujo = new MediaStream([...this.lienzo.captureStream(FPS).getVideoTracks(), ...this.destino.stream.getAudioTracks()])
      const mime = FORMATOS.find((m) => MediaRecorder.isTypeSupported(m))
      const rec = new MediaRecorder(flujo, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.cola = this.cola.then(() => this.enviar(id, e.data))
      }
      rec.onerror = () => this.fallar('la grabación se interrumpió')
      rec.start(1000)
      this.rec = rec
      this.inicio = Date.now()
      // Con setInterval (no requestAnimationFrame): main desactiva la ralentización de la ventana mientras se graba, así sigue
      // dibujando aunque esté minimizada.
      this.reloj = window.setInterval(() => {
        this.conectarAudio()
        this.dibujar()
      }, 1000 / FPS)
    } catch (err) {
      await this.cancelar()
      throw err
    }
  }

  /** Para y guarda. Devuelve dónde quedó (null si no llegó a empezar). */
  async detener(): Promise<{ ruta: string; nombre: string } | null> {
    const rec = this.rec
    const id = this.id
    this.rec = undefined
    this.id = undefined
    if (!rec || !id) return null
    // Se para ya (antes de que la llamada suelte sus pistas); el último trozo llega antes de `onstop`.
    const parado = rec.state === 'inactive' ? Promise.resolve() : new Promise<void>((ok) => (rec.onstop = () => ok()))
    if (rec.state !== 'inactive') rec.stop()
    window.clearInterval(this.reloj)
    await parado
    this.soltar()
    await this.cola
    return window.api.chat.operar('grabacionTerminar', { id })
  }

  /** Descarta lo grabado. */
  async cancelar(): Promise<void> {
    const rec = this.rec
    const id = this.id
    this.rec = undefined
    this.id = undefined
    this.fallo = true // los trozos pendientes ya no se escriben
    if (rec && rec.state !== 'inactive') rec.stop()
    this.soltar()
    await this.cola
    if (id) await window.api.chat.operar('grabacionCancelar', { id }).catch(() => undefined)
  }

  private async enviar(id: string, trozo: Blob): Promise<void> {
    if (this.fallo) return
    try {
      await window.api.chat.operar('grabacionTrozo', { id, datos: new Uint8Array(await trozo.arrayBuffer()) })
    } catch (err) {
      this.fallar((err as Error).message)
    }
  }

  private fallar(motivo: string): void {
    if (this.fallo) return
    this.fallo = true
    this.alFallo(`Se detuvo la grabación: ${motivo}. Lo grabado hasta ahora se guardó.`)
  }

  private soltar(): void {
    window.clearInterval(this.reloj)
    for (const v of this.videos.values()) {
      v.pause()
      v.srcObject = null
    }
    this.videos.clear()
    this.conectadas.clear()
    void this.audio?.close().catch(() => undefined)
    this.audio = undefined
    this.destino = undefined
  }

  /** Mezcla en la grabación cada pista de audio nueva (la mía y la del otro; las que se apagan simplemente callan). */
  private conectarAudio(): void {
    const { audio, destino } = this
    if (!audio || !destino) return
    const e = this.escena()
    for (const t of [...(e.local?.getAudioTracks() ?? []), ...(e.remoto?.getAudioTracks() ?? [])]) {
      if (this.conectadas.has(t.id) || t.readyState !== 'live') continue
      try {
        audio.createMediaStreamSource(new MediaStream([t])).connect(destino)
        this.conectadas.add(t.id)
      } catch {
        /* esa pista no se puede mezclar: se sigue con las demás */
      }
    }
  }

  private video(pista: MediaStreamTrack): HTMLVideoElement {
    let v = this.videos.get(pista.id)
    if (!v) {
      v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.srcObject = new MediaStream([pista])
      void v.play().catch(() => undefined)
      this.videos.set(pista.id, v)
    }
    return v
  }

  private dibujar(): void {
    const c = this.c2d
    if (!c) return
    const e = this.escena()
    c.fillStyle = '#0d0e12'
    c.fillRect(0, 0, ANCHO, ALTO)
    const camRemota = e.camaraRemota ? pistaVideo(e.remoto) : undefined
    const camPropia = e.miCamara ? pistaVideo(e.local) : undefined
    const pantalla = pistaVideo(e.pantallaRemota) ?? pistaVideo(e.pantallaLocal)
    const principal = pantalla ?? camRemota

    if (principal) {
      this.contener(this.video(principal), 0, 0, ANCHO, ALTO)
    } else {
      // Sin imagen grande: los dos lado a lado (cámara si la hay, si no la inicial), como en una llamada de voz.
      const w = 560
      const h = 315
      const y = (ALTO - h) / 2
      this.mosaico(undefined, e.otro, (ANCHO - 2 * w - 24) / 2, y, w, h, false)
      this.mosaico(camPropia, 'Tú', (ANCHO - 2 * w - 24) / 2 + w + 24, y, w, h, true)
    }

    if (principal) {
      const minis: { pista?: MediaStreamTrack; nombre: string; espejo: boolean }[] = []
      if (pantalla) minis.push({ pista: camRemota, nombre: e.otro, espejo: false })
      minis.push({ pista: camPropia, nombre: 'Tú', espejo: true })
      let x = ANCHO - MINI.margen - MINI.ancho
      for (const m of minis.reverse()) {
        this.mosaico(m.pista, m.nombre, x, ALTO - MINI.margen - MINI.alto, MINI.ancho, MINI.alto, m.espejo)
        x -= MINI.ancho + 12
      }
      if (camRemota && principal === camRemota) this.etiqueta(e.otro, 16, ALTO - 16)
      if (pantalla) this.etiqueta(pistaVideo(e.pantallaRemota) ? `Pantalla de ${e.otro}` : 'Tu pantalla', 16, 16 + 34, true)
    }
  }

  /** Dibuja la imagen entera (con bandas si no encaja). */
  private contener(v: HTMLVideoElement, x: number, y: number, w: number, h: number): void {
    if (!v.videoWidth || !v.videoHeight) return
    const k = Math.min(w / v.videoWidth, h / v.videoHeight)
    const dw = v.videoWidth * k
    const dh = v.videoHeight * k
    this.c2d!.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }

  /** Un recuadro con la cámara (recortada para llenarlo) o, sin cámara, la inicial; con el nombre abajo. */
  private mosaico(pista: MediaStreamTrack | undefined, nombre: string, x: number, y: number, w: number, h: number, espejo: boolean): void {
    const c = this.c2d!
    c.save()
    c.beginPath()
    c.roundRect(x, y, w, h, 14)
    c.clip()
    c.fillStyle = '#23252d'
    c.fillRect(x, y, w, h)
    const v = pista ? this.video(pista) : undefined
    if (v?.videoWidth && v.videoHeight) {
      const k = Math.max(w / v.videoWidth, h / v.videoHeight)
      const dw = v.videoWidth * k
      const dh = v.videoHeight * k
      if (espejo) {
        c.translate(x + w, y)
        c.scale(-1, 1)
        c.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh)
      } else c.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    } else {
      const r = Math.min(w, h) * 0.22
      c.fillStyle = '#3a3d4a'
      c.beginPath()
      c.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#fff'
      c.font = `600 ${Math.round(r)}px system-ui, sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(inicial(nombre), x + w / 2, y + h / 2)
    }
    c.restore()
    this.etiqueta(nombre, x + 8, y + h - 8)
  }

  /** Nombre sobre una píldora oscura; `(x, y)` es la esquina inferior izquierda. */
  private etiqueta(texto: string, x: number, y: number, grande = false): void {
    const c = this.c2d!
    c.save()
    c.font = `600 ${grande ? 16 : 13}px system-ui, sans-serif`
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    const t = texto.length > 40 ? `${texto.slice(0, 39)}…` : texto
    const w = c.measureText(t).width + 20
    const h = grande ? 30 : 24
    c.fillStyle = 'rgba(0, 0, 0, 0.55)'
    c.beginPath()
    c.roundRect(x, y - h, w, h, h / 2)
    c.fill()
    c.fillStyle = '#fff'
    c.fillText(t, x + 10, y - h / 2)
    c.restore()
  }
}
