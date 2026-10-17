/**
 * Integración con GitHub (API REST con un token guardado cifrado): tipos, contrato tipado y lógica pura.
 * El renderer solo manda el id del proyecto; main resuelve la carpeta y el repositorio de GitHub a partir de su remoto.
 */

export interface RemotoGitHub {
  nombre: string
  /** URL tal como está en git (sin credenciales). */
  url: string
  /** Servidor real (un alias de ~/.ssh/config se resuelve con `ssh -G`). */
  host: string
  propietario: string
  repo: string
  /** El servidor es GitHub (github.com o el servidor de empresa configurado). */
  esGitHub: boolean
}

export interface RepoGitHub {
  id: number
  nombre: string
  /** `propietario/repo`. */
  completo: string
  descripcion: string
  privado: boolean
  url: string
  urlHttps: string
  urlSsh: string
  ramaPorDefecto: string
  actualizado: string
}

export interface UsuarioGitHub {
  usuario: string
  nombre?: string
}

export interface EstadoGitHub {
  conectado: boolean
  usuario?: UsuarioGitHub
  /** El token se guardó cifrado en el equipo; si no, solo vive en memoria hasta cerrar la aplicación. */
  persistente: boolean
  host: string
  /** Remoto del proyecto que apunta a GitHub (si lo hay). */
  remoto?: RemotoGitHub
  repo?: RepoGitHub
  /** Por qué no se pudo leer el repositorio (sin acceso, no existe…). */
  errorRepo?: string
}

export type EstadoCI = 'exito' | 'fallo' | 'pendiente' | 'ninguno'

export interface CheckCI {
  nombre: string
  estado: 'exito' | 'fallo' | 'pendiente' | 'omitido'
  url?: string
}

export interface ResumenCI {
  estado: EstadoCI
  checks: CheckCI[]
}

export interface PullRequest {
  numero: number
  titulo: string
  estado: 'abierta' | 'cerrada' | 'fusionada'
  borrador: boolean
  autor: string
  /** Rama de origen. */
  rama: string
  base: string
  url: string
  actualizada: string
  cuerpo?: string
  /** `null` mientras GitHub calcula si se puede fusionar. */
  fusionable?: boolean | null
}

export interface Issue {
  numero: number
  titulo: string
  estado: 'abierta' | 'cerrada'
  autor: string
  etiquetas: string[]
  url: string
  actualizada: string
  comentarios: number
}

interface P {
  proyectoId: string
}

export type MetodoFusion = 'merge' | 'squash' | 'rebase'

export interface OperacionesGitHub {
  estado: { entrada: Partial<P>; salida: EstadoGitHub }
  conectar: { entrada: { token: string }; salida: EstadoGitHub }
  desconectar: { entrada: Record<string, never>; salida: EstadoGitHub }
  repos: { entrada: { texto?: string }; salida: RepoGitHub[] }
  /** Clona un repositorio (URL o `propietario/repo`) en una carpeta y lo agrega como proyecto. */
  clonar: { entrada: { repo: string; carpetaPadre: string; protocolo?: 'https' | 'ssh'; grupoId?: string }; salida: { proyectoId: string; ruta: string } }
  /** Crea el repositorio en GitHub, lo enlaza como `origin` y envía la rama actual. */
  crearRepo: { entrada: P & { nombre: string; descripcion?: string; privado?: boolean; organizacion?: string; protocolo?: 'https' | 'ssh' }; salida: EstadoGitHub }
  prs: { entrada: P & { estado?: 'open' | 'closed' | 'all' }; salida: PullRequest[] }
  prActual: { entrada: P; salida: { pr: PullRequest | null; ci?: ResumenCI } }
  crearPr: { entrada: P & { titulo: string; cuerpo?: string; base?: string; borrador?: boolean }; salida: PullRequest }
  fusionarPr: { entrada: P & { numero: number; metodo: MetodoFusion }; salida: { mensaje: string } }
  /** Trae la rama del pull request y cambia a ella. */
  traerPr: { entrada: P & { numero: number }; salida: { rama: string } }
  issues: { entrada: P & { estado?: 'open' | 'closed' | 'all' }; salida: Issue[] }
  crearIssue: { entrada: P & { titulo: string; cuerpo?: string; etiquetas?: string[] }; salida: Issue }
  comentar: { entrada: P & { numero: number; texto: string }; salida: { url: string } }
  ci: { entrada: P & { ref?: string }; salida: ResumenCI }
}

export type NombreOperacionGitHub = keyof OperacionesGitHub

// ------------------------------------------------------------------ lógica pura

export const HOST_GITHUB = 'github.com'

/** Página de GitHub para crear un token (clásico) con los permisos que usa la aplicación ya marcados. */
export const URL_CREAR_TOKEN = 'https://github.com/settings/tokens/new?description=Odesk%20Agent&scopes=repo,workflow'

export interface RemotoAnalizado {
  host: string
  propietario: string
  repo: string
}

/**
 * Extrae servidor, propietario y repositorio de la URL de un remoto: https, ssh:// y la forma corta `git@host:propietario/repo.git`
 * (donde `host` puede ser un alias de ~/.ssh/config). Las rutas locales no tienen propietario: devuelve `undefined`.
 */
export function analizarRemoto(url: string): RemotoAnalizado | undefined {
  const t = url.trim()
  const dePatron = (m: RegExpExecArray | null): RemotoAnalizado | undefined => (m ? { host: m[1]!.toLowerCase(), propietario: m[2]!, repo: m[3]! } : undefined)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    if (/^file:/i.test(t)) return undefined
    return dePatron(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(t))
  }
  // Forma corta (scp): host de al menos dos caracteres para no confundir `C:/ruta` de Windows.
  return dePatron(/^(?:[^@/\s]+@)?([^/:\s]{2,}):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(t))
}

/** Forma `propietario/repo`, o una URL de GitHub. */
export function analizarRepoEscrito(entrada: string): RemotoAnalizado | undefined {
  const t = entrada.trim()
  const corto = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(t)
  if (corto && !t.includes(':')) return { host: HOST_GITHUB, propietario: corto[1]!, repo: corto[2]! }
  return analizarRemoto(t)
}

export const urlHttps = (r: { propietario: string; repo: string }, host = HOST_GITHUB): string => `https://${host}/${r.propietario}/${r.repo}.git`
export const urlSsh = (r: { propietario: string; repo: string }, host = HOST_GITHUB): string => `git@${host}:${r.propietario}/${r.repo}.git`

/** Nombre de repositorio que GitHub acepta a partir de un nombre cualquiera (espacios → guiones, sin acentos ni símbolos). */
export function nombreRepoValido(nombre: string): string {
  const n = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
  return n && n !== '.' && n !== '..' ? n : 'proyecto'
}

/**
 * Archivos que casi nunca deben llegar a un repositorio (claves, credenciales, `.env`): la IA no los prepara ni los confirma sin
 * que lo hagas tú.
 */
export function esArchivoSensible(ruta: string): boolean {
  const nombre = ruta.split('/').pop()!.toLowerCase()
  if (/^\.env(\..+)?$/.test(nombre)) return !/\.(example|sample|template|dist)$/.test(nombre)
  if (/\.(pem|key|p12|pfx|keystore|jks|ppk|kdbx)$/.test(nombre)) return true
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(nombre)) return !nombre.endsWith('.pub')
  return ['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials', 'credentials.json', 'secrets.json', 'secrets.yml', 'secrets.yaml', 'terraform.tfstate', 'service-account.json'].includes(nombre)
}
