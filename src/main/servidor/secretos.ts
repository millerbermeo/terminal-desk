import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AlmacenToken } from '../github/token'
import type { SeccionesSecretas } from './boveda'

async function leerJson<T>(ruta: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(ruta, 'utf8')) as T
  } catch {
    return undefined
  }
}

async function escribirJson(ruta: string, v: unknown): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  const tmp = `${ruta}.${process.pid}.boveda.tmp`
  await writeFile(tmp, JSON.stringify(v, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, ruta)
}

type ConEnv = { env?: Record<string, string> }

/**
 * Secretos de este equipo, por secciones:
 * - `proveedores`: `env` de cada proveedor de IA (claves de API), por id.
 * - `mcp`: `env` de cada servidor MCP, por nombre.
 * - `api`: datos del cliente API completos (colecciones, entornos con sus tokens, historial).
 * - `github`: token de GitHub.
 * Lo demás de proveedores y MCP viaja con los datos de la cuenta (sin claves).
 */
export interface EscriturasSerializadas {
  /** Ejecuta `f` en la cola de escrituras de `proveedores.json` (la misma que usa la pantalla de proveedores). */
  proveedores?: <T>(f: () => Promise<T>) => Promise<T>
  /** Reemplaza los datos del cliente API por la vía normal del servicio. */
  api?: (datos: unknown) => Promise<void>
}

export function seccionesSecretas(dir: string, github: AlmacenToken, alAplicar?: (seccion: string) => void, serializar: EscriturasSerializadas = {}): SeccionesSecretas {
  const proveedores = join(dir, 'proveedores.json')
  const mcp = join(dir, 'mcp.json')
  const api = join(dir, 'api', 'datos.json')
  return {
    async leer() {
      const s: Record<string, unknown> = {}
      const lista = await leerJson<(ConEnv & { id?: string })[]>(proveedores)
      if (Array.isArray(lista)) s.proveedores = Object.fromEntries(lista.filter((p) => p.id && p.env && Object.keys(p.env).length).map((p) => [p.id!, p.env]))
      const m = await leerJson<{ servidores?: Record<string, ConEnv> }>(mcp)
      if (m?.servidores) s.mcp = Object.fromEntries(Object.entries(m.servidores).filter(([, v]) => v.env && Object.keys(v.env).length).map(([n, v]) => [n, v.env]))
      const datosApi = await leerJson<unknown>(api)
      if (datosApi) s.api = datosApi
      const t = await github.leer()
      // Solo si está guardado en disco: un token solo en memoria (sin llavero) no se sube.
      if (t?.persistente) s.github = { token: t.token, ...(t.usuario ? { usuario: t.usuario } : {}), ...(t.refresh ? { refresh: t.refresh } : {}), ...(t.expira !== undefined ? { expira: t.expira } : {}), ...(t.refrescaHasta !== undefined ? { refrescaHasta: t.refrescaHasta } : {}) }
      return s
    },

    async aplicar(seccion, data) {
      if (seccion === 'proveedores' && data && typeof data === 'object') {
        const aplicarEnv = async (): Promise<void> => {
          const lista = await leerJson<(ConEnv & { id?: string })[]>(proveedores)
          if (Array.isArray(lista)) {
            const env = data as Record<string, Record<string, string>>
            await escribirJson(proveedores, lista.map((p) => (p.id && env[p.id] ? { ...p, env: env[p.id] } : p)))
          }
        }
        await (serializar.proveedores ? serializar.proveedores(aplicarEnv) : aplicarEnv())
      } else if (seccion === 'mcp' && data && typeof data === 'object') {
        const m = await leerJson<{ servidores?: Record<string, ConEnv> }>(mcp)
        if (m?.servidores) {
          const env = data as Record<string, Record<string, string>>
          await escribirJson(mcp, { ...m, servidores: Object.fromEntries(Object.entries(m.servidores).map(([n, v]) => [n, env[n] ? { ...v, env: env[n] } : v])) })
        }
      } else if (seccion === 'api' && data && typeof data === 'object') {
        await (serializar.api ? serializar.api(data) : escribirJson(api, data))
      } else if (seccion === 'github' && data && typeof data === 'object') {
        const g = data as { token?: unknown; usuario?: unknown; refresh?: unknown; expira?: unknown; refrescaHasta?: unknown }
        if (typeof g.token === 'string') {
          await github.guardar(g.token, typeof g.usuario === 'string' ? g.usuario : undefined, {
            ...(typeof g.refresh === 'string' ? { refresh: g.refresh } : {}),
            ...(typeof g.expira === 'number' ? { expira: g.expira } : {}),
            ...(typeof g.refrescaHasta === 'number' ? { refrescaHasta: g.refrescaHasta } : {})
          })
        }
      } else return
      alAplicar?.(seccion)
    }
  }
}
