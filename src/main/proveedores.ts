import { delimiter, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { Proveedor, ProveedorEstado } from '@shared/modelos'
import type { ResultadoProveedor } from '@shared/ipc'
import { DIR } from './proyectos'

const ARCHIVO = join(DIR, 'proveedores.json')
const CLAVE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/

const POR_DEFECTO: Proveedor[] = [
  { id: 'claude', nombre: 'Claude Code', comando: 'claude', env: {} },
  { id: 'codex', nombre: 'Codex CLI', comando: 'codex', env: {} },
  { id: 'gemini', nombre: 'Gemini CLI', comando: 'gemini', env: {} }
]

function normalizar(p: Partial<Proveedor>): Proveedor | null {
  if (typeof p.id !== 'string' || typeof p.nombre !== 'string' || typeof p.comando !== 'string') return null
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(p.env ?? {})) if (CLAVE_ENV.test(k) && typeof v === 'string') env[k] = v
  return { id: p.id, nombre: p.nombre, comando: p.comando, env }
}

async function escribir(lista: Proveedor[]): Promise<void> {
  await mkdir(DIR, { recursive: true })
  await writeFile(ARCHIVO, JSON.stringify(lista, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') await chmod(ARCHIVO, 0o600) // puede contener claves en env
}

export async function leerProveedores(): Promise<Proveedor[]> {
  try {
    const crudo = JSON.parse(await readFile(ARCHIVO, 'utf8')) as Partial<Proveedor>[]
    return crudo.map(normalizar).filter((p): p is Proveedor => p !== null)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('proveedores.json inválido:', err)
      return []
    }
    await escribir(POR_DEFECTO)
    return POR_DEFECTO
  }
}

export async function obtenerProveedor(id: string): Promise<Proveedor | undefined> {
  return (await leerProveedores()).find((p) => p.id === id)
}

async function esEjecutable(ruta: string): Promise<boolean> {
  try {
    await access(ruta, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Busca el primer token del comando en el PATH (o como ruta directa). */
async function comandoDisponible(comando: string): Promise<boolean> {
  const bin = comando.trim().split(/\s+/)[0]
  if (!bin) return false
  if (isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) return esEjecutable(bin)
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) if (await esEjecutable(join(dir, bin + ext))) return true
  }
  return false
}

export async function listarProveedores(): Promise<ProveedorEstado[]> {
  const lista = await leerProveedores()
  return Promise.all(lista.map(async (p) => ({ ...p, disponible: await comandoDisponible(p.comando) })))
}

let cola: Promise<unknown> = Promise.resolve()
export function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const p = cola.then(fn, fn)
  cola = p.catch(() => undefined)
  return p
}

export function guardarProveedor(entrada: Proveedor): Promise<ResultadoProveedor> {
  return enCola(async () => {
    const nombre = entrada.nombre.trim()
    const comando = entrada.comando.trim()
    if (!nombre) return { ok: false, mensaje: 'Falta el nombre' }
    if (!comando) return { ok: false, mensaje: 'Falta el comando' }
    for (const k of Object.keys(entrada.env)) {
      if (!CLAVE_ENV.test(k)) return { ok: false, mensaje: `Nombre de variable inválido: ${k}` }
    }
    const lista = await leerProveedores()
    if (lista.some((p) => p.id !== entrada.id && p.nombre.toLowerCase() === nombre.toLowerCase())) {
      return { ok: false, mensaje: 'Ya existe un proveedor con ese nombre' }
    }
    const nuevo: Proveedor = { id: entrada.id || randomUUID().slice(0, 8), nombre, comando, env: entrada.env }
    const i = lista.findIndex((p) => p.id === nuevo.id)
    if (i >= 0) lista[i] = nuevo
    else lista.push(nuevo)
    await escribir(lista)
    return { ok: true, proveedores: await listarProveedores() }
  })
}

export function eliminarProveedor(id: string): Promise<ProveedorEstado[]> {
  return enCola(async () => {
    await escribir((await leerProveedores()).filter((p) => p.id !== id))
    return listarProveedores()
  })
}
