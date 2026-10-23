import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { get } from 'node:http'
import { connect } from 'node:net'
import type { ProcesoPuerto } from '@shared/arranque'
import { PUERTOS_COMUNES, type ServidorLocal } from '@shared/navegador'

/** ¿Hay algo escuchando en ese puerto de esta máquina (IPv4 o IPv6)? Los servidores de desarrollo suelen enlazar solo `localhost`. */
export function puertoAbierto(puerto: number, esperaMs = 300): Promise<boolean> {
  const probar = (host: string): Promise<boolean> =>
    new Promise((resolver) => {
      const s = connect({ host, port: puerto })
      const fin = (ok: boolean): void => {
        s.destroy()
        resolver(ok)
      }
      s.setTimeout(esperaMs, () => fin(false))
      s.once('connect', () => fin(true))
      s.once('error', () => fin(false))
    })
  return Promise.all([probar('127.0.0.1'), probar('::1')]).then(([a, b]) => a || b)
}

/** Título (`<title>`) de la página que sirve ese puerto, si responde con HTML. */
export function tituloDe(puerto: number, esperaMs = 800): Promise<string | undefined> {
  return new Promise((resolver) => {
    const req = get({ host: 'localhost', port: puerto, path: '/', timeout: esperaMs, headers: { Accept: 'text/html', 'User-Agent': 'OdeskAgent/1.0' } }, (res) => {
      if (!String(res.headers['content-type'] ?? '').includes('html')) {
        res.resume()
        return resolver(undefined)
      }
      let t = ''
      res.setEncoding('utf8')
      res.on('data', (d: string) => {
        t += d
        if (t.length > 32_768 || /<\/title>/i.test(t)) {
          res.destroy()
          resolver(analizarTitulo(t))
        }
      })
      res.on('end', () => resolver(analizarTitulo(t)))
      res.on('error', () => resolver(analizarTitulo(t)))
    })
    req.on('timeout', () => (req.destroy(), resolver(undefined)))
    req.on('error', () => resolver(undefined))
  })
}

export function analizarTitulo(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const t = m?.[1]?.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 100) : undefined
}

/** Servidores de desarrollo que están escuchando ahora mismo en los puertos habituales (o en los que se indiquen). */
export async function servidoresLocales(puertos: readonly number[] = PUERTOS_COMUNES): Promise<ServidorLocal[]> {
  const abiertos = (await Promise.all(puertos.map(async (p) => ((await puertoAbierto(p)) ? p : 0)))).filter((p) => p > 0)
  return Promise.all(
    abiertos.sort((a, b) => a - b).map(async (puerto): Promise<ServidorLocal> => {
      const titulo = await tituloDe(puerto)
      return { puerto, url: `http://localhost:${puerto}/`, ...(titulo ? { titulo } : {}) }
    })
  )
}

// ---------- Quién ocupa un puerto ----------

/** Ejecuta un programa y devuelve su salida; falla si no existe, devuelve error o tarda demasiado. Se inyecta en los tests. */
export type Ejecutar = (programa: string, args: string[]) => Promise<string>

export const ejecutarReal: Ejecutar = (programa, args) =>
  new Promise((resolver, rechazar) => {
    execFile(programa, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, salida) => (err ? rechazar(err) : resolver(String(salida))))
  })

/** `ss -H -ltnp` (Linux): `users:(("node",pid=123,fd=21))`. */
export function analizarSs(texto: string): { pid: number; proceso?: string } | undefined {
  for (const linea of texto.split('\n')) {
    const pid = /pid=(\d+)/.exec(linea)
    if (!pid) continue
    const nombre = /\(\("([^"]+)"/.exec(linea)
    return { pid: Number(pid[1]), ...(nombre ? { proceso: nombre[1]! } : {}) }
  }
  return undefined
}

/** `lsof -Fpc` (macOS y Linux): líneas `p<pid>` y `c<comando>`. */
export function analizarLsof(texto: string): { pid: number; proceso?: string } | undefined {
  let pid: number | undefined
  let proceso: string | undefined
  for (const linea of texto.split('\n')) {
    if (linea.startsWith('p') && pid === undefined) pid = Number(linea.slice(1))
    else if (linea.startsWith('c') && pid !== undefined && proceso === undefined) proceso = linea.slice(1).trim()
  }
  return pid && Number.isInteger(pid) ? { pid, ...(proceso ? { proceso } : {}) } : undefined
}

/** `netstat -ano -p TCP` (Windows): `TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  4321`. */
export function analizarNetstat(texto: string, puerto: number): { pid: number } | undefined {
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(linea)
    if (m && Number(m[1]) === puerto) return { pid: Number(m[2]) }
  }
  return undefined
}

/** Proceso (pid y nombre) que escucha en ese puerto, si se puede saber. Sin permisos para ver procesos de otros usuarios devuelve `undefined`. */
export async function procesoEnPuerto(puerto: number, ejecutar: Ejecutar = ejecutarReal): Promise<{ pid: number; proceso?: string } | undefined> {
  if (process.platform === 'win32') {
    const r = await ejecutar('netstat', ['-ano', '-p', 'TCP']).then((t) => analizarNetstat(t, puerto), () => undefined)
    return r
  }
  const ss = await ejecutar('ss', ['-H', '-ltnp', `sport = :${puerto}`]).then(analizarSs, () => undefined)
  if (ss) return ss
  return ejecutar('lsof', ['-nP', `-iTCP:${puerto}`, '-sTCP:LISTEN', '-Fpc']).then(analizarLsof, () => undefined)
}

/** Padres de un proceso, del más cercano al más lejano (solo Linux y macOS). */
export async function ancestrosDe(pid: number, ejecutar: Ejecutar = ejecutarReal, max = 25): Promise<number[]> {
  if (process.platform === 'win32') return []
  const out: number[] = []
  let actual = pid
  while (out.length < max) {
    const ppid = Number((await ejecutar('ps', ['-o', 'ppid=', '-p', String(actual)]).catch(() => '')).trim())
    if (!Number.isInteger(ppid) || ppid <= 1 || out.includes(ppid)) break
    out.push(ppid)
    actual = ppid
  }
  return out
}

/** Carpeta de trabajo de un proceso (Linux: `/proc`; macOS: `lsof`). */
export async function cwdDe(pid: number, ejecutar: Ejecutar = ejecutarReal): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined
  const directo = await readlink(`/proc/${pid}/cwd`).catch(() => undefined)
  if (directo) return directo
  const t = await ejecutar('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).catch(() => '')
  return t.split('\n').find((l) => l.startsWith('n'))?.slice(1).trim() || undefined
}

/** Todo lo necesario para decidir de quién es un puerto ocupado. */
export async function duenoDePuerto(puerto: number, ejecutar: Ejecutar = ejecutarReal): Promise<ProcesoPuerto | undefined> {
  const p = await procesoEnPuerto(puerto, ejecutar)
  if (!p) return undefined
  const [ancestros, cwd] = await Promise.all([ancestrosDe(p.pid, ejecutar), cwdDe(p.pid, ejecutar)])
  return { pid: p.pid, ...(p.proceso ? { proceso: p.proceso } : {}), ...(cwd ? { cwd } : {}), ancestros }
}

const vivo = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Cierra un proceso: SIGTERM y, si sigue vivo tras `graciaMs`, SIGKILL (en Windows `taskkill /T /F`). Devuelve si ya no existe. */
export async function cerrarProceso(pid: number, graciaMs = 3000, ejecutar: Ejecutar = ejecutarReal): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false
  if (process.platform === 'win32') {
    await ejecutar('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => undefined)
    return !vivo(pid)
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return !vivo(pid)
  }
  const limite = Date.now() + graciaMs
  while (Date.now() < limite) {
    if (!vivo(pid)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // ya terminó
  }
  await new Promise((r) => setTimeout(r, 150))
  return !vivo(pid)
}
