import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { ResultadoHerramienta } from '@shared/core/herramientas'
import { HERRAMIENTAS_ODESK, SERVIDOR_MCP } from '@shared/herramientas-odesk'

const VERSION_PROTOCOLO = '2024-11-05'

interface Peticion {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: Record<string, unknown>
}

/**
 * Servidor MCP mínimo por stdio (JSON-RPC, un mensaje por línea) con las herramientas de tareas. No tiene datos propios:
 * cada llamada se delega en `llamar`, que se las pide a la app abierta. Sin dependencias, para poder lanzarlo con el propio Electron.
 */
export function servirMcpTareas(entrada: Readable, salida: Writable, llamar: (herramienta: string, entrada: unknown) => Promise<ResultadoHerramienta>): Promise<void> {
  const enviar = (o: unknown): void => void salida.write(JSON.stringify(o) + '\n')
  const ok = (id: string | number, result: unknown): void => enviar({ jsonrpc: '2.0', id, result })
  const fallo = (id: string | number, code: number, message: string): void => enviar({ jsonrpc: '2.0', id, error: { code, message } })

  const atender = async (p: Peticion): Promise<void> => {
    // Las notificaciones (sin id) no se responden.
    if (p.id === undefined) return
    switch (p.method) {
      case 'initialize':
        return ok(p.id, {
          protocolVersion: typeof p.params?.protocolVersion === 'string' ? p.params.protocolVersion : VERSION_PROTOCOLO,
          capabilities: { tools: {} },
          serverInfo: { name: SERVIDOR_MCP, version: '1.0.0' }
        })
      case 'ping':
        return ok(p.id, {})
      case 'tools/list':
        return ok(p.id, { tools: HERRAMIENTAS_ODESK.map((h) => ({ name: h.nombre, description: h.descripcion, inputSchema: h.esquema })) })
      case 'tools/call': {
        const nombre = String(p.params?.name ?? '')
        if (!HERRAMIENTAS_ODESK.some((h) => h.nombre === nombre)) return fallo(p.id, -32602, `Herramienta desconocida: ${nombre}`)
        const r = await llamar(nombre, p.params?.arguments ?? {})
        return ok(p.id, { content: [{ type: 'text', text: r.texto }], ...(r.error ? { isError: true } : {}) })
      }
      default:
        return fallo(p.id, -32601, `Método no soportado: ${String(p.method)}`)
    }
  }

  const lineas = createInterface({ input: entrada })
  const pendientes = new Set<Promise<void>>()
  lineas.on('line', (linea) => {
    if (!linea.trim()) return
    let p: Peticion
    try {
      p = JSON.parse(linea) as Peticion
    } catch {
      return enviar({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } })
    }
    const tarea = atender(p).catch((err) => {
      if (p.id !== undefined) fallo(p.id, -32603, (err as Error).message)
    })
    pendientes.add(tarea)
    void tarea.finally(() => pendientes.delete(tarea))
  })
  return new Promise((resolver) => lineas.on('close', () => void Promise.all(pendientes).then(() => resolver())))
}
