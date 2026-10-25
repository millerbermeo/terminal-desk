import { HERRAMIENTAS_CREDENCIALES } from './credenciales-herramientas'
import { HERRAMIENTAS_GIT } from './git-herramientas'
import { HERRAMIENTAS_GITHUB } from './github-herramientas'
import { HERRAMIENTAS_MOVIL } from './movil-herramientas'
import { HERRAMIENTAS_NAVEGADOR } from './navegador-herramientas'
import { HERRAMIENTAS_TAREAS, type DefHerramientaTareas } from './tareas-herramientas'

/** Servidor MCP de la aplicación: un solo servidor con todas las herramientas (tareas, git, GitHub, credenciales, navegador integrado y móviles Android). */
export const SERVIDOR_MCP = 'odesk'
export const PREFIJO_MCP = `mcp__${SERVIDOR_MCP}__`

export const HERRAMIENTAS_ODESK: readonly DefHerramientaTareas[] = [...HERRAMIENTAS_TAREAS, ...HERRAMIENTAS_GIT, ...HERRAMIENTAS_GITHUB, ...HERRAMIENTAS_CREDENCIALES, ...HERRAMIENTAS_NAVEGADOR, ...HERRAMIENTAS_MOVIL]
