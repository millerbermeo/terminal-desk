import type { Uso } from './agente'

export type TipoSpan = 'agente' | 'llm' | 'herramienta' | 'evento'

/** Una unidad de trabajo medida. Los spans forman un árbol por `padre` (agente > llm | herramienta > agente…). */
export interface Span {
  id: string
  padre?: string
  tipo: TipoSpan
  nombre: string // agente: su nombre; llm: el modelo; herramienta: su nombre; evento: su tipo
  inicio: number // epoch ms
  fin?: number
  duracionMs?: number
  estado: 'ok' | 'error'
  entrada?: string // prompt / argumentos (truncado y sin credenciales)
  salida?: string // respuesta / resultado (truncado y sin credenciales)
  uso?: Uso // tokens (spans llm y agente)
  atributos?: Record<string, string | number | boolean>
}

export type EstadoTraza = 'en_curso' | 'completado' | 'limite_pasos' | 'cancelado' | 'error' | 'rechazado' | 'fallido'

/** Traza completa de una ejecución: todo lo que hicieron los agentes, en orden y con tiempos. */
export interface Traza {
  id: string // = ejecucionId
  inicio: number
  fin?: number
  duracionMs?: number
  prompt: string
  agente: string
  modo: 'chat' | 'flujo' | 'grupo' | 'eval'
  proyectoId?: string
  estado: EstadoTraza
  uso: Uso // suma de todas las llamadas al modelo (incluidos subagentes y resúmenes)
  spans: Span[]
  truncada?: boolean // se alcanzó el máximo de spans
}

export interface ResumenTraza {
  id: string
  inicio: number
  duracionMs?: number
  prompt: string
  agente: string
  modo: Traza['modo']
  estado: EstadoTraza
  llamadasLlm: number
  herramientas: number
  errores: number
  uso: Uso
}
