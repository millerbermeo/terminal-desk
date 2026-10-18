import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto, ResultadoAgregar, SolicitudAgregar, ValidacionRuta } from '@shared/ipc'
import { resolverDirDatos } from './migracion'
import { ErrorServidor, ErrorSesion, servidor } from './servidor/cliente'
import { RutasLocales } from './servidor/rutas'
import { avisoDeGit, leerVinculo, repoDe, vincularProyectoLocal } from './servidor/vinculo'

// Los datos del usuario viven en ~/.odesk-agent. Si existe la carpeta del nombre anterior (~/.centro-proyectos), se mueve aquí al
// arrancar, antes de que nada lea ni escriba (este módulo se evalúa antes que los que usan `DIR`).
export const MIGRACION_DATOS = resolverDirDatos()
if (MIGRACION_DATOS.aviso) console.warn(MIGRACION_DATOS.aviso)
export const DIR = MIGRACION_DATOS.dir

/** Carpeta de cada proyecto en ESTE equipo: el servidor no guarda rutas. */
export const rutasLocales = new RutasLocales(join(DIR, 'rutas.json'))

interface GrupoApi {
  id: string
  name: string
}
interface ProyectoApi {
  id: string
  name: string
  repo: string | null
  groupId: string | null
}

// Las lecturas se repiten mucho (cada operación de git o archivos resuelve la carpeta del proyecto): se guardan un instante.
const VIGENCIA_MS = 2000
let memoria: { datos: DatosProyectos; hasta: number } | undefined

/** Olvida lo leído: hay que llamarlo tras cualquier cambio en el servidor. */
export function olvidarProyectos(): void {
  memoria = undefined
}

/**
 * Grupos y proyectos de la cuenta (servidor) que están en este equipo: el servidor aporta nombre, grupo y repositorio; la carpeta
 * sale de `rutas.json`. Un proyecto de la cuenta sin carpeta aquí no aparece hasta abrir su carpeta (por su `.odesk/project.json`).
 * Lanza `ErrorSesion` si no hay sesión.
 */
export async function leerProyectos(): Promise<DatosProyectos> {
  if (memoria && memoria.hasta > Date.now()) return structuredClone(memoria.datos)
  const r = await servidor.get<{ groups: GrupoApi[]; projects: ProyectoApi[] }>('/projects')
  const locales = await rutasLocales.todas()
  const datos: DatosProyectos = {
    grupos: r.groups.map((g) => ({ id: g.id, nombre: g.name })),
    proyectos: r.projects.flatMap((p) => (locales[p.id] ? [{ id: p.id, nombre: p.name, ruta: locales[p.id], ...(p.groupId ? { grupo: p.groupId } : {}) }] : []))
  }
  memoria = { datos, hasta: Date.now() + VIGENCIA_MS }
  return structuredClone(datos)
}

/** Proyectos del archivo local de antes de existir el servidor (`proyectos.json`); vacío si no hay. */
export async function leerProyectosLocales(): Promise<DatosProyectos> {
  try {
    const crudo = JSON.parse(await readFile(join(DIR, 'proyectos.json'), 'utf8')) as Partial<DatosProyectos>
    return { grupos: crudo.grupos ?? [], proyectos: crudo.proyectos ?? [] }
  } catch {
    return { grupos: [], proyectos: [] }
  }
}

/** Absoluta tal cual; `~` y relativas se resuelven contra el home. */
function resolverRuta(ruta: string): string {
  const r = ruta.trim()
  if (r === '~') return homedir()
  if (r.startsWith('~/') || r.startsWith('~\\')) return resolve(homedir(), r.slice(2))
  return isAbsolute(r) ? resolve(r) : resolve(homedir(), r)
}

/** Resuelve la ruta y comprueba que sea una carpeta accesible y no repetida. */
export async function validarRuta(entrada: string): Promise<ValidacionRuta> {
  if (!entrada.trim()) return { ok: false, ruta: '', mensaje: 'Falta la ruta' }
  const ruta = resolverRuta(entrada)
  try {
    if (!(await stat(ruta)).isDirectory()) return { ok: false, ruta, mensaje: 'No es una carpeta' }
    await access(ruta, constants.R_OK | constants.X_OK)
  } catch (err) {
    const codigo = (err as NodeJS.ErrnoException).code
    const mensaje = codigo === 'ENOENT' || codigo === 'ENOTDIR' ? 'La ruta no existe' : 'Sin permiso de acceso'
    return { ok: false, ruta, mensaje }
  }
  const repetido = (await leerProyectos()).proyectos.find((p) => p.ruta === ruta)
  if (repetido) return { ok: false, ruta, mensaje: `Ya agregado como «${repetido.nombre}»` }
  return { ok: true, ruta }
}

/** Autocompletado de rutas: subcarpetas de la carpeta escrita cuyo nombre empieza por lo que falta (sin ocultas salvo que se escriba el punto). */
export async function sugerirRutas(prefijo: string): Promise<string[]> {
  const entrada = prefijo.trim()
  if (!entrada || entrada.length > 500) return []
  const termina = /[\\/]$/.test(entrada)
  const base = resolverRuta(termina ? entrada : entrada.replace(/[^\\/]*$/, '') || '~/')
  const parcial = termina ? '' : (entrada.match(/[^\\/]*$/)?.[0] ?? '')
  if (entrada === '~') return [homedir()]
  try {
    const nombres = await readdir(base, { withFileTypes: true })
    return nombres
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && d.name.toLowerCase().startsWith(parcial.toLowerCase()) && (parcial.startsWith('.') || !d.name.startsWith('.')))
      .map((d) => join(base, d.name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 30)
  } catch {
    return []
  }
}

export async function agregarProyectos(sol: SolicitudAgregar): Promise<ResultadoAgregar> {
  const datos = await leerProyectos()
  const errores: ErrorProyecto[] = []
  const rutas: string[] = []

  for (const [indice, p] of sol.proyectos.entries()) {
    const v = await validarRuta(p.ruta)
    rutas.push(v.ruta)
    if (!p.nombre.trim()) errores.push({ indice, mensaje: 'Falta el nombre' })
    else if (!v.ok) errores.push({ indice, mensaje: `${v.mensaje}: ${v.ruta || p.ruta}` })
    else if (rutas.indexOf(v.ruta) !== indice) errores.push({ indice, mensaje: 'Ruta repetida en el formulario' })
  }
  if (sol.grupoId && !datos.grupos.some((g) => g.id === sol.grupoId)) {
    errores.push({ indice: -1, mensaje: 'El grupo no existe' })
  }
  if (errores.length > 0) return { datos, errores }

  // El servidor crea (o reutiliza por nombre) el grupo nuevo con el primer proyecto; los demás ya lo encuentran.
  const nombreGrupo = sol.grupoNuevo?.trim()
  const destino = sol.grupoId ? { groupId: sol.grupoId } : nombreGrupo ? { groupName: nombreGrupo } : {}
  const reanudados: string[] = []
  const avisos: string[] = []
  try {
    for (const [i, p] of sol.proyectos.entries()) {
      try {
        const id = await resolverProyecto(p.nombre.trim(), rutas[i], destino)
        if (id.existente) reanudados.push(id.id)
        else {
          const aviso = await avisoDeGit(rutas[i])
          if (aviso) avisos.push(`${p.nombre.trim()}: ${aviso}`)
        }
        await rutasLocales.fijar(id.id, rutas[i])
      } catch (err) {
        if (err instanceof ErrorSesion || (err instanceof ErrorServidor && err.estado === undefined) || !(err instanceof Error)) throw err // sin sesión o sin conexión: se corta todo
        errores.push({ indice: i, mensaje: err.message })
      }
    }
  } finally {
    olvidarProyectos()
  }
  return { datos: await leerProyectos(), errores, ...(reanudados.length ? { reanudados } : {}), ...(avisos.length ? { avisos } : {}) }
}

/** `propietario/repositorio` en minúsculas de una URL de git (https, ssh o alias SSH): dos remotos del mismo repo dan la misma clave. */
export function claveRepo(url: string): string | undefined {
  const m = /([^/:\s]+)\/([^/:\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined
}

/**
 * El único proyecto de la cuenta con ese repositorio que todavía no tiene carpeta en este equipo. Si hay varios (un monorepo con
 * proyectos distintos) o ya está enlazado a otra carpeta de aquí, no se adivina: `undefined`.
 */
async function proyectoPorRepo(repo: string): Promise<string | undefined> {
  const clave = claveRepo(repo)
  if (!clave) return undefined
  const { projects } = await servidor.get<{ projects: { id: string; repo?: string | null }[] }>('/projects')
  const candidatos = projects.filter((p) => p.repo && claveRepo(p.repo) === clave)
  if (candidatos.length !== 1) return undefined
  const locales = await rutasLocales.todas()
  return locales[candidatos[0]!.id] ? undefined : candidatos[0]!.id
}

/**
 * Enlace local de una carpeta: si ya trae `.odesk/project.json` y el proyecto es de esta cuenta, se reanuda (mismo id, así se
 * recupera su contexto); si no, se busca un proyecto de la cuenta con el mismo repositorio (`proyectoPorRepo`) y, si tampoco hay, se
 * registra uno nuevo en el servidor y se escribe el archivo.
 */
async function resolverProyecto(nombre: string, ruta: string, destino: object): Promise<{ id: string; existente: boolean }> {
  const previo = await leerVinculo(ruta)
  if (previo) {
    try {
      await servidor.get(`/projects/${previo}`)
      return { id: previo, existente: true }
    } catch (err) {
      if (!(err instanceof ErrorServidor) || err.estado !== 404) throw err
      // el id del archivo no es de esta cuenta (o ya no existe): se registra uno nuevo y se reescribe
    }
  }
  const repo = await repoDe(ruta)
  const porRepo = repo ? await proyectoPorRepo(repo) : undefined
  if (porRepo) {
    // La carpeta no traía `.odesk/project.json` (o era de otra cuenta), pero su remoto coincide con un proyecto de la cuenta que aún no
    // tiene carpeta aquí: es ese. Se enlaza para que el otro equipo y este compartan contexto.
    await vincularProyectoLocal(ruta, porRepo)
    return { id: porRepo, existente: true }
  }
  const creado = await servidor.post<{ id: string }>('/projects', { name: nombre, ...(repo ? { repo } : {}), ...destino })
  try {
    await vincularProyectoLocal(ruta, creado.id)
  } catch (err) {
    await servidor.delete(`/projects/${creado.id}`).catch(() => undefined) // sin el archivo el proyecto quedaría huérfano
    throw new Error(`No se pudo escribir .odesk/project.json en la carpeta: ${(err as Error).message}`, { cause: err })
  }
  return { id: creado.id, existente: false }
}

/**
 * «Quitar» un proyecto lo suelta de este equipo; en el servidor se conserva (tareas, conversaciones…) y en otros equipos sigue
 * igual. Su `.odesk/project.json` queda en la carpeta: al volver a abrirla se retoma el mismo proyecto.
 */
export async function eliminarProyecto(id: string): Promise<DatosProyectos> {
  await rutasLocales.quitar(id)
  olvidarProyectos()
  return leerProyectos()
}

/** Borra el grupo; sus proyectos pasan a "sin grupo". */
export async function eliminarGrupo(id: string): Promise<DatosProyectos> {
  try {
    await servidor.delete(`/groups/${encodeURIComponent(id)}`)
  } finally {
    olvidarProyectos()
  }
  return leerProyectos()
}

/** Carpeta de un proyecto registrado (falla si ya no existe). */
export async function carpetaDeProyecto(id: string): Promise<string> {
  const p = (await leerProyectos()).proyectos.find((x) => x.id === String(id))
  if (!p) throw new Error('El proyecto ya no existe.')
  return p.ruta
}

/** Registra una carpeta como proyecto (con su grupo, si se indica) y devuelve su id. */
export async function registrarProyecto(ruta: string, nombre: string, grupoId?: string): Promise<{ id: string }> {
  const r = await agregarProyectos({ ...(grupoId ? { grupoId } : {}), proyectos: [{ nombre, ruta }] })
  if (r.errores.length) throw new Error(r.errores.map((e) => e.mensaje).join('; '))
  // Por su carpeta, no por la posición: si la carpeta traía `.odesk/project.json` se reanudó un proyecto antiguo, que no es el último.
  const destino = resolverRuta(ruta)
  const registrado = r.datos.proyectos.find((p) => p.ruta === destino)
  if (!registrado) throw new Error('No se pudo registrar el proyecto.')
  return { id: registrado.id }
}

/** Proyectos de la cuenta que tienen repositorio y aún no tienen carpeta en este equipo (candidatos a clonar). */
export async function proyectosSinCarpeta(): Promise<{ id: string; nombre: string; repo: string; grupoId?: string }[]> {
  const r = await servidor.get<{ groups: GrupoApi[]; projects: ProyectoApi[] }>('/projects')
  const locales = await rutasLocales.todas()
  return r.projects.flatMap((p) => (!locales[p.id] && p.repo ? [{ id: p.id, nombre: p.name, repo: p.repo, ...(p.groupId ? { grupoId: p.groupId } : {}) }] : []))
}

/**
 * Deja una carpeta (por ejemplo, un repositorio recién clonado) enlazada a un proyecto que ya existe en la cuenta: mismo id, así se
 * recupera su contexto (tablero, conversaciones, trazas). Si el repositorio ya trae `.odesk/project.json` con ese id no se toca.
 */
export async function vincularCarpetaAProyecto(ruta: string, proyectoId: string): Promise<void> {
  await servidor.get(`/projects/${encodeURIComponent(proyectoId)}`) // falla (404) si no es de esta cuenta
  if ((await leerVinculo(ruta)) !== proyectoId) await vincularProyectoLocal(ruta, proyectoId)
  await rutasLocales.fijar(proyectoId, ruta)
  olvidarProyectos()
}
