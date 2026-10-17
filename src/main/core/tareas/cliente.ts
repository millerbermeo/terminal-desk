import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type { ResultadoHerramienta } from '@shared/core/herramientas'

/** Los sockets Unix admiten unos 104-107 caracteres de ruta (según el sistema): con una carpeta de datos más larga se usa una ruta corta. */
const MAX_RUTA_SOCKET = 100

/** Socket local de la app (en Windows, una tubería con nombre): solo el proceso principal escribe las tareas. Cliente y servidor calculan la misma ruta. */
export function rutaSocketTareas(dir: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\odesk-tareas-${userInfo().username}`
  const propia = join(dir, 'tareas.sock')
  if (propia.length <= MAX_RUTA_SOCKET) return propia
  return join('/tmp', `odesk-tareas-${process.getuid?.() ?? 'u'}-${createHash('sha1').update(dir).digest('hex').slice(0, 12)}.sock`)
}
export const archivoTokenTareas = (dir: string): string => join(dir, 'tareas.token')

export interface PeticionTareas {
  id: string
  token: string
  herramienta: string
  entrada: unknown
  proyectoId?: string
}

export type RespuestaTareas = { id: string } & ResultadoHerramienta

/**
 * Llama a una herramienta de tareas en la app que está abierta. Es lo que hace el servidor MCP (otro proceso, lanzado por el CLI
 * de Claude): no toca los datos, se los pide a la app. Si la app no está abierta, devuelve un error legible.
 */
export async function llamarTareas(dir: string, herramienta: string, entrada: unknown, proyectoId?: string, esperaMs = 60_000): Promise<ResultadoHerramienta> {
  let token: string
  try {
    token = (await readFile(archivoTokenTareas(dir), 'utf8')).trim()
  } catch {
    return { texto: 'Odesk Agent no está abierto: las tareas solo se pueden consultar o cambiar con la aplicación en marcha.', error: true }
  }
  const id = randomBytes(6).toString('hex')
  return new Promise((resolver) => {
    const socket = connect(rutaSocketTareas(dir))
    let buffer = ''
    let hecho = false
    const terminar = (r: ResultadoHerramienta): void => {
      if (hecho) return
      hecho = true
      clearTimeout(timer)
      socket.destroy()
      resolver(r)
    }
    const timer = setTimeout(() => terminar({ texto: 'Odesk Agent no respondió a tiempo.', error: true }), esperaMs)
    socket.on('error', () => terminar({ texto: 'Odesk Agent no está abierto: las tareas solo se pueden consultar o cambiar con la aplicación en marcha.', error: true }))
    socket.on('close', () => terminar({ texto: 'Odesk Agent cerró la conexión sin responder.', error: true }))
    socket.on('connect', () => {
      const p: PeticionTareas = { id, token, herramienta, entrada, ...(proyectoId ? { proyectoId } : {}) }
      socket.write(JSON.stringify(p) + '\n')
    })
    socket.on('data', (d) => {
      buffer += d.toString('utf8')
      const i = buffer.indexOf('\n')
      if (i < 0) return
      try {
        const r = JSON.parse(buffer.slice(0, i)) as RespuestaTareas
        if (r.id === id) terminar({ texto: String(r.texto ?? ''), ...(r.error ? { error: true } : {}) })
      } catch {
        terminar({ texto: 'Respuesta inválida de Odesk Agent.', error: true })
      }
    })
  })
}
