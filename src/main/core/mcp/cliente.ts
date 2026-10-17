import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { EsquemaEntrada, ResultadoHerramienta } from '@shared/core/herramientas'
import type { ServidorMcpConfig } from './config'

export interface HerramientaMcp {
  nombre: string
  descripcion: string
  esquema: EsquemaEntrada
}

/** Cliente de un servidor MCP por stdio. */
export class ClienteMcp {
  private readonly cliente = new Client({ name: 'odesk-agent', version: '0.1.0' })

  constructor(private readonly cfg: Pick<ServidorMcpConfig, 'comando' | 'args' | 'env' | 'cwd'>) {}

  async conectar(): Promise<void> {
    await this.cliente.connect(
      new StdioClientTransport({
        command: this.cfg.comando,
        args: this.cfg.args,
        env: { ...(process.env as Record<string, string>), ...this.cfg.env },
        ...(this.cfg.cwd ? { cwd: this.cfg.cwd } : {}),
        stderr: 'ignore'
      })
    )
  }

  async listarHerramientas(): Promise<HerramientaMcp[]> {
    const salida: HerramientaMcp[] = []
    let cursor: string | undefined
    do {
      const r = await this.cliente.listTools(cursor ? { cursor } : undefined)
      for (const t of r.tools)
        salida.push({
          nombre: t.name,
          descripcion: t.description ?? t.name,
          esquema: { type: 'object', ...(t.inputSchema as Omit<EsquemaEntrada, 'type'>) }
        })
      cursor = r.nextCursor
    } while (cursor)
    return salida
  }

  async llamar(nombre: string, argumentos: Record<string, unknown>, senal?: AbortSignal): Promise<ResultadoHerramienta> {
    const r = await this.cliente.callTool({ name: nombre, arguments: argumentos }, undefined, senal ? { signal: senal } : undefined)
    const contenido = Array.isArray(r.content) ? r.content : []
    const texto = contenido
      .map((c: { type: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : `[contenido ${c.type} no soportado]`))
      .join('\n')
    return { texto: texto || '(sin contenido)', ...(r.isError ? { error: true } : {}) }
  }

  cerrar(): Promise<void> {
    return this.cliente.close()
  }
}
