import type { ModoAutonomia } from './core/permisos'

/** Ajustes del Asistente de un proyecto (o `global`): viajan con la cuenta a todos tus equipos. */
export interface AjustesAsistente {
  /** Id de un modelo, o ausente = automático. */
  modelo?: string
  /** `autonomo` solo vale en el equipo donde se activó: nunca se sube a la cuenta. */
  autonomia?: ModoAutonomia
}

/** Clave de un documento de ajustes: `global` o el UUID de un proyecto. */
export const CLAVE_AJUSTES = /^(?:global|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

const AUTONOMIAS: readonly string[] = ['preguntar', 'ediciones', 'autonomo']

/** Lo válido de un objeto cualquiera (lo que llega de disco, de otro equipo o de la interfaz): el resto se descarta. */
export function limpiarAjustes(crudo: unknown): AjustesAsistente {
  const c = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  const salida: AjustesAsistente = {}
  if (typeof c.modelo === 'string' && c.modelo && c.modelo.length <= 100) salida.modelo = c.modelo
  if (typeof c.autonomia === 'string' && AUTONOMIAS.includes(c.autonomia)) salida.autonomia = c.autonomia as ModoAutonomia
  return salida
}
