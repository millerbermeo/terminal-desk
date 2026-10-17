import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { archivoTokenTareas, rutaSocketTareas, type PeticionTareas, type RespuestaTareas } from './cliente'
import { ejecutarHerramientaTareas } from './herramientas'
import type { ServicioTareas } from './servicio'

const MAX_PETICION = 2_000_000

export interface ServidorTareas {
  ruta: string
  cerrar(): Promise<void>
}

/** El token vive en un archivo 0600: lo lee el servidor MCP (mismo usuario) para identificarse; otro usuario no puede. */
async function leerOCrearToken(dir: string): Promise<string> {
  const archivo = archivoTokenTareas(dir)
  try {
    const t = (await readFile(archivo, 'utf8')).trim()
    if (t.length >= 32) return t
  } catch {
    /* primer arranque */
  }
  const token = randomBytes(24).toString('hex')
  await mkdir(dir, { recursive: true })
  await writeFile(archivo, token + '\n', { mode: 0o600 })
  return token
}

const igual = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Servidor local por el que la IA (a través del servidor MCP) usa las tareas. Solo este proceso las escribe: no hay dos procesos
 * peleando por el archivo, y las reglas son las mismas que para la interfaz. Todo lo que llega aquí se trata como autor «ia».
 */
export async function iniciarServidorTareas(dir: string, servicio: ServicioTareas): Promise<ServidorTareas> {
  const token = await leerOCrearToken(dir)
  const ruta = rutaSocketTareas(dir)
  if (process.platform !== 'win32') await rm(ruta, { force: true }) // restos de una ejecución anterior

  const conexiones = new Set<Socket>()
  const atender = (socket: Socket): void => {
    conexiones.add(socket)
    socket.on('close', () => conexiones.delete(socket))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => socket.destroy())
    socket.on('data', (trozo: string) => {
      buffer += trozo
      if (buffer.length > MAX_PETICION) return void socket.destroy()
      let i: number
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linea = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        void responder(linea)
      }
    })
    const responder = async (linea: string): Promise<void> => {
      let id = ''
      try {
        const p = JSON.parse(linea) as Partial<PeticionTareas>
        id = String(p.id ?? '')
        if (typeof p.token !== 'string' || !igual(p.token, token)) return void socket.destroy()
        const r = await ejecutarHerramientaTareas(servicio, String(p.herramienta ?? ''), p.entrada, { proyectoId: p.proyectoId })
        const respuesta: RespuestaTareas = { id, ...r }
        if (!socket.destroyed) socket.write(JSON.stringify(respuesta) + '\n')
      } catch (err) {
        if (!socket.destroyed) socket.write(JSON.stringify({ id, texto: `Petición inválida: ${(err as Error).message}`, error: true }) + '\n')
      }
    }
  }

  const servidor = createServer(atender)
  await new Promise<void>((resolver, rechazar) => {
    servidor.once('error', rechazar)
    servidor.listen(ruta, () => {
      servidor.off('error', rechazar)
      resolver()
    })
  })
  if (process.platform !== 'win32') await chmod(ruta, 0o600).catch(() => undefined)

  return {
    ruta,
    cerrar: () =>
      new Promise<void>((resolver) => {
        servidor.close(() => resolver())
        for (const c of conexiones) c.destroy()
      })
  }
}
