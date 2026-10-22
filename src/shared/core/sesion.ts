import type { Adjunto } from './adjuntos'
import type { EventoAgente } from './agente'

export type EstadoTurno = 'en_curso' | 'completado' | 'limite_pasos' | 'cancelado' | 'error' | 'rechazado' | 'fallido'

/** Un intercambio ya terminado, tal como se ve en pantalla (prompt + eventos + estado). */
export interface TurnoGuardado {
  prompt: string
  modo: 'chat' | 'flujo' | 'grupo' | 'comando'
  destino: string
  raiz: string
  eventos: EventoAgente[]
  estado: EstadoTurno
  error?: string
  proyectoId?: string
  autonomia?: 'preguntar' | 'ediciones' | 'autonomo'
  adjuntos?: Adjunto[]
  /** Pregunta lateral: se respondió aparte mientras otra tarea seguía en marcha. */
  lateral?: boolean
  /** Id del mensaje en el CLI: con él se pueden deshacer los cambios de archivos de este turno. */
  mensajeId?: string
}

export interface SesionGuardada {
  id: string
  titulo: string
  proyectoId?: string
  creada: string
  actualizada: string
  transcripcion: TurnoGuardado[]
  /** Estimación de lo que ocupa el contexto del modelo en esta conversación (para mostrar el medidor al retomarla). */
  tokensContexto?: number
}

export interface ResumenSesion {
  id: string
  titulo: string
  proyectoId?: string
  actualizada: string
  turnos: number
  tokens: number
}
