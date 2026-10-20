import { useSyncExternalStore } from 'react'
import type { ClaseSolicitud, DecisionHumana, EventoAgente, PreguntaUsuario } from '@shared/core/agente'

export interface Solicitud {
  solicitudId: string
  ejecucionId: string
  agente: string
  clase: ClaseSolicitud
  contenido: string
  detalle?: string
  destructivo?: boolean
  herramienta?: string
  puedeSiempre?: boolean // se puede ofrecer «Permitir siempre»
  preguntas?: PreguntaUsuario[] // clase `pregunta`: opciones que el modelo le plantea al usuario
  destino?: string // proyecto o celda que la originó (si se conoce)
}

/**
 * Confirmaciones pendientes de TODAS las celdas y ventanas del renderer. Es global a propósito: un solo modal atiende
 * a varios asistentes a la vez y no se pierde nada al cambiar de pantalla.
 */
let solicitudes: Solicitud[] = []
const etiquetas = new Map<string, string>() // ejecucionId -> destino
const oyentes = new Set<() => void>()

function publicar(nuevas: Solicitud[]): void {
  solicitudes = nuevas
  for (const o of oyentes) o()
}

/** Registra las solicitudes que llegan por el canal de eventos. Devuelve la función para darse de baja. */
export function escucharSolicitudes(): () => void {
  return window.api.core.onEvento((e: EventoAgente) => {
    if (e.tipo !== 'solicitud_humana') return
    const destino = etiquetas.get(e.ejecucionId)
    publicar([
      ...solicitudes,
      {
        solicitudId: e.solicitudId, ejecucionId: e.ejecucionId, agente: e.agente, clase: e.clase, contenido: e.contenido,
        ...(e.detalle ? { detalle: e.detalle } : {}), ...(e.destructivo ? { destructivo: true } : {}), ...(e.herramienta ? { herramienta: e.herramienta } : {}), ...(e.puedeSiempre ? { puedeSiempre: true } : {}), ...(e.preguntas ? { preguntas: e.preguntas } : {}),
        ...(destino ? { destino } : {})
      }
    ])
  })
}

/** Asocia una ejecución con su destino para mostrarlo en el modal («Backend», «Frontend»…). */
export function etiquetarEjecucion(ejecucionId: string, destino: string): void {
  etiquetas.set(ejecucionId, destino)
  if (solicitudes.some((s) => s.ejecucionId === ejecucionId && !s.destino)) publicar(solicitudes.map((s) => (s.ejecucionId === ejecucionId ? { ...s, destino } : s)))
}

/** La ejecución terminó o se canceló: ya no espera respuestas. */
export function limpiarEjecucion(ejecucionId: string): void {
  etiquetas.delete(ejecucionId)
  if (solicitudes.some((s) => s.ejecucionId === ejecucionId)) publicar(solicitudes.filter((s) => s.ejecucionId !== ejecucionId))
}

export function responderSolicitud(s: Solicitud, decision: DecisionHumana): void {
  publicar(solicitudes.filter((x) => x.solicitudId !== s.solicitudId))
  void window.api.core.responder(s.solicitudId, decision)
}

export function useSolicitudes(): Solicitud[] {
  return useSyncExternalStore(
    (cb) => {
      oyentes.add(cb)
      return () => oyentes.delete(cb)
    },
    () => solicitudes
  )
}
