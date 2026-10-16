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

const area = (r: Rect): number => r.w * r.h

/** Mosaico perfecto: todo dentro del lienzo, sin solapes y sin huecos (el área suma GRID²). */
export function esMosaico(rects: Rects): boolean {
  const lista = Object.values(rects)
  const sinSolapes = lista.every((r, i) => dentro(r) && lista.every((o, j) => i === j || !solapa(r, o)))
  return sinSolapes && lista.reduce((t, r) => t + area(r), 0) === GRID * GRID
}

type Dir = 'r' | 'd' | 'l' | 'u'

/** Cuánto puede estirarse `r` hacia `dir` antes de chocar con otro panel o con el borde (en unidades). */
function espacioLibre(work: Rects, id: string, r: Rect, dir: Dir): number {
  const horizontal = dir === 'r' || dir === 'l'
  let limite = dir === 'r' ? GRID - (r.x + r.w) : dir === 'd' ? GRID - (r.y + r.h) : dir === 'l' ? r.x : r.y
  for (const [otro, q] of Object.entries(work)) {
    if (otro === id) continue
    // solo estorban los paneles que comparten tramo con el lado por el que se estira
    const comparte = horizontal ? q.y < r.y + r.h && r.y < q.y + q.h : q.x < r.x + r.w && r.x < q.x + q.w
    if (!comparte) continue
    const distancia =
      dir === 'r' ? q.x - (r.x + r.w) : dir === 'd' ? q.y - (r.y + r.h) : dir === 'l' ? r.x - (q.x + q.w) : r.y - (q.y + q.h)
    if (distancia >= 0 && distancia < limite) limite = distancia
  }
  return limite
}

/**
 * Rellena huecos: los paneles se estiran hacia el espacio libre contiguo (a lo largo de todo su lado),
 * hasta chocar con otro panel o con el borde. `excluir` no se estira (el que el usuario está arrastrando).
 */
function absorber(work: Rects, excluir?: string): void {
  for (let guarda = 0, cambio = true; cambio && guarda < 50; guarda++) {
    cambio = false
    for (const [id, r] of Object.entries(work)) {
      if (id === excluir) continue
      for (const dir of ['r', 'd', 'l', 'u'] as Dir[]) {
        const k = espacioLibre(work, id, r, dir)
        if (k <= 0) continue
        if (dir === 'r') r.w += k
        else if (dir === 'd') r.h += k
        else if (dir === 'l') {
          r.x -= k
          r.w += k
        } else {
          r.y -= k
          r.h += k
        }
        cambio = true
      }
    }
  }
}

const MIN_DIVISION_W = 25 // unidades mínimas por mitad al partir un panel (≈ MIN_ANCHO px en una ventana normal)
const MIN_DIVISION_H = 15

/** Parte el panel más grande en dos y devuelve el rect libre para el nuevo, o null si ninguno admite partirse. */
function partirMayor(rects: Rects): Rect | null {
  const orden = Object.entries(rects).sort(([, a], [, b]) => area(b) - area(a))
  for (const [id, r] of orden) {
    // la ventana suele ser más ancha que alta: se parte en horizontal si el panel es "más ancho" en píxeles
    const porAncho = r.w * 1.6 >= r.h
    if (porAncho && r.w >= 2 * MIN_DIVISION_W) {
      const w = Math.floor(r.w / 2)
      rects[id] = { ...r, w: r.w - w }
      return { x: r.x + r.w - w, y: r.y, w, h: r.h }
    }
    if (r.h >= 2 * MIN_DIVISION_H) {
      const h = Math.floor(r.h / 2)
      rects[id] = { ...r, h: r.h - h }
      return { x: r.x, y: r.y + r.h - h, w: r.w, h }
    }
    if (r.w >= 2 * MIN_DIVISION_W) {
      const w = Math.floor(r.w / 2)
      rects[id] = { ...r, w: r.w - w }
      return { x: r.x + r.w - w, y: r.y, w, h: r.h }
    }
  }
  return null
}

/**
 * Ajusta el layout a la lista de ids sin dejar huecos. Sin personalizar se recalcula la cuadrícula;
 * personalizado: los paneles cerrados los absorbe un vecino y cada nuevo parte en dos al más grande.
 * Si no se puede mantener un mosaico perfecto, se vuelve a la cuadrícula automática.
 */
export function reconciliar(
  prev: Rects,
  ids: string[],
  personalizado: boolean
): { rects: Rects; personalizado: boolean } {
  const mantenidos = ids.filter((id) => prev[id])
  const nuevos = ids.filter((id) => !prev[id])
  const automatico = { rects: layoutAutomatico(ids), personalizado: false }
  if (!personalizado || mantenidos.length === 0) return automatico
  if (nuevos.length === 0 && mantenidos.length === Object.keys(prev).length) return { rects: prev, personalizado }

  const rects: Rects = Object.fromEntries(mantenidos.map((id) => [id, { ...prev[id] }]))
  if (mantenidos.length < Object.keys(prev).length) absorber(rects)
  for (const id of nuevos) {
    const hueco = partirMayor(rects)
    if (!hueco) return automatico
    rects[id] = hueco
  }
  return esMosaico(rects) ? { rects, personalizado } : automatico
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

interface Minimos {
  w: number
  h: number
}

/**
 * Despeja los paneles que `id` pisa en un eje. Cada panel pisado cede espacio: primero se encoge
 * (por el lado que mira a `id`) hasta su tamaño mínimo y, si hace falta, se desplaza; lo que
 * desplaza a su vez lo trata igual en cascada. Devuelve false si no hay sitio en el lienzo.
 */
function despejar(work: Rects, original: Rects, id: string, eje: 'x' | 'y', dir: 1 | -1, min: Minimos): boolean {
  const pos = eje === 'x' ? 'x' : 'y'
  const tam = eje === 'x' ? 'w' : 'h'
  const minimo = eje === 'x' ? min.w : min.h
  const cola = [id]
  for (let vueltas = 0; cola.length > 0; vueltas++) {
    if (vueltas > 500) return false
    const actualId = cola.pop()!
    const actual = work[actualId]
    for (const [qid, q] of Object.entries(work)) {
      // el panel que se manipula (id) nunca cede, y un panel no se solapa consigo mismo
      if (qid === id || qid === actualId || !solapa(actual, q)) continue
      const mq = Math.min(minimo, original[qid][tam]) // un panel ya más pequeño que el mínimo no se obliga a crecer
      if (dir > 0) {
        const borde = actual[pos] + actual[tam]
        const resto = q[pos] + q[tam] - borde
        q[tam] = Math.max(resto, mq)
        q[pos] = borde
        if (q[pos] + q[tam] > GRID) return false
      } else {
        const borde = actual[pos]
        const resto = borde - q[pos]
        q[tam] = Math.max(resto, mq)
        q[pos] = borde - q[tam]
        if (q[pos] < 0) return false
      }
      cola.push(qid)
    }
  }
  return true
}

/** Estado resultante de arrastrar con (dx, dy) exactos, o null si no cabe. */
function intentar(
  rects0: Rects,
  id: string,
  tipo: Asa,
  dx: number,
  dy: number,
  min: Minimos
): Rects | null {
  const r0 = rects0[id]
  const propio = construir(r0, tipo, dx, dy)
  if (!dentro(propio)) return null
  if (propio.w < Math.min(min.w, r0.w) || propio.h < Math.min(min.h, r0.h)) return null

  const work: Rects = Object.fromEntries(Object.entries(rects0).map(([k, r]) => [k, { ...r }]))

  // Un eje cada vez (primero x, luego y): así un panel solo cede en el sentido en que se lo pisa.
  // Solo hay que despejar donde el panel invade espacio nuevo; al encogerse no pisa a nadie.
  const dirX = tipo.r && dx > 0 ? 1 : tipo.l && dx < 0 ? -1 : 0
  const dirY = tipo.b && dy > 0 ? 1 : tipo.t && dy < 0 ? -1 : 0
  if (dirX) {
    work[id] = construir(r0, tipo, dx, 0)
    if (!despejar(work, rects0, id, 'x', dirX, min)) return null
  }
  work[id] = propio
  if (dirY && !despejar(work, rects0, id, 'y', dirY, min)) return null
  absorber(work, id) // los huecos que deja el panel al encogerse los rellenan sus vecinos
  return esMosaico(work) ? work : null
}

/**
 * Tira del borde o esquina `tipo` del panel `id` por (dx, dy) unidades. Los vecinos ceden espacio
 * (se encogen hasta el mínimo y luego se desplazan) y los huecos se rellenan, así que el resultado
 * siempre es un mosaico sin huecos. Se calcula desde el estado inicial del arrastre: al volver atrás
 * todo recupera su tamaño. Si el desplazamiento pedido no cabe, se usa el mayor que sí.
 */
export function redimensionar(
  rects0: Rects,
  id: string,
  tipo: Asa,
  dx: number,
  dy: number,
  minW: number,
  minH: number
): Rects {
  const min = { w: minW, h: minH }
  // mayor desplazamiento (en valor absoluto, hasta `pedido`) que cabe: bisección, 0 siempre cabe
  const mejor = (pedido: number, probar: (k: number) => Rects | null): number => {
    if (pedido === 0 || probar(pedido)) return pedido
    const signo = Math.sign(pedido)
    let bien = 0
    let mal = Math.abs(pedido)
    while (mal - bien > 1) {
      const medio = (bien + mal) >> 1
      if (probar(signo * medio)) bien = medio
      else mal = medio
    }
    return signo * bien
  }
  const x = mejor(dx, (k) => intentar(rects0, id, tipo, k, 0, min))
  const y = mejor(dy, (k) => intentar(rects0, id, tipo, x, k, min))
  return intentar(rects0, id, tipo, x, y, min) ?? rects0
}

/** Mover = intercambiar sitio con el panel que hay bajo el puntero (coordenadas en unidades). */
export function intercambiar(rects0: Rects, id: string, punto: { x: number; y: number }): Rects {
  const destino = Object.entries(rects0).find(
    ([k, r]) => k !== id && punto.x >= r.x && punto.x < r.x + r.w && punto.y >= r.y && punto.y < r.y + r.h
  )
  if (!destino) return rects0
  return { ...rects0, [id]: { ...destino[1] }, [destino[0]]: { ...rects0[id] } }
}
