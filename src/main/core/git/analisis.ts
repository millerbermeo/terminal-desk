import type { ArchivoCambio, ArchivoCommit, CodigoEstado, Commit, Etiqueta, RefCommit, Rama, Remoto, Stash } from '@shared/versiones'

/** Límite de archivos que se devuelven en el estado (un `node_modules` sin ignorar no debe colgar la interfaz). */
export const MAX_ARCHIVOS = 5000

const CODIGOS = new Set(['M', 'A', 'D', 'R', 'C', 'T', 'U'])
const codigo = (c: string | undefined): CodigoEstado => (c && CODIGOS.has(c) ? (c as CodigoEstado) : '.')

export interface EstadoAnalizado {
  rama?: string
  desacoplado?: string
  sinCommits: boolean
  upstream?: string
  adelante: number
  atras: number
  archivos: ArchivoCambio[]
  truncado: boolean
}

/** `git status --porcelain=v2 --branch -z`. */
export function analizarEstado(salida: string): EstadoAnalizado {
  const r: EstadoAnalizado = { sinCommits: false, adelante: 0, atras: 0, archivos: [], truncado: false }
  let oid = ''
  const partes = salida.split('\0')
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]!
    if (!p) continue
    if (p.startsWith('# ')) {
      if (p.startsWith('# branch.oid ')) {
        oid = p.slice(13)
        r.sinCommits = oid === '(initial)'
      } else if (p.startsWith('# branch.head ')) {
        const h = p.slice(14)
        if (h !== '(detached)') r.rama = h
      } else if (p.startsWith('# branch.upstream ')) r.upstream = p.slice(18)
      else if (p.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(p)
        if (m) {
          r.adelante = Number(m[1])
          r.atras = Number(m[2])
        }
      }
      continue
    }
    let archivo: ArchivoCambio | undefined
    let m: RegExpExecArray | null
    if (p[0] === '1' && (m = /^1 (.)(.) \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(p))) {
      archivo = { ruta: m[3]!, indice: codigo(m[1]), trabajo: codigo(m[2]), conflicto: false, sinSeguimiento: false }
    } else if (p[0] === '2' && (m = /^2 (.)(.) \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(p))) {
      archivo = { ruta: m[3]!, anterior: partes[++i] ?? '', indice: codigo(m[1]), trabajo: codigo(m[2]), conflicto: false, sinSeguimiento: false }
    } else if (p[0] === 'u' && (m = /^u (.)(.) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([\s\S]*)$/.exec(p))) {
      archivo = { ruta: m[3]!, indice: codigo(m[1]), trabajo: codigo(m[2]), conflicto: true, sinSeguimiento: false }
    } else if (p[0] === '?' && p[1] === ' ') {
      archivo = { ruta: p.slice(2), indice: '.', trabajo: '.', conflicto: false, sinSeguimiento: true }
    }
    if (!archivo) continue
    if (r.archivos.length >= MAX_ARCHIVOS) {
      r.truncado = true
      continue
    }
    r.archivos.push(archivo)
  }
  if (!r.rama && oid && oid !== '(initial)') r.desacoplado = oid.slice(0, 7)
  return r
}

/** Formato de `git log` que se analiza con `analizarLog` (con `--decorate=full`). */
export const FORMATO_LOG = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%s%x1e'

export function analizarRefs(decoracion: string): RefCommit[] {
  const refs: RefCommit[] = []
  for (const bruto of decoracion.split(', ')) {
    const d = bruto.trim()
    if (!d) continue
    if (d === 'HEAD') refs.push({ tipo: 'cabeza', nombre: 'HEAD' })
    else if (d.startsWith('HEAD -> ')) refs.push({ tipo: 'cabeza', nombre: d.slice(8).replace(/^refs\/heads\//, '') })
    else if (d.startsWith('tag: ')) refs.push({ tipo: 'etiqueta', nombre: d.slice(5).replace(/^refs\/tags\//, '') })
    else if (d.startsWith('refs/remotes/')) {
      if (!d.endsWith('/HEAD')) refs.push({ tipo: 'remota', nombre: d.slice(13) })
    } else if (d.startsWith('refs/heads/')) refs.push({ tipo: 'rama', nombre: d.slice(11) })
  }
  return refs
}

export function analizarLog(salida: string): Commit[] {
  const commits: Commit[] = []
  for (const registro of salida.split('\x1e')) {
    const r = registro.replace(/^\n+/, '')
    if (!r.trim()) continue
    const [hash, corto, autor, correo, fecha, padres, refs, asunto] = r.split('\0')
    if (!hash) continue
    commits.push({ hash, corto: corto ?? hash.slice(0, 7), autor: autor ?? '', correo: correo ?? '', fecha: fecha ?? '', padres: (padres ?? '').split(' ').filter(Boolean), refs: analizarRefs(refs ?? ''), asunto: asunto ?? '' })
  }
  return commits
}

export const FORMATO_RAMAS = '%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname:short)%00%(contents:subject)%00%(committerdate:iso-strict)%1e'

export function analizarRamas(salida: string): Rama[] {
  const ramas: Rama[] = []
  for (const registro of salida.split('\x1e')) {
    const r = registro.replace(/^\n+/, '')
    if (!r.trim()) continue
    const [ref, nombre, cabeza, upstream, pista, ultimo, asunto, fecha] = r.split('\0')
    if (!ref || !nombre) continue
    const remota = ref.startsWith('refs/remotes/')
    if (remota && ref.endsWith('/HEAD')) continue
    const adelante = Number(/ahead (\d+)/.exec(pista ?? '')?.[1] ?? 0)
    const atras = Number(/behind (\d+)/.exec(pista ?? '')?.[1] ?? 0)
    ramas.push({ nombre, remota, actual: cabeza === '*', ...(upstream ? { upstream } : {}), adelante, atras, huerfana: (pista ?? '').includes('gone'), ultimo: ultimo ?? '', asunto: asunto ?? '', fecha: fecha ?? '' })
  }
  return ramas
}

export const FORMATO_ETIQUETAS = '%(refname:short)%00%(objecttype)%00%(objectname:short)%00%(*objectname:short)%00%(creatordate:iso-strict)%00%(contents:subject)%00%(taggername)%1e'

export function analizarEtiquetas(salida: string): Etiqueta[] {
  const etiquetas: Etiqueta[] = []
  for (const registro of salida.split('\x1e')) {
    const r = registro.replace(/^\n+/, '')
    if (!r.trim()) continue
    const [nombre, tipo, objeto, apunta, fecha, mensaje, autor] = r.split('\0')
    if (!nombre) continue
    const anotada = tipo === 'tag'
    etiquetas.push({ nombre, anotada, commit: (anotada ? apunta : objeto) ?? '', fecha: fecha ?? '', mensaje: anotada ? (mensaje ?? '') : '', autor: autor ?? '' })
  }
  return etiquetas
}

export function analizarStashes(salida: string): Stash[] {
  const lista: Stash[] = []
  for (const registro of salida.split('\x1e')) {
    const r = registro.replace(/^\n+/, '')
    if (!r.trim()) continue
    const [mensaje, fecha] = r.split('\0')
    lista.push({ indice: lista.length, mensaje: mensaje ?? '', fecha: fecha ?? '' })
  }
  return lista
}

/** `git remote -v`: oculta las credenciales de las URL (`https://usuario:token@…`). */
export function analizarRemotos(salida: string): Remoto[] {
  const vistos = new Map<string, string>()
  for (const linea of salida.split('\n')) {
    const m = /^(\S+)\t(\S+) \(fetch\)$/.exec(linea.trim())
    if (m && !vistos.has(m[1]!)) vistos.set(m[1]!, ocultarCredenciales(m[2]!))
  }
  return [...vistos].map(([nombre, url]) => ({ nombre, url }))
}

export const ocultarCredenciales = (url: string): string => url.replace(/\/\/[^/@\s]+@/, '//***@')

/** Archivos de un commit: `--name-status -z` y `--numstat -z` (las dos salidas se cruzan por ruta). */
export function analizarArchivosCommit(nombreEstado: string, numstat: string): ArchivoCommit[] {
  const cifras = new Map<string, { a: number | null; e: number | null }>()
  const n = numstat.split('\0')
  for (let i = 0; i < n.length; i++) {
    const p = n[i]!
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(p)
    if (!m) continue
    const par = { a: m[1] === '-' ? null : Number(m[1]), e: m[2] === '-' ? null : Number(m[2]) }
    if (m[3] === '') {
      // renombrado: las rutas vienen en las dos entradas siguientes
      const nueva = n[i + 2] ?? ''
      cifras.set(nueva, par)
      i += 2
    } else cifras.set(m[3]!, par)
  }
  const archivos: ArchivoCommit[] = []
  const s = nombreEstado.split('\0')
  for (let i = 0; i < s.length; i++) {
    const e = s[i]!
    if (!e) continue
    if (e[0] === 'R' || e[0] === 'C') {
      const anterior = s[++i] ?? ''
      const ruta = s[++i] ?? ''
      archivos.push({ ruta, anterior, estado: e[0], adiciones: cifras.get(ruta)?.a ?? null, eliminaciones: cifras.get(ruta)?.e ?? null })
    } else {
      const ruta = s[++i] ?? ''
      archivos.push({ ruta, estado: e[0]!, adiciones: cifras.get(ruta)?.a ?? null, eliminaciones: cifras.get(ruta)?.e ?? null })
    }
  }
  return archivos
}

/**
 * Traduce los errores habituales de git a un mensaje que diga qué hacer. El texto original va detrás, por si hace falta.
 */
/** Quita lo que no ayuda: los avisos «could not open directory» (carpetas sin permiso de lectura, p. ej. datos de otro usuario) se resumen. */
export function limpiarStderr(stderr: string, max = 1200): string {
  let omitidas = 0
  const lineas = stderr.split('\n').filter((l) => {
    if (/^warning: could not open directory /i.test(l.trim())) {
      omitidas++
      return false
    }
    return !/^hint:/i.test(l.trim()) // consejos de git sobre su propia línea de comandos: aquí no sirven
  })
  if (omitidas) lineas.push(`(${omitidas} carpeta${omitidas === 1 ? '' : 's'} sin permiso de lectura omitida${omitidas === 1 ? '' : 's'})`)
  const t = lineas.join('\n').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

export function explicarError(stderr: string, operacion = 'git'): string {
  const t = limpiarStderr(stderr)
  const con = (titulo: string): string => (t ? `${titulo}\n${t}` : titulo)
  if (/Please tell me who you are|unable to auto-detect email|empty ident name/i.test(t)) return con('Git no sabe quién eres: configura tu nombre y correo para poder confirmar.')
  if (/not a git repository/i.test(t)) return con('Esta carpeta no es un repositorio git.')
  if (/dubious ownership|safe\.directory/i.test(t)) return con('Git no confía en esta carpeta (pertenece a otro usuario). Márcala como segura con: git config --global --add safe.directory <ruta>')
  if (/would be overwritten by (checkout|merge)|Your local changes to the following files would be overwritten|Please commit your changes or stash them/i.test(t))
    return con('Tienes cambios locales que se perderían. Confírmalos, descártalos o guárdalos en el stash antes de continuar.')
  if (/Authentication failed|Permission denied \(|Permission denied, please try again|could not read Username|could not read Password|terminal prompts disabled|Host key verification failed|publickey/i.test(t))
    return con('No se pudo autenticar con el remoto. La aplicación no puede pedir contraseñas: usa una clave SSH (con ssh-agent) o un «credential helper» de git.')
  if (/non-fast-forward|\(fetch first\)|failed to push some refs|Updates were rejected|rejected/i.test(t) && /push/.test(operacion + t))
    return con('El remoto tiene cambios que aún no tienes. Trae (pull) los cambios y vuelve a enviar.')
  if (/Not possible to fast-forward|diverging branches|have diverged/i.test(t)) return con('Tu rama y la del remoto han divergido: no se puede avanzar sin mezclar. Haz un pull con rebase o fusiona a mano.')
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable|Could not read from remote repository/i.test(t)) return con('No se pudo conectar con el remoto. Revisa la red y la URL.')
  if (/has no upstream branch|no upstream configured|There is no tracking information/i.test(t)) return con('La rama no sigue a ninguna rama remota todavía.')
  if (/CONFLICT|Automatic merge failed|fix conflicts/i.test(t)) return con('Hay conflictos que resolver.')
  if (/nothing to commit|no changes added to commit/i.test(t)) return con('No hay cambios preparados para confirmar.')
  if (/already exists/i.test(t)) return con('Ya existe con ese nombre.')
  if (/not fully merged/i.test(t)) return con('La rama tiene commits que no están en otra: si estás seguro, elimínala forzando.')
  if (/index\.lock/i.test(t)) return con('Hay otra operación de git en curso (index.lock). Espera a que termine o borra el archivo si quedó huérfano.')
  return con(`git ${operacion} falló.`)
}

/** `git diff --numstat -z`: líneas añadidas y quitadas por archivo (los binarios salen con `-`: cuentan 0). */
export function analizarNumstat(salida: string): Map<string, { mas: number; menos: number }> {
  const r = new Map<string, { mas: number; menos: number }>()
  const partes = salida.split('\0')
  for (let i = 0; i < partes.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(partes[i]!)
    if (!m) continue
    let ruta = m[3]!
    if (ruta === '') {
      i++ // renombrado: siguen la ruta anterior y la nueva
      ruta = partes[++i] ?? ''
    }
    if (ruta) r.set(ruta, { mas: m[1] === '-' ? 0 : Number(m[1]), menos: m[2] === '-' ? 0 : Number(m[2]) })
  }
  return r
}
