/**
 * Cuando el asistente no puede hacer algo (el sistema, una regla, un guardrail o tú mismo lo negaron), el texto técnico del error no
 * dice qué falta. Aquí se reconoce el motivo (puro, probado) y se explica en claro: qué intentó, por qué no pudo y qué permiso necesita.
 */

export type TipoDenegacion = 'sistema' | 'regla' | 'guardrail' | 'usuario' | 'autonomo' | 'credenciales' | 'sudo' | 'cli'

export interface Denegacion {
  tipo: TipoDenegacion
  titulo: string
  /** Lo que intentó hacer («Escribir en», «Ejecutar»…) y sobre qué (ruta o comando). */
  accion: string
  objetivo?: string
  porque: string
  /** Qué permiso hace falta para que funcione. */
  permiso: string
  /** Cómo dárselo (o qué hacer si no se puede). */
  solucion: string
}

export interface EntradaDenegacion {
  herramienta?: string
  entrada?: Record<string, unknown>
  /** Mensaje de error del resultado, o motivo del guardrail. */
  texto: string
  /** El texto viene de un evento `guardrail` (no de un resultado de herramienta). */
  guardrail?: boolean
}

const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')

const VERBO: Record<string, string> = {
  Read: 'Leer',
  Grep: 'Buscar en',
  Glob: 'Listar',
  Write: 'Escribir en',
  Edit: 'Editar',
  MultiEdit: 'Editar',
  NotebookEdit: 'Editar',
  Bash: 'Ejecutar',
  leer_archivo: 'Leer',
  escribir_archivo: 'Escribir en',
  ejecutar_comando: 'Ejecutar'
}
const ESCRIBE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'escribir_archivo'])
const EJECUTA = new Set(['Bash', 'ejecutar_comando'])

function objetivoDe(e: EntradaDenegacion): string | undefined {
  const i = e.entrada ?? {}
  const v = cadena(i.file_path) || cadena(i.path) || cadena(i.ruta) || cadena(i.command) || cadena(i.comando) || cadena(i.pattern)
  return v ? (v.length > 220 ? v.slice(0, 219) + '…' : v) : undefined
}

/** Ruta que aparece en un error del sistema («EACCES: permission denied, open '/x/y'»). */
function rutaDelError(texto: string): string | undefined {
  return /(?:open|access|scandir|mkdir|unlink|rename|stat|copyfile|rmdir|lstat|readdir|writefile|readfile)\s+['"]([^'"]+)['"]/i.exec(texto)?.[1] ?? /['"](\/[^'"]+|[A-Za-z]:\\[^'"]+)['"]/.exec(texto)?.[1] ?? /:\s+(\/[^\s:]+):\s*Permission denied/i.exec(texto)?.[1] ?? /cannot (?:open|access|read|create|remove)[^:]*'([^']+)'/i.exec(texto)?.[1]
}

export function explicarDenegacion(e: EntradaDenegacion): Denegacion | null {
  const t = e.texto.trim()
  if (!t) return null
  const herr = e.herramienta ?? ''
  const verbo = VERBO[herr] ?? (herr ? `Usar ${herr}` : 'Hacer esto')
  const objetivo = objetivoDe(e)
  const base = { accion: verbo, ...(objetivo ? { objetivo } : {}) }

  // Eventos de guardrail que solo informan (se permitió o se tapó): no son una denegación.
  if (e.guardrail && /(permitido|autorizado|tapadas|enviadas al modelo)/i.test(t) && !/denegad/i.test(t)) return null

  // 1. El sistema operativo no deja (permisos de archivo)
  if (/\b(EACCES|EPERM)\b|permission denied|operation not permitted|permiso denegado|acceso denegado|access is denied/i.test(t) && !/permission to use|requested permissions/i.test(t)) {
    const ruta = rutaDelError(t) ?? (e.herramienta && !EJECUTA.has(herr) ? objetivo : undefined)
    const lugar = ruta ?? 'ese archivo'
    const escribe = ESCRIBE.has(herr) || /\b(write|mkdir|unlink|rename|rmdir|copyfile|create|remove)\b/i.test(t)
    const ejecuta = EJECUTA.has(herr) && /\bexec|spawn|command|comando\b/i.test(t)
    const permiso = ejecuta
      ? 'Permiso de ejecución (x) sobre el programa o script'
      : escribe
        ? `Permiso de escritura (w) sobre «${lugar}» o, si hay que crearlo, sobre su carpeta`
        : `Permiso de lectura (r) sobre «${lugar}» y de acceso (x) a todas las carpetas que lo contienen`
    return {
      tipo: 'sistema',
      titulo: escribe ? 'El sistema no deja escribir ahí' : ejecuta ? 'El sistema no deja ejecutar eso' : 'No tienes permisos sobre este archivo',
      accion: base.accion,
      ...(ruta ? { objetivo: ruta } : objetivo ? { objetivo } : {}),
      porque: 'El sistema operativo negó el acceso: el usuario con el que corre Odesk Code no tiene ese permiso (es del sistema de archivos, no de la IA).',
      permiso,
      solucion: `Mira quién es el dueño y qué permisos tiene con «ls -l ${ruta ? `"${ruta}"` : '<ruta>'}». Se arregla con «chmod u+${ejecuta ? 'x' : escribe ? 'w' : 'r'} …» si es tuyo, o con «sudo chown $USER …» si es de otro usuario. Si es una carpeta de red o un disco montado, vuelve a montarlo con tu usuario.`
    }
  }

  // 2. Acciones catastróficas bloqueadas en modo autónomo
  const auto = /Bloqueado en modo aut[oó]nomo:\s*(.+?)(?:\.\s|\.$|$)/i.exec(t)
  if (auto) {
    return {
      tipo: 'autonomo',
      titulo: 'Esta acción está prohibida, incluso en modo Autónomo',
      ...base,
      porque: `Se considera peligrosa: ${auto[1]}.`,
      permiso: 'Ninguno: ningún modo de autonomía la permite (es una barrera de seguridad fija).',
      solucion: 'Si de verdad hace falta, ejecútala tú en una terminal con calma y dile al asistente cómo quedó.'
    }
  }

  // 3. Credenciales
  if (/no autoriz[oó] este acceso a credenciales|acceso a credenciales denegado/i.test(t)) {
    return {
      tipo: 'credenciales',
      titulo: 'Acceso a credenciales no autorizado',
      ...base,
      porque: 'Leer archivos como .env, claves o variables de entorno enviaría su contenido al modelo, y no se escribió la contraseña del equipo para permitirlo.',
      permiso: 'Tu autorización con la contraseña del equipo (vale para toda la conversación una vez dada).',
      solucion: 'Pídele que vuelva a intentarlo y escribe la contraseña en el diálogo. Si no quieres darle el dato, pásale solo los valores que no sean secretos.'
    }
  }
  if (/permisos de administrador|sudo/i.test(t) && /(deneg|rechaz|no se recibi)/i.test(t)) {
    return {
      tipo: 'sudo',
      titulo: 'Sin permisos de administrador',
      ...base,
      porque: 'El comando necesita sudo y no se aprobó con la contraseña de administrador.',
      permiso: 'Permisos de administrador (sudo) concedidos por ti en el diálogo.',
      solucion: 'Pídele que lo repita y escribe la contraseña del equipo cuando la pida, o ejecútalo tú en una terminal.'
    }
  }

  // 4. Regla de permisos del proyecto
  if (/regla de permisos de este proyecto lo deniega/i.test(t)) {
    return {
      tipo: 'regla',
      titulo: 'Una regla de permisos lo bloquea',
      ...base,
      porque: 'Este proyecto tiene una regla «denegar» que coincide con esta acción.',
      permiso: 'Quitar o cambiar esa regla en Permisos del proyecto.',
      solucion: 'Abre Ajustes → Permisos, busca la regla «denegar» que coincide y bórrala o cámbiala a «permitir».'
    }
  }

  // 5. Rechazado por ti
  if (/el usuario (lo )?rechaz[oó]|el usuario no quiso|el usuario deneg[oó]|user (rejected|denied|doesn't want)/i.test(t)) {
    const comentario = /Comentario del usuario:\s*(.+)$|rechaz[oó]:\s*(.+)$/is.exec(t)
    return {
      tipo: 'usuario',
      titulo: 'Rechazaste esta acción',
      ...base,
      porque: `La acción pedía tu aprobación y la rechazaste${comentario ? `: «${(comentario[1] ?? comentario[2] ?? '').trim().slice(0, 160)}»` : '.'}`,
      permiso: 'Tu aprobación (en el diálogo de confirmación).',
      solucion: 'Dile que lo intente otra vez y aprueba el diálogo; o cambia el modo de autonomía a «Ediciones» (archivos) o «Autónomo» (comandos) para no tener que confirmar cada vez.'
    }
  }

  // 6. Guardrails de rutas y contenido
  const protegida = /no se puede escribir en [«"](.+?)[»"] \((.+?)\)/i.exec(t)
  if (protegida) {
    return {
      tipo: 'guardrail',
      titulo: 'Ruta protegida: la IA no puede escribir ahí',
      accion: 'Escribir en',
      objetivo: protegida[1]!,
      porque: `«${protegida[1]}» es ${protegida[2]}: se protege para no romper el repositorio ni las dependencias.`,
      permiso: 'Ninguno para la IA: es un guardrail fijo.',
      solucion: 'Si de verdad hay que cambiarlo, hazlo tú a mano (o con git/pnpm, que sí pueden tocarlo).'
    }
  }
  const sensible = /[«"](.+?)[»"] es un (.+?): su contenido no se env[ií]a al modelo|accede a [«"](.+?)[»"], que parece contener credenciales/i.exec(t)
  if (sensible) {
    return {
      tipo: 'guardrail',
      titulo: 'Archivo con credenciales: no se envía al modelo',
      accion: base.accion,
      objetivo: sensible[1] ?? sensible[3] ?? objetivo ?? '',
      porque: sensible[2] ? `Es un ${sensible[2]}.` : 'Parece contener credenciales.',
      permiso: 'Tu autorización con la contraseña del equipo para leer archivos sensibles.',
      solucion: 'Si necesita un valor concreto, pásaselo tú en el chat o guárdalo como credencial de prueba; no hace falta darle todo el archivo.'
    }
  }
  if (/credenciales|secretos|claves? (api|privad)/i.test(t) && (e.guardrail || /^Bloqueado/i.test(t))) {
    return {
      tipo: 'guardrail',
      titulo: 'Se frenó por posibles credenciales',
      ...base,
      porque: t.replace(/^Bloqueado:\s*/i, ''),
      permiso: 'Ninguno automático: quita la credencial del texto, o confirma tú el envío cuando se te pregunte.',
      solucion: 'Cambia el secreto por una variable de entorno o un marcador, y vuelve a pedirlo.'
    }
  }
  if (/^Bloqueado:/i.test(t) || e.guardrail) {
    return {
      tipo: 'guardrail',
      titulo: 'Un guardrail frenó esta acción',
      ...base,
      porque: t.replace(/^Bloqueado:\s*/i, ''),
      permiso: 'Ninguno: es una barrera de seguridad de la app.',
      solucion: 'Revisa el motivo; si la acción es legítima, hazla tú o reformula la tarea para que no la necesite.'
    }
  }

  // 7. El CLI de Claude pidió un permiso que no estaba concedido
  const cli = /requested permissions to (?:use )?([\w:*.-]+)(?: on (.+?))?,? but you haven't granted it yet|permission to use ([\w:*.-]+) has been denied|permission denied for tool ([\w:*.-]+)/i.exec(t)
  if (cli) {
    const herramienta = cli[1] ?? cli[3] ?? cli[4] ?? herr
    const escribe = ESCRIBE.has(herramienta)
    const ejecuta = EJECUTA.has(herramienta)
    return {
      tipo: 'cli',
      titulo: `Sin permiso para usar ${herramienta}`,
      accion: VERBO[herramienta] ?? `Usar ${herramienta}`,
      ...(cli[2] ?? objetivo ? { objetivo: (cli[2] ?? objetivo)! } : {}),
      porque: `El modo de autonomía actual no concede «${herramienta}» sin preguntarte.`,
      permiso: escribe ? 'Modo «Ediciones» o «Autónomo» (permiten editar archivos).' : ejecuta ? 'Modo «Autónomo» (permite ejecutar comandos) o aprobar cada comando.' : `Permiso para la herramienta «${herramienta}» (una regla «permitir» o el modo Autónomo).`,
      solucion: 'Cambia la autonomía en el compositor (chip del modelo → Autonomía) o añade una regla «permitir» en Permisos.'
    }
  }
  return null
}
