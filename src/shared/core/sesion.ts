import type { EventoAgente } from './agente'

export type EstadoTurno = 'en_curso' | 'completado' | 'limite_pasos' | 'cancelado' | 'error' | 'rechazado' | 'fallido'

/** Un intercambio ya terminado, tal como se ve en pantalla (prompt + eventos + estado). */
export interface TurnoGuardado {
  prompt: string
  modo: 'chat' | 'flujo' | 'grupo'
  destino: string
  raiz: string
  eventos: EventoAgente[]
  estado: EstadoTurno
  error?: string
  proyectoId?: string
  autonomia?: 'preguntar' | 'ediciones' | 'autonomo'
}

export interface SesionGuardada {
  id: string
  titulo: string
  proyectoId?: string
  creada: string
  actualizada: string
  transcripcion: TurnoGuardado[]
}

export interface ResumenSesion {
  id: string
  titulo: string
  proyectoId?: string
  actualizada: string
  turnos: number
  tokens: number
}
