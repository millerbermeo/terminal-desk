import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { sanear } from '@shared/registro'
import type { EntradaBitacora } from '@shared/bitacora-asistente'
import { diaLocal } from './medidor'

const DIAS_RETENIDOS = 30
const MAX_ERROR = 1500
const MAX_MENSAJE = 90

/**
 * Archivo por día (`consumo/AAAA-MM-DD.jsonl`) con una línea por mensaje del Asistente y por fallo. Nunca lanza ni bloquea el turno:
 * si no puede escribir, lo ignora. Se borra lo de más de 30 días. Es local; no se sube a ningún servidor.
 */
export class BitacoraAsistente {
  private cola: Promise<void> = Promise.resolve()
  private limpiado = ''

  constructor(
    private readonly dir: string,
    private readonly casa?: string,
    private readonly ahora: () => number = Date.now
  ) {}

  anotar(e: EntradaBitacora): void {
    const limpia: EntradaBitacora =
      e.tipo === 'fallo'
        ? { ...e, mensaje: sanear(e.mensaje, MAX_MENSAJE, this.casa), error: sanear(e.error, MAX_ERROR, this.casa) }
        : { ...e, mensaje: sanear(e.mensaje, MAX_MENSAJE, this.casa) }
    this.cola = this.cola
      .then(async () => {
        await mkdir(this.dir, { recursive: true })
        await appendFile(join(this.dir, `${diaLocal(e.ts)}.jsonl`), JSON.stringify(limpia) + '\n', 'utf8')
        await this.limpiar()
      })
      .catch(() => undefined)
  }

  /** Entradas de los últimos `dias` días (1 = solo hoy), de la más reciente a la más antigua. */
  async leer(dias: number): Promise<EntradaBitacora[]> {
    await this.cola
    const desde = diaLocal(this.ahora() - (Math.max(1, Math.min(dias, DIAS_RETENIDOS)) - 1) * 86_400_000)
    const salida: EntradaBitacora[] = []
    try {
      for (const f of (await readdir(this.dir)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) >= desde)) {
        for (const linea of (await readFile(join(this.dir, f), 'utf8')).split('\n')) {
          if (!linea.trim()) continue
          try {
            const o = JSON.parse(linea) as EntradaBitacora
            if (o && (o.tipo === 'turno' || o.tipo === 'fallo') && typeof o.ts === 'number') salida.push(o)
          } catch {
            /* línea cortada por un cierre brusco */
          }
        }
      }
    } catch {
      /* aún no hay nada */
    }
    return salida.sort((a, b) => b.ts - a.ts)
  }

  private async limpiar(): Promise<void> {
    const hoy = diaLocal(this.ahora())
    if (this.limpiado === hoy) return
    this.limpiado = hoy
    const limite = diaLocal(this.ahora() - DIAS_RETENIDOS * 86_400_000)
    for (const f of await readdir(this.dir).catch(() => [] as string[])) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < limite) await rm(join(this.dir, f), { force: true })
  }
}
