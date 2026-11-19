import { exigirConexion } from './montajes'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { claveNombre, type DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto, ResultadoAgregar, SolicitudAgregar, ValidacionRuta } from '@shared/ipc'
import { resolverDirDatos } from './migracion'
import { ErrorServidor, ErrorSesion, esFalloDeConexion, servidor } from './servidor/cliente'
import { RutasLocales } from './servidor/rutas'
import { avisoDeGit, leerVinculo, quitarVinculoLocal, repoDe, vincularProyectoLocal } from './servidor/vinculo'

// Los datos del usuario viven en ~/.odesk-agent. Si existe la carpeta del nombre anterior (~/.centro-proyectos), se mueve aquí al
// arrancar, antes de que nada lea ni escriba (este módulo se evalúa antes que los que usan `DIR`).
export const MIGRACION_DATOS = resolverDirDatos()
if (MIGRACION_DATOS.aviso) console.warn(MIGRACION_DATOS.aviso)
export const DIR = MIGRACION_DATOS.dir

/** Carpeta de cada proyecto en ESTE equipo: el servidor no guarda rutas. */
export const rutasLocales = new RutasLocales(join(DIR, 'rutas.json'))

/** Proyectos locales: solo viven en este equipo (`proyectos-locales.json`), con id `local-…` (nunca un UUID: nada los sube al servidor). */
interface ProyectoLocal {
  id: string
  nombre: string
  ruta: string
  grupo?: string
}
/** Grupo local: solo existe en este equipo (mismo archivo, id `local-…`). Sus proyectos son locales. */
interface GrupoLocal {
  id: string
  nombre: string
}
interface ArchivoLocales {
  grupos: GrupoLocal[]
  proyectos: ProyectoLocal[]
}
const ARCHIVO_LOCALES = join(DIR, 'proyectos-locales.json')
let colaLocales: Promise<unknown> = Promise.resolve()

export const esProyectoLocal = (id: unknown): id is string => typeof id === 'string' && id.startsWith('local-')
/** Mismo prefijo que los proyectos: un grupo `local-…` nunca va al servidor. */
export const esGrupoLocal = esProyectoLocal

async function leerArchivoLocales(): Promise<ArchivoLocales> {
  try {
    const j = JSON.parse(await readFile(ARCHIVO_LOCALES, 'utf8')) as { grupos?: GrupoLocal[]; proyectos?: ProyectoLocal[] }
    return {
      grupos: (j.grupos ?? []).filter((g) => esGrupoLocal(g?.id) && typeof g.nombre === 'string'),
      proyectos: (j.proyectos ?? []).filter((p) => esProyectoLocal(p?.id) && typeof p.nombre === 'string' && typeof p.ruta === 'string')
    }
  } catch {
    return { grupos: [], proyectos: [] }
  }
}

async function leerLocales(): Promise<ProyectoLocal[]> {
  return (await leerArchivoLocales()).proyectos
}

/** Cambia proyectos y grupos locales (escrituras en cola, atómicas). */
function cambiarArchivoLocales(fn: (a: ArchivoLocales) => ArchivoLocales): Promise<void> {
  const p = colaLocales.then(async () => {
    const nuevo = fn(await leerArchivoLocales())
    await mkdir(DIR, { recursive: true })
    const tmp = `${ARCHIVO_LOCALES}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 2, grupos: nuevo.grupos, proyectos: nuevo.proyectos }, null, 2) + '\n', 'utf8')
    await rename(tmp, ARCHIVO_LOCALES)
  })
  colaLocales = p.catch(() => undefined)
  return p
}

/** Cambia la lista de proyectos locales (escrituras en cola, atómicas). */
function cambiarLocales(fn: (l: ProyectoLocal[]) => ProyectoLocal[]): Promise<void> {
  return cambiarArchivoLocales((a) => ({ ...a, proyectos: fn(a.proyectos) }))
}

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
/** Última respuesta buena del servidor, de qué cuenta era: sirve mientras el servidor no responde (un corte no debe parar el trabajo). */
let ultimaLectura: { groups: GrupoApi[]; projects: ProyectoApi[]; usuario: string | undefined } | undefined

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
  let r: { groups: GrupoApi[]; projects: ProyectoApi[] }
  let vigente = true
  try {
    const usuario = (await servidor.estado()).email // antes de pedir: si la cuenta cambia durante la petición, no se etiqueta con la nueva
    r = await servidor.get<{ groups: GrupoApi[]; projects: ProyectoApi[] }>('/projects')
    ultimaLectura = { ...r, usuario }
  } catch (err) {
    // Sin conexión (o el servidor caído) se sigue con lo último que respondió para esta cuenta: enviar un mensaje al Asistente, abrir un
    // archivo o usar git no dependen de que el servidor conteste justo ahora. Sin sesión, o si nunca respondió, el error sale tal cual.
    if (!esFalloDeConexion(err) || !ultimaLectura || ultimaLectura.usuario !== (await servidor.estado()).email) throw err
    r = ultimaLectura
    vigente = false
  }
  const locales = await rutasLocales.todas()
  const archivo = await leerArchivoLocales()
  const grupos = [...r.groups.map((g) => ({ id: g.id, nombre: g.name })), ...archivo.grupos.map((g) => ({ id: g.id, nombre: g.nombre, local: true as const }))]
  const soloAqui = archivo.proyectos.map((p) => ({ id: p.id, nombre: p.nombre, ruta: p.ruta, local: true as const, ...(p.grupo && grupos.some((g) => g.id === p.grupo) ? { grupo: p.grupo } : {}) }))
  const datos: DatosProyectos = {
    grupos,
    proyectos: [...r.projects.flatMap((p) => (locales[p.id] ? [{ id: p.id, nombre: p.name, ruta: locales[p.id], ...(p.groupId ? { grupo: p.groupId } : {}) }] : [])), ...soloAqui]
  }
  memoria = { datos, hasta: Date.now() + VIGENCIA_MS }
  if (vigente) void completarRepos(r.projects, locales)
  return structuredClone(datos)
}

const reposRevisados = new Map<string, number>() // proyecto -> cuándo se miró (se repite cada 5 min si no tenía remoto)

/**
 * Un proyecto registrado antes de que su carpeta tuviera `origin` queda en el servidor sin repositorio y otros equipos no pueden
 * clonarlo ni reconocerlo. Si aquí ya tiene remoto, se lo manda (cada 5 min como mucho; nunca bloquea ni lanza).
 */
async function completarRepos(proyectos: ProyectoApi[], locales: Record<string, string>): Promise<void> {
  let cambio = false
  for (const p of proyectos) {
    const ruta = locales[p.id]
    if (p.repo || !ruta || (reposRevisados.get(p.id) ?? 0) > Date.now()) continue
    reposRevisados.set(p.id, Date.now() + 5 * 60_000)
    try {
      const repo = await repoDe(ruta)
      if (!repo) continue // todavía sin remoto: se vuelve a mirar en 5 min
      await servidor.put(`/projects/${encodeURIComponent(p.id)}/repo`, { repo })
      cambio = true
    } catch {
      /* se reintenta en 5 min */
    }
  }
  if (cambio) olvidarProyectos()
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

/**
 * ¿Ya hay un proyecto con ese nombre (en este equipo o en la cuenta)? Si la carpeta se va a reanudar como un proyecto de la cuenta
 * (trae su `.odesk/project.json` o su remoto coincide), ese proyecto no cuenta: conserva su nombre.
 */
async function nombreOcupado(nombre: string, datos: DatosProyectos, ruta: string): Promise<boolean> {
  const k = claveNombre(nombre)
  if (datos.proyectos.some((p) => claveNombre(p.nombre) === k)) return true
  const sinCarpeta = await proyectosSinCarpeta().catch(() => [])
  const coincide = sinCarpeta.filter((p) => claveNombre(p.nombre) === k)
  if (coincide.length === 0) return false
  const vinculo = await leerVinculo(ruta).catch(() => undefined)
  const remoto = await repoDe(ruta).catch(() => undefined)
  const clave = remoto ? claveRepo(remoto) : undefined
  return coincide.some((p) => p.id !== vinculo && !(clave && p.repo && claveRepo(p.repo) === clave))
}

/** Cambia el nombre de un proyecto de la cuenta o local. No admite el nombre de otro proyecto. */
export async function renombrarProyecto(id: string, nombre: string): Promise<DatosProyectos> {
  const limpio = nombre.trim()
  if (!limpio) throw new Error('Falta el nombre.')
  if (limpio.length > 120) throw new Error('El nombre es demasiado largo (máximo 120 caracteres).')
  const datos = await leerProyectos()
  const k = claveNombre(limpio)
  const sinCarpeta = await proyectosSinCarpeta().catch(() => [])
  if (datos.proyectos.some((p) => p.id !== id && claveNombre(p.nombre) === k) || sinCarpeta.some((p) => p.id !== id && claveNombre(p.nombre) === k)) {
    throw new Error(`Ya existe un proyecto llamado «${limpio}». Elige otro nombre.`)
  }
  if (esProyectoLocal(id)) {
    await cambiarLocales((l) => l.map((p) => (p.id === id ? { ...p, nombre: limpio } : p)))
  } else {
    if (!datos.proyectos.some((p) => p.id === id)) throw new Error('Ese proyecto no está en este equipo.')
    try {
      await servidor.put(`/projects/${encodeURIComponent(id)}/name`, { name: limpio })
    } finally {
      olvidarProyectos()
    }
  }
  olvidarProyectos()
  return leerProyectos()
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
    else if (sol.proyectos.some((o, j) => j < indice && claveNombre(o.nombre) === claveNombre(p.nombre))) errores.push({ indice, mensaje: `Nombre repetido en el formulario: «${p.nombre.trim()}»` })
    else if (await nombreOcupado(p.nombre, datos, v.ruta)) errores.push({ indice, mensaje: `Ya existe un proyecto llamado «${p.nombre.trim()}». Elige otro nombre.` })
  }
  if (sol.grupoId && !datos.grupos.some((g) => g.id === sol.grupoId)) {
    errores.push({ indice: -1, mensaje: 'El grupo no existe' })
  }
  if (errores.length > 0) return { datos, errores }

  if (sol.modo === 'local') {
    if (sol.grupoNuevo?.trim()) return { datos, errores: [{ indice: -1, mensaje: 'Un proyecto local usa un grupo que ya exista: crear grupos es cosa de la cuenta.' }] }
    // Sin servidor, sin `.odesk/project.json`, sin seguimiento remoto: solo se apunta la carpeta en este equipo.
    const yaAqui = new Set([...datos.proyectos.map((p) => p.ruta), ...(await leerLocales()).map((p) => p.ruta)])
    for (const [i, p] of sol.proyectos.entries()) if (yaAqui.has(rutas[i])) errores.push({ indice: i, mensaje: `Esa carpeta ya es un proyecto: ${p.nombre.trim()}` })
    if (errores.length > 0) return { datos, errores }
    await cambiarLocales((l) => [...l, ...sol.proyectos.map((p, i) => ({ id: `local-${randomUUID()}`, nombre: p.nombre.trim(), ruta: rutas[i], ...(sol.grupoId ? { grupo: sol.grupoId } : {}) }))])
    olvidarProyectos()
    return { datos: await leerProyectos(), errores }
  }

  if (sol.grupoId && esGrupoLocal(sol.grupoId)) return { datos, errores: [{ indice: -1, mensaje: 'Ese grupo es local: solo admite proyectos locales. Pásalo a remoto o agrega los proyectos como locales.' }] }

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
  if (esProyectoLocal(id)) {
    await cambiarLocales((l) => l.filter((p) => p.id !== id))
    olvidarProyectos()
    return leerProyectos()
  }
  await rutasLocales.quitar(id)
  olvidarProyectos()
  return leerProyectos()
}

/** Pasa un proyecto a otro grupo (`null` = sin grupo). */
export async function moverProyectoAGrupo(id: string, grupoId: string | null): Promise<DatosProyectos> {
  if (esProyectoLocal(id)) {
    await cambiarLocales((l) => l.map((p) => (p.id === id ? { id: p.id, nombre: p.nombre, ruta: p.ruta, ...(grupoId ? { grupo: grupoId } : {}) } : p)))
    olvidarProyectos()
    return leerProyectos()
  }
  if (grupoId && esGrupoLocal(grupoId)) throw new Error('Ese grupo es local: un proyecto de la cuenta no puede entrar. Pasa el grupo a remoto o este proyecto a local.')
  try {
    await servidor.put(`/projects/${encodeURIComponent(id)}/group`, { groupId: grupoId })
  } finally {
    olvidarProyectos()
  }
  return leerProyectos()
}

/** Borra el grupo; sus proyectos pasan a "sin grupo". */
export async function eliminarGrupo(id: string): Promise<DatosProyectos> {
  if (esGrupoLocal(id)) {
    await cambiarArchivoLocales((a) => ({ grupos: a.grupos.filter((g) => g.id !== id), proyectos: a.proyectos.map((p) => (p.grupo === id ? { id: p.id, nombre: p.nombre, ruta: p.ruta } : p)) }))
    olvidarProyectos()
    return leerProyectos()
  }
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
  exigirConexion(p.ruta) // montaje de red caído: no se toca el disco (se quedaría colgado)
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

/** Proyectos de la cuenta que aún no tienen carpeta en este equipo (candidatos a clonar, o a enlazar con su carpeta si no tienen repositorio). Conservan su grupo de la cuenta. */
export async function proyectosSinCarpeta(): Promise<{ id: string; nombre: string; repo: string; grupoId?: string }[]> {
  const r = await servidor.get<{ groups: GrupoApi[]; projects: ProyectoApi[] }>('/projects')
  const locales = await rutasLocales.todas()
  return r.projects.flatMap((p) => (!locales[p.id] ? [{ id: p.id, nombre: p.name, repo: p.repo ?? '', ...(p.groupId ? { grupoId: p.groupId } : {}) }] : []))
}

/** Prefijo del error cuando algo pide confirmación antes de enlazar: la interfaz la pregunta y reintenta con `confirmar`. */
export const REQUIERE_CONFIRMACION = 'REQUIERE_CONFIRMACION:'

/**
 * Enlaza una carpeta que YA está en este equipo (sin clonar) a un proyecto de la cuenta: mismo id, así recupera su tablero, conversaciones
 * y trazas. Protecciones:
 * - Si la carpeta ya es otro proyecto aquí, o su `.odesk/project.json` apunta a OTRO proyecto vivo de la cuenta: no se enlaza (error).
 * - Si trae un id que ya no existe en la cuenta (p. ej. se vació la base) o su remoto de git no es el del proyecto: se pide confirmación.
 * - Si trae el mismo id que el proyecto, es la carpeta correcta y se enlaza sin preguntar.
 */
export async function enlazarCarpetaExistente(entrada: { ruta: string; proyectoId: string; repo?: string; confirmar?: boolean }): Promise<{ ruta: string }> {
  const v = await validarRuta(entrada.ruta)
  if (!v.ok) throw new Error(v.mensaje) // no existe, no es carpeta o ya es otro proyecto de este equipo
  const avisos: string[] = []
  const previo = await leerVinculo(v.ruta)
  if (previo && previo !== entrada.proyectoId) {
    try {
      const otro = await servidor.get<{ name: string }>(`/projects/${encodeURIComponent(previo)}`)
      throw new Error(`Esa carpeta ya está enlazada a otro proyecto de tu cuenta («${otro.name}»): no es la de este proyecto.`)
    } catch (err) {
      if (!(err instanceof ErrorServidor) || err.estado !== 404) throw err
      avisos.push('La carpeta trae el id de un proyecto que ya no existe en tu cuenta; se sustituirá por el de este proyecto.')
    }
  }
  const local = await repoDe(v.ruta)
  const esperado = entrada.repo ? claveRepo(entrada.repo) : undefined
  const encontrado = local ? claveRepo(local) : undefined
  if (esperado && encontrado && esperado !== encontrado) avisos.push(`La carpeta apunta a «${encontrado}» y el proyecto usa «${esperado}».`)
  if (avisos.length > 0 && !entrada.confirmar) throw new Error(`${REQUIERE_CONFIRMACION} ${avisos.join('\n')}`)
  await vincularCarpetaAProyecto(v.ruta, entrada.proyectoId)
  return { ruta: v.ruta }
}

/**
 * Cambia la carpeta de un proyecto de este equipo (te equivocaste al enlazarlo): enlaza la nueva con las mismas protecciones y, si el
 * `.odesk/project.json` de la anterior es de este proyecto y no está subido a git, lo borra para que no siga apuntando ahí.
 */
export async function cambiarCarpetaProyecto(entrada: { proyectoId: string; ruta: string; confirmar?: boolean }): Promise<{ ruta: string; aviso?: string }> {
  const actual = (await leerProyectos()).proyectos.find((p) => p.id === entrada.proyectoId)
  if (!actual) throw new Error('Ese proyecto no está en este equipo.')
  if (resolverRuta(entrada.ruta) === actual.ruta) throw new Error('Esa ya es la carpeta de este proyecto.')
  const delServidor = await servidor.get<{ repo?: string | null }>(`/projects/${encodeURIComponent(entrada.proyectoId)}`)
  const { ruta } = await enlazarCarpetaExistente({ ruta: entrada.ruta, proyectoId: entrada.proyectoId, ...(delServidor.repo ? { repo: delServidor.repo } : {}), ...(entrada.confirmar ? { confirmar: true } : {}) })
  const resultado = await quitarVinculoLocal(actual.ruta, entrada.proyectoId).catch(() => 'sin-enlace' as const)
  const aviso =
    resultado === 'versionado'
      ? `La carpeta anterior (${actual.ruta}) tiene .odesk/project.json subido a git y se dejó como estaba. Si ya no la usas para este proyecto, bórralo con git rm.`
      : undefined
  return { ruta, ...(aviso ? { aviso } : {}) }
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

/** Id viejo → id nuevo de cada proyecto que cambió de modo (tareas y conversaciones se reasignan con esto). */
export interface ResultadoModo {
  datos: DatosProyectos
  proyectos: { viejo: string; nuevo: string }[]
  /** Si el grupo cambió de id (de la cuenta a local o al revés). */
  grupo?: { viejo: string; nuevo: string }
  avisos: string[]
}

/**
 * Pasa un grupo entero (o los proyectos «sin grupo» de este equipo, `grupoId = null`) a local o a remoto.
 * - A local: cada proyecto de la cuenta se apunta en `proyectos-locales.json` con un id `local-…`, se suelta su `.odesk/project.json`
 *   (si no está versionado) y **se borra del servidor** (con sus tareas, conversaciones y trazas allí; aquí se conservan). El grupo se
 *   recrea como local y se borra el de la cuenta. Si el grupo tiene proyectos de la cuenta sin carpeta en este equipo, no se hace nada.
 * - A remoto: cada proyecto local se registra en la cuenta (o reanuda el suyo por `.odesk/project.json`/remoto de git) y deja de ser
 *   local; el grupo local se crea (o reutiliza por nombre) en la cuenta.
 * Se hace proyecto a proyecto: si algo falla a mitad, lo ya movido queda movido y el error lo dice.
 */
export async function cambiarModo(grupoId: string | null, modo: 'local' | 'remoto'): Promise<ResultadoModo> {
  const datos = await leerProyectos()
  const grupo = grupoId ? datos.grupos.find((g) => g.id === grupoId) : undefined
  if (grupoId && !grupo) throw new Error('El grupo no existe.')
  const enGrupo = (p: (typeof datos.proyectos)[number]): boolean => (grupoId ? p.grupo === grupoId : !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))
  const proyectos = datos.proyectos.filter(enGrupo)
  const cambios: { viejo: string; nuevo: string }[] = []
  const avisos: string[] = []
  let grupoNuevo: { viejo: string; nuevo: string } | undefined

  try {
    if (modo === 'local') {
      let destino: string | undefined
      if (grupoId && !esGrupoLocal(grupoId)) {
        const fuera = (await proyectosSinCarpeta()).filter((p) => p.grupoId === grupoId)
        if (fuera.length) {
          throw new Error(`El grupo tiene ${fuera.length === 1 ? 'un proyecto' : `${fuera.length} proyectos`} de tu cuenta sin carpeta en este equipo (${fuera.map((p) => `«${p.nombre}»`).join(', ')}). Clónalos o enlázalos aquí, o sácalos del grupo, antes de pasarlo a local.`)
        }
        destino = `local-${randomUUID()}`
        await cambiarArchivoLocales((a) => ({ ...a, grupos: [...a.grupos, { id: destino!, nombre: grupo!.nombre }] }))
        grupoNuevo = { viejo: grupoId, nuevo: destino }
      } else if (grupoId) destino = grupoId
      for (const p of proyectos) {
        if (p.local) {
          if (destino && p.grupo !== destino) await cambiarLocales((l) => l.map((x) => (x.id === p.id ? { ...x, grupo: destino } : x)))
          continue
        }
        const nuevo = `local-${randomUUID()}`
        await cambiarLocales((l) => [...l, { id: nuevo, nombre: p.nombre, ruta: p.ruta, ...(destino ? { grupo: destino } : {}) }])
        try {
          await servidor.delete(`/projects/${encodeURIComponent(p.id)}`)
        } catch (err) {
          if (!(err instanceof ErrorServidor) || err.estado !== 404) {
            await cambiarLocales((l) => l.filter((x) => x.id !== nuevo)) // sigue en la cuenta: no se duplica
            throw new Error(`«${p.nombre}»: ${(err as Error).message}`, { cause: err })
          }
        }
        await rutasLocales.quitar(p.id)
        const r = await quitarVinculoLocal(p.ruta, p.id).catch(() => 'sin-enlace' as const)
        if (r === 'versionado') avisos.push(`«${p.nombre}» tiene .odesk/project.json subido a git: bórralo con git rm para que otro equipo no intente retomarlo.`)
        cambios.push({ viejo: p.id, nuevo })
      }
      if (grupoNuevo) await servidor.delete(`/groups/${encodeURIComponent(grupoNuevo.viejo)}`).catch((err) => {
        if (!(err instanceof ErrorServidor) || err.estado !== 404) throw err
      })
    } else {
      let destino: object = {}
      let groupId: string | undefined
      if (grupoId && esGrupoLocal(grupoId)) {
        const creado = await servidor.post<{ id: string }>('/groups', { name: grupo!.nombre })
        groupId = creado.id
        grupoNuevo = { viejo: grupoId, nuevo: creado.id }
      } else if (grupoId) groupId = grupoId
      if (groupId) destino = { groupId }
      for (const p of proyectos) {
        if (!p.local) continue
        const { id } = await resolverProyecto(p.nombre, p.ruta, destino)
        if (groupId) await servidor.put(`/projects/${encodeURIComponent(id)}/group`, { groupId }) // si se reanudó uno que ya existía, queda en este grupo
        await rutasLocales.fijar(id, p.ruta)
        await cambiarLocales((l) => l.filter((x) => x.id !== p.id))
        cambios.push({ viejo: p.id, nuevo: id })
        const aviso = await avisoDeGit(p.ruta)
        if (aviso) avisos.push(`«${p.nombre}»: ${aviso}`)
      }
      if (grupoNuevo) {
        const viejo = grupoNuevo.viejo
        await cambiarArchivoLocales((a) => ({ grupos: a.grupos.filter((g) => g.id !== viejo), proyectos: a.proyectos.map((p) => (p.grupo === viejo ? { ...p, grupo: grupoNuevo!.nuevo } : p)) }))
      }
    }
  } finally {
    olvidarProyectos()
  }
  return { datos: await leerProyectos(), proyectos: cambios, ...(grupoNuevo ? { grupo: grupoNuevo } : {}), avisos }
}
