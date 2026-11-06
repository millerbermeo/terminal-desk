import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SERVIDOR_MCP } from '@shared/herramientas-odesk'
import type { ClienteMcpExterno, EstadoMcpExterno } from '@shared/control-app'
import { configMcpTareas } from './core/tareas/mcp-config'

/**
 * Instala el servidor MCP «odesk» en asistentes externos (Claude Code fuera de Odesk, Claude Desktop, Cursor, VS Code) para que controlen
 * la app mientras está abierta. Solo se toca la entrada «odesk» del archivo de configuración de cada cliente; el resto se conserva.
 * El servidor no tiene datos: habla con la app por el socket local con el token de `~/.odesk-agent` (solo este usuario puede leerlo).
 */
interface DefCliente {
  id: ClienteMcpExterno
  nombre: string
  archivo: string
  /** Clave del objeto de servidores dentro del archivo. */
  clave: 'mcpServers' | 'servers'
  /** Carpeta que indica que el cliente está instalado. */
  marca: string
  formato: (s: ServidorExterno) => Record<string, unknown>
}

interface ServidorExterno {
  command: string
  args: string[]
  env: Record<string, string>
}

function appData(): string {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

export function clientesMcp(h: string = homedir(), datos: string = appData()): DefCliente[] {
  const simple = (s: ServidorExterno): Record<string, unknown> => ({ command: s.command, args: s.args, env: s.env })
  return [
    { id: 'claude-code', nombre: 'Claude Code (fuera de Odesk)', archivo: join(h, '.claude.json'), clave: 'mcpServers', marca: join(h, '.claude'), formato: (s) => ({ type: 'stdio', ...simple(s) }) },
    { id: 'claude-desktop', nombre: 'Claude Desktop', archivo: join(datos, 'Claude', 'claude_desktop_config.json'), clave: 'mcpServers', marca: join(datos, 'Claude'), formato: simple },
    { id: 'cursor', nombre: 'Cursor', archivo: join(h, '.cursor', 'mcp.json'), clave: 'mcpServers', marca: join(h, '.cursor'), formato: simple },
    { id: 'vscode', nombre: 'VS Code (Copilot / Claude)', archivo: join(datos, 'Code', 'User', 'mcp.json'), clave: 'servers', marca: join(datos, 'Code', 'User'), formato: (s) => ({ type: 'stdio', ...simple(s) }) }
  ]
}

function servidorExterno(): ServidorExterno | undefined {
  const c = configMcpTareas()?.mcpServers[SERVIDOR_MCP]
  return c && { command: c.command, args: c.args, env: c.env }
}

async function leerJson(archivo: string): Promise<Record<string, unknown>> {
  try {
    const d = JSON.parse(await readFile(archivo, 'utf8')) as unknown
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${archivo} no es un objeto JSON.`)
    return d as Record<string, unknown>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    // Un archivo que no se entiende no se pisa: se perdería la configuración del cliente.
    throw new Error(`No se puede leer ${archivo}: ${(err as Error).message}`, { cause: err })
  }
}

async function escribirJson(archivo: string, datos: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(archivo), { recursive: true })
  const tmp = `${archivo}.odesk-${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(datos, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, archivo)
}

export async function estadoMcpExterno(defs: DefCliente[] = clientesMcp()): Promise<EstadoMcpExterno> {
  const s = servidorExterno()
  const clientes = await Promise.all(
    defs.map(async (c) => {
      const d = await leerJson(c.archivo).catch(() => ({}) as Record<string, unknown>)
      const servidores = d[c.clave] as Record<string, unknown> | undefined
      return { id: c.id, nombre: c.nombre, instalado: Boolean(servidores && SERVIDOR_MCP in servidores), disponible: existsSync(c.marca), ruta: c.archivo }
    })
  )
  return { json: JSON.stringify({ mcpServers: { [SERVIDOR_MCP]: s ?? { error: 'Compila la app (pnpm build): falta out/main/mcp-tareas.js' } } }, null, 2), clientes }
}

export async function instalarMcpExterno(id: ClienteMcpExterno, instalar: boolean, defs: DefCliente[] = clientesMcp()): Promise<EstadoMcpExterno> {
  const c = defs.find((x) => x.id === id)
  if (!c) throw new Error(`Cliente desconocido: ${id}`)
  const s = servidorExterno()
  if (instalar && !s) throw new Error('No encuentro el servidor MCP compilado (out/main/mcp-tareas.js): ejecuta pnpm build.')
  const d = await leerJson(c.archivo)
  const servidores = { ...((d[c.clave] as Record<string, unknown> | undefined) ?? {}) }
  if (instalar) servidores[SERVIDOR_MCP] = c.formato(s!)
  else delete servidores[SERVIDOR_MCP]
  await escribirJson(c.archivo, { ...d, [c.clave]: servidores })
  return estadoMcpExterno(defs)
}

/**
 * Al arrancar: si un cliente ya lo tenía instalado, se reescribe con las rutas actuales (cambian al actualizar o mover la app; en una
 * AppImage, en cada arranque). Nunca lanza.
 */
export async function refrescarMcpExterno(defs: DefCliente[] = clientesMcp()): Promise<void> {
  const s = servidorExterno()
  if (!s) return
  for (const c of defs) {
    try {
      const d = await leerJson(c.archivo)
      const servidores = d[c.clave] as Record<string, unknown> | undefined
      if (!servidores || !(SERVIDOR_MCP in servidores)) continue
      const nuevo = c.formato(s)
      if (JSON.stringify(servidores[SERVIDOR_MCP]) === JSON.stringify(nuevo)) continue
      await escribirJson(c.archivo, { ...d, [c.clave]: { ...servidores, [SERVIDOR_MCP]: nuevo } })
    } catch {
      /* ese cliente se queda como estaba */
    }
  }
}
