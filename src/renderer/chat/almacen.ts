import { useSyncExternalStore } from 'react'
import { LIMITE_ARCHIVO_CHAT, tipoPorMime, vistaPrevia, type ConversacionChat, type EventoChat, type MensajeChat, type ResultadoBusqueda } from '@shared/chat'
import { aplicarEvento, estadoInicial, marcarFallido, mensajeLocal, totalNoLeidos, type EstadoChat } from '@shared/chat-estado'
import { notificacionesActivas } from '../agente/notificaciones'

/** Todo lo que la interfaz sabe del chat: el estado del servidor más lo que es solo de esta pantalla. */
export interface VistaChat extends EstadoChat {
  /** Conversación que se está viendo (null = ninguna). */
  abierta: string | null
  /** Último error de una operación, para mostrarlo en un aviso. */
  error: string
  noLeidos: number
}

const identificador = (): string => crypto.randomUUID()

const MAX_ESPERA_ESCRIBIR_MS = 6000
const REENVIO_ESCRIBIENDO_MS = 3000

/**
 * Estado del chat en la interfaz. Vive aparte de la pantalla porque los mensajes, las insignias y las llamadas tienen que funcionar
 * aunque la sección «Chat» no esté abierta. Los cambios del servidor llegan como eventos y se aplican con `aplicarEvento` (puro).
 */
class AlmacenChat {
  private estado: EstadoChat = estadoInicial()
  private abierta: string | null = null
  private visible = false
  private error = ''
  private snapshot: VistaChat = this.armar()
  private readonly oyentes = new Set<() => void>()
  private readonly timersEscribiendo = new Map<string, number>()
  private ultimoEscribiendo = 0
  private baja?: () => void
  private recargando = false
  /** Se llama con cada evento del servidor (la capa de llamadas lo usa). */
  readonly alEvento = new Set<(e: EventoChat) => void>()

  private armar(): VistaChat {
    return { ...this.estado, abierta: this.abierta, error: this.error, noLeidos: totalNoLeidos(this.estado) }
  }

  private emitir(): void {
    this.snapshot = this.armar()
    this.oyentes.forEach((f) => f())
  }

  readonly suscribir = (f: () => void): (() => void) => {
    this.oyentes.add(f)
    return () => this.oyentes.delete(f)
  }
  readonly obtener = (): VistaChat => this.snapshot

  private fijar(cambio: (e: EstadoChat) => EstadoChat): void {
    this.estado = cambio(this.estado)
    this.emitir()
  }

  private fallo(err: unknown): void {
    this.error = err instanceof Error ? err.message : String(err)
    this.emitir()
  }

  /** Muestra un aviso de error generado por la propia pantalla (p. ej. sin permiso de micrófono). */
  fijarError(mensaje: string): void {
    this.error = mensaje
    this.emitir()
  }

  descartarError = (): void => {
    if (!this.error) return
    this.error = ''
    this.emitir()
  }

  /** Empieza a escuchar al servidor y carga lo inicial. Devuelve cómo dejar de escuchar. */
  iniciar(): () => void {
    this.baja?.()
    // Un estado de una sesión anterior (otra cuenta en el mismo proceso) no debe verse ni un instante.
    this.estado = estadoInicial()
    this.abierta = null
    this.error = ''
    this.emitir()
    const dejar = window.api.chat.onEvento((e) => this.alEventoServidor(e))
    this.baja = dejar
    void window.api.chat.operar('estado', {}).then((r) => this.fijar((s) => ({ ...s, conexion: r.conexion })), () => undefined)
    void this.recargarTodo()
    return () => {
      dejar()
      if (this.baja === dejar) this.baja = undefined
    }
  }

  private alEventoServidor(e: EventoChat): void {
    const antes = this.estado
    this.estado = aplicarEvento(this.estado, e, this.estado.yo?.id)
    if (e.t === 'mensaje.nuevo') this.alMensajeNuevo(e.mensaje)
    if (e.t === 'escribiendo' && e.escribiendo) this.programarFinEscribiendo(e.conversacionId, e.usuarioId)
    this.emitir()
    // Al reconectar (o recibir algo que el estado no sabe ubicar) se vuelve a pedir lo que pudo cambiar mientras no se escuchaba.
    if (e.t === 'conexion' && e.estado === 'conectado' && antes.conexion !== 'conectado') void this.resincronizar()
    if (this.estado.recargar.contactos || this.estado.recargar.conversaciones) void this.refrescarPendientes()
    this.alEvento.forEach((f) => f(e))
  }

  private programarFinEscribiendo(conversacionId: string, usuarioId: string): void {
    window.clearTimeout(this.timersEscribiendo.get(conversacionId))
    this.timersEscribiendo.set(
      conversacionId,
      window.setTimeout(() => this.fijar((s) => aplicarEvento(s, { t: 'escribiendo', conversacionId, usuarioId, escribiendo: false }, s.yo?.id)), MAX_ESPERA_ESCRIBIR_MS)
    )
  }

  /** Aviso del sistema por un mensaje que el usuario no está viendo; y si sí lo ve, se marca como leído. */
  private alMensajeNuevo(m: MensajeChat): void {
    if (m.emisorId === this.estado.yo?.id) return
    const viendo = this.visible && this.abierta === m.conversacionId && document.hasFocus()
    if (viendo) return void this.marcarLeido(m.conversacionId)
    const c = this.estado.conversaciones.find((x) => x.id === m.conversacionId)
    if (m.tipo === 'call' || c?.silenciada || !notificacionesActivas()) return
    void window.api.notificaciones.mostrar({ titulo: c?.otro.nombre ?? 'Mensaje nuevo', cuerpo: vistaPrevia(m), clave: `chat:${m.conversacionId}` }).catch(() => undefined)
  }

  // ---------------------------------------------------------------- carga

  private async recargarTodo(): Promise<void> {
    try {
      const [yo, c, v] = await Promise.all([window.api.chat.operar('perfil', {}), window.api.chat.operar('contactos', {}), window.api.chat.operar('conversaciones', {})])
      this.fijar((s) => ({ ...s, yo, contactos: c.contactos, bloqueados: c.bloqueados, conversaciones: v.conversaciones, cargado: true, recargar: { contactos: false, conversaciones: false } }))
    } catch (err) {
      // Sin sesión o sin servidor: se muestra vacío y se reintenta al conectar.
      this.fijar((s) => ({ ...s, cargado: true }))
      if (!/sesi[oó]n|conectar/i.test(String((err as Error)?.message))) this.fallo(err)
    }
  }

  /** Tras volver la conexión: lista de chats al día y, en el chat abierto, los mensajes que faltan. */
  private async resincronizar(): Promise<void> {
    await this.recargarTodo()
    const id = this.abierta
    if (!id) return
    const hilo = this.estado.hilos[id]
    const ultimo = hilo?.mensajes.filter((m) => !m.local).at(-1)?.seq
    if (hilo && ultimo !== undefined) {
      try {
        const p = await window.api.chat.operar('mensajes', { conversacionId: id, desde: ultimo, limite: 100 })
        for (const m of p.mensajes) this.fijar((s) => aplicarEvento(s, { t: 'mensaje.cambio', mensaje: m }, s.yo?.id))
        if (this.visible) void this.marcarLeido(id)
      } catch {
        /* se reintentará al próximo cambio */
      }
    }
  }

  private async refrescarPendientes(): Promise<void> {
    if (this.recargando) return
    this.recargando = true
    const { contactos, conversaciones } = this.estado.recargar
    this.estado = { ...this.estado, recargar: { contactos: false, conversaciones: false } }
    try {
      const [c, v] = await Promise.all([contactos ? window.api.chat.operar('contactos', {}) : undefined, conversaciones ? window.api.chat.operar('conversaciones', {}) : undefined])
      this.fijar((s) => ({
        ...s,
        ...(c ? { contactos: c.contactos, bloqueados: c.bloqueados } : {}),
        ...(v ? { conversaciones: v.conversaciones } : {})
      }))
    } catch {
      /* llegará otro evento o se recargará al reconectar */
    } finally {
      this.recargando = false
    }
  }

  // ---------------------------------------------------------------- pantalla

  fijarVisible(v: boolean): void {
    if (this.visible === v) return
    this.visible = v
    if (v && this.abierta) void this.marcarLeido(this.abierta)
  }

  /** Muestra una conversación: baja sus últimos mensajes si no estaban y los marca como leídos. */
  async abrir(id: string | null): Promise<void> {
    this.abierta = id
    this.emitir()
    if (!id) return
    if (!this.estado.hilos[id]) {
      try {
        const p = await window.api.chat.operar('mensajes', { conversacionId: id, limite: 40 })
        this.fijar((s) => ({
          ...s,
          hilos: { ...s.hilos, [id]: { mensajes: p.mensajes, hayMas: p.hayMas } },
          conversaciones: s.conversaciones.map((c) => (c.id === id ? { ...c, leidoPorOtro: p.leidoPorOtro, entregadoAlOtro: p.entregadoAlOtro, ultimoSeq: Math.max(c.ultimoSeq, p.ultimoSeq) } : c))
        }))
      } catch (err) {
        this.fallo(err)
        return
      }
    }
    if (this.visible) void this.marcarLeido(id)
  }

  async cargarAnteriores(id: string): Promise<void> {
    const hilo = this.estado.hilos[id]
    const primero = hilo?.mensajes.find((m) => !m.local)?.seq
    if (!hilo || !hilo.hayMas || !primero) return
    try {
      const p = await window.api.chat.operar('mensajes', { conversacionId: id, antes: primero, limite: 40 })
      this.fijar((s) => {
        const actual = s.hilos[id]
        if (!actual) return s
        const ids = new Set(actual.mensajes.map((m) => m.id))
        return { ...s, hilos: { ...s.hilos, [id]: { mensajes: [...p.mensajes.filter((m) => !ids.has(m.id)), ...actual.mensajes], hayMas: p.hayMas } } }
      })
    } catch (err) {
      this.fallo(err)
    }
  }

  async marcarLeido(id: string): Promise<void> {
    const c = this.estado.conversaciones.find((x) => x.id === id)
    if (!c || (c.noLeidos === 0 && !this.estado.hilos[id]?.mensajes.some((m) => m.seq > c.ultimoSeq))) return
    const seq = Math.max(c.ultimoSeq, ...(this.estado.hilos[id]?.mensajes.map((m) => m.seq) ?? [0]))
    this.fijar((s) => ({ ...s, conversaciones: s.conversaciones.map((x) => (x.id === id ? { ...x, noLeidos: 0 } : x)) }))
    await window.api.chat.operar('leido', { conversacionId: id, seq }).catch(() => undefined)
  }

  /** «Escribiendo…» al otro: como mucho cada 3 s mientras se teclea. */
  escribiendo(id: string): void {
    const ahora = Date.now()
    if (ahora - this.ultimoEscribiendo < REENVIO_ESCRIBIENDO_MS) return
    this.ultimoEscribiendo = ahora
    void window.api.chat.operar('tiempoReal', { orden: { t: 'escribiendo', conversacionId: id, escribiendo: true } }).catch(() => undefined)
  }

  // ---------------------------------------------------------------- envío

  private poner(m: MensajeChat): void {
    this.fijar((s) => {
      const hilo = s.hilos[m.conversacionId] ?? { mensajes: [], hayMas: false }
      return { ...s, hilos: { ...s.hilos, [m.conversacionId]: { ...hilo, mensajes: [...hilo.mensajes, m] } } }
    })
  }

  private confirmar(m: MensajeChat): void {
    this.fijar((s) => aplicarEvento(s, { t: 'mensaje.nuevo', mensaje: m }, s.yo?.id))
  }

  private fallido(conversacionId: string, clienteId: string, err: unknown): void {
    this.fijar((s) => {
      const hilo = s.hilos[conversacionId]
      return hilo ? { ...s, hilos: { ...s.hilos, [conversacionId]: { ...hilo, mensajes: marcarFallido(hilo.mensajes, clienteId, err instanceof Error ? err.message : 'No se pudo enviar') } } } : s
    })
  }

  /** Muestra el mensaje enseguida (gris, «enviando») y lo manda; si falla queda con «Reintentar». */
  async enviarTexto(conversacionId: string, texto: string, respondeA?: MensajeChat): Promise<void> {
    const yo = this.estado.yo?.id
    if (!yo || !texto.trim()) return
    const clienteId = identificador()
    this.poner(mensajeLocal({ conversacionId, emisorId: yo, tipo: 'text', texto: texto.trim(), clienteId, respondeA: respondeA ? { id: respondeA.id, emisorId: respondeA.emisorId, tipo: respondeA.tipo, texto: vistaPrevia(respondeA), eliminado: false } : null }))
    await this.mandarTexto(conversacionId, texto.trim(), clienteId, respondeA?.id)
  }

  private async mandarTexto(conversacionId: string, texto: string, clienteId: string, respondeA?: string): Promise<void> {
    try {
      this.confirmar(await window.api.chat.operar('enviarTexto', { conversacionId, texto, clienteId, ...(respondeA ? { respondeA } : {}) }))
    } catch (err) {
      this.fallido(conversacionId, clienteId, err)
    }
  }

  /** Envía un archivo, imagen o nota de voz. Comprueba el tamaño antes de subir nada. */
  async enviarArchivo(conversacionId: string, archivo: { nombre: string; mime: string; datos: Uint8Array; duracionMs?: number; texto?: string }, respondeA?: MensajeChat): Promise<void> {
    const yo = this.estado.yo?.id
    if (!yo) return
    if (archivo.datos.byteLength > LIMITE_ARCHIVO_CHAT) return this.fallo(new Error(`«${archivo.nombre}» pasa de ${Math.round(LIMITE_ARCHIVO_CHAT / 1024 / 1024)} MB.`))
    const tipo = tipoPorMime(archivo.mime)
    const clienteId = identificador()
    this.poner(
      mensajeLocal({
        conversacionId, emisorId: yo, tipo, texto: archivo.texto ?? '', clienteId,
        adjunto: { id: `local-${clienteId}`, nombre: archivo.nombre, mime: archivo.mime, tamano: archivo.datos.byteLength, duracionMs: archivo.duracionMs ?? null }
      })
    )
    try {
      this.confirmar(await window.api.chat.operar('enviarArchivo', { conversacionId, tipo, nombre: archivo.nombre, mime: archivo.mime, datos: archivo.datos, clienteId, ...(archivo.duracionMs !== undefined ? { duracionMs: archivo.duracionMs } : {}), ...(archivo.texto ? { texto: archivo.texto } : {}), ...(respondeA ? { respondeA: respondeA.id } : {}) }))
    } catch (err) {
      this.fallido(conversacionId, clienteId, err)
    }
  }

  async reintentar(m: MensajeChat): Promise<void> {
    if (m.local !== 'fallido' || m.tipo !== 'text') return
    this.fijar((s) => {
      const hilo = s.hilos[m.conversacionId]
      return hilo ? { ...s, hilos: { ...s.hilos, [m.conversacionId]: { ...hilo, mensajes: hilo.mensajes.map((x) => (x.id === m.id ? { ...x, local: 'enviando' as const, error: undefined } : x)) } } } : s
    })
    await this.mandarTexto(m.conversacionId, m.texto, m.clienteId, m.respondeA?.id)
  }

  /** Quita de la pantalla un mensaje que nunca llegó a enviarse. */
  descartarLocal(m: MensajeChat): void {
    this.fijar((s) => {
      const hilo = s.hilos[m.conversacionId]
      return hilo ? { ...s, hilos: { ...s.hilos, [m.conversacionId]: { ...hilo, mensajes: hilo.mensajes.filter((x) => x.id !== m.id) } } } : s
    })
  }

  // ---------------------------------------------------------------- acciones sobre mensajes y contactos

  /** Ejecuta una operación y, si falla, deja el error a la vista. Devuelve `undefined` si falló. */
  private async hacer<T>(f: () => Promise<T>): Promise<T | undefined> {
    try {
      return await f()
    } catch (err) {
      this.fallo(err)
      return undefined
    }
  }

  async editar(m: MensajeChat, texto: string): Promise<void> {
    const r = await this.hacer(() => window.api.chat.operar('editar', { mensajeId: m.id, texto }))
    if (r) this.fijar((s) => aplicarEvento(s, { t: 'mensaje.cambio', mensaje: r }, s.yo?.id))
  }
  async eliminar(m: MensajeChat): Promise<void> {
    await this.hacer(() => window.api.chat.operar('eliminar', { mensajeId: m.id }))
  }
  async reaccionar(m: MensajeChat, emoji: string | null): Promise<void> {
    const r = await this.hacer(() => window.api.chat.operar('reaccionar', { mensajeId: m.id, emoji }))
    if (r) this.fijar((s) => aplicarEvento(s, { t: 'mensaje.cambio', mensaje: r }, s.yo?.id))
  }
  async vaciar(id: string): Promise<void> {
    await this.hacer(() => window.api.chat.operar('vaciar', { conversacionId: id }))
  }
  async ajustes(id: string, a: { silenciada?: boolean; archivada?: boolean }): Promise<void> {
    this.fijar((s) => ({ ...s, conversaciones: s.conversaciones.map((c) => (c.id === id ? { ...c, ...a } : c)) }))
    await this.hacer(() => window.api.chat.operar('ajustes', { conversacionId: id, ...a }))
  }

  async solicitar(email: string): Promise<'enviada' | 'ya_contacto' | undefined> {
    const r = await this.hacer(() => window.api.chat.operar('solicitar', { email }))
    if (r) await this.refrescarContactos()
    return r?.estado
  }
  async responder(contactoId: string, aceptar: boolean): Promise<void> {
    await this.hacer(() => window.api.chat.operar('responder', { contactoId, aceptar }))
    await this.recargarTodo()
  }
  async eliminarContacto(contactoId: string): Promise<void> {
    await this.hacer(() => window.api.chat.operar('eliminarContacto', { contactoId }))
    await this.recargarTodo()
  }
  async bloquear(usuarioId: string, bloquear: boolean): Promise<void> {
    await this.hacer(() => window.api.chat.operar(bloquear ? 'bloquear' : 'desbloquear', { usuarioId }))
    await this.recargarTodo()
  }
  async guardarPerfil(p: { nombre?: string | null; mostrarPresencia?: boolean }): Promise<void> {
    const yo = await this.hacer(() => window.api.chat.operar('guardarPerfil', p))
    if (yo) this.fijar((s) => ({ ...s, yo }))
  }
  private async refrescarContactos(): Promise<void> {
    const c = await this.hacer(() => window.api.chat.operar('contactos', {}))
    if (c) this.fijar((s) => ({ ...s, contactos: c.contactos, bloqueados: c.bloqueados }))
  }

  /** Abre (o crea) el chat con un contacto y lo deja como conversación activa. */
  async abrirCon(usuarioId: string): Promise<string | undefined> {
    const r = await this.hacer(() => window.api.chat.operar('abrirConversacion', { usuarioId }))
    if (!r) return undefined
    if (!this.estado.conversaciones.some((c) => c.id === r.id)) await this.recargarTodo()
    await this.abrir(r.id)
    return r.id
  }

  async buscar(q: string): Promise<ResultadoBusqueda[]> {
    return (await this.hacer(() => window.api.chat.operar('buscar', { q })))?.resultados ?? []
  }

  conversacion(id: string | null): ConversacionChat | undefined {
    return id ? this.estado.conversaciones.find((c) => c.id === id) : undefined
  }
}

export const almacenChat = new AlmacenChat()

export const useChat = (): VistaChat => useSyncExternalStore(almacenChat.suscribir, almacenChat.obtener, almacenChat.obtener)
