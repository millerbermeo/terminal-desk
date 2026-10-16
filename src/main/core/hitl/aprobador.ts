import type { EventoAgente } from '@shared/core/agente'
import type { LlamadaHerramienta } from '@shared/core/herramientas'
import type { Aprobador } from '../agents/harness'
import { esDestructiva } from '../guardrails/destructivo'
import type { PuertaHumana } from '../orchestrator/puerta'

export interface DepsAprobador {
  puerta: PuertaHumana
  ejecucionId: string
  alEvento: (e: EventoAgente) => void
  senal?: AbortSignal
}

const MAX_DETALLE = 1500
const recortar = (t: string): string => (t.length > MAX_DETALLE ? t.slice(0, MAX_DETALLE) + '\n[… recortado]' : t)

/** Lo que verá el usuario: qué se va a hacer exactamente. */
export function describirLlamada(l: LlamadaHerramienta): string {
  const e = l.entrada
  switch (l.nombre) {
    case 'ejecutar_comando':
      return `$ ${[String(e.comando), ...(Array.isArray(e.args) ? e.args.map(String) : [])].join(' ')}`
    case 'escribir_archivo':
      return `Escribir ${String(e.ruta)}\n\n${recortar(String(e.contenido ?? ''))}`
    default:
      return `${l.nombre}\n${recortar(JSON.stringify(e, null, 2))}`
  }
}

/**
 * Human-in-the-loop: cada escritura o ejecución espera la confirmación del usuario.
 * Las acciones destructivas (rm, git push/reset --hard…) se marcan como tales y nunca se «recuerdan».
 * Si la ejecución se cancela mientras se espera, la acción se deniega.
 */
export function crearAprobadorHumano(d: DepsAprobador): Aprobador {
  const recordadas = new Set<string>()
  return async (llamada, riesgo, agente) => {
    const razon = esDestructiva(llamada.nombre, llamada.entrada)
    if (!razon && recordadas.has(llamada.nombre)) return true
    try {
      const decision = await d.puerta.solicitar(
        {
          clase: 'accion',
          contenido: describirLlamada(llamada),
          detalle: `${agente} quiere usar «${llamada.nombre}» (${riesgo})${razon ? ` — ACCIÓN DESTRUCTIVA: ${razon}` : ''}`,
          herramienta: llamada.nombre,
          ...(razon ? { destructivo: true } : {})
        },
        (solicitudId, s) => d.alEvento({ ejecucionId: d.ejecucionId, agente, profundidad: 0, tipo: 'solicitud_humana', solicitudId, ...s }),
        d.senal
      )
      if (decision.aprobado && decision.recordar && !razon) recordadas.add(llamada.nombre)
      return decision.aprobado
    } catch {
      return false
    }
  }
}
