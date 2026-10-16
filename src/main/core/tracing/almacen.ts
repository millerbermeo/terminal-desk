import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResumenTraza, Traza } from '@shared/core/traza'
import { AlmacenJson } from '../memory/almacen'

const MAX_TRAZAS = 200

export function resumir(t: Traza): ResumenTraza {
  return {
    id: t.id,
    inicio: t.inicio,
    ...(t.duracionMs !== undefined ? { duracionMs: t.duracionMs } : {}),
    prompt: t.prompt.slice(0, 200),
    agente: t.agente,
    modo: t.modo,
    estado: t.estado,
    llamadasLlm: t.spans.filter((s) => s.tipo === 'llm').length,
    herramientas: t.spans.filter((s) => s.tipo === 'herramienta').length,
    errores: t.spans.filter((s) => s.estado === 'error').length,
    uso: t.uso
  }
}

/** Una traza por archivo (0600: aunque se redactan credenciales, contienen prompts y salidas). Conserva las últimas 200. */
export class AlmacenTrazas {
  private readonly almacen: AlmacenJson<Traza>

  constructor(private readonly dir: string) {
    this.almacen = new AlmacenJson<Traza>(dir, 0o600)
  }

  async guardar(t: Traza): Promise<void> {
    await this.almacen.actualizar(t.id, () => t)
    const ids = await this.almacen.ids()
    if (ids.length > MAX_TRAZAS) {
      const fechas = await Promise.all(ids.map(async (id) => ({ id, m: await stat(join(this.dir, `${id}.json`)).then((s) => s.mtimeMs, () => 0) })))
      for (const { id } of fechas.sort((a, b) => a.m - b.m).slice(0, ids.length - MAX_TRAZAS)) await this.almacen.actualizar(id, () => undefined)
    }
  }

  obtener(id: string): Promise<Traza | undefined> {
    return this.almacen.leer(id)
  }

  async eliminar(id: string): Promise<void> {
    await this.almacen.actualizar(id, () => undefined)
  }

  /** Resúmenes de las trazas más recientes primero. */
  async listar(limite = 50): Promise<ResumenTraza[]> {
    const trazas = (await Promise.all((await this.almacen.ids()).map((id) => this.almacen.leer(id).catch(() => undefined)))).filter((t): t is Traza => !!t)
    return trazas.sort((a, b) => b.inicio - a.inicio).slice(0, limite).map(resumir)
  }
}
