/** Layout "bento": cada panel es un rectángulo en una cuadrícula fina de GRID×GRID unidades. */
export const GRID = 96 // ~10 px por unidad en una ventana normal: el arrastre se siente continuo

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Rects = Record<string, Rect>

export interface Asa {
  l?: boolean
  r?: boolean
  t?: boolean
  b?: boolean
}

export const solapa = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const dentro = (r: Rect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= GRID && r.y + r.h <= GRID

/** Reparte `total` unidades en `n` partes casi iguales. */
function repartir(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  const resto = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0))
}

/** Cuadrícula inicial: ~cuadrada; el último panel de una fila incompleta ocupa el resto. */
export function layoutAutomatico(ids: string[]): Rects {
  const n = ids.length
  if (n === 0) return {}
  const cols = Math.min(Math.ceil(Math.sqrt(n)), GRID)
  const filas = Math.ceil(n / cols)
  const anchos = repartir(GRID, cols)
  const altos = repartir(GRID, filas)
  const rects: Rects = {}
  ids.forEach((id, i) => {
    const f = Math.floor(i / cols)
    const c = i % cols
    const ultimoIncompleto = i === n - 1 && c < cols - 1
    const hasta = ultimoIncompleto ? cols : c + 1
    rects[id] = {
      x: anchos.slice(0, c).reduce((a, b) => a + b, 0),
      y: altos.slice(0, f).reduce((a, b) => a + b, 0),
      w: anchos.slice(c, hasta).reduce((a, b) => a + b, 0),
      h: altos[f]
    }
  })
  return rects
}

/** Primer hueco libre (de mayor a menor tamaño) para un panel nuevo, o null si no cabe. */
export function huecoLibre(rects: Rect[]): Rect | null {
  for (const [w, h] of [[48, 48], [48, 32], [32, 48], [32, 32], [24, 32], [32, 24], [24, 24]]) {
    for (let y = 0; y + h <= GRID; y += 2) {
      for (let x = 0; x + w <= GRID; x += 2) {
        const r = { x, y, w, h }
        if (!rects.some((o) => solapa(r, o))) return r
      }
    }
  }
  return null
}

/**
 * Ajusta los ids: quita los cerrados y coloca los nuevos. Si el usuario no personalizó el layout,
 * se recalcula la cuadrícula; si sí y no queda hueco para un panel nuevo, se reinicia.
 */
export function reconciliar(
  prev: Rects,
  ids: string[],
  personalizado: boolean
): { rects: Rects; personalizado: boolean } {
  const mantenidos = ids.filter((id) => prev[id])
  const nuevos = ids.filter((id) => !prev[id])
  if (!personalizado || mantenidos.length === 0) return { rects: layoutAutomatico(ids), personalizado: false }
  if (nuevos.length === 0 && mantenidos.length === ids.length) return { rects: prev, personalizado }

  const rects: Rects = Object.fromEntries(mantenidos.map((id) => [id, prev[id]]))
  for (const id of nuevos) {
    const hueco = huecoLibre(Object.values(rects))
    if (!hueco) return { rects: layoutAutomatico(ids), personalizado: false }
    rects[id] = hueco
  }
  return { rects, personalizado }
}

function construir(r0: Rect, tipo: 'mover' | Asa, dx: number, dy: number): Rect {
  if (tipo === 'mover') return { ...r0, x: r0.x + dx, y: r0.y + dy }
  const r = { ...r0 }
  if (tipo.l) {
    r.x += dx
    r.w -= dx
  }
  if (tipo.r) r.w += dx
  if (tipo.t) {
    r.y += dy
    r.h -= dy
  }
  if (tipo.b) r.h += dy
  return r
}

/**
 * Aplica un arrastre de (dx, dy) unidades al rectángulo `r0`. Si el resultado se saldría del lienzo,
 * bajaría del tamaño mínimo o pisaría a otro panel, se reduce el desplazamiento hasta lo máximo posible.
 */
export function aplicarArrastre(
  r0: Rect,
  tipo: 'mover' | Asa,
  dx: number,
  dy: number,
  otros: Rect[],
  minW: number,
  minH: number
): Rect {
  const mw = Math.min(minW, r0.w) // si ya era menor que el mínimo, no se obliga a crecer
  const mh = Math.min(minH, r0.h)
  const valido = (r: Rect): boolean => dentro(r) && r.w >= mw && r.h >= mh && !otros.some((o) => solapa(r, o))
  const mejor = (pedido: number, probar: (k: number) => Rect): number => {
    const paso = Math.sign(pedido)
    for (let k = pedido; k !== 0; k -= paso) if (valido(probar(k))) return k
    return 0
  }
  const x = mejor(dx, (k) => construir(r0, tipo, k, 0))
  const y = mejor(dy, (k) => construir(r0, tipo, x, k))
  return construir(r0, tipo, x, y)
}
