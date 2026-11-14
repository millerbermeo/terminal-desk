import { useSyncExternalStore } from 'react'
import type { Turno } from './useAgente'

/**
 * Notificaciones del sistema cuando el Asistente termina de responder. La preferencia es de este equipo (`localStorage`) y vale para
 * todos los chats. La notificación la muestra el proceso principal (`notificacion:mostrar`); al pulsarla, trae la ventana al frente y
 * la interfaz va al chat de donde salió (`App.tsx#irAChat`, por la `clave` de la conversación).
 */
const CLAVE = 'odesk:notificaciones'
const oyentes = new Set<() => void>()

export function notificacionesActivas(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== '0' // activas por defecto
  } catch {
    return true
  }
}

export function fijarNotificaciones(activas: boolean): void {
  try {
    localStorage.setItem(CLAVE, activas ? '1' : '0')
  } catch {
    /* sin almacenamiento: vale solo hasta recargar */
  }
  oyentes.forEach((f) => f())
}

const suscribir = (f: () => void): (() => void) => {
  oyentes.add(f)
  const otraVentana = (e: StorageEvent): void => void (e.key === CLAVE && f())
  window.addEventListener('storage', otraVentana)
  return () => {
    oyentes.delete(f)
    window.removeEventListener('storage', otraVentana)
  }
}

export const useNotificaciones = (): boolean => useSyncExternalStore(suscribir, notificacionesActivas)

const corto = (t: string, max: number): string => {
  const l = t.replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim()
  return l.length > max ? `${l.slice(0, max - 1)}…` : l
}

/** Título y texto de la notificación de un turno terminado; `null` si no hay que avisar (lo canceló el usuario, pregunta lateral…). */
export function textoNotificacion(t: Turno): { titulo: string; cuerpo: string } | null {
  if (t.lateral || t.estado === 'en_curso' || t.estado === 'cancelado') return null
  const fin = [...t.eventos].reverse().find((e) => e.tipo === 'fin' && e.agente === t.raiz)
  const texto = fin?.tipo === 'fin' ? fin.resultado.texto : ''
  const bien = t.estado === 'completado'
  return {
    titulo: `${bien ? 'Asistente' : 'Asistente: no terminó'} · ${t.destino}`,
    cuerpo: bien ? corto(texto, 180) || 'Terminó de responder.' : corto(t.error ?? '', 180) || 'La respuesta terminó con un problema.'
  }
}

/**
 * Avisa de que un chat terminó de responder. No avisa si ya lo estás viendo (ventana enfocada y ese chat a la vista).
 * @param clave la de la conversación (`useAgente`): con ella se vuelve al chat al pulsar
 * @param aLaVista ¿ese chat se ve ahora mismo en esta ventana?
 */
export function notificarRespuesta(t: Turno, clave: string | undefined, aLaVista: boolean): void {
  if (!notificacionesActivas() || (aLaVista && document.hasFocus())) return
  const n = textoNotificacion(t)
  if (n) void window.api.notificaciones.mostrar({ ...n, ...(clave ? { clave } : {}) }).catch(() => undefined)
}
