import { useSyncExternalStore } from 'react'
import type { EventoChat, ServidorIce, UsuarioChat } from '@shared/chat'
import { almacenChat } from './almacen'

export type FaseLlamada = 'inactiva' | 'preparando' | 'llamando' | 'entrante' | 'conectando' | 'en-curso' | 'terminada'

export interface VistaLlamada {
  fase: FaseLlamada
  con?: UsuarioChat
  video: boolean
  llamadaId?: string
  /** Segundos desde que se estableció la llamada. */
  segundos: number
  silenciado: boolean
  /** Mi cámara está apagada (por elección, o porque este equipo no tiene: ver `camaraDisponible`). */
  sinCamara: boolean
  /** Este equipo pudo abrir una cámara al empezar. Sin ella la videollamada sigue solo con audio (se puede reintentar). */
  camaraDisponible: boolean
  /** La otra persona está mandando imagen (lo avisa ella por la señalización). */
  camaraRemota: boolean
  /** Ocultar la miniatura de mi propia cámara (sigue enviándose). */
  ocultarPropia: boolean
  /** Aviso pasajero sobre la cámara («No se encontró una cámara»…). */
  avisoCamara?: string
  local?: MediaStream
  remoto?: MediaStream
  /** Por qué terminó (o no pudo empezar), para mostrarlo unos segundos. */
  mensaje: string
}

const MOTIVOS: Record<string, string> = {
  rechazada: 'Llamada rechazada',
  cancelada: 'Llamada cancelada',
  sin_respuesta: 'No contestó',
  ocupado: 'Está en otra llamada',
  sin_conexion: 'No está conectado',
  no_permitida: 'No puedes llamar a este contacto',
  ya_en_llamada: 'Ya estás en una llamada',
  atendida_en_otro: 'Atendida en otro equipo',
  conexion_perdida: 'Se perdió la conexión',
  colgada: 'Llamada terminada',
  invalida: 'No se pudo iniciar la llamada'
}

/** Mensajes del navegador al pedir micrófono o cámara, en cristiano. */
export function errorDeMedios(err: unknown): string {
  const nombre = (err as { name?: string } | undefined)?.name
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'No hay permiso para usar el micrófono o la cámara. Actívalo en los ajustes del sistema.'
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'No se encontró un micrófono o cámara.'
  if (nombre === 'NotReadableError') return 'El micrófono o la cámara está en uso por otra aplicación.'
  return 'No se pudo acceder al micrófono o la cámara.'
}

/** Tono de llamada generado con Web Audio (sin archivos): dos pitidos cada 2 s. */
class Timbre {
  private ctx?: AudioContext
  private timer?: number
  iniciar(): void {
    this.detener()
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      const pitido = (): void => {
        for (const [t, f] of [[0, 440], [0.35, 480]] as const) {
          const o = ctx.createOscillator()
          const g = ctx.createGain()
          o.frequency.value = f
          g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
          g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.03)
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3)
          o.connect(g).connect(ctx.destination)
          o.start(ctx.currentTime + t)
          o.stop(ctx.currentTime + t + 0.32)
        }
      }
      pitido()
      this.timer = window.setInterval(pitido, 2000)
    } catch {
      /* sin audio: la llamada suena igual en pantalla */
    }
  }
  detener(): void {
    window.clearInterval(this.timer)
    this.timer = undefined
    void this.ctx?.close().catch(() => undefined)
    this.ctx = undefined
  }
}

const inactiva = (): VistaLlamada => ({ fase: 'inactiva', video: false, segundos: 0, silenciado: false, sinCamara: false, camaraDisponible: false, camaraRemota: false, ocultarPropia: false, mensaje: '' })

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const VIDEO: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }

/** Mensaje corto cuando la cámara no se puede abrir (la llamada sigue con audio). */
function avisoDeCamara(err: unknown): string {
  const nombre = (err as { name?: string } | undefined)?.name
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'Este equipo no tiene cámara: estás solo con audio.'
  if (nombre === 'NotReadableError') return 'La cámara está en uso por otra aplicación: estás solo con audio.'
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'Sin permiso para la cámara: estás solo con audio.'
  return 'No se pudo abrir la cámara: estás solo con audio.'
}

/**
 * Micrófono (obligatorio) y, en videollamada, la cámara si la hay. Si la cámara falla (no hay, está ocupada o sin permiso) se sigue
 * solo con audio en vez de cancelar la llamada: así se puede hacer una videollamada entre un equipo con cámara y otro sin ella.
 */
async function abrirMedios(video: boolean): Promise<{ flujo: MediaStream; camara: boolean; aviso?: string }> {
  if (!video) return { flujo: await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false }), camara: false }
  try {
    return { flujo: await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: VIDEO }), camara: true }
  } catch (err) {
    // Sin cámara se sigue con el micrófono; si tampoco hay micrófono (o permiso), este segundo intento lanza y la llamada no empieza.
    const flujo = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false })
    return { flujo, camara: false, aviso: avisoDeCamara(err) }
  }
}

/**
 * Llamadas de voz y video (WebRTC). El audio y el video van directos entre los dos equipos; el servidor solo pasa la oferta, la
 * respuesta y los candidatos ICE por el WebSocket. Quien llama crea la oferta cuando el otro contesta.
 */
class ControlLlamada {
  private vista: VistaLlamada = inactiva()
  private readonly oyentes = new Set<() => void>()
  private pc?: RTCPeerConnection
  private local?: MediaStream
  private candidatosPendientes: RTCIceCandidateInit[] = []
  private soyLlamante = false
  private reloj?: number
  private fin?: number
  private ice: ServidorIce[] = []
  private readonly timbre = new Timbre()

  readonly suscribir = (f: () => void): (() => void) => {
    this.oyentes.add(f)
    return () => this.oyentes.delete(f)
  }
  readonly obtener = (): VistaLlamada => this.vista

  private fijar(c: Partial<VistaLlamada>): void {
    this.vista = { ...this.vista, ...c }
    this.oyentes.forEach((f) => f())
  }

  /** Engancha las llamadas a los eventos del servidor. Devuelve cómo soltarlas. */
  iniciar(): () => void {
    const f = (e: EventoChat): void => void this.alEvento(e)
    almacenChat.alEvento.add(f)
    return () => {
      almacenChat.alEvento.delete(f)
      this.limpiar()
    }
  }

  private orden(o: Parameters<typeof window.api.chat.operar<'tiempoReal'>>[1]['orden']): void {
    void window.api.chat.operar('tiempoReal', { orden: o }).catch(() => undefined)
  }

  private get libre(): boolean {
    return this.vista.fase === 'inactiva' || this.vista.fase === 'terminada'
  }

  /** Pide el micrófono (y la cámara en videollamada) y llama. */
  async llamar(con: UsuarioChat, video: boolean): Promise<void> {
    if (!this.libre) return
    window.clearTimeout(this.fin)
    this.soyLlamante = true
    this.fijar({ ...inactiva(), fase: 'preparando', con, video, camaraRemota: video })
    try {
      const m = await abrirMedios(video)
      this.local = m.flujo
      this.fijar({ camaraDisponible: m.camara, sinCamara: video && !m.camara, ...(m.aviso ? { avisoCamara: m.aviso } : {}) })
      if (m.aviso) this.quitarAvisoLuego()
    } catch (err) {
      return this.terminar(errorDeMedios(err))
    }
    try {
      this.ice = (await window.api.chat.operar('ice', {})).servidores
    } catch (err) {
      return this.terminar((err as Error).message)
    }
    const llamadaId = crypto.randomUUID()
    this.fijar({ llamadaId, local: this.local, fase: 'llamando' })
    this.orden({ t: 'llamada.invitar', llamadaId, usuarioId: con.id, video })
  }

  async contestar(): Promise<void> {
    const { fase, llamadaId, video } = this.vista
    if (fase !== 'entrante' || !llamadaId) return
    this.timbre.detener()
    this.fijar({ fase: 'preparando', camaraRemota: video })
    try {
      const m = await abrirMedios(video)
      this.local = m.flujo
      this.fijar({ camaraDisponible: m.camara, sinCamara: video && !m.camara, ...(m.aviso ? { avisoCamara: m.aviso } : {}) })
      if (m.aviso) this.quitarAvisoLuego()
      this.ice = (await window.api.chat.operar('ice', {})).servidores
    } catch (err) {
      this.orden({ t: 'llamada.responder', llamadaId, aceptar: false })
      return this.terminar(errorDeMedios(err))
    }
    this.crearConexion()
    this.fijar({ local: this.local, fase: 'conectando' })
    this.orden({ t: 'llamada.responder', llamadaId, aceptar: true })
  }

  rechazar(): void {
    const { fase, llamadaId } = this.vista
    if (fase === 'entrante' && llamadaId) this.orden({ t: 'llamada.responder', llamadaId, aceptar: false })
    else this.colgar()
  }

  colgar(): void {
    const { llamadaId } = this.vista
    if (llamadaId) this.orden({ t: 'llamada.colgar', llamadaId })
    this.terminar(this.vista.fase === 'en-curso' ? MOTIVOS.colgada : MOTIVOS.cancelada)
  }

  alternarSilencio(): void {
    const silenciado = !this.vista.silenciado
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !silenciado))
    this.fijar({ silenciado })
  }

  /** El emisor de video de la conexión (existe aunque no haya cámara: se negocia siempre en videollamada). */
  private emisorVideo(): RTCRtpSender | undefined {
    return this.pc?.getTransceivers?.().find((t) => t.receiver.track?.kind === 'video')?.sender
  }

  /**
   * Apaga o enciende mi cámara. Apagar suelta la cámara de verdad (se apaga su luz) y avisa al otro; encender la vuelve a abrir y la
   * pone en la misma conexión (sin renegociar). Si el equipo no tenía cámara al empezar, encender lo vuelve a intentar.
   */
  async alternarCamara(): Promise<void> {
    if (!this.local || !this.vista.video) return
    const apagar = !this.vista.sinCamara
    const pistas = this.local.getVideoTracks()
    if (apagar) {
      pistas.forEach((t) => (t.enabled = false))
      const emisor = this.emisorVideo()
      if (emisor) {
        await emisor.replaceTrack(null).catch(() => undefined)
        pistas.forEach((t) => (t.stop(), this.local!.removeTrack(t)))
        this.local = new MediaStream(this.local.getTracks())
      }
      this.fijar({ sinCamara: true, local: this.local })
      return this.avisarCamara(false)
    }
    // Encender: si la pista sigue viva (sin conexión aún) basta con activarla.
    const viva = pistas.find((t) => t.readyState === 'live')
    if (viva) {
      viva.enabled = true
      this.fijar({ sinCamara: false })
      return this.avisarCamara(true)
    }
    try {
      const nueva = (await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false })).getVideoTracks()[0]
      if (!nueva || !this.local) return
      const emisor = this.emisorVideo()
      if (emisor) await emisor.replaceTrack(nueva)
      else this.pc?.addTrack(nueva, this.local) // sin transceptor de video (no debería pasar): se añade y se renegocia
      this.local = new MediaStream([...this.local.getAudioTracks(), nueva])
      this.fijar({ sinCamara: false, camaraDisponible: true, local: this.local, avisoCamara: undefined })
      this.avisarCamara(true)
    } catch (err) {
      this.fijar({ avisoCamara: avisoDeCamara(err) })
      this.quitarAvisoLuego()
    }
  }

  /** Ocultar o mostrar la miniatura de mi cámara (no cambia lo que ve el otro). */
  alternarVistaPropia(): void {
    this.fijar({ ocultarPropia: !this.vista.ocultarPropia })
  }

  private avisarCamara(activa: boolean): void {
    if (this.vista.llamadaId && this.pc) this.orden({ t: 'llamada.senal', llamadaId: this.vista.llamadaId, datos: { tipo: 'camara', activa } })
  }

  private avisoTimer?: number
  private quitarAvisoLuego(): void {
    window.clearTimeout(this.avisoTimer)
    this.avisoTimer = window.setTimeout(() => this.fijar({ avisoCamara: undefined }), 5000)
  }

  private crearConexion(): void {
    const pc = new RTCPeerConnection({ iceServers: this.ice })
    this.pc = pc
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!))
    // Videollamada sin cámara en este equipo: se negocia igual el video (para recibir el del otro y poder encender una cámara luego).
    if (this.vista.video && !this.local?.getVideoTracks().length) pc.addTransceiver?.('video', { direction: 'sendrecv' })
    pc.ontrack = (e) => this.fijar({ remoto: e.streams[0] ?? new MediaStream([e.track]) })
    pc.onnegotiationneeded = () => {
      // Solo a mitad de llamada (la primera oferta la hace `ofrecer`): p. ej. una cámara añadida sin transceptor previo.
      if (pc.connectionState === 'connected' && pc.signalingState === 'stable') void this.ofrecer()
    }
    pc.onicecandidate = (e) => {
      if (e.candidate && this.vista.llamadaId) this.orden({ t: 'llamada.senal', llamadaId: this.vista.llamadaId, datos: { tipo: 'ice', candidato: e.candidate.toJSON() } })
    }
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return
      if (pc.connectionState === 'connected' && this.vista.fase !== 'en-curso') {
        this.fijar({ fase: 'en-curso', segundos: 0 })
        // Cada lado dice si manda imagen (el otro muestra su avatar si no).
        if (this.vista.video) this.avisarCamara(!this.vista.sinCamara && !!this.local?.getVideoTracks().some((t) => t.readyState === 'live'))
        const inicio = Date.now()
        this.reloj = window.setInterval(() => this.fijar({ segundos: Math.round((Date.now() - inicio) / 1000) }), 1000)
      } else if (pc.connectionState === 'failed') {
        this.colgar()
        this.fijar({ mensaje: MOTIVOS.conexion_perdida })
      }
    }
  }

  private async alEvento(e: EventoChat): Promise<void> {
    switch (e.t) {
      case 'llamada.entrante':
        if (!this.libre) return // el servidor ya responde «ocupado»; esto es una red de seguridad
        window.clearTimeout(this.fin)
        this.soyLlamante = false
        this.fijar({ ...inactiva(), fase: 'entrante', con: e.de, video: e.video, llamadaId: e.llamadaId })
        this.timbre.iniciar()
        if (!document.hasFocus()) void window.api.notificaciones.mostrar({ titulo: e.video ? 'Videollamada entrante' : 'Llamada entrante', cuerpo: e.de.nombre, clave: 'chat-llamada' }).catch(() => undefined)
        return
      case 'llamada.sonando':
        if (e.llamadaId === this.vista.llamadaId) this.timbre.iniciar()
        return
      case 'llamada.aceptada':
        if (e.llamadaId !== this.vista.llamadaId || !this.soyLlamante) return
        this.timbre.detener()
        this.fijar({ fase: 'conectando' })
        this.crearConexion()
        return void this.ofrecer()
      case 'llamada.senal':
        if (e.llamadaId === this.vista.llamadaId) await this.alSenal(e.datos as { tipo?: string; sdp?: RTCSessionDescriptionInit; candidato?: RTCIceCandidateInit; activa?: boolean })
        return
      case 'llamada.fin':
        if (e.llamadaId !== this.vista.llamadaId) return
        if (e.motivo === 'atendida_en_otro') return this.limpiar()
        return this.terminar(MOTIVOS[e.motivo] ?? 'Llamada terminada')
    }
  }

  private async ofrecer(): Promise<void> {
    const pc = this.pc
    if (!pc || !this.vista.llamadaId) return
    try {
      const oferta = await pc.createOffer()
      await pc.setLocalDescription(oferta)
      this.orden({ t: 'llamada.senal', llamadaId: this.vista.llamadaId, datos: { tipo: 'oferta', sdp: { type: oferta.type, sdp: oferta.sdp } } })
    } catch {
      this.colgar()
    }
  }

  private async alSenal(d: { tipo?: string; sdp?: RTCSessionDescriptionInit; candidato?: RTCIceCandidateInit; activa?: boolean }): Promise<void> {
    const pc = this.pc
    const id = this.vista.llamadaId
    if (!pc || !id || !d || typeof d !== 'object') return
    if (d.tipo === 'camara') return this.fijar({ camaraRemota: d.activa === true })
    try {
      if (d.tipo === 'oferta' && d.sdp) {
        await pc.setRemoteDescription({ type: 'offer', sdp: String(d.sdp.sdp ?? '') })
        // Aunque este equipo no tenga cámara, el video queda en «enviar y recibir»: así se puede encender una cámara a mitad de llamada.
        if (this.vista.video) pc.getTransceivers?.().forEach((t) => t.receiver.track?.kind === 'video' && t.direction === 'recvonly' && (t.direction = 'sendrecv'))
        const respuesta = await pc.createAnswer()
        await pc.setLocalDescription(respuesta)
        this.orden({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'respuesta', sdp: { type: respuesta.type, sdp: respuesta.sdp } } })
        await this.vaciarCandidatos()
      } else if (d.tipo === 'respuesta' && d.sdp) {
        await pc.setRemoteDescription({ type: 'answer', sdp: String(d.sdp.sdp ?? '') })
        await this.vaciarCandidatos()
      } else if (d.tipo === 'ice' && d.candidato) {
        // Los candidatos pueden llegar antes que la descripción remota: se guardan hasta tenerla.
        if (pc.remoteDescription) await pc.addIceCandidate(d.candidato).catch(() => undefined)
        else this.candidatosPendientes.push(d.candidato)
      }
    } catch {
      this.colgar()
    }
  }

  private async vaciarCandidatos(): Promise<void> {
    const lista = this.candidatosPendientes
    this.candidatosPendientes = []
    for (const c of lista) await this.pc?.addIceCandidate(c).catch(() => undefined)
  }

  private limpiar(): void {
    this.timbre.detener()
    window.clearTimeout(this.avisoTimer)
    window.clearInterval(this.reloj)
    this.reloj = undefined
    this.local?.getTracks().forEach((t) => t.stop())
    this.local = undefined
    if (this.pc) {
      this.pc.ontrack = this.pc.onicecandidate = this.pc.onconnectionstatechange = this.pc.onnegotiationneeded = null
      this.pc.close()
    }
    this.pc = undefined
    this.candidatosPendientes = []
    this.vista = inactiva()
    this.oyentes.forEach((f) => f())
  }

  /** Corta todo y deja un aviso de por qué, unos segundos. */
  private terminar(mensaje: string): void {
    const con = this.vista.con
    const video = this.vista.video
    this.limpiar()
    this.fijar({ fase: 'terminada', con, video, mensaje })
    window.clearTimeout(this.fin)
    this.fin = window.setTimeout(() => this.fijar(inactiva()), 2800)
  }
}

export const controlLlamada = new ControlLlamada()

export const useLlamada = (): VistaLlamada => useSyncExternalStore(controlLlamada.suscribir, controlLlamada.obtener, controlLlamada.obtener)
