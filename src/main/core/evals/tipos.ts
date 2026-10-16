import type { AgenteDef } from '../agents/agente'

export type Asercion =
  | { tipo: 'archivo_existe'; ruta: string }
  | { tipo: 'archivo_contiene'; ruta: string; texto?: string; regex?: string }
  | { tipo: 'archivo_no_contiene'; ruta: string; texto?: string; regex?: string }
  /** Ejecuta un comando en el proyecto de la prueba (p. ej. `node --test`): pasa si termina con código 0. */
  | { tipo: 'comando_pasa'; comando: string; args?: string[]; timeoutMs?: number }
  | { tipo: 'respuesta_contiene'; texto?: string; regex?: string }
  | { tipo: 'herramienta_usada'; nombre: string }
  | { tipo: 'herramienta_no_usada'; nombre: string }
  /** Ningún archivo del proyecto contiene credenciales. */
  | { tipo: 'sin_secretos' }
  | { tipo: 'guardrail_activado' }
  | { tipo: 'max_pasos'; max: number }
  | { tipo: 'max_tokens'; max: number }
  /** Un modelo evalúa la respuesta y los archivos contra un criterio en lenguaje natural. */
  | { tipo: 'juez_llm'; criterio: string }

export interface CasoEval {
  id: string
  descripcion: string
  prompt: string
  /** Proyecto inicial (ruta relativa -> contenido). Puede incluir las pruebas que definen la especificación. */
  archivos: Record<string, string>
  aserciones: Asercion[]
  agente?: AgenteDef
  /** Binarios que el agente puede ejecutar durante la prueba (por defecto, solo `node`). */
  comandosPermitidos?: string[]
  /** Si el agente no termina en `completado` el caso falla, salvo que se espere otro estado. */
  maxPasos?: number
  timeoutMs?: number
}

export interface SuiteEval {
  id: string
  descripcion: string
  /** Tasa mínima de casos superados para dar la suite por buena. */
  umbral?: number
  casos: CasoEval[]
}
