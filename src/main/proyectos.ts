import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto, ResultadoAgregar, SolicitudAgregar, ValidacionRuta } from '@shared/ipc'
import { resolverDirDatos } from './migracion'

// Los datos del usuario viven en ~/.odesk-agent. Si existe la carpeta del nombre anterior (~/.centro-proyectos), se mueve aquí al
// arrancar, antes de que nada lea ni escriba (este módulo se evalúa antes que los que usan `DIR`).
export const MIGRACION_DATOS = resolverDirDatos()
if (MIGRACION_DATOS.aviso) console.warn(MIGRACION_DATOS.aviso)
export const DIR = MIGRACION_DATOS.dir
const ARCHIVO = join(DIR, 'proyectos.json')

function ejemplo(): DatosProyectos {
  const home = homedir()
  return {
    grupos: [
      { id: 'personal', nombre: 'Personal' },
      { id: 'trabajo', nombre: 'Trabajo' }
    ],
    proyectos: [
      { id: 'home', nombre: 'Inicio', ruta: home, grupo: 'personal' },
      { id: 'documentos', nombre: 'Documentos', ruta: join(home, 'Documents'), grupo: 'personal' },
      { id: 'dev', nombre: 'Dev', ruta: join(home, 'dev'), grupo: 'trabajo' },
      { id: 'sin-grupo', nombre: 'Sin grupo', ruta: home }
    ]
  }
}

export async function leerProyectos(): Promise<DatosProyectos> {
  try {
    const crudo = JSON.parse(await readFile(ARCHIVO, 'utf8')) as Partial<DatosProyectos>
    return { grupos: crudo.grupos ?? [], proyectos: crudo.proyectos ?? [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('proyectos.json inválido:', err)
      return { grupos: [], proyectos: [] }
    }
    const datos = ejemplo()
    await mkdir(DIR, { recursive: true })
    await writeFile(ARCHIVO, JSON.stringify(datos, null, 2) + '\n', 'utf8')
    return datos
  }
}

async function guardar(datos: DatosProyectos): Promise<void> {
  await mkdir(DIR, { recursive: true })
  await writeFile(ARCHIVO, JSON.stringify(datos, null, 2) + '\n', 'utf8')
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

function idUnico(base: string, usados: Set<string>): string {
  const slug =
    base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  let id = slug
  while (usados.has(id)) id = `${slug}-${randomUUID().slice(0, 4)}`
  return id
}

// Serializa lecturas-modificaciones-escrituras para no pisar el archivo.
let cola: Promise<unknown> = Promise.resolve()
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const p = cola.then(fn, fn)
  cola = p.catch(() => undefined)
  return p
}

export function agregarProyectos(sol: SolicitudAgregar): Promise<ResultadoAgregar> {
  return enCola(async () => {
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

    let grupo = sol.grupoId
    const nombreGrupo = sol.grupoNuevo?.trim()
    if (!grupo && nombreGrupo) {
      const existente = datos.grupos.find((g) => g.nombre.toLowerCase() === nombreGrupo.toLowerCase())
      if (existente) grupo = existente.id
      else {
        grupo = idUnico(nombreGrupo, new Set(datos.grupos.map((g) => g.id)))
        datos.grupos.push({ id: grupo, nombre: nombreGrupo })
      }
    }

    const usados = new Set(datos.proyectos.map((p) => p.id))
    sol.proyectos.forEach((p, i) => {
      const id = idUnico(p.nombre, usados)
      usados.add(id)
      datos.proyectos.push({ id, nombre: p.nombre.trim(), ruta: rutas[i], ...(grupo ? { grupo } : {}) })
    })
    await guardar(datos)
    return { datos, errores: [] }
  })
}

export function eliminarProyecto(id: string): Promise<DatosProyectos> {
  return enCola(async () => {
    const datos = await leerProyectos()
    datos.proyectos = datos.proyectos.filter((p) => p.id !== id)
    await guardar(datos)
    return datos
  })
}

/** Borra el grupo; sus proyectos pasan a "sin grupo". */
export function eliminarGrupo(id: string): Promise<DatosProyectos> {
  return enCola(async () => {
    const datos = await leerProyectos()
    datos.grupos = datos.grupos.filter((g) => g.id !== id)
    datos.proyectos = datos.proyectos.map((p) => {
      if (p.grupo !== id) return p
      const { grupo: _omitido, ...resto } = p
      return resto
    })
    await guardar(datos)
    return datos
  })
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
  const registrado = r.datos.proyectos.at(-1)
  if (!registrado) throw new Error('No se pudo registrar el proyecto.')
  return { id: registrado.id }
}
