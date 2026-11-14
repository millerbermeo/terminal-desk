/**
 * Chat entre cuentas: contactos con aceptación, mensajes en tiempo real, archivos, notas de voz y llamadas.
 * El servidor (`terminal-desk-api/src/chat`) es la fuente de verdad; el proceso principal habla con él (HTTP + WebSocket) y la interfaz
 * solo ve estos tipos por IPC. El token de sesión nunca sale de main.
 */

export interface UsuarioChat {
  id: string
  email: string
  nombre: string
  /** Solo si la persona comparte su presencia con sus contactos. */
  enLinea?: boolean
  ultimaConexion?: string | null
}

export interface PerfilChat {
  id: string
  email: string
  nombre: string
  /** Lo que escribió el usuario (null = usa la parte local del correo). */
  nombrePropio: string | null
  mostrarPresencia: boolean
}

/** `recibida`: te la mandaron y falta que respondas · `enviada`: la mandaste y está pendiente. */
export type EstadoContacto = 'aceptado' | 'recibida' | 'enviada'

export interface ContactoChat {
  id: string
  usuario: UsuarioChat
  estado: EstadoContacto
  desde: string
}

export type TipoMensaje = 'text' | 'image' | 'audio' | 'video' | 'file' | 'call'

export interface AdjuntoChat {
  id: string
  nombre: string
  mime: string
  tamano: number
  duracionMs: number | null
}

export type EstadoLlamadaMensaje = 'completada' | 'perdida' | 'rechazada' | 'cancelada'

export interface MensajeChat {
  id: string
  conversacionId: string
  seq: number
  emisorId: string
  tipo: TipoMensaje
  texto: string
  adjunto: AdjuntoChat | null
  respondeA: { id: string; emisorId: string; tipo: TipoMensaje; texto: string; eliminado: boolean } | null
  reacciones: { emoji: string; usuarios: string[] }[]
  /** Llamada: `{video, estado, duracionS}`. */
  meta: Record<string, unknown>
  creado: string
  editado: string | null
  eliminado: boolean
  clienteId: string
  /** Solo en la interfaz: mensaje que aún no confirmó el servidor (`enviando`) o que no se pudo enviar (`fallido`). */
  local?: 'enviando' | 'fallido'
  /** Solo en la interfaz: si falló, el motivo para mostrarlo. */
  error?: string
}

export interface ConversacionChat {
  id: string
  otro: UsuarioChat
  ultimo: { id: string; emisorId: string; tipo: TipoMensaje; texto: string; seq: number; creado: string } | null
  noLeidos: number
  silenciada: boolean
  archivada: boolean
  ultimoSeq: number
  /** Hasta qué mensaje (número de orden) ha leído / recibido el otro: para pintar ✓ y ✓✓. */
  leidoPorOtro: number
  entregadoAlOtro: number
  actividad: string
}

export interface PaginaMensajes {
  mensajes: MensajeChat[]
  hayMas: boolean
  ultimoSeq: number
  leidoPorOtro: number
  entregadoAlOtro: number
}

export interface ResultadoBusqueda {
  id: string
  conversacionId: string
  seq: number
  emisorId: string
  texto: string
  creado: string
}

export interface ServidorIce {
  urls: string[]
  username?: string
  credential?: string
}

export type EstadoConexionChat = 'desconectado' | 'conectando' | 'conectado'

/** Lo que el servidor empuja por el WebSocket (más `conexion`, que genera main). */
export type EventoChat =
  | { t: 'conexion'; estado: EstadoConexionChat }
  | { t: 'mensaje.nuevo'; mensaje: MensajeChat }
  | { t: 'mensaje.cambio'; mensaje: MensajeChat }
  | { t: 'recibo'; conversacionId: string; usuarioId: string; leidoSeq?: number; entregadoSeq?: number }
  | { t: 'escribiendo'; conversacionId: string; usuarioId: string; escribiendo: boolean }
  | { t: 'presencia'; usuarioId: string; enLinea: boolean; ultimaConexion: string | null }
  | { t: 'contacto.cambio' }
  | { t: 'conversacion.cambio'; conversacionId: string }
  | { t: 'llamada.entrante'; llamadaId: string; de: UsuarioChat; video: boolean }
  | { t: 'llamada.sonando'; llamadaId: string }
  | { t: 'llamada.aceptada'; llamadaId: string }
  | { t: 'llamada.senal'; llamadaId: string; datos: unknown }
  | { t: 'llamada.fin'; llamadaId: string; motivo: string }

/** Lo que la interfaz puede mandar por el WebSocket (main descarta cualquier otra cosa). */
export type OrdenTiempoReal =
  | { t: 'escribiendo'; conversacionId: string; escribiendo: boolean }
  | { t: 'llamada.invitar'; llamadaId: string; usuarioId: string; video: boolean }
  | { t: 'llamada.responder'; llamadaId: string; aceptar: boolean }
  | { t: 'llamada.senal'; llamadaId: string; datos: unknown }
  | { t: 'llamada.colgar'; llamadaId: string }

export interface EntradaEnviarArchivo {
  conversacionId: string
  tipo: 'image' | 'audio' | 'video' | 'file'
  nombre: string
  /** Tipo declarado por quien lo elige; el servidor decide el real mirando los bytes. */
  mime: string
  datos: Uint8Array
  duracionMs?: number
  /** Pie del archivo. */
  texto?: string
  clienteId: string
  respondeA?: string
}

export interface ArchivoDescargado {
  datos: Uint8Array
  mime: string
  nombre: string
}

export interface OperacionesChat {
  estado: { entrada: Record<string, never>; salida: { conexion: EstadoConexionChat } }
  perfil: { entrada: Record<string, never>; salida: PerfilChat }
  guardarPerfil: { entrada: { nombre?: string | null; mostrarPresencia?: boolean }; salida: PerfilChat }
  contactos: { entrada: Record<string, never>; salida: { contactos: ContactoChat[]; bloqueados: UsuarioChat[] } }
  solicitar: { entrada: { email: string }; salida: { estado: 'enviada' | 'ya_contacto' } }
  responder: { entrada: { contactoId: string; aceptar: boolean }; salida: void }
  eliminarContacto: { entrada: { contactoId: string }; salida: void }
  bloquear: { entrada: { usuarioId: string }; salida: void }
  desbloquear: { entrada: { usuarioId: string }; salida: void }
  conversaciones: { entrada: Record<string, never>; salida: { conversaciones: ConversacionChat[] } }
  abrirConversacion: { entrada: { usuarioId: string }; salida: { id: string } }
  mensajes: { entrada: { conversacionId: string; antes?: number; desde?: number; limite?: number }; salida: PaginaMensajes }
  enviarTexto: { entrada: { conversacionId: string; texto: string; clienteId: string; respondeA?: string }; salida: MensajeChat }
  enviarArchivo: { entrada: EntradaEnviarArchivo; salida: MensajeChat }
  leido: { entrada: { conversacionId: string; seq: number }; salida: void }
  editar: { entrada: { mensajeId: string; texto: string }; salida: MensajeChat }
  eliminar: { entrada: { mensajeId: string }; salida: void }
  reaccionar: { entrada: { mensajeId: string; emoji: string | null }; salida: MensajeChat }
  vaciar: { entrada: { conversacionId: string }; salida: void }
  ajustes: { entrada: { conversacionId: string; silenciada?: boolean; archivada?: boolean }; salida: void }
  buscar: { entrada: { q: string }; salida: { resultados: ResultadoBusqueda[] } }
  noLeidos: { entrada: Record<string, never>; salida: { total: number } }
  descargar: { entrada: { adjuntoId: string }; salida: ArchivoDescargado }
  /** Abre «Guardar como…» y escribe el archivo. `false` si el usuario canceló. */
  guardarComo: { entrada: { adjuntoId: string; nombre: string }; salida: boolean }
  ice: { entrada: Record<string, never>; salida: { servidores: ServidorIce[] } }
  /** Manda una orden por el WebSocket (escribiendo, llamadas). `false` si no hay conexión. */
  tiempoReal: { entrada: { orden: OrdenTiempoReal }; salida: boolean }
}

export type NombreOperacionChat = keyof OperacionesChat

/** Límite de un archivo en el servidor por defecto (25 MB); la interfaz lo comprueba antes de leerlo entero. */
export const LIMITE_ARCHIVO_CHAT = 25 * 1024 * 1024
export const LIMITE_TEXTO_CHAT = 8000
/** Notas de voz: 10 minutos. */
export const MAX_NOTA_VOZ_MS = 10 * 60_000

/** Texto de una llamada registrada en el chat. */
export function textoLlamada(m: Pick<MensajeChat, 'meta' | 'emisorId'>, yoId: string): string {
  const video = m.meta.video === true
  const estado = m.meta.estado as EstadoLlamadaMensaje | undefined
  const tipo = video ? 'Videollamada' : 'Llamada de voz'
  const mia = m.emisorId === yoId
  switch (estado) {
    case 'completada':
      return `${tipo} · ${duracionCorta(Number(m.meta.duracionS) || 0)}`
    case 'perdida':
      return mia ? `${tipo} sin respuesta` : `${tipo} perdida`
    case 'rechazada':
      return mia ? `${tipo} rechazada` : `${tipo} rechazada`
    default:
      return mia ? `${tipo} cancelada` : `${tipo} perdida`
  }
}

/** 75 → «1:15»; 3725 → «1:02:05». */
export function duracionCorta(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const dos = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${dos(m)}:${dos(r)}` : `${m}:${dos(r)}`
}

/** Tamaño legible: 1536 → «1,5 KB». */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const unidades = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < unidades.length - 1) {
    v /= 1024
    i++
  }
  return `${(v < 10 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',')} ${unidades[i]}`
}

/** Texto corto de un mensaje para la lista de chats, las respuestas y las notificaciones. */
export function vistaPrevia(m: Pick<MensajeChat, 'tipo' | 'texto' | 'eliminado'>): string {
  if (m.eliminado) return 'Mensaje eliminado'
  const etiqueta: Record<string, string> = { image: '📷 Foto', audio: '🎤 Nota de voz', video: '🎬 Video', file: '📎 Archivo', call: '📞 Llamada' }
  if (m.tipo === 'text') return m.texto.slice(0, 140)
  return m.texto ? `${etiqueta[m.tipo]} · ${m.texto.slice(0, 100)}` : etiqueta[m.tipo]
}

/** Qué tipo de mensaje corresponde a un archivo según su tipo MIME (el servidor lo vuelve a comprobar por los bytes). */
export function tipoPorMime(mime: string): 'image' | 'audio' | 'video' | 'file' {
  const m = mime.toLowerCase()
  if (/^image\/(png|jpeg|gif|webp)$/.test(m)) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return 'file'
}

/** Enlaces dentro de un texto, para pintarlos como tales (solo http y https). */
export function partirEnlaces(texto: string): { texto: string; enlace?: string }[] {
  const partes: { texto: string; enlace?: string }[] = []
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
  let desde = 0
  for (const m of texto.matchAll(re)) {
    if (m.index > desde) partes.push({ texto: texto.slice(desde, m.index) })
    partes.push({ texto: m[0], enlace: m[0] })
    desde = m.index + m[0].length
  }
  if (desde < texto.length) partes.push({ texto: texto.slice(desde) })
  return partes
}
