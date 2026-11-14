import { vistaPrevia, type ContactoChat, type ConversacionChat, type EstadoConexionChat, type EventoChat, type MensajeChat, type PerfilChat, type UsuarioChat } from './chat'

/** Mensajes ya cargados de una conversación, en orden. Los que aún no confirmó el servidor van al final (`local`). */
export interface HiloChat {
  mensajes: MensajeChat[]
  /** Hay mensajes anteriores sin cargar. */
  hayMas: boolean
}

export interface EstadoChat {
  conexion: EstadoConexionChat
  yo?: PerfilChat
  contactos: ContactoChat[]
  bloqueados: UsuarioChat[]
  conversaciones: ConversacionChat[]
  hilos: Record<string, HiloChat>
  /** Quién está escribiendo en cada conversación (la interfaz lo borra a los pocos segundos). */
  escribiendo: Record<string, string>
  presencia: Record<string, { enLinea: boolean; ultimaConexion: string | null }>
  /** Lo que el estado detectó que está desactualizado y la interfaz debe volver a pedir al servidor. */
  recargar: { contactos: boolean; conversaciones: boolean }
  cargado: boolean
}

export const estadoInicial = (): EstadoChat => ({
  conexion: 'desconectado',
  contactos: [],
  bloqueados: [],
  conversaciones: [],
  hilos: {},
  escribiendo: {},
  presencia: {},
  recargar: { contactos: false, conversaciones: false },
  cargado: false
})

const orden = (m: MensajeChat): number => (m.local ? Number.MAX_SAFE_INTEGER : m.seq)

/** Mete un mensaje en el hilo: sustituye el que ya estaba (por id, o por `clienteId` si era uno mío pendiente) o lo añade en su sitio. */
export function insertarMensaje(mensajes: MensajeChat[], m: MensajeChat): MensajeChat[] {
  const i = mensajes.findIndex((x) => x.id === m.id || (x.local && x.clienteId === m.clienteId && x.emisorId === m.emisorId))
  const copia = i >= 0 ? mensajes.map((x, j) => (j === i ? m : x)) : [...mensajes, m]
  return copia.sort((a, b) => orden(a) - orden(b) || a.creado.localeCompare(b.creado))
}

const resumen = (m: MensajeChat): NonNullable<ConversacionChat['ultimo']> => ({ id: m.id, emisorId: m.emisorId, tipo: m.tipo, texto: vistaPrevia(m), seq: m.seq, creado: m.creado })

function conMensajeEnConversaciones(lista: ConversacionChat[], m: MensajeChat, yoId: string | undefined, nuevo: boolean): ConversacionChat[] {
  return lista
    .map((c) => {
      if (c.id !== m.conversacionId) return c
      const esUltimo = m.seq >= c.ultimoSeq
      return {
        ...c,
        ultimo: esUltimo || c.ultimo?.id === m.id ? resumen(m) : c.ultimo,
        ultimoSeq: Math.max(c.ultimoSeq, m.seq),
        actividad: esUltimo ? m.creado : c.actividad,
        noLeidos: nuevo && m.emisorId !== yoId && !m.eliminado ? c.noLeidos + 1 : c.noLeidos
      }
    })
    .sort((a, b) => b.actividad.localeCompare(a.actividad))
}

/** Total de mensajes sin leer en conversaciones no silenciadas (la insignia de la barra lateral). */
export const totalNoLeidos = (e: Pick<EstadoChat, 'conversaciones'>): number => e.conversaciones.reduce((n, c) => (c.silenciada ? n : n + c.noLeidos), 0)

/** Solicitudes de contacto que esperan mi respuesta. */
export const solicitudesPendientes = (e: Pick<EstadoChat, 'contactos'>): ContactoChat[] => e.contactos.filter((c) => c.estado === 'recibida')

/** Aplica un evento del servidor (o de la conexión) al estado. Puro: devuelve un estado nuevo y no toca el anterior. */
export function aplicarEvento(e: EstadoChat, ev: EventoChat, yoId: string | undefined): EstadoChat {
  switch (ev.t) {
    case 'conexion':
      return { ...e, conexion: ev.estado }
    case 'mensaje.nuevo': {
      const m = ev.mensaje
      const hilo = e.hilos[m.conversacionId]
      const conocida = e.conversaciones.some((c) => c.id === m.conversacionId)
      return {
        ...e,
        hilos: hilo ? { ...e.hilos, [m.conversacionId]: { ...hilo, mensajes: insertarMensaje(hilo.mensajes, m) } } : e.hilos,
        conversaciones: conMensajeEnConversaciones(e.conversaciones, m, yoId, !hilo?.mensajes.some((x) => x.id === m.id)),
        // Un mensaje de una conversación que aún no se conocía: hay que traer la lista (con el contacto y sus datos).
        recargar: conocida ? e.recargar : { ...e.recargar, conversaciones: true },
        // Quien envía deja de «escribir».
        escribiendo: omitir(e.escribiendo, m.conversacionId, m.emisorId)
      }
    }
    case 'mensaje.cambio': {
      const m = ev.mensaje
      const hilo = e.hilos[m.conversacionId]
      return {
        ...e,
        hilos: hilo ? { ...e.hilos, [m.conversacionId]: { ...hilo, mensajes: insertarMensaje(hilo.mensajes, m) } } : e.hilos,
        conversaciones: conMensajeEnConversaciones(e.conversaciones, m, yoId, false)
      }
    }
    case 'recibo':
      return {
        ...e,
        conversaciones: e.conversaciones.map((c) => {
          if (c.id !== ev.conversacionId) return c
          if (ev.usuarioId === yoId) return ev.leidoSeq !== undefined && ev.leidoSeq >= c.ultimoSeq ? { ...c, noLeidos: 0 } : c
          return {
            ...c,
            leidoPorOtro: Math.max(c.leidoPorOtro, ev.leidoSeq ?? 0),
            entregadoAlOtro: Math.max(c.entregadoAlOtro, ev.entregadoSeq ?? 0, ev.leidoSeq ?? 0)
          }
        })
      }
    case 'escribiendo':
      return { ...e, escribiendo: ev.escribiendo ? { ...e.escribiendo, [ev.conversacionId]: ev.usuarioId } : omitir(e.escribiendo, ev.conversacionId, ev.usuarioId) }
    case 'presencia':
      return {
        ...e,
        presencia: { ...e.presencia, [ev.usuarioId]: { enLinea: ev.enLinea, ultimaConexion: ev.ultimaConexion } },
        contactos: e.contactos.map((c) => (c.usuario.id === ev.usuarioId && c.estado === 'aceptado' ? { ...c, usuario: { ...c.usuario, enLinea: ev.enLinea, ultimaConexion: ev.ultimaConexion ?? c.usuario.ultimaConexion } } : c)),
        conversaciones: e.conversaciones.map((c) => (c.otro.id === ev.usuarioId ? { ...c, otro: { ...c.otro, enLinea: ev.enLinea, ultimaConexion: ev.ultimaConexion ?? c.otro.ultimaConexion } } : c))
      }
    case 'contacto.cambio':
      return { ...e, recargar: { contactos: true, conversaciones: true } }
    case 'conversacion.cambio':
      return { ...e, recargar: { ...e.recargar, conversaciones: true }, hilos: omitirHilo(e.hilos, ev.conversacionId) }
    default:
      return e
  }
}

function omitir(mapa: Record<string, string>, conversacionId: string, usuarioId: string): Record<string, string> {
  if (mapa[conversacionId] !== usuarioId) return mapa
  const { [conversacionId]: _fuera, ...resto } = mapa
  void _fuera
  return resto
}

function omitirHilo(hilos: Record<string, HiloChat>, id: string): Record<string, HiloChat> {
  const { [id]: _fuera, ...resto } = hilos
  void _fuera
  return resto
}

/** Un mensaje mío recién escrito, aún sin confirmar. */
export function mensajeLocal(v: { conversacionId: string; emisorId: string; tipo: MensajeChat['tipo']; texto: string; clienteId: string; adjunto?: MensajeChat['adjunto']; respondeA?: MensajeChat['respondeA']; ahora?: Date }): MensajeChat {
  return {
    id: `local-${v.clienteId}`,
    conversacionId: v.conversacionId,
    seq: 0,
    emisorId: v.emisorId,
    tipo: v.tipo,
    texto: v.texto,
    adjunto: v.adjunto ?? null,
    respondeA: v.respondeA ?? null,
    reacciones: [],
    meta: {},
    creado: (v.ahora ?? new Date()).toISOString(),
    editado: null,
    eliminado: false,
    clienteId: v.clienteId,
    local: 'enviando'
  }
}

/** Marca como fallido un mensaje pendiente (para mostrar «Reintentar»). */
export function marcarFallido(mensajes: MensajeChat[], clienteId: string, error: string): MensajeChat[] {
  return mensajes.map((m) => (m.local && m.clienteId === clienteId ? { ...m, local: 'fallido' as const, error } : m))
}

/** Días distintos entre mensajes seguidos, para poner el separador «Hoy», «Ayer»… */
export function etiquetaDia(iso: string, ahora = new Date()): string {
  const d = new Date(iso)
  const inicio = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((inicio(ahora) - inicio(d)) / 86_400_000)
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias > 1 && dias < 7) return d.toLocaleDateString('es', { weekday: 'long' })
  return d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: d.getFullYear() === ahora.getFullYear() ? undefined : 'numeric' })
}

/** «en línea», «últ. vez hoy a las 14:05», o nada si no comparte su presencia. */
export function textoPresencia(u: Pick<UsuarioChat, 'enLinea' | 'ultimaConexion'>, ahora = new Date()): string {
  if (u.enLinea === undefined) return ''
  if (u.enLinea) return 'en línea'
  if (!u.ultimaConexion) return ''
  const hora = new Date(u.ultimaConexion).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const dia = etiquetaDia(u.ultimaConexion, ahora)
  return `últ. vez ${dia === 'Hoy' ? 'hoy' : dia.toLowerCase()} a las ${hora}`
}
