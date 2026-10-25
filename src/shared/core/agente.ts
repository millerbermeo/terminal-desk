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
  | { tipo: 'inicio'; prompt: string; /** Id del mensaje del usuario en el CLI: permite deshacer los cambios de archivos hasta ahí. */ mensajeId?: string }
  | { tipo: 'paso'; numero: number }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'texto_delta'; texto: string } // trozo del texto que se está escribiendo; el evento `texto` lo reemplaza al terminar el paso
  | { tipo: 'herramienta_inicio'; llamada: LlamadaHerramienta }
  | { tipo: 'herramienta_fin'; llamada: LlamadaHerramienta; resultado: ResultadoHerramienta }
  | { tipo: 'contexto'; estrategia: 'poda' | 'resumen'; tokensAntes: number; tokensDespues: number }
  | { tipo: 'fin'; resultado: ResultadoAgente }
  | { tipo: 'ruta'; complejidad: Complejidad; modelo: string; razon: string; sugerirFlujo: boolean }
  | { tipo: 'flujo_nodo'; nodo: NodoFlujo; intento: number }
  | { tipo: 'solicitud_humana'; solicitudId: string; clase: ClaseSolicitud; contenido: string; detalle?: string; destructivo?: boolean; herramienta?: string; puedeSiempre?: boolean; preguntas?: PreguntaUsuario[] }
  | { tipo: 'guardrail'; herramienta: string; motivo: string }
  | { tipo: 'worktree'; accion: AccionWorktree; rama: string; ruta: string; detalle?: string }
  | { tipo: 'flujo_fin'; estado: EstadoFlujo; resumen: string }
  | { tipo: 'aprobacion_automatica'; clase: ClaseSolicitud; motivo: string }
  /** Tokens que ocupó el contexto en la última llamada del agente raíz (dato real de la API, no una estimación). */
  | { tipo: 'uso_contexto'; tokens: number; modelo?: string; ventana?: number }
  | { tipo: 'comando_salida'; nombre: string; linea: string; ok: boolean; salida: string; duracionMs: number }
  | { tipo: 'a2a'; de: string; a: string; fase: 'envio' | 'respuesta'; texto: string }
  /** La cuenta de suscripción activa llegó a su límite y la ejecución continúa con otra. */
  | { tipo: 'cuenta_cambiada'; de: string; a: string; hasta?: number; /** Se cortó a mitad de la tarea y la otra cuenta sigue desde ahí. */ continua?: boolean }
  /** El Asistente abrió una sesión nueva con un resumen en vez de seguir arrastrando un contexto enorme (cada llamada lo reenvía entero). */
  | { tipo: 'contexto_compactado'; motivo: 'contexto' | 'imagenes' | 'inactividad' | 'modelo' | 'cuenta'; tokensAntes: number; imagenes: number; conModelo: boolean }
  /** Aviso de consumo: el contexto de la conversación o el gasto de una ejecución son altos. */
  | { tipo: 'aviso_consumo'; motivo: 'contexto' | 'costo'; tokens?: number; costo?: number }
  /** En modo autónomo, la respuesta topó el límite de pasos y se le pidió continuar sola (sin que el usuario lo escriba). */
  | { tipo: 'continuacion_automatica'; ronda: number; max: number }
)

export type Complejidad = 'simple' | 'media' | 'compleja'
export type NodoFlujo = 'planificacion' | 'aprobacion' | 'generacion' | 'pruebas' | 'confirmacion'
export type ClaseSolicitud = 'plan' | 'confirmacion' | 'accion' | 'pregunta'

/** Pregunta con opciones que el modelo le hace al usuario (herramienta `AskUserQuestion` del CLI). */
export interface PreguntaUsuario {
  pregunta: string
  encabezado?: string
  opciones: { etiqueta: string; descripcion?: string }[]
  multiple?: boolean
}
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
  /** Solo en `pregunta`: respuesta elegida (o escrita) para cada pregunta, por su texto. */
  respuestas?: Record<string, string>
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
  esfuerzo?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' // esfuerzo de razonamiento (solo suscripción); sin él, el del modelo
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
