/**
 * Cuánto pregunta el agente (las reglas de permisos y los guardrails valen en los tres):
 * - `preguntar`: confirma toda escritura y ejecución.
 * - `ediciones`: las escrituras de archivos dentro del proyecto pasan solas; los comandos siguen preguntando.
 * - `autonomo`: además ejecuta sin preguntar las verificaciones del proyecto (typecheck, lint, test) y en el Flujo aprueba el plan solo.
 *   Con presupuesto de tokens. Lo destructivo, los comandos desconocidos y la confirmación final del Flujo siguen pidiendo confirmación.
 */
export type ModoAutonomia = 'preguntar' | 'ediciones' | 'autonomo'

export type AccionRegla = 'permitir' | 'denegar'

/** Regla persistente de un proyecto (o global). `comando`: línea de comando (`pnpm test`, `git commit *`); `herramienta`: nombre de herramienta (`escribir_archivo`, `mcp__db__*`). */
export interface ReglaPermiso {
  id: string
  tipo: 'comando' | 'herramienta'
  patron: string
  accion: AccionRegla
  creada: string // ISO
}

export type NuevaRegla = Pick<ReglaPermiso, 'tipo' | 'patron' | 'accion'>
