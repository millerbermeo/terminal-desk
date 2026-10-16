export interface InfoModelo {
  id: string
  nombre: string
  ventana: number // tokens de contexto que admite
}

export interface LimiteApi {
  limite: number
  restante: number
  reinicio?: string // ISO
}

/** Límites de tasa que la API informa en las cabeceras de cada respuesta. */
export interface LimitesApi {
  solicitudes?: LimiteApi
  tokens?: LimiteApi
  entrada?: LimiteApi
  salida?: LimiteApi
  actualizado: number // epoch ms
}

export interface UsoModelo {
  entrada: number
  salida: number
  llamadas: number
}

/** Consumo registrado por esta aplicación (todas las llamadas al modelo, incluidos resúmenes y jueces). */
export interface ResumenUso {
  dia: string // YYYY-MM-DD (hora local)
  hoy: Record<string, UsoModelo> // por modelo
  total: UsoModelo // hoy, todos los modelos
  ultimos7Dias: UsoModelo
  limites?: LimitesApi
}

/** Modelos que se conocen aunque la API no responda a la lista. */
export const MODELOS_CONOCIDOS: readonly InfoModelo[] = [
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', ventana: 200_000 },
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', ventana: 200_000 },
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', ventana: 200_000 },
  { id: 'claude-fable-5-1', nombre: 'Claude Fable 5.1', ventana: 200_000 }
]

export const VENTANA_POR_DEFECTO = 200_000
