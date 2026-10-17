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
  { nombre: 'plan', descripcion: 'Descompone una funcionalidad en tareas con criterios y dependencias (no implementa nada)', uso: '/plan <funcionalidad>' },
  { nombre: 'tareas', descripcion: 'Revisa las tareas del proyecto: bloqueos, mal definidas y siguiente paso', uso: '/tareas' },
  { nombre: 'commit', descripcion: 'Revisa los cambios y propone el commit (espera tu visto bueno)', uso: '/commit [indicaciones]' },
  { nombre: 'pr', descripcion: 'Redacta y abre un pull request de la rama actual en GitHub', uso: '/pr [indicaciones]' },
  { nombre: 'ayuda', descripcion: 'Lista todos los comandos', uso: '/ayuda' }
] as const

/** Comandos incluidos que se expanden a una petición para el agente (el resto los resuelve la interfaz). */
export const PLANTILLAS_INCLUIDAS: Record<string, string> = {
  plan:
    'Planifica esta funcionalidad SIN implementarla todavía: 1) consulta las tareas del proyecto (listar_tareas) para no duplicar nada; ' +
    '2) revisa la estructura del código que se verá afectada; 3) crea el plan con crear_tareas: tareas pequeñas y ordenadas, cada una con ' +
    'criterios de aceptación verificables, notas técnicas (archivos y enfoque), prioridad y dependencias entre ellas (depende_de_indices); ' +
    '4) resume el orden de ejecución y señala riesgos o requisitos que falten. Funcionalidad: $ARGUMENTOS',
  commit:
    'Prepara un commit con los cambios actuales del proyecto: 1) mira git_estado y git_diff (y git_historial para imitar el estilo de los mensajes); ' +
    '2) agrupa lo que corresponde a un solo cambio: si hay cambios sin relación, dímelo y propón varios commits; 3) nunca incluyas archivos con secretos; ' +
    '4) muéstrame el mensaje propuesto y los archivos, y espera mi visto bueno antes de usar git_preparar y git_commit. No envíes nada al remoto.',
  pr:
    'Abre un pull request con la rama actual: 1) mira git_estado (rama, commits por enviar) y git_historial para ver qué commits trae la rama; ' +
    '2) si hay cambios sin confirmar, avísame; 3) redacta el título y la descripción (qué cambia, por qué y cómo probarlo); 4) muéstramelos y espera mi visto bueno; ' +
    '5) con él, usa github_crear_pr (envía la rama si hace falta). No fusiones nada.',
  tareas:
    'Revisa las tareas de este proyecto: usa resumen_tareas y listar_tareas. Dime qué está bloqueado y por qué, qué tareas están mal definidas ' +
    '(sin criterios de aceptación) o parecen duplicadas, y qué falta. Recomiéndame las prioridades y el siguiente paso. No cambies nada sin que te lo pida.'
}

/** Sustituye `$ARGUMENTOS` en la plantilla (si no aparece, los argumentos se añaden al final). */
export function expandirPlantilla(plantilla: string, argumentos: string): string {
  const a = argumentos.trim()
  return plantilla.includes('$ARGUMENTOS') ? plantilla.replaceAll('$ARGUMENTOS', a) : a ? `${plantilla}\n\n${a}` : plantilla
}

/** Argumentos escritos tras el nombre, separados por espacios (se admiten comillas simples o dobles). Sin shell. */
export function dividirArgumentos(texto: string): string[] {
  return [...texto.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!)
}
