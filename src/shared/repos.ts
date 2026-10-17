import { analizarRemoto } from './github'

/**
 * Reconocer que dos carpetas son el mismo repositorio. Sirve para retomar un proyecto en otra computadora cuando su carpeta no
 * trae `.odesk/project.json` (porque nadie lo subió a git): si el `origin` coincide con el de un proyecto de la cuenta, se puede
 * ofrecer retomarlo en vez de crear uno nuevo y vacío.
 */

/**
 * Clave estable de un repositorio: `servidor/propietario/repo`, en minúsculas y sin `.git`. La misma para un repositorio clonado
 * por https o por ssh, con credenciales en la URL o sin ellas. `undefined` si el remoto no identifica un repositorio compartido
 * (una ruta local, `file:` o una URL que no se entiende): esos no valen para emparejar entre computadoras.
 *
 * `hostReal` es el servidor ya resuelto cuando el remoto usa un alias de `~/.ssh/config` (`git@github-trabajo:…`), que solo existe
 * en esa computadora; sin él, el alias se usa tal cual y no emparejará con el de otra máquina.
 */
export function claveRepo(remoto: string | null | undefined, hostReal?: string): string | undefined {
  if (typeof remoto !== 'string') return undefined
  const r = analizarRemoto(remoto)
  if (!r) return undefined
  let host = (hostReal ?? r.host).toLowerCase()
  // `ssh.github.com` es el acceso por el puerto 443 al mismo servidor (lo mismo para otros que usen ese prefijo).
  if (host.startsWith('ssh.')) host = host.slice(4)
  return `${host}/${r.propietario.toLowerCase()}/${r.repo.toLowerCase()}`
}

/** ¿Dos remotos apuntan al mismo repositorio? Falso si alguno no identifica uno (rutas locales). */
export function mismoRepo(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = claveRepo(a)
  return x !== undefined && x === claveRepo(b)
}

export interface ProyectoRemoto {
  id: string
  name: string
  repo: string | null
}

/**
 * Proyectos de la cuenta que viven en el mismo repositorio que `remoto` y **todavía no tienen carpeta en este equipo**. Se excluyen
 * los que ya la tienen para no acabar con el mismo proyecto en dos carpetas (una carpeta = un proyecto).
 *
 * Varios resultados son normales en un monorepo (backend y frontend comparten `origin`): entonces hay que preguntar cuál es, no
 * adivinar.
 */
export function candidatosPorRepo(proyectos: readonly ProyectoRemoto[], remoto: string | null | undefined, conCarpeta: ReadonlySet<string>): ProyectoRemoto[] {
  const clave = claveRepo(remoto)
  if (!clave) return []
  return proyectos.filter((p) => !conCarpeta.has(p.id) && claveRepo(p.repo) === clave)
}
