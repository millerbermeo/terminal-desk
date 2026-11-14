import { ErrorServidor } from '../servidor/cliente'
import type { ClienteServidor } from '../servidor/cliente'
import { LIMITE_ARCHIVO_CHAT, LIMITE_TEXTO_CHAT, MAX_NOTA_VOZ_MS, type AdjuntoChat, type ArchivoDescargado, type NombreOperacionChat, type OperacionesChat, type OrdenTiempoReal } from '@shared/chat'
import type { ConexionChat } from './conexion'

type Cliente = Pick<ClienteServidor, 'get' | 'post' | 'put' | 'delete' | 'binario' | 'descargar'>

export interface DepsServicioChat {
  conexion: Pick<ConexionChat, 'conexion' | 'enviar'>
  /** «Guardar como…»: pide el destino al usuario y escribe el archivo. `false` si canceló. */
  guardarArchivo(nombre: string, datos: Uint8Array): Promise<boolean>
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

/**
 * Operaciones del chat que la interfaz pide por IPC. Todo pasa por aquí: valida lo recibido, habla con el servidor con la sesión
 * (el token no sale de main) y devuelve datos simples.
 */
export class ServicioChat {
  private readonly cache = new Map<string, ArchivoDescargado>()
  private bytesCache = 0

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

  async descargar(adjuntoId: string, nombre?: string): Promise<ArchivoDescargado> {
    const id = uuid(adjuntoId, 'El archivo')
    const previo = this.cache.get(id)
    if (previo) return previo
    const r = await this.servidor.descargar(`/chat/archivos/${id}`)
    const a: ArchivoDescargado = { datos: r.datos, mime: r.tipo.split(';')[0] || 'application/octet-stream', nombre: nombre ?? 'archivo' }
    this.recordar(id, a)
    return a
  }

  async enviarArchivo(e: OperacionesChat['enviarArchivo']['entrada']): Promise<OperacionesChat['enviarArchivo']['salida']> {
    const conv = uuid(e.conversacionId, 'La conversación')
    if (!(e.datos instanceof Uint8Array) || e.datos.byteLength === 0) throw new ErrorServidor('El archivo está vacío')
    if (e.datos.byteLength > LIMITE_ARCHIVO_CHAT) throw new ErrorServidor(`El archivo pasa de ${Math.round(LIMITE_ARCHIVO_CHAT / 1024 / 1024)} MB`)
    if (!['image', 'audio', 'video', 'file'].includes(e.tipo)) throw new ErrorServidor('Tipo de archivo no válido')
    const duracion = e.duracionMs === undefined ? undefined : entero(Math.round(Number(e.duracionMs)))
    if (e.duracionMs !== undefined && (duracion === undefined || duracion > MAX_NOTA_VOZ_MS)) throw new ErrorServidor('Duración no válida')
    const mime = typeof e.mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+(\s*;.*)?$/i.test(e.mime) ? e.mime : 'application/octet-stream'
    const pie = e.texto === undefined ? '' : texto(e.texto, 2000, 'El pie', true)
    const id = clienteId(e.clienteId)
    const ruta = `/chat/conversaciones/${conv}/archivos?nombre=${encodeURIComponent(String(e.nombre ?? 'archivo').slice(0, 200))}${duracion !== undefined ? `&duracionMs=${duracion}` : ''}`
    const adjunto = await this.servidor.binario<AdjuntoChat>(ruta, e.datos, mime)
    return this.servidor.post(`/chat/conversaciones/${conv}/mensajes`, { tipo: e.tipo, texto: pie, adjuntoId: adjunto.id, clienteId: id, ...(e.respondeA ? { respondeA: uuid(e.respondeA, 'El mensaje') } : {}) })
  }

  orden(o: OrdenTiempoReal): boolean {
    // Se reconstruye cada orden con solo los campos permitidos: nada de lo que mande la interfaz pasa tal cual.
    switch (o?.t) {
      case 'escribiendo':
        return this.deps.conexion.enviar({ t: 'escribiendo', conversacionId: uuid(o.conversacionId, 'La conversación'), escribiendo: o.escribiendo === true })
      case 'llamada.invitar':
        return this.deps.conexion.enviar({ t: 'llamada.invitar', llamadaId: uuid(o.llamadaId, 'La llamada'), usuarioId: uuid(o.usuarioId, 'El usuario'), video: o.video === true })
      case 'llamada.responder':
        return this.deps.conexion.enviar({ t: 'llamada.responder', llamadaId: uuid(o.llamadaId, 'La llamada'), aceptar: o.aceptar === true })
      case 'llamada.senal':
        return this.deps.conexion.enviar({ t: 'llamada.senal', llamadaId: uuid(o.llamadaId, 'La llamada'), datos: o.datos })
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
    conversaciones: async () => this.servidor.get('/chat/conversaciones'),
    abrirConversacion: async (e) => this.servidor.post('/chat/conversaciones', { usuarioId: uuid(e.usuarioId, 'El usuario') }),
    mensajes: async (e) => {
      const q = new URLSearchParams()
      const antes = entero(e.antes)
      const desde = entero(e.desde)
      const limite = entero(e.limite)
      if (antes) q.set('antes', String(antes))
      if (desde !== undefined) q.set('desde', String(desde))
      if (limite) q.set('limite', String(Math.min(limite, 100)))
      return this.servidor.get(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/mensajes${q.size ? `?${q}` : ''}`)
    },
    enviarTexto: async (e) =>
      this.servidor.post(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/mensajes`, {
        tipo: 'text',
        texto: texto(e.texto, LIMITE_TEXTO_CHAT, 'El mensaje'),
        clienteId: clienteId(e.clienteId),
        ...(e.respondeA ? { respondeA: uuid(e.respondeA, 'El mensaje') } : {})
      }),
    enviarArchivo: async (e) => this.enviarArchivo(e),
    leido: async (e) => this.servidor.post(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/leido`, { seq: entero(e.seq) ?? 0 }),
    editar: async (e) => this.servidor.put(`/chat/mensajes/${uuid(e.mensajeId, 'El mensaje')}`, { texto: texto(e.texto, LIMITE_TEXTO_CHAT, 'El mensaje') }),
    eliminar: async (e) => this.servidor.delete(`/chat/mensajes/${uuid(e.mensajeId, 'El mensaje')}`),
    reaccionar: async (e) => this.servidor.put(`/chat/mensajes/${uuid(e.mensajeId, 'El mensaje')}/reaccion`, { emoji: e.emoji === null ? null : texto(e.emoji, 16, 'La reacción') }),
    vaciar: async (e) => this.servidor.post(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/vaciar`),
    ajustes: async (e) =>
      this.servidor.put(`/chat/conversaciones/${uuid(e.conversacionId, 'La conversación')}/ajustes`, {
        ...(e.silenciada !== undefined ? { silenciada: e.silenciada === true } : {}),
        ...(e.archivada !== undefined ? { archivada: e.archivada === true } : {})
      }),
    buscar: async (e) => this.servidor.get(`/chat/buscar?q=${encodeURIComponent(texto(e.q, 100, 'La búsqueda'))}`),
    noLeidos: async () => this.servidor.get('/chat/no-leidos'),
    descargar: async (e) => this.descargar(e.adjuntoId),
    guardarComo: async (e) => {
      const a = await this.descargar(e.adjuntoId)
      return this.deps.guardarArchivo(String(e.nombre || a.nombre).slice(0, 200), a.datos)
    },
    ice: async () => this.servidor.get('/chat/ice'),
    tiempoReal: async (e) => this.orden(e.orden)
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
