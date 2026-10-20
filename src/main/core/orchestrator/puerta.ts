import { randomUUID } from 'node:crypto'
import type { ClaseSolicitud, DecisionHumana, PreguntaUsuario } from '@shared/core/agente'

export interface SolicitudHumana {
  clase: ClaseSolicitud
  contenido: string
  detalle?: string
  destructivo?: boolean
  herramienta?: string
  /** Se puede ofrecer «Permitir siempre» (hay una regla exacta que guardar). */
  puedeSiempre?: boolean
  preguntas?: PreguntaUsuario[]
}

interface Pendiente {
  resolver(d: DecisionHumana): void
  rechazar(e: Error): void
}

/**
 * Punto de espera por una decisión humana (aprobar un plan, confirmar un resultado).
 * Las promesas pendientes se rechazan si la ejecución se cancela.
 */
export class PuertaHumana {
  private readonly pendientes = new Map<string, Pendiente>()

  solicitar(s: SolicitudHumana, alSolicitar: (solicitudId: string, s: SolicitudHumana) => void, senal?: AbortSignal): Promise<DecisionHumana> {
    return new Promise((resolver, rechazar) => {
      if (senal?.aborted) return rechazar(new Error('cancelado'))
      const id = randomUUID()
      const alAbortar = (): void => {
        this.pendientes.delete(id)
        rechazar(new Error('cancelado'))
      }
      senal?.addEventListener('abort', alAbortar, { once: true })
      this.pendientes.set(id, {
        resolver: (d) => {
          senal?.removeEventListener('abort', alAbortar)
          resolver(d)
        },
        rechazar
      })
      alSolicitar(id, s)
    })
  }

  /** Devuelve false si la solicitud no existe (ya respondida o cancelada). */
  responder(solicitudId: string, decision: DecisionHumana): boolean {
    const p = this.pendientes.get(solicitudId)
    if (!p) return false
    this.pendientes.delete(solicitudId)
    p.resolver({ aprobado: decision.aprobado === true, ...(decision.comentario ? { comentario: String(decision.comentario).slice(0, 2000) } : {}), ...(decision.recordar === true ? { recordar: true } : {}), ...(decision.siempre === true ? { siempre: true } : {}), ...(decision.respuestas ? { respuestas: respuestasLimpias(decision.respuestas) } : {}) })
    return true
  }
}

function respuestasLimpias(r: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(r).slice(0, 20).map(([k, v]) => [String(k).slice(0, 500), String(v).slice(0, 2000)]))
}
