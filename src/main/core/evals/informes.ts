import type { ComparacionInformes, InformeEval } from '@shared/core/evals'
import { AlmacenJson } from '../memory/almacen'

const stamp = (iso: string): string => iso.replace(/[-:.]/g, '').slice(0, 15) // 20261016T145500

/** Informes de evaluación por suite, para detectar regresiones entre ejecuciones. */
export class AlmacenInformes {
  private readonly almacen: AlmacenJson<InformeEval>

  constructor(dir: string) {
    this.almacen = new AlmacenJson<InformeEval>(dir)
  }

  async guardar(i: InformeEval): Promise<void> {
    await this.almacen.actualizar(`${i.suite}__${stamp(i.fecha)}`, () => i)
  }

  /** Más recientes primero. */
  async listar(suite: string, limite = 10): Promise<InformeEval[]> {
    const ids = (await this.almacen.ids()).filter((id) => id.startsWith(`${suite}__`)).sort().reverse().slice(0, limite)
    return (await Promise.all(ids.map((id) => this.almacen.leer(id)))).filter((i): i is InformeEval => !!i)
  }
}

export function compararInformes(anterior: InformeEval, actual: InformeEval): ComparacionInformes {
  const antes = new Map(anterior.casos.map((c) => [c.id, c.pasa]))
  const salida: ComparacionInformes = { regresiones: [], mejoras: [], nuevos: [], deltaTasa: actual.tasa - anterior.tasa }
  for (const c of actual.casos) {
    const previo = antes.get(c.id)
    if (previo === undefined) salida.nuevos.push(c.id)
    else if (previo && !c.pasa) salida.regresiones.push(c.id)
    else if (!previo && c.pasa) salida.mejoras.push(c.id)
  }
  return salida
}
