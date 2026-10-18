import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const CARPETA_VINCULO = '.odesk'
export const ARCHIVO_VINCULO = 'project.json'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/**
 * Enlace local: escribe `<ruta>/.odesk/project.json` con solo el id del proyecto en el servidor. Está pensado para subirse a git:
 * al clonar en otra computadora, ese id dice qué proyecto consultar. No lleva rutas ni datos del equipo.
 */
export async function vincularProyectoLocal(ruta: string, projectId: string): Promise<void> {
  if (!esUuid(projectId)) throw new Error('El id del proyecto no es válido.')
  const dir = join(ruta, CARPETA_VINCULO)
  await mkdir(dir, { recursive: true })
  const destino = join(dir, ARCHIVO_VINCULO)
  const tmp = `${destino}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify({ projectId }, null, 2) + '\n', 'utf8')
  await rename(tmp, destino)
}

/** El id guardado en `.odesk/project.json`, o `undefined` si no hay archivo o no es válido. */
export async function leerVinculo(ruta: string): Promise<string | undefined> {
  try {
    const j = JSON.parse(await readFile(join(ruta, CARPETA_VINCULO, ARCHIVO_VINCULO), 'utf8')) as { projectId?: unknown }
    return esUuid(j.projectId) ? j.projectId : undefined
  } catch {
    return undefined
  }
}

/** Remoto `origin` del repositorio (sin credenciales incrustadas), o `undefined` si no es un repo o no tiene. */
export async function repoDe(ruta: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: ruta, timeout: 5000 })
    const url = stdout.trim().replace(/^(https?:\/\/)[^/@\s]+@/i, '$1') // quita usuario:token@ de las URLs https
    return url || undefined
  } catch {
    return undefined
  }
}

/**
 * Si la carpeta es un repositorio git y `.odesk/project.json` aún no está versionado, el texto que recuerda subirlo: sin ese archivo
 * en el repo, otra computadora no sabe a qué proyecto corresponde. `undefined` si no hace falta avisar.
 */
export async function avisoDeGit(ruta: string): Promise<string | undefined> {
  const archivo = `${CARPETA_VINCULO}/${ARCHIVO_VINCULO}`
  const git = (...args: string[]) => exec('git', args, { cwd: ruta, timeout: 5000 })
  try {
    await git('rev-parse', '--is-inside-work-tree')
  } catch {
    return undefined // no es un repositorio: no hay nada que subir
  }
  try {
    await git('check-ignore', '-q', archivo)
    return `${archivo} está en un .gitignore: quítalo de ahí y súbelo a git, o la otra computadora no reconocerá el proyecto.`
  } catch {
    // no está ignorado
  }
  try {
    await git('ls-files', '--error-unmatch', archivo)
    return undefined // ya está versionado
  } catch {
    return `Falta subir ${archivo} a git (git add ${archivo} && git commit && git push). Sin él, la otra computadora no sabrá qué proyecto es.`
  }
}

export type ResultadoQuitarVinculo = 'quitado' | 'versionado' | 'otro-proyecto' | 'sin-enlace'

/**
 * Borra `.odesk/project.json` de una carpeta que se deja de usar para ese proyecto, solo si es SU enlace (el id coincide) y no está subido a
 * git (si está versionado se deja: borrarlo cambiaría el repositorio, y lo decide quien lo gestiona). Quita `.odesk/` si queda vacía.
 */
export async function quitarVinculoLocal(ruta: string, projectId: string): Promise<ResultadoQuitarVinculo> {
  const actual = await leerVinculo(ruta)
  if (!actual) return 'sin-enlace'
  if (actual !== projectId) return 'otro-proyecto'
  const archivo = `${CARPETA_VINCULO}/${ARCHIVO_VINCULO}`
  try {
    await exec('git', ['ls-files', '--error-unmatch', archivo], { cwd: ruta, timeout: 5000 })
    return 'versionado'
  } catch {
    // no es un repositorio o el archivo no está versionado: se puede borrar
  }
  await rm(join(ruta, CARPETA_VINCULO, ARCHIVO_VINCULO), { force: true })
  try {
    if ((await readdir(join(ruta, CARPETA_VINCULO))).length === 0) await rmdir(join(ruta, CARPETA_VINCULO))
  } catch {
    // la carpeta tiene otras cosas o ya no existe: se deja
  }
  return 'quitado'
}
