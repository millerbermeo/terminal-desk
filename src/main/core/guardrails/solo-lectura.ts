import { palabras } from './autonomo'

/**
 * ¿Es un `Bash` que solo LEE (buscar, listar, ver archivos, consultar git)? Esos comandos no necesitan confirmación en «Preguntar»
 * ni en «Ediciones»: equivalen a `Read`/`Grep`/`Glob`, que ya se permiten siempre. Sin esto, en «Preguntar» hasta un `grep -rn` o
 * un `git log` paraban el turno esperando un clic (y el modelo los usa a menudo para responder una pregunta).
 *
 * Conservador a propósito: ante cualquier duda devuelve `false` y se pregunta como siempre. Rechaza sustituciones (`$( )`, `` ` ``,
 * `$VAR`), redirecciones a archivo, procesos en segundo plano, subshells, asignaciones de entorno y cualquier programa u opción que
 * pueda escribir o ejecutar otra cosa (`find -exec`, `sed -i`, `sort -o`, `rg --pre`, `git branch <nombre>`…).
 */
export function esBashSoloLectura(linea: string): boolean {
  // Redirecciones inofensivas habituales: descartar errores o unirlos a la salida.
  const l = linea.replace(/\s2>\s*\/dev\/null\b/g, ' ').replace(/\s2>&1\b/g, ' ').trim()
  if (!l || l.length > 2000) return false
  if (/[`$<>()\n\r\\]/.test(fueraDeComillas(l, true))) return false // las llaves `{a,b}` solo expanden nombres; un grupo `{ …; }` cae igual (programa `{`)
  if (/(^|[^&])&($|[^&])/.test(fueraDeComillas(l, false))) return false // `&` suelto = segundo plano
  const partes = separar(l)
  if (!partes) return false
  return partes.every((p) => tramoSoloLectura(palabras(p)))
}

/** La línea sin el contenido entre comillas (dentro de comillas simples nada se interpreta; en dobles, `$` y `` ` `` sí y se conservan). */
function fueraDeComillas(l: string, conservarExpansionEnDobles: boolean): string {
  let r = ''
  let comilla: '"' | "'" | null = null
  for (const c of l) {
    if (comilla) {
      if (c === comilla) comilla = null
      else if (comilla === '"' && conservarExpansionEnDobles && (c === '$' || c === '`')) r += c
      continue
    }
    if (c === '"' || c === "'") comilla = c
    else r += c
  }
  return comilla ? r + '\n' : r // comillas sin cerrar: no se acepta
}

/** Tramos separados por `&&`, `||`, `;` y `|` fuera de comillas. */
function separar(l: string): string[] | null {
  const r: string[] = []
  let actual = ''
  let comilla: '"' | "'" | null = null
  for (let i = 0; i < l.length; i++) {
    const c = l[i]!
    if (comilla) {
      if (c === comilla) comilla = null
      actual += c
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      actual += c
    } else if (c === ';' || c === '|' || c === '&') {
      if ((c === '|' || c === '&') && l[i + 1] === c) i++
      r.push(actual)
      actual = ''
    } else actual += c
  }
  r.push(actual)
  const t = r.map((x) => x.trim())
  return t.every(Boolean) ? t : null
}

/** Programas que solo leen con cualquier opción. */
const LIBRES = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'file', 'stat', 'du', 'df', 'echo', 'printf', 'which', 'whereis',
  'basename', 'dirname', 'realpath', 'readlink', 'uniq', 'cut', 'tr', 'nl', 'diff', 'cmp', 'cd', 'true', 'test', 'whoami', 'uname',
  'id', 'column', 'comm', 'rev', 'md5sum', 'sha1sum', 'sha256sum', 'jq'
])

/** Opciones que convierten en escritura o ejecución a un programa que normalmente solo lee. */
const PELIGROSAS: Record<string, RegExp> = {
  find: /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
  sort: /^(-o|--output)/,
  tree: /^-o$/,
  rg: /^--(pre|pre-glob)/,
  fd: /^(-x|-X|--exec|--exec-batch)/
}

/** Subcomandos de git que solo leen (sin argumentos que cambien algo). */
const GIT_LECTURA = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'describe', 'shortlog', 'grep', 'cat-file', 'reflog', 'rev-list', 'merge-base', 'show-ref', 'for-each-ref', 'whatchanged'])

function tramoSoloLectura(p: string[]): boolean {
  const [prog = '', ...args] = p
  if (!prog || prog.includes('=')) return false // `VAR=x cmd`
  if (LIBRES.has(prog)) return true
  const peligrosa = PELIGROSAS[prog]
  if (peligrosa) return !args.some((a) => peligrosa.test(a))
  if (prog === 'sed') return sedSoloLectura(args)
  if (prog === 'git') return gitSoloLectura(args)
  return false
}

/** `sed -n '10,40p' archivo` y parecidos: solo imprimir rangos. Nada de `-i`, ni scripts con `w`/`e`/`s///w`. */
function sedSoloLectura(args: string[]): boolean {
  let script = false
  for (const a of args) {
    if (a === '-n' || a === '-E' || a === '-r' || a === '--quiet') continue
    if (a.startsWith('-')) return false
    if (!script) {
      if (!/^(\d+|\$)?(,(\d+|\$))?p$|^\/[^/]*\/p$|^\d+q$/.test(a)) return false
      script = true
    }
  }
  return script
}

function gitSoloLectura(args: string[]): boolean {
  let i = 0
  // Opciones globales seguras antes del subcomando (`git -C dir log`, `git --no-pager diff`).
  while (i < args.length && args[i]!.startsWith('-')) {
    if (args[i] === '--no-pager') i++
    else if (args[i] === '-C') i += 2
    else return false // `-c clave=valor` puede ejecutar cosas (alias, pager, hooks)
  }
  const sub = args[i]
  const resto = args.slice(i + 1)
  if (!sub) return false
  if (resto.some((a) => /^--(output|ext-diff|textconv|exec)/.test(a))) return false
  if (GIT_LECTURA.has(sub)) return true
  // Solo listar: sin nombres (un nombre suelto crea una rama/etiqueta o cambia un remoto).
  if (sub === 'branch') return resto.every((a) => /^(-a|-r|-v|-vv|--all|--remotes|--list|--show-current|--verbose|--no-color|--contains|--merged|--no-merged|--sort=.*)$/.test(a))
  if (sub === 'tag') return resto.every((a) => /^(-l|--list|-n\d*|--sort=.*|--contains|--merged)$/.test(a))
  if (sub === 'remote') return resto.every((a) => a === '-v' || a === '--verbose') || (resto[0] === 'get-url' && resto.length === 2)
  if (sub === 'stash') return resto[0] === 'list' || (resto[0] === 'show' && resto.length <= 3)
  if (sub === 'config') return resto.length >= 1 && /^(--get|--get-all|--list|-l|--get-regexp)$/.test(resto[0]!)
  return false
}
