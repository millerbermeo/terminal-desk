import { randomUUID } from 'node:crypto'
import { aplicarComando, ID_PROYECTO_ARRANQUE, moverComando, quitarComando, type ComandoArranque } from '@shared/arranque'

export type ResultadoGuardar = { ok: true; comando: ComandoArranque; lista: ComandoArranque[] } | { ok: false; mensaje: string }

/** Dónde viven los comandos de arranque. En producción, la cuenta del servidor (`ArranqueNube`); en las pruebas, la memoria. */
export interface StoreArranque {
  listar(proyectoId: string): Promise<ComandoArranque[]>
  /** Los de todos los proyectos que tienen alguno. */
  todos(): Promise<{ proyectoId: string; comandos: ComandoArranque[] }[]>
  /** Crea (sin `entrada.id`) o edita. Rechaza lo repetido en el proyecto. */
  guardar(proyectoId: string, entrada: unknown): Promise<ResultadoGuardar>
  eliminar(proyectoId: string, id: string): Promise<ComandoArranque[]>
  mover(proyectoId: string, id: string, indice: number): Promise<ComandoArranque[]>
}

export function idProyectoValido(proyectoId: unknown): string {
  if (typeof proyectoId !== 'string' || !ID_PROYECTO_ARRANQUE.test(proyectoId)) throw new Error('Arranque: proyecto no válido')
  return proyectoId
}

/** Implementación en memoria con las mismas reglas (las de `shared/arranque.ts`): sirve de referencia y para las pruebas. */
export class MemoriaArranque implements StoreArranque {
  private datos = new Map<string, ComandoArranque[]>()

  async listar(proyectoId: string): Promise<ComandoArranque[]> {
    return [...(this.datos.get(idProyectoValido(proyectoId)) ?? [])]
  }

  async todos(): Promise<{ proyectoId: string; comandos: ComandoArranque[] }[]> {
    return [...this.datos].filter(([, c]) => c.length > 0).map(([proyectoId, comandos]) => ({ proyectoId, comandos: [...comandos] }))
  }

  async guardar(proyectoId: string, entrada: unknown): Promise<ResultadoGuardar> {
    const actual = await this.listar(proyectoId)
    const r = aplicarComando(actual, entrada, randomUUID)
    if (!r.ok) return r
    this.datos.set(proyectoId, r.lista)
    return { ok: true, comando: r.comando, lista: r.lista }
  }

  async eliminar(proyectoId: string, id: string): Promise<ComandoArranque[]> {
    const lista = quitarComando(await this.listar(proyectoId), id)
    this.datos.set(proyectoId, lista)
    return lista
  }

  async mover(proyectoId: string, id: string, indice: number): Promise<ComandoArranque[]> {
    const lista = moverComando(await this.listar(proyectoId), id, indice)
    this.datos.set(proyectoId, lista)
    return lista
  }

  /** Solo para pruebas: cambia la lista tal cual, sin validar (como un dato editado a mano). */
  forzar(proyectoId: string, fn: (actual: ComandoArranque[]) => ComandoArranque[]): void {
    this.datos.set(proyectoId, fn(this.datos.get(proyectoId) ?? []))
  }
}
