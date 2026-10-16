/**
 * Comando propio escrito en el chat como `/nombre argumentos`.
 * - `prompt`: se expande a una petición para el agente (`$ARGUMENTOS` se sustituye por lo que se escriba detrás).
 * - `ejecutable`: programa fijo (argv, sin shell). No pasa por el modelo; su salida se muestra y el agente la ve en el siguiente mensaje.
 */
export interface ComandoUsuario {
  nombre: string // a-z, 0-9, «-» y «_»
  descripcion: string
  tipo: 'prompt' | 'ejecutable'
  plantilla?: string // prompt
  comando?: string[] // ejecutable: [programa, ...argumentos fijos]
  argumentos?: boolean // ejecutable: admite argumentos extra detrás del nombre
  permitido?: boolean // ejecutable: no pide confirmación (nunca si es destructivo)
}

/** Nombres de los comandos incluidos en la aplicación (no se pueden redefinir). */
export const COMANDOS_INCLUIDOS = [
  { nombre: 'flujo', descripcion: 'Lanza el flujo de desarrollo (plan, aprobación, generación, verificación)', uso: '/flujo <petición>' },
  { nombre: 'chat', descripcion: 'Vuelve al modo chat', uso: '/chat' },
  { nombre: 'modo', descripcion: 'Cambia la autonomía: preguntar, ediciones o autonomo', uso: '/modo preguntar|ediciones|autonomo' },
  { nombre: 'nueva', descripcion: 'Empieza una conversación nueva (la actual queda en el historial)', uso: '/nueva' },
  { nombre: 'historial', descripcion: 'Abre el historial de conversaciones', uso: '/historial' },
  { nombre: 'permisos', descripcion: 'Reglas de permisos de este proyecto', uso: '/permisos' },
  { nombre: 'comandos', descripcion: 'Gestiona tus comandos con /', uso: '/comandos' },
  { nombre: 'ayuda', descripcion: 'Lista todos los comandos', uso: '/ayuda' }
] as const

/** Sustituye `$ARGUMENTOS` en la plantilla (si no aparece, los argumentos se añaden al final). */
export function expandirPlantilla(plantilla: string, argumentos: string): string {
  const a = argumentos.trim()
  return plantilla.includes('$ARGUMENTOS') ? plantilla.replaceAll('$ARGUMENTOS', a) : a ? `${plantilla}\n\n${a}` : plantilla
}

/** Argumentos escritos tras el nombre, separados por espacios (se admiten comillas simples o dobles). Sin shell. */
export function dividirArgumentos(texto: string): string[] {
  return [...texto.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!)
}
