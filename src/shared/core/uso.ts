export interface InfoModelo {
  id: string
  nombre: string
  ventana?: number // tokens de contexto que admite; ausente si no se conoce (suscripción, hasta usar el modelo)
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
  entrada: number // incluye la caché
  salida: number
  llamadas: number
  /** De `entrada`, lo leído de la caché (barato). Solo en suscripción. */
  cache?: number
  /** Coste en USD a precio de lista que informa el CLI (en suscripción no se factura, pero mide el consumo real). */
  costo?: number
}

/** Consumo registrado por esta aplicación (todas las llamadas al modelo, incluidos resúmenes y jueces). */
export interface ResumenUso {
  dia: string // YYYY-MM-DD (hora local)
  hoy: Record<string, UsoModelo> // por modelo
  total: UsoModelo // hoy, todos los modelos
  ultimos7Dias: UsoModelo
  limites?: LimitesApi
  /** Cuánto del plan de suscripción se ha usado (toda la cuenta: web, terminales, otros equipos). */
  plan?: UsoPlan
}

/** Una ventana de límite del plan. */
export interface VentanaPlan {
  /** 0–100 */
  porcentaje: number
  /** Cuándo se reinicia (epoch ms). */
  reinicio?: number
}

/** Uso del plan de Claude (Pro/Max) tal como lo muestra `/usage` de Claude Code. */
export interface UsoPlan {
  cuenta: string
  /** pro, max… */
  tipo?: string
  cincoHoras?: VentanaPlan
  semana?: VentanaPlan
  semanaOpus?: VentanaPlan
  semanaSonnet?: VentanaPlan
  /** Epoch ms de la última consulta correcta. */
  actualizado?: number
  /** Por qué no se pudo consultar la última vez (se siguen mostrando los últimos datos buenos). */
  error?: string
}

/** Modelos que se conocen aunque la API no responda a la lista. */
export const MODELOS_CONOCIDOS: readonly InfoModelo[] = [
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', ventana: 200_000 },
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', ventana: 200_000 },
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', ventana: 200_000 },
  { id: 'claude-fable-5-1', nombre: 'Claude Fable 5.1', ventana: 200_000 }
]

export const VENTANA_POR_DEFECTO = 200_000

/** Uso real del contexto de una conversación, tal como lo informa el CLI (solo con su proceso vivo). */
export interface ContextoUso {
  total: number
  maximo: number
  /** 0–100 */
  porcentaje: number
  categorias: { nombre: string; tokens: number; /** Margen que el CLI reserva para compactar (no es contenido). */ reservado: boolean }[]
}
