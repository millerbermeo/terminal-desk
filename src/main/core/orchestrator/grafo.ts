export const FIN = '__fin__'

export interface Transicion<E> {
  estado: E
  siguiente: string // id de un nodo, o FIN
}

export interface ContextoNodo {
  intento: number // cuántas veces se ha entrado ya en este nodo (1 = primera)
  senal?: AbortSignal
}

export type Nodo<E> = (estado: E, ctx: ContextoNodo) => Promise<Transicion<E>>

export interface ResultadoGrafo<E> {
  estado: E
  recorrido: string[]
  motivo: 'fin' | 'cancelado' | 'limite'
}

export interface OpcionesGrafo<E> {
  senal?: AbortSignal
  maxTransiciones?: number // protege de ciclos infinitos
  alNodo?(nodo: string, intento: number, estado: E): void
}

/** Máquina de estados: cada nodo recibe el estado y decide el siguiente nodo (las aristas condicionales viven en el nodo). */
export class GrafoEstados<E> {
  constructor(
    private readonly nodos: Readonly<Record<string, Nodo<E>>>,
    private readonly inicio: string
  ) {
    if (!nodos[inicio]) throw new Error(`Nodo inicial inexistente: ${inicio}`)
  }

  async ejecutar(estadoInicial: E, o: OpcionesGrafo<E> = {}): Promise<ResultadoGrafo<E>> {
    const max = o.maxTransiciones ?? 50
    const visitas = new Map<string, number>()
    const recorrido: string[] = []
    let estado = estadoInicial
    let actual = this.inicio
    while (actual !== FIN) {
      if (o.senal?.aborted) return { estado, recorrido, motivo: 'cancelado' }
      if (recorrido.length >= max) return { estado, recorrido, motivo: 'limite' }
      const nodo = this.nodos[actual]
      if (!nodo) throw new Error(`Transición a un nodo inexistente: ${actual}`)
      const intento = (visitas.get(actual) ?? 0) + 1
      visitas.set(actual, intento)
      recorrido.push(actual)
      o.alNodo?.(actual, intento, estado)
      const t = await nodo(estado, { intento, ...(o.senal ? { senal: o.senal } : {}) })
      estado = t.estado
      actual = t.siguiente
    }
    return { estado, recorrido, motivo: 'fin' }
  }
}
