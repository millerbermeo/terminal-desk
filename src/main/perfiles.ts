import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Datos locales por cuenta. Todo lo personal de `~/.odesk-agent` (tareas, conversaciones, trazas, memoria, rutas, token de GitHub,
 * proveedores con sus claves, colecciones del cliente API…) es de la cuenta con la que se entró. Al entrar con OTRA cuenta en este
 * equipo, lo de la anterior se aparta a `perfiles/<id>/` y se recupera lo que la nueva tuviera guardado; así una cuenta nunca ve
 * los datos de otra. Lo que no es de nadie (token de sesión, servidor, worktrees, plugins generados, socket) se queda.
 *
 * Es resistente a cortes: cada paso es un `rename` atómico y `perfil-activo.json` dice en qué fase se quedó; si la app se cierra a
 * mitad, el siguiente acceso termina el trabajo antes de seguir.
 */

export const CARPETA_PERFILES = 'perfiles'
export const ARCHIVO_ACTIVO = 'perfil-activo.json'

/** Entradas de la carpeta de datos que NO pertenecen a una cuenta. Todo lo demás (también lo que se añada en el futuro) sí. */
export const COMPARTIDOS = new Set([
  'sesion.json', // token de la sesión actual (se sustituye al entrar)
  'servidor.json', // dirección del servidor
  CARPETA_PERFILES,
  ARCHIVO_ACTIVO,
  'worktrees', // checkouts git con rutas absolutas: moverlos los rompería
  'sesiones', // plugins de Claude Code generados (derivados, pueden estar en uso)
  'mcp', // configuración generada del servidor MCP
  'caveman', // plugin Caveman descargado de GitHub (global para todas las cuentas)
  'tareas.sock',
  'tareas.token'
])

interface Marca {
  /** Cuenta cuyos datos están en la carpeta. `null` mientras se recupera el perfil de `entrando`. */
  usuarioId: string | null
  entrando?: string
}

export type ResultadoPerfil = 'igual' | 'adoptado' | 'cambiado'

const esId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v)

async function leerMarca(dir: string): Promise<Marca | undefined> {
  try {
    const m = JSON.parse(await readFile(join(dir, ARCHIVO_ACTIVO), 'utf8')) as Partial<Marca>
    if (m.usuarioId === null && esId(m.entrando)) return { usuarioId: null, entrando: m.entrando }
    if (esId(m.usuarioId)) return { usuarioId: m.usuarioId }
  } catch {
    // sin marca: datos de antes de separar por cuenta
  }
  return undefined
}

async function escribirMarca(dir: string, m: Marca): Promise<void> {
  const destino = join(dir, ARCHIVO_ACTIVO)
  const tmp = `${destino}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(m) + '\n', { mode: 0o600 })
  await rename(tmp, destino)
}

async function entradas(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** Mueve cada entrada de `de` a `a`; si ya hay algo con ese nombre en `a` (restos de un corte anterior), se reemplaza. */
async function mover(de: string, a: string, filtro: (nombre: string) => boolean): Promise<void> {
  await mkdir(a, { recursive: true, mode: 0o700 })
  for (const nombre of await entradas(de)) {
    if (!filtro(nombre)) continue
    await rm(join(a, nombre), { recursive: true, force: true })
    await rename(join(de, nombre), join(a, nombre))
  }
}

/** Trae a la carpeta de datos el perfil guardado de `id` (si lo hay) y lo marca como activo. */
async function recuperar(dir: string, id: string): Promise<void> {
  const origen = join(dir, CARPETA_PERFILES, id)
  await mover(origen, dir, (n) => !COMPARTIDOS.has(n))
  await rmdir(origen).catch(() => undefined)
  await escribirMarca(dir, { usuarioId: id })
}

/**
 * Deja en `dir` los datos de `usuarioId`:
 * - `igual`: ya eran suyos.
 * - `adoptado`: no había marca (datos de antes de esta función, o primer uso): pasan a ser de esta cuenta.
 * - `cambiado`: eran de otra cuenta; se apartaron y se recuperaron los de esta. Hay que reiniciar la app para no usar nada cacheado.
 */
export async function cambiarPerfil(dir: string, usuarioId: string): Promise<ResultadoPerfil> {
  if (!esId(usuarioId)) throw new Error('Identificador de cuenta no válido')
  let marca = await leerMarca(dir)
  if (marca?.usuarioId === null && marca.entrando) {
    await recuperar(dir, marca.entrando) // un cambio anterior quedó a medias: se termina primero
    marca = { usuarioId: marca.entrando }
  }
  if (!marca) {
    await mkdir(dir, { recursive: true })
    await escribirMarca(dir, { usuarioId })
    return 'adoptado'
  }
  if (marca.usuarioId === usuarioId) return 'igual'
  // 1) Apartar lo de la cuenta anterior. Si se corta aquí, la marca sigue siendo suya y se repite sin perder nada.
  await mover(dir, join(dir, CARPETA_PERFILES, marca.usuarioId!), (n) => !COMPARTIDOS.has(n) && !n.endsWith('.tmp'))
  // 2) Anotar que se está recuperando el de la nueva, y recuperarlo.
  await escribirMarca(dir, { usuarioId: null, entrando: usuarioId })
  await recuperar(dir, usuarioId)
  return 'cambiado'
}
