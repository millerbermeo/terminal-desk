import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SERVIDOR_MCP } from '@shared/herramientas-odesk'
import { DIR } from '../../proyectos'
import type { ServidorMcpConfig } from '../mcp/config'

let raizApp = process.cwd()
let dirDatos = DIR

/** La app indica dónde está (para localizar `out/main/mcp-tareas.js`) y dónde guarda sus datos. */
export function configurarMcpTareas(opciones: { raizApp: string; dirDatos: string }): void {
  raizApp = opciones.raizApp
  dirDatos = opciones.dirDatos
}

/** Ruta del servidor MCP ya compilado (`out/main/mcp-tareas.js`), preferentemente la copia fuera del asar. */
export function rutaServidorMcp(): string | undefined {
  const candidatas = [join(raizApp, 'out', 'main', 'mcp-tareas.js'), join(__dirname, 'mcp-tareas.js'), join(__dirname, '..', 'mcp-tareas.js')]
  for (const c of candidatas) {
    const fuera = c.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    if (fuera !== c && existsSync(fuera)) return fuera
    if (existsSync(c)) return c
  }
  return undefined
}

export interface ConfigMcpTareas {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string>; cwd?: string }>
}

/** Cómo lanzar el servidor: el propio Electron como Node (no hace falta tener Node instalado). */
export function configMcpTareas(proyectoId?: string): ConfigMcpTareas | undefined {
  const script = rutaServidorMcp()
  if (!script) return undefined
  return {
    mcpServers: {
      [SERVIDOR_MCP]: {
        command: process.execPath,
        args: [script],
        env: { ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: dirDatos, ...(proyectoId ? { ODESK_PROYECTO_ID: proyectoId } : {}) }
      }
    }
  }
}

/** Servidores externos (Playwright de serie + los de `mcp.json`) que se suman al `--mcp-config` del CLI; los deshabilitados y el nombre reservado se omiten. */
export function servidoresExternos(servidores: Record<string, ServidorMcpConfig>): Record<string, ServidorMcpConfig> {
  return Object.fromEntries(Object.entries(servidores).filter(([nombre, s]) => !s.deshabilitado && nombre !== SERVIDOR_MCP))
}

/** Archivo de configuración para `claude --mcp-config` (el nombre lleva el hash del contenido: inmutable, varias sesiones no se pisan). */
export async function archivoMcpTareas(proyectoId?: string, externos: Record<string, ServidorMcpConfig> = {}): Promise<string | undefined> {
  const base = configMcpTareas(proyectoId)?.mcpServers ?? {}
  if (Object.keys(base).length === 0 && Object.keys(externos).length === 0) return undefined
  const config: ConfigMcpTareas = {
    mcpServers: {
      ...Object.fromEntries(Object.entries(externos).map(([n, s]) => [n, { command: s.comando, args: s.args, env: s.env, ...(s.cwd ? { cwd: s.cwd } : {}) }])),
      ...base
    }
  }
  const contenido = JSON.stringify(config, null, 2) + '\n'
  const archivo = join(dirDatos, 'mcp', `tareas-${createHash('sha1').update(contenido).digest('hex').slice(0, 10)}.json`)
  try {
    await stat(archivo)
    return archivo
  } catch {
    /* hay que crearlo */
  }
  await mkdir(join(archivo, '..'), { recursive: true })
  const tmp = `${archivo}.${process.pid}.tmp`
  await writeFile(tmp, contenido, 'utf8')
  await rename(tmp, archivo)
  return archivo
}
