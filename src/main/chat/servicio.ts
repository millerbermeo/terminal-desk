import { ErrorServidor } from '../servidor/cliente'
import type { ClienteServidor } from '../servidor/cliente'
import {
  LIMITE_ARCHIVO_CHAT,
  LIMITE_TEXTO_CHAT,
  MAX_NOTA_VOZ_MS,
  type AdjuntoChat,
  type ArchivoDescargado,
  type ConversacionChat,
  type EventoChat,
  type MensajeChat,
  type NombreOperacionChat,
  type OperacionesChat,
  type OrdenTiempoReal,
  type PaginaMensajes,
  type ResultadoBusqueda
} from '@shared/chat'
import type { ConexionChat } from './conexion'
import type { CifradoChat } from './e2e/cifrado'
import { detectarTipo } from './e2e/tipo'
import type { MediosLlamada } from './medios'

type Cliente = Pick<ClienteServidor, 'get' | 'post' | 'put' | 'delete' | 'binario' | 'descargar'>

export interface DepsServicioChat {
  conexion: Pick<ConexionChat, 'conexion' | 'enviar'>
  /** Cifrado de extremo a extremo: todo mensaje, archivo y señal de llamada pasa por aquí antes de salir y al llegar. */
  cifrado: CifradoChat
  /** «Guardar como…»: pide el destino al usuario y escribe el archivo. `false` si canceló. */
  guardarArchivo(nombre: string, datos: Uint8Array): Promise<boolean>
  /** Compartir pantalla y grabar llamadas (sin esto, esas operaciones dicen que no están disponibles). */
  medios?: MediosLlamada
  /** Abre la carpeta del sistema con el archivo seleccionado. */
  mostrarEnCarpeta?(ruta: string): void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLIENTE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** Lo que llega de la interfaz no es de fiar: se comprueba aquí antes de armar ninguna ruta o cuerpo. */
function uuid(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new ErrorServidor(`${campo} no es válido`)
  return v
}
function texto(v: unknown, max: number, campo: string, vacio = false): string {
  if (typeof v !== 'string') throw new ErrorServidor(`${campo} no es válido`)
  const t = v.trim()
  if (!vacio && !t) throw new ErrorServidor(`${campo} está vacío`)
  if (t.length > max) throw new ErrorServidor(`${campo} pasa de ${max} caracteres`)
  return t
}
function clienteId(v: unknown): string {
  if (typeof v !== 'string' || !CLIENTE_ID.test(v)) throw new ErrorServidor('El identificador del mensaje no es válido')
  return v
}
const entero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined)

/** Mejor mensaje para el usuario cuando falla una operación del chat. */
export function mensajeDeError(err: unknown): string {
  if (err instanceof ErrorServidor) {
    if (err.estado === 404 && /Cannot (GET|POST|PUT|DELETE)/.test(err.message)) return 'Este servidor aún no tiene el chat: actualiza el backend (terminal-desk-api).'
    return err.message
  }
  return err instanceof Error ? err.message : 'No se pudo completar la operación del chat.'
}

/** Tamaño máximo de lo que se guarda en memoria para no volver a descargar (audios que se reproducen varias veces, imágenes). */
const CACHE_MAX_BYTES = 40 * 1024 * 1024
/** Búsqueda local (el servidor no puede buscar en lo cifrado): mensajes por conversación que se bajan como mucho para buscar. */
const BUSQUEDA_POR_CHAT = 500
const BUSQUEDA_MAX = 50_000
const MIME_DECLARADO = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i

const normalizar = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** El tipo de mensaje tiene que encajar con lo que son de verdad los bytes del archivo (antes lo comprobaba el servidor). */
function tipoValido(tipo: 'image' | 'audio' | 'video' | 'file', mime: string, seguro: boolean): boolean {
  if (tipo === 'file') return true
  if (!seguro) return false
  if (tipo === 'image') return mime.startsWith('image/')
  if (tipo === 'audio') return mime.startsWith('audio/')
  return mime.startsWith('video/')
}

/**
 * Operaciones del chat que la interfaz pide por IPC. Todo pasa por aquí: valida lo recibido, habla con el servidor con la sesión
 * (el token no sale de main) y devuelve datos simples.
 */
export class ServicioChat {
  private readonly cache = new Map<string, ArchivoDescargado>()
  private bytesCache = 0
  /** Datos de cada mensaje que hacen falta para volver a cifrarlo al editarlo (los datos asociados del sobre). */
  private readonly conocidos = new Map<string, { conversacionId: string; clienteId: string; tipo: MensajeChat['tipo'] }>()
  /** Índice en memoria (nunca en disco) del texto descifrado, para buscar. */
  private readonly indice = new Map<string, ResultadoBusqueda>()
  private readonly indexadas = new Set<string>()
  private colaEventos: Promise<void> = Promise.resolve()

  constructor(
    private readonly servidor: Cliente,
    private readonly deps: DepsServicioChat
  ) {}

  private recordar(id: string, a: ArchivoDescargado): void {
    if (a.datos.byteLength > CACHE_MAX_BYTES / 2) return
    this.cache.set(id, a)
    this.bytesCache += a.datos.byteLength
    // Se descarta lo más antiguo (el orden de inserción de un Map) hasta volver al límite.
    for (const [k, v] of this.cache) {
      if (this.bytesCache <= CACHE_MAX_BYTES) break
      this.cache.delete(k)
      this.bytesCache -= v.datos.byteLength
    }
  }

  /** Al cerrar sesión: fuera de memoria lo descifrado (archivos, índice de búsqueda, claves abiertas). */
  olvidar(): void {
    this.cache.clear()
    this.bytesCache = 0
    this.conocidos.clear()
    this.indice.clear()
    this.indexadas.clear()
    this.deps.cifrado.olvidar()
  }

  async descargar(adjuntoId: string, nombre?: string): Promise<ArchivoDescargado> {
    const id = uuid(adjuntoId, 'El archivo')
    const previo = this.cache.get(id)
    if (previo) return previo
    const r = await this.servidor.descargar(`/chat/archivos/${id}`)
    let a: ArchivoDescargado
    if (this.deps.cifrado.esAdjuntoCifrado(id)) {
      let abierto: ReturnType<CifradoChat['abrirArchivo']>
      try {
        abierto = this.deps.cifrado.abrirArchivo(id, r.datos)
      } catch (err) {
        throw new ErrorServidor((err as Error).message)
      }
      if (!abierto) throw new ErrorServidor('No se tiene la clave de este archivo')
      a = abierto
    } else {
      a = { datos: r.datos, mime: r.tipo.split(';')[0] || 'application/octet-stream', nombre: nombre ?? 'archivo' }
    }
    this.recordar(id, a)
    return a
  }

  // ---------------------------------------------------------------- mensajes (cifrar al salir, descifrar al llegar)

  /** Abre el sobre de un mensaje y recuerda lo necesario para editarlo y buscarlo. */
  private async abrir(m: MensajeChat): Promise<MensajeChat> {
    const r = await this.deps.cifrado.abrirMensaje(m)
    this.conocidos.set(m.id, { conversacionId: m.conversacionId, clienteId: m.clienteId, tipo: m.tipo })
    if (this.conocidos.size > BUSQUEDA_MAX) this.conocidos.delete(this.conocidos.keys().next().value!)
    this.indexar(r)
    return r
  }

  private indexar(m: MensajeChat): void {
    const legible = (m.cifrado === 'si' || m.cifrado === 'clave-nueva' || m.cifrado === 'no') && !m.eliminado && m.tipo !== 'call' && m.texto
    if (!legible) return void this.indice.delete(m.id)
    this.indice.set(m.id, { id: m.id, conversacionId: m.conversacionId, seq: m.seq, emisorId: m.emisorId, texto: m.texto.slice(0, 300), creado: m.creado })
    if (this.indice.size > BUSQUEDA_MAX) this.indice.delete(this.indice.keys().next().value!)
  }

  private async pagina(ruta: string): Promise<PaginaMensajes> {
    const p = await this.servidor.get<PaginaMensajes>(ruta)
    return { ...p, mensajes: await Promise.all((p.mensajes ?? []).map((m) => this.abrir(m))) }
  }

  private async conversaciones(): Promise<{ conversaciones: ConversacionChat[] }> {
    const r = await this.servidor.get<{ conversaciones: ConversacionChat[] }>('/chat/conversaciones')
    return { conversaciones: await this.deps.cifrado.abrirConversaciones(r.conversaciones) }
  }

  private async enviarTexto(e: OperacionesChat['enviarTexto']['entrada']): Promise<MensajeChat> {
    const conv = uuid(e.conversacionId, 'La conversación')
    const t = texto(e.texto, LIMITE_TEXTO_CHAT, 'El mensaje')
    const id = clienteId(e.clienteId)
    const respondeA = e.respondeA ? uuid(e.respondeA, 'El mensaje') : undefined
    const sobre = await this.deps.cifrado.cerrarMensaje({ conversacionId: conv, clienteId: id, tipo: 'text', texto: t })
    const m = await this.servidor.post<MensajeChat>(`/chat/conversaciones/${conv}/mensajes`, { tipo: 'text', texto: sobre, clienteId: id, ...(respondeA ? { respondeA } : {}) })
    return this.abrir(m)
  }

  private async editar(e: OperacionesChat['editar']['entrada']): Promise<MensajeChat> {
    const id = uuid(e.mensajeId, 'El mensaje')
    const t = texto(e.texto, LIMITE_TEXTO_CHAT, 'El mensaje')
    const m = this.conocidos.get(id)
    if (!m) throw new ErrorServidor('Vuelve a abrir el chat para editar este mensaje')
    const sobre = await this.deps.cifrado.cerrarMensaje({ conversacionId: m.conversacionId, clienteId: m.clienteId, tipo: m.tipo, texto: t })
    return this.abrir(await this.servidor.put<MensajeChat>(`/chat/mensajes/${id}`, { texto: sobre }))
  }

  /** El servidor no puede buscar en lo cifrado: se busca aquí en lo descifrado (bajando, una vez por sesión, el historial reciente). */
  private async buscar(q: string): Promise<{ resultados: ResultadoBusqueda[] }> {
    const t = normalizar(texto(q, 100, 'La búsqueda'))
    if (t.length < 2) return { resultados: [] }
    const { conversaciones } = await this.servidor.get<{ conversaciones: ConversacionChat[] }>('/chat/conversaciones')
    this.deps.cifrado.recordarConversaciones(conversaciones)
    for (const c of conversaciones) {
      if (this.indexadas.has(c.id)) continue
      let antes: number | undefined
      for (let n = 0; n < BUSQUEDA_POR_CHAT; n += 100) {
        const p = await this.pagina(`/chat/conversaciones/${c.id}/mensajes?limite=100${antes ? `&antes=${antes}` : ''}`).catch(() => undefined)
        if (!p || p.mensajes.length === 0) break
        antes = p.mensajes[0].seq
        if (!p.hayMas) break
      }
      this.indexadas.add(c.id)
    }
    const resultados = [...this.indice.values()].filter((r) => normalizar(r.texto).includes(t)).sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, 40)
    return { resultados }
  }

  /**
   * Eventos del servidor → interfaz, en orden (uno detrás de otro aunque descifrar tarde): mensajes descifrados, señales de llamada
   * abiertas y comprobadas. Una señal que no se puede abrir corta la llamada (nadie puede meterse en medio).
   */
  recibirEvento(e: EventoChat, emitir: (e: EventoChat) => void): void {
    this.colaEventos = this.colaEventos
      .then(async () => {
        const r = await this.transformar(e)
        if (r) emitir(r)
      })
      .catch(() => undefined)
  }

  private async transformar(e: EventoChat): Promise<EventoChat | null> {
    switch (e.t) {
      case 'mensaje.nuevo':
      case 'mensaje.cambio':
        return { ...e, mensaje: await this.abrir(e.mensaje) }
      case 'llamada.entrante':
        this.deps.cifrado.recordarLlamada(e.llamadaId, e.de.id)
        return e
      case 'llamada.senal':
        try {
          return { ...e, datos: await this.deps.cifrado.abrirSenal(e.llamadaId, e.datos) }
        } catch {
          this.deps.conexion.enviar({ t: 'llamada.colgar', llamadaId: e.llamadaId })
          return { t: 'llamada.fin', llamadaId: e.llamadaId, motivo: 'cifrado' }
        }
      case 'claves.cambio':
        await this.deps.cifrado.clavesCambiaron(e.usuarioId)
        return e
      default:
        return e
    }
  }

  async enviarArchivo(e: OperacionesChat['enviarArchivo']['entrada']): Promise<OperacionesChat['enviarArchivo']['salida']> {
    const conv = uuid(e.conversacionId, 'La conversación')
    if (!(e.datos instanceof Uint8Array) || e.datos.byteLength === 0) throw new ErrorServidor('El archivo está vacío')
    if (e.datos.byteLength > LIMITE_ARCHIVO_CHAT) throw new ErrorServidor(`El archivo pasa de ${Math.round(LIMITE_ARCHIVO_CHAT / 1024 / 1024)} MB`)
    if (!['image', 'audio', 'video', 'file'].includes(e.tipo)) throw new ErrorServidor('Tipo de archivo no válido')
    const duracion = e.duracionMs === undefined ? undefined : entero(Math.round(Number(e.duracionMs)))
    if (e.duracionMs !== undefined && (duracion === undefined || duracion > MAX_NOTA_VOZ_MS)) throw new ErrorServidor('Duración no válida')
    const declarado = typeof e.mime === 'string' ? e.mime.split(';')[0].trim().toLowerCase() : ''
    const pie = e.texto === undefined ? '' : texto(e.texto, 2000, 'El pie', true)
    const id = clienteId(e.clienteId)
    const respondeA = e.respondeA ? uuid(e.respondeA, 'El mensaje') : undefined
    // El servidor ya no ve el contenido: el tipo real se comprueba aquí, por los bytes, antes de cifrar.
    const det = detectarTipo(e.datos, declarado)
    if (!tipoValido(e.tipo, det.mime, det.seguro)) throw new ErrorServidor('El archivo no corresponde al tipo de mensaje')
    const mime = det.seguro ? det.mime : MIME_DECLARADO.test(declarado) ? declarado : 'application/octet-stream'
    const nombre = String(e.nombre ?? 'archivo').slice(0, 200) || 'archivo'
    const { blob, clave } = await this.deps.cifrado.cifrarArchivo(e.datos, conv)
    // Al servidor solo llegan bytes opacos: sin nombre, tipo ni duración (eso va dentro del mensaje cifrado).
    const subido = await this.servidor.binario<AdjuntoChat>(`/chat/conversaciones/${conv}/archivos?cifrado=1`, new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength), 'application/octet-stream')
    const sobre = await this.deps.cifrado.cerrarMensaje({
      conversacionId: conv,
      clienteId: id,
      tipo: e.tipo,
      texto: pie,
      adjunto: { id: subido.id, clave, nombre, mime, tamano: e.datos.byteLength, ...(duracion !== undefined ? { duracionMs: duracion } : {}) }
    })
    const m = await this.servidor.post<MensajeChat>(`/chat/conversaciones/${conv}/mensajes`, { tipo: e.tipo, texto: sobre, adjuntoId: subido.id, clienteId: id, ...(respondeA ? { respondeA } : {}) })
    // El archivo recién enviado ya se tiene en claro: no hace falta bajarlo ni descifrarlo para verlo.
    this.recordar(subido.id, { datos: e.datos, mime, nombre })
    return this.abrir(m)
  }

  async orden(o: OrdenTiempoReal): Promise<boolean> {
    // Se reconstruye cada orden con solo los campos permitidos: nada de lo que mande la interfaz pasa tal cual.
    switch (o?.t) {
      case 'escribiendo':
        return this.deps.conexion.enviar({ t: 'escribiendo', conversacionId: uuid(o.conversacionId, 'La conversación'), escribiendo: o.escribiendo === true, ...(o.audio === true && o.escribiendo === true ? { audio: true } : {}) })
      case 'llamada.invitar': {
        const llamadaId = uuid(o.llamadaId, 'La llamada')
        const usuarioId = uuid(o.usuarioId, 'El usuario')
        // Sin una clave aceptada del contacto la señalización no se podría cifrar: no se llama.
        await this.deps.cifrado.exigirContactoSeguro(usuarioId)
        this.deps.cifrado.recordarLlamada(llamadaId, usuarioId)
        return this.deps.conexion.enviar({ t: 'llamada.invitar', llamadaId, usuarioId, video: o.video === true })
      }
      case 'llamada.responder':
        return this.deps.conexion.enviar({ t: 'llamada.responder', llamadaId: uuid(o.llamadaId, 'La llamada'), aceptar: o.aceptar === true })
      case 'llamada.senal': {
        const llamadaId = uuid(o.llamadaId, 'La llamada')
        // Oferta, respuesta y candidatos van cifrados: el servidor no puede cambiar las huellas DTLS de la llamada.
        return this.deps.conexion.enviar({ t: 'llamada.senal', llamadaId, datos: await this.deps.cifrado.cerrarSenal(llamadaId, o.datos) })
      }
      case 'llamada.colgar':
        return this.deps.conexion.enviar({ t: 'llamada.colgar', llamadaId: uuid(o.llamadaId, 'La llamada') })
      default:
        throw new ErrorServidor('Orden no válida')
    }
  }

  readonly operaciones: { [K in NombreOperacionChat]: (e: OperacionesChat[K]['entrada']) => Promise<OperacionesChat[K]['salida']> } = {
    estado: async () => ({ conexion: this.deps.conexion.conexion }),
    perfil: async () => this.servidor.get('/chat/yo'),
    guardarPerfil: async (e) =>
      this.servidor.put('/chat/yo', {
        ...(e.nombre !== undefined ? { nombre: e.nombre === null ? null : texto(e.nombre, 60, 'El nombre', true) } : {}),
        ...(e.mostrarPresencia !== undefined ? { mostrarPresencia: e.mostrarPresencia === true } : {})
      }),
    contactos: async () => this.servidor.get('/chat/contactos'),
    solicitar: async (e) => this.servidor.post('/chat/contactos', { email: texto(e.email, 254, 'El correo') }),
    responder: async (e) => this.servidor.post(`/chat/contactos/${uuid(e.contactoId, 'La solicitud')}/respuesta`, { aceptar: e.aceptar === true }),
    eliminarContacto: async (e) => this.servidor.delete(`/chat/contactos/${uuid(e.contactoId, 'El contacto')}`),
    bloquear: async (e) => this.servidor.post(`/chat/bloqueos/${uuid(e.usuarioId, 'El usuario')}`),
    desbloquear: async (e) => this.servidor.delete(`/chat/bloqueos/${uuid(e.usuarioId, 'El usuario')}`),
    conversaciones: async () => this.conversaciones(),
    abrirConversacion: async (e) => this.servidor.post('/chat/conversaciones', { usuarioId: uuid(e.usuarioId, 'El usuario') }),
    mensajes: async (e) => {
      const q = new URLSearchParams()
      const antes = entero(e.antes)
      const desde = entero(e.desde)
      const limite = entero(e.limite)
      if (antes) q.set('antes', String(antes))
      if (desde !== undefined) q.set('desde', String(desde))
      if (limite) q.set('limite', String(Math.min(limite, 100)))
      return this.pagina(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/mensajes${q.size ? `?${q}` : ''}`)
    },
    enviarTexto: async (e) => this.enviarTexto(e),
    enviarArchivo: async (e) => this.enviarArchivo(e),
    leido: async (e) => this.servidor.post(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/leido`, { seq: entero(e.seq) ?? 0 }),
    editar: async (e) => this.editar(e),
    eliminar: async (e) => this.servidor.delete(`/chat/mensajes/${uuid(e.mensajeId, 'El mensaje')}`),
    reaccionar: async (e) => this.abrir(await this.servidor.put<MensajeChat>(`/chat/mensajes/${uuid(e.mensajeId, 'El mensaje')}/reaccion`, { emoji: e.emoji === null ? null : texto(e.emoji, 16, 'La reacción') })),
    vaciar: async (e) => this.servidor.post(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/vaciar`),
    ajustes: async (e) =>
      this.servidor.put(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/ajustes`, {
        ...(e.silenciada !== undefined ? { silenciada: e.silenciada === true } : {}),
        ...(e.archivada !== undefined ? { archivada: e.archivada === true } : {})
      }),
    buscar: async (e) => this.buscar(e.q),
    noLeidos: async () => this.servidor.get('/chat/no-leidos'),
    descargar: async (e) => this.descargar(e.adjuntoId),
    guardarComo: async (e) => {
      const a = await this.descargar(e.adjuntoId)
      return this.deps.guardarArchivo(String(e.nombre || a.nombre).slice(0, 200), a.datos)
    },
    ice: async () => {
      const r = await this.servidor.get<{ servidores: OperacionesChat['ice']['salida']['servidores']; soloRelay?: boolean }>('/chat/ice')
      return { servidores: r.servidores, soloRelay: r.soloRelay === true }
    },
    cifrado: async () => this.deps.cifrado.estado(),
    cifradoCrear: async (e) => this.deps.cifrado.crear(String(e.frase ?? '')),
    cifradoDesbloquear: async (e) => this.deps.cifrado.desbloquear(String(e.frase ?? '')),
    cifradoRestablecer: async (e) => this.deps.cifrado.restablecer(String(e.frase ?? '')),
    cifradoCambiarFrase: async (e) => this.deps.cifrado.cambiarFrase(String(e.frase ?? '')),
    cifradoContacto: async (e) => this.deps.cifrado.contacto(uuid(e.usuarioId, 'El usuario')),
    cifradoAceptarClave: async (e) => this.deps.cifrado.aceptar(uuid(e.usuarioId, 'El usuario')),
    cifradoVerificar: async (e) => this.deps.cifrado.verificar(uuid(e.usuarioId, 'El usuario'), e.verificada === true),
    tiempoReal: async (e) => this.orden(e.orden),
    pantallaFuentes: async () => this.medios().listar(),
    pantallaElegir: async (e) => this.medios().elegir(e.id),
    grabacionIniciar: async (e) => this.medios().iniciarGrabacion(typeof e.con === 'string' ? e.con.slice(0, 120) : ''),
    grabacionTrozo: async (e) => this.medios().trozo(e.id, e.datos),
    grabacionTerminar: async (e) => this.medios().terminarGrabacion(e.id),
    grabacionCancelar: async (e) => this.medios().cancelarGrabacion(e.id),
    mostrarGrabacion: async (e) => {
      if (!this.medios().esGuardada(e.ruta)) throw new ErrorServidor('Esa grabación no se hizo en esta sesión')
      this.deps.mostrarEnCarpeta?.(e.ruta)
    }
  }

  private medios(): MediosLlamada {
    if (!this.deps.medios) throw new ErrorServidor('Compartir pantalla y grabar no están disponibles aquí')
    return this.deps.medios
  }
}

export type ResultadoOperacionChat = { ok: true; valor: unknown } | { ok: false; mensaje: string }

/** Puerta del IPC: nombre de operación conocido, y los errores viajan como datos (por IPC un `throw` pierde detalles). */
export async function ejecutarOperacionChat(s: ServicioChat, op: unknown, entrada: unknown): Promise<ResultadoOperacionChat> {
  if (typeof op !== 'string' || !Object.hasOwn(s.operaciones, op)) return { ok: false, mensaje: `Operación de chat desconocida: ${String(op)}` }
  const e = entrada !== null && typeof entrada === 'object' ? entrada : {}
  try {
    const valor = await (s.operaciones[op as NombreOperacionChat] as (e: unknown) => Promise<unknown>)(e)
    return { ok: true, valor }
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err) }
  }
}
