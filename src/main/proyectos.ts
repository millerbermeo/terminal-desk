import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto, ResultadoAgregar, SolicitudAgregar } from '@shared/ipc'

const DIR = join(homedir(), '.centro-proyectos')
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

async function esDirectorio(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory()
  } catch {
    return false
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
      const ruta = resolverRuta(p.ruta)
      rutas.push(ruta)
      if (!p.nombre.trim()) errores.push({ indice, mensaje: 'Falta el nombre' })
      else if (!p.ruta.trim()) errores.push({ indice, mensaje: 'Falta la ruta' })
      else if (!(await esDirectorio(ruta))) errores.push({ indice, mensaje: `No es una carpeta: ${ruta}` })
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
