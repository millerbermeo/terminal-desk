import type { InfoServidorMcp } from '@shared/core/agente'
import type { RegistroHerramientas } from '../tools/registro'
import { ClienteMcp } from './cliente'
import type { ConfigMcp } from './config'

const TIEMPO_CONEXION_MS = 15_000

/** Prefijo con el que se registran las herramientas de un servidor: mcp__<servidor>__<herramienta>. */
export const prefijoMcp = (servidor: string): string => `mcp__${servidor}__`

/** Nombre válido para el modelo (^[a-zA-Z0-9_-]{1,64}$). */
const nombreHerramienta = (servidor: string, h: string): string =>
  (prefijoMcp(servidor) + h.replace(/[^a-zA-Z0-9_-]/g, '_')).slice(0, 64)

function conLimite<T>(p: Promise<T>, ms: number, que: string): Promise<T> {
  let t: NodeJS.Timeout
  const limite = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${que}: tiempo agotado`)), ms)))
  return Promise.race([p, limite]).finally(() => clearTimeout(t))
}

/** Conecta los servidores de la config y expone sus herramientas en el mismo registro que las integradas. */
export class OrquestadorMcp {
  private readonly clientes = new Map<string, ClienteMcp>()
  private info: InfoServidorMcp[] = []

  constructor(private readonly registro: RegistroHerramientas) {}

  estado(): InfoServidorMcp[] {
    return this.info
  }

  async iniciar(config: ConfigMcp): Promise<InfoServidorMcp[]> {
    await this.detener()
    this.info = await Promise.all(
      Object.entries(config.servidores).map(async ([nombre, cfg]): Promise<InfoServidorMcp> => {
        if (cfg.deshabilitado) return { nombre, estado: 'deshabilitado', herramientas: 0 }
        const cliente = new ClienteMcp(cfg)
        try {
          const defs = await conLimite(
            cliente.conectar().then(() => cliente.listarHerramientas()),
            TIEMPO_CONEXION_MS,
            `MCP ${nombre}`
          )
          for (const d of defs) {
            this.registro.registrar({
              nombre: nombreHerramienta(nombre, d.nombre),
              descripcion: `[${nombre}] ${d.descripcion}`,
              esquema: d.esquema,
              riesgo: cfg.riesgo,
              ejecutar: (entrada, ctx) => cliente.llamar(d.nombre, entrada, ctx.senal)
            })
          }
          this.clientes.set(nombre, cliente)
          return { nombre, estado: 'conectado', herramientas: defs.length }
        } catch (err) {
          await cliente.cerrar().catch(() => undefined)
          return { nombre, estado: 'error', herramientas: 0, error: (err as Error).message }
        }
      })
    )
    return this.info
  }

  async detener(): Promise<void> {
    for (const nombre of this.clientes.keys()) this.registro.quitarPrefijo(prefijoMcp(nombre))
    await Promise.allSettled([...this.clientes.values()].map((c) => c.cerrar()))
    this.clientes.clear()
    this.info = []
  }
}
