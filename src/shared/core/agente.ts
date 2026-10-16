import type { LlamadaHerramienta, ResultadoHerramienta } from './herramientas'
import type { ModoAutonomia } from './permisos'

export type BloqueContenido =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'herramienta_uso'; id: string; nombre: string; entrada: Record<string, unknown> }
  | { tipo: 'herramienta_resultado'; usoId: string; texto: string; error?: boolean }
  /** Imagen o PDF adjuntos: el contenido está en el almacén de adjuntos (no se duplica en la conversación). `tokens` = estimación de su coste en contexto. */
  | { tipo: 'imagen'; adjuntoId: string; mime: string; nombre: string; tokens: number }
  | { tipo: 'documento'; adjuntoId: string; mime: string; nombre: string; tokens: number }

export interface Mensaje {
  rol: 'user' | 'assistant'
  contenido: BloqueContenido[]
}

export interface Uso {
  tokensEntrada: number
  tokensSalida: number
}

export type EstadoEjecucion = 'completado' | 'limite_pasos' | 'cancelado' | 'error'

export interface ResultadoAgente {
  estado: EstadoEjecucion
  texto: string // última respuesta de texto del agente
  mensajes: Mensaje[] // conversación completa (permite continuarla)
  uso: Uso
  pasos: number
  error?: string
}

/** Eventos de una ejecución. `agente` y `profundidad` identifican al subagente que los emite (0 = raíz). */
export type EventoAgente = { ejecucionId: string; agente: string; profundidad: number } & (
  | { tipo: 'inicio'; prompt: string }
  | { tipo: 'paso'; numero: number }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'texto_delta'; texto: string } // trozo del texto que se está escribiendo; el evento `texto` lo reemplaza al terminar el paso
  | { tipo: 'herramienta_inicio'; llamada: LlamadaHerramienta }
  | { tipo: 'herramienta_fin'; llamada: LlamadaHerramienta; resultado: ResultadoHerramienta }
  | { tipo: 'contexto'; estrategia: 'poda' | 'resumen'; tokensAntes: number; tokensDespues: number }
  | { tipo: 'fin'; resultado: ResultadoAgente }
  | { tipo: 'ruta'; complejidad: Complejidad; modelo: string; razon: string; sugerirFlujo: boolean }
  | { tipo: 'flujo_nodo'; nodo: NodoFlujo; intento: number }
  | { tipo: 'solicitud_humana'; solicitudId: string; clase: ClaseSolicitud; contenido: string; detalle?: string; destructivo?: boolean; herramienta?: string; puedeSiempre?: boolean }
  | { tipo: 'guardrail'; herramienta: string; motivo: string }
  | { tipo: 'worktree'; accion: AccionWorktree; rama: string; ruta: string; detalle?: string }
  | { tipo: 'flujo_fin'; estado: EstadoFlujo; resumen: string }
  | { tipo: 'aprobacion_automatica'; clase: ClaseSolicitud; motivo: string }
  | { tipo: 'comando_salida'; nombre: string; linea: string; ok: boolean; salida: string; duracionMs: number }
  | { tipo: 'a2a'; de: string; a: string; fase: 'envio' | 'respuesta'; texto: string }
)

export type Complejidad = 'simple' | 'media' | 'compleja'
export type NodoFlujo = 'planificacion' | 'aprobacion' | 'generacion' | 'pruebas' | 'confirmacion'
export type ClaseSolicitud = 'plan' | 'confirmacion' | 'accion'
export type AccionWorktree = 'creado' | 'confirmado' | 'descartado' | 'conservado' | 'publicado'
export type EstadoFlujo = 'completado' | 'rechazado' | 'fallido' | 'cancelado'

/** Respuesta del usuario a una `solicitud_humana`. */
export interface DecisionHumana {
  aprobado: boolean
  comentario?: string
  /** Solo en solicitudes de clase `accion`: no volver a preguntar por esta herramienta durante la ejecución (nunca aplica a acciones destructivas). */
  recordar?: boolean
  /** Solo en `accion`: guardar una regla persistente que permita esta acción en el proyecto (nunca para acciones destructivas). */
  siempre?: boolean
}

/** Directorio de trabajo aislado (git worktree) de una tarea de agente. */
export interface InfoWorktree {
  id: string
  proyectoId: string
  rama: string
  ruta: string
}

export interface ResultadoPublicar {
  ok: boolean
  mensaje: string
}

/** Petición del renderer para lanzar un agente (el cwd se resuelve en main desde el proyecto). */
export interface SolicitudAgente {
  prompt: string
  proyectoId?: string
  agenteId?: string // por defecto, el agente raíz
  autonomia?: ModoAutonomia // por defecto, `preguntar`
  aislado?: boolean // solo flujo: trabaja en un git worktree propio (por defecto sí); false = en el directorio del proyecto
  modo?: 'chat' | 'flujo' // flujo = planificación -> aprobación -> generación -> pruebas -> confirmación (exige proyectoId)
  grupoId?: string // consulta a todos los submódulos del grupo con agentes que se comunican entre sí (A2A)
  modelo?: string // fuerza un modelo (desactiva el router)
  adjuntos?: string[] // ids de archivos subidos con `adjuntoSubir` (imágenes, PDFs, texto); máx. 5
  sesionId?: string // continúa esa conversación (memoria de corto plazo); sin él se crea una nueva
}

export interface EjecucionIniciada {
  ejecucionId: string
  sesionId: string
}

export type EstadoServidorMcp = 'conectado' | 'error' | 'deshabilitado'

export interface InfoServidorMcp {
  nombre: string
  estado: EstadoServidorMcp
  herramientas: number
  error?: string
}
