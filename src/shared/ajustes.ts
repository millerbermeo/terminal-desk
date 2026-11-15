import type { ModoAutonomia } from './core/permisos'

/** Ajustes del Asistente de un proyecto (o `global`): viajan con la cuenta a todos tus equipos. */
export interface AjustesAsistente {
  /** Id de un modelo, `auto` (el router elige) o ausente = por defecto (el Sonnet más avanzado). */
  modelo?: string
  /** `autonomo` solo vale en el equipo donde se activó: nunca se sube a la cuenta. */
  autonomia?: ModoAutonomia
  /** Esfuerzo de razonamiento del modelo (suscripción): menos esfuerzo = menos tokens de pensamiento. `auto` = el del modelo. Ausente = por defecto (`ESFUERZO_POR_DEFECTO`). */
  esfuerzo?: Esfuerzo | 'auto'
}

export const ESFUERZOS_AJUSTE = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Esfuerzo = (typeof ESFUERZOS_AJUSTE)[number]

/** Valores del Asistente cuando el proyecto aún no tiene nada guardado. */
export const AUTONOMIA_POR_DEFECTO = 'autonomo' as const
export const ESFUERZO_POR_DEFECTO: Esfuerzo = 'medium'

/** Id del Sonnet de versión más alta de la lista (`claude-sonnet-5-5` > `claude-sonnet-4-5-20250929`), o `undefined` si no hay ninguno. */
export function sonnetMasAvanzado(modelos: readonly { id: string }[]): string | undefined {
  const version = (id: string): [number, number] | undefined => {
    const m = /sonnet-(\d+)(?:[-.](\d{1,2}))?(?!\d)/i.exec(id)
    return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined
  }
  let mejor: { id: string; v: [number, number] } | undefined
  for (const { id } of modelos) {
    const v = version(id)
    if (v && (!mejor || v[0] > mejor.v[0] || (v[0] === mejor.v[0] && v[1] > mejor.v[1]))) mejor = { id, v }
  }
  return mejor?.id
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
  if (typeof c.esfuerzo === 'string' && (c.esfuerzo === 'auto' || (ESFUERZOS_AJUSTE as readonly string[]).includes(c.esfuerzo))) salida.esfuerzo = c.esfuerzo as Esfuerzo | 'auto'
  return salida
}
