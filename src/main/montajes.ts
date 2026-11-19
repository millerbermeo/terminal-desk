import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { sep } from 'node:path'

/**
 * Proyectos en carpetas montadas por red (sshfs, NFS, SMB…). Cuando el montaje se cae, CUALQUIER llamada al sistema de archivos sobre
 * esa ruta se queda colgada sin fin (y las síncronas, como `existsSync`, congelan todo el proceso principal). Por eso nunca se toca la
 * ruta directamente para saber si responde: se sondea con un proceso hijo con tiempo máximo, que se mata si no contesta.
 */

const FS_DE_RED = /^(fuse\.(sshfs|rclone|s3fs|gvfsd-fuse|curlftpfs|davfs2)|sshfs|nfs\d?|cifs|smb3?|smbfs|davfs|ceph|afs|9p)$/
const ESPERA_SONDEO_MS = 4000
const REVISAR_CADA_MS = 5000
const CACHE_RED_MS = 60_000

const desescapar = (s: string): string => s.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)))

/** Puntos de montaje de red del sistema (Linux: `/proc/self/mountinfo`; macOS: `mount`). Leerlos nunca toca los montajes. */
async function montajesDeRed(): Promise<string[]> {
  try {
    if (process.platform === 'linux') {
      const texto = await readFile('/proc/self/mountinfo', 'utf8')
      const salida: string[] = []
      for (const linea of texto.split('\n')) {
        const [antes, despues] = linea.split(' - ')
        const fs = despues?.split(' ')[0]
        const punto = antes?.split(' ')[4]
        if (fs && punto && FS_DE_RED.test(fs)) salida.push(desescapar(punto))
      }
      return salida
    }
    if (process.platform === 'darwin') {
      const texto = await new Promise<string>((ok) => execFile('mount', { timeout: 3000 }, (_e, out) => ok(String(out ?? ''))))
      return [...texto.matchAll(/ on (.+?) \((nfs|smbfs|afpfs|webdav|macfuse|osxfuse|fuse)[,)]/g)].map((m) => m[1]!)
    }
  } catch {
    /* sin datos: se tratará como ruta local */
  }
  return []
}

let cacheMontajes: { cuando: number; puntos: string[] } | undefined

/** ¿Está esta ruta dentro de un montaje de red? */
export async function esRutaDeRed(ruta: string): Promise<boolean> {
  if (process.platform === 'win32') return /^\\\\/.test(ruta) // UNC (\\servidor\recurso, \\sshfs\…)
  if (!cacheMontajes || Date.now() - cacheMontajes.cuando > CACHE_RED_MS) cacheMontajes = { cuando: Date.now(), puntos: await montajesDeRed() }
  return cacheMontajes.puntos.some((p) => ruta === p || ruta.startsWith(p.endsWith(sep) ? p : p + sep))
}

/** ¿Responde la carpeta? Con un proceso hijo (`test -d`) para poder abandonarlo si el montaje está colgado. */
export function sondear(ruta: string, ms = ESPERA_SONDEO_MS): Promise<boolean> {
  if (process.platform === 'win32') {
    return Promise.race([stat(ruta).then((s) => s.isDirectory(), () => false), new Promise<boolean>((ok) => setTimeout(() => ok(false), ms))])
  }
  return new Promise((ok) => {
    execFile('test', ['-d', ruta], { timeout: ms, killSignal: 'SIGKILL' }, (err) => ok(!err))
  })
}

export const mensajeSinConexion = (ruta: string): string =>
  `Sin conexión con la carpeta del proyecto (${ruta}). Está en un montaje de red (SSH) que no responde: vuelve a montarlo y se podrá abrir de nuevo.`

const caidas = new Set<string>() // rutas que ahora mismo no responden
export const rutaCaida = (ruta: string): boolean => caidas.has(ruta)

/** Falla enseguida (sin tocar el disco) si la carpeta está en un montaje caído. */
export function exigirConexion(ruta: string): void {
  if (caidas.has(ruta)) throw new Error(mensajeSinConexion(ruta))
}

/**
 * Antes de abrir algo en esa carpeta: si está en red la sondea en el momento (no espera a la siguiente ronda del monitor) y
 * actualiza el estado. Las carpetas locales pasan sin coste.
 */
export async function comprobarAhora(ruta: string, alCambiar?: (ruta: string, conectada: boolean) => void): Promise<boolean> {
  if (!caidas.has(ruta) && !(await esRutaDeRed(ruta))) return true
  const ok = await sondear(ruta)
  const antes = !caidas.has(ruta)
  if (ok) caidas.delete(ruta)
  else caidas.add(ruta)
  if (ok !== antes) alCambiar?.(ruta, ok)
  return ok
}

/** Vigila cada pocos segundos las carpetas de red de los proyectos y avisa cuando una se cae o vuelve. */
export class MonitorConexion {
  private temporizador?: NodeJS.Timeout
  private revisando = false

  constructor(
    private readonly rutas: () => Promise<{ id: string; ruta: string }[]>,
    private readonly alCambiar: (cambio: { proyectoIds: string[]; ruta: string; conectada: boolean }) => void
  ) {}

  iniciar(): void {
    this.temporizador ??= setInterval(() => void this.revisar(), REVISAR_CADA_MS)
    this.temporizador.unref()
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    delete this.temporizador
  }

  /** Una ronda; si la anterior sigue en curso (sondeos lentos) no se apila otra. */
  async revisar(): Promise<void> {
    if (this.revisando) return
    this.revisando = true
    try {
      const proyectos = await this.rutas().catch(() => [])
      const porRuta = new Map<string, string[]>()
      for (const p of proyectos) porRuta.set(p.ruta, [...(porRuta.get(p.ruta) ?? []), p.id])
      await Promise.all(
        [...porRuta].map(async ([ruta, ids]) => {
          await comprobarAhora(ruta, (r, conectada) => this.alCambiar({ proyectoIds: ids, ruta: r, conectada }))
        })
      )
    } finally {
      this.revisando = false
    }
  }
}
