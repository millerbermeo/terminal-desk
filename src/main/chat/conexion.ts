import type { EstadoConexionChat, EventoChat, OrdenTiempoReal } from '@shared/chat'
import { servidorSeguro } from '@shared/sesion'

/** Lo mínimo de un WebSocket que se usa (así se prueba sin red). */
export interface SocketChat {
  readonly readyState: number
  send(dato: string): void
  close(codigo?: number, motivo?: string): void
  onopen: (() => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: ((e: { code: number }) => void) | null
  onerror: (() => void) | null
}

export interface DepsConexion {
  /** Dirección http(s) del servidor. */
  url(): string
  /** Token de la sesión (nunca sale de main). Sin él no hay conexión. */
  token(): Promise<string | undefined>
  alEvento(e: EventoChat): void
  crearSocket?(url: string): SocketChat
  /** Programa `fn` dentro de `ms` y devuelve cómo cancelarlo (inyectable en las pruebas). */
  esperar?(ms: number, fn: () => void): () => void
}

/** Pausas entre reintentos al caerse la conexión (ms); la última se repite. Con un poco de aleatoriedad para que no se junten todos. */
export const PAUSAS_REINTENTO = [1000, 2000, 5000, 10_000, 30_000]
const LATIDO_MS = 25_000
/** Sin recibir nada (ni el «pong») en este tiempo, la conexión se da por muerta y se reabre. */
const SILENCIO_MAX_MS = 70_000
const ABIERTO = 1

const esperarReal = (ms: number, fn: () => void): (() => void) => {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

/**
 * Conexión WebSocket con el servidor del chat. Se abre sola, se autentica con el primer mensaje, manda latidos, se reabre con pausas
 * crecientes si se cae y avisa de cada cambio de estado. `detener()` la cierra y no vuelve a abrir hasta el siguiente `iniciar()`.
 */
export class ConexionChat {
  private socket?: SocketChat
  private activa = false
  private estado: EstadoConexionChat = 'desconectado'
  private intentos = 0
  private cancelarReintento?: () => void
  private cancelarLatido?: () => void
  private ultimoMensaje = 0
  /** Cada apertura tiene su número: lo que llegue de una conexión vieja se ignora. */
  private generacion = 0

  constructor(private readonly deps: DepsConexion) {}

  get conexion(): EstadoConexionChat {
    return this.estado
  }

  iniciar(): void {
    if (this.activa) return
    this.activa = true
    this.intentos = 0
    void this.abrir()
  }

  detener(): void {
    this.activa = false
    this.generacion++
    this.cancelarReintento?.()
    this.cancelarLatido?.()
    this.cancelarReintento = this.cancelarLatido = undefined
    const s = this.socket
    this.socket = undefined
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null
      s.close(1000, 'cierre')
    }
    this.cambiar('desconectado')
  }

  enviar(orden: OrdenTiempoReal): boolean {
    if (this.estado !== 'conectado' || this.socket?.readyState !== ABIERTO) return false
    this.socket.send(JSON.stringify(orden))
    return true
  }

  private cambiar(estado: EstadoConexionChat): void {
    if (estado === this.estado) return
    this.estado = estado
    this.deps.alEvento({ t: 'conexion', estado })
  }

  private esperar(ms: number, fn: () => void): () => void {
    return (this.deps.esperar ?? esperarReal)(ms, fn)
  }

  private async abrir(): Promise<void> {
    if (!this.activa) return
    const gen = ++this.generacion
    const url = this.deps.url().replace(/\/+$/, '')
    const token = await this.deps.token().catch(() => undefined)
    if (!this.activa || gen !== this.generacion) return
    // Sin sesión no hay nada que reintentar: `iniciar()` se vuelve a llamar al abrir sesión.
    if (!token) {
      this.activa = false
      return this.cambiar('desconectado')
    }
    if (!servidorSeguro(url) && process.env.ODESK_PERMITIR_HTTP !== '1') {
      this.activa = false
      return this.cambiar('desconectado')
    }
    this.cambiar('conectando')
    let s: SocketChat
    try {
      s = (this.deps.crearSocket ?? ((u) => new WebSocket(u) as unknown as SocketChat))(url.replace(/^http/i, 'ws') + '/chat/ws')
    } catch {
      return this.reintentar()
    }
    this.socket = s
    this.ultimoMensaje = Date.now()
    s.onopen = () => {
      if (gen === this.generacion) s.send(JSON.stringify({ t: 'auth', token }))
    }
    s.onmessage = (e) => {
      if (gen !== this.generacion) return
      this.ultimoMensaje = Date.now()
      let m: { t?: unknown }
      try {
        m = JSON.parse(String(e.data)) as { t?: unknown }
      } catch {
        return
      }
      if (typeof m.t !== 'string') return
      if (m.t === 'listo') {
        this.intentos = 0
        this.iniciarLatido(gen)
        return this.cambiar('conectado')
      }
      if (m.t === 'pong') return
      this.deps.alEvento(m as EventoChat)
    }
    s.onclose = () => {
      if (gen !== this.generacion) return
      this.socket = undefined
      this.cancelarLatido?.()
      this.reintentar()
    }
    s.onerror = () => {
      // Tras un error siempre llega `onclose`, que es quien reintenta.
    }
  }

  private iniciarLatido(gen: number): void {
    this.cancelarLatido?.()
    const latir = (): void => {
      if (gen !== this.generacion || !this.socket) return
      if (Date.now() - this.ultimoMensaje > SILENCIO_MAX_MS) {
        // Muerta sin avisar (cambio de red, portátil dormido): se cierra y `onclose` la reabre.
        this.socket.close(4000, 'sin respuesta')
        return
      }
      if (this.socket.readyState === ABIERTO) this.socket.send('{"t":"ping"}')
      this.cancelarLatido = this.esperar(LATIDO_MS, latir)
    }
    this.cancelarLatido = this.esperar(LATIDO_MS, latir)
  }

  private reintentar(): void {
    if (!this.activa) return this.cambiar('desconectado')
    this.cambiar('desconectado')
    const base = PAUSAS_REINTENTO[Math.min(this.intentos++, PAUSAS_REINTENTO.length - 1)]
    this.cancelarReintento = this.esperar(base + Math.round(Math.random() * base * 0.3), () => void this.abrir())
  }
}
