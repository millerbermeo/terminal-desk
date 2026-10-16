/**
 * Layout en árbol de divisiones (como tmux / VSCode): cada nodo parte su espacio en dos.
 * Siempre cubre todo el lienzo (sin huecos ni solapes) y cada divisor mueve una línea completa.
 */
export type Dir = 'h' | 'v' // h: lado a lado (a | b) · v: apilados (a sobre b)

export interface Hoja {
  t: 'hoja'
  id: string
}

export interface Division {
  t: 'div'
  id: number
  dir: Dir
  razon: number // fracción del espacio que ocupa `a` (0..1)
  a: Nodo
  b: Nodo
}

export type Nodo = Hoja | Division

/** Rectángulo en fracciones del lienzo (0..1). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Medidas {
  ancho: number // px del lienzo
  alto: number
  minAncho: number // px mínimos de una terminal
  minAlto: number
}

export interface DivisorGeo {
  id: number
  dir: Dir
  nodo: Rect // espacio del nodo que parte (el divisor ocupa todo su otro eje)
  razon: number
}

let siguienteId = 1
const hoja = (id: string): Hoja => ({ t: 'hoja', id })
const division = (dir: Dir, razon: number, a: Nodo, b: Nodo): Division => ({ t: 'div', id: siguienteId++, dir, razon, a, b })

export function hojas(n: Nodo | null): string[] {
  if (!n) return []
  return n.t === 'hoja' ? [n.id] : [...hojas(n.a), ...hojas(n.b)]
}

/** n terminales en cuadrícula ~cuadrada; las filas incompletas reparten el ancho entre las que tengan. */
function apilar(items: Nodo[], dir: Dir): Nodo {
  if (items.length === 1) return items[0]
  return division(dir, 1 / items.length, items[0], apilar(items.slice(1), dir))
}

export function balanceado(ids: string[]): Nodo | null {
  const n = ids.length
  if (n === 0) return null
  const cols = Math.ceil(Math.sqrt(n))
  const filas: Nodo[] = []
  for (let i = 0; i < n; i += cols) filas.push(apilar(ids.slice(i, i + cols).map(hoja), 'h'))
  return apilar(filas, 'v')
}

/** Rectángulos de las hojas y geometría de los divisores. */
export function calcular(
  n: Nodo | null,
  r: Rect = { x: 0, y: 0, w: 1, h: 1 },
  hojasOut: Record<string, Rect> = {},
  divs: DivisorGeo[] = []
): { hojas: Record<string, Rect>; divisores: DivisorGeo[] } {
  if (!n) return { hojas: hojasOut, divisores: divs }
  if (n.t === 'hoja') {
    hojasOut[n.id] = r
    return { hojas: hojasOut, divisores: divs }
  }
  divs.push({ id: n.id, dir: n.dir, nodo: r, razon: n.razon })
  if (n.dir === 'h') {
    calcular(n.a, { ...r, w: r.w * n.razon }, hojasOut, divs)
    calcular(n.b, { ...r, x: r.x + r.w * n.razon, w: r.w * (1 - n.razon) }, hojasOut, divs)
  } else {
    calcular(n.a, { ...r, h: r.h * n.razon }, hojasOut, divs)
    calcular(n.b, { ...r, y: r.y + r.h * n.razon, h: r.h * (1 - n.razon) }, hojasOut, divs)
  }
  return { hojas: hojasOut, divisores: divs }
}

/** Tamaño mínimo (px) de un subárbol a lo largo de un eje. */
export function minimo(n: Nodo, eje: 'x' | 'y', m: Medidas): number {
  if (n.t === 'hoja') return eje === 'x' ? m.minAncho : m.minAlto
  const ma = minimo(n.a, eje, m)
  const mb = minimo(n.b, eje, m)
  const mismoEje = (n.dir === 'h') === (eje === 'x')
  return mismoEje ? ma + mb : Math.max(ma, mb)
}

function buscar(n: Nodo, id: number): Division | null {
  if (n.t === 'hoja') return null
  return n.id === id ? n : buscar(n.a, id) ?? buscar(n.b, id)
}

/** Nueva razón de un divisor, limitada para que ningún lado baje de su mínimo. */
export function limitarRazon(raiz: Nodo, id: number, deseada: number, tamano: number, m: Medidas): number {
  const nodo = buscar(raiz, id)
  if (!nodo || tamano <= 0) return deseada
  const eje = nodo.dir === 'h' ? 'x' : 'y'
  const minA = minimo(nodo.a, eje, m)
  const minB = minimo(nodo.b, eje, m)
  if (minA + minB >= tamano) return minA / (minA + minB) // no caben los mínimos: reparto proporcional
  return Math.min(Math.max(deseada, minA / tamano), 1 - minB / tamano)
}

/**
 * Versión "de vista" del árbol: cada razón se limita según el tamaño real en píxeles para que
 * ninguna terminal baje del mínimo (también tras encoger la ventana o comprimir un subárbol).
 * No se guarda: el árbol original conserva sus proporciones y recupera la forma al haber espacio.
 */
export function normalizar(n: Nodo, ancho: number, alto: number, m: Medidas): Nodo {
  if (n.t === 'hoja') return n
  const horizontal = n.dir === 'h'
  const tam = horizontal ? ancho : alto
  const minA = minimo(n.a, horizontal ? 'x' : 'y', m)
  const minB = minimo(n.b, horizontal ? 'x' : 'y', m)
  const razon = minA + minB >= tam ? minA / (minA + minB) : Math.min(Math.max(n.razon, minA / tam), 1 - minB / tam)
  const a = normalizar(n.a, horizontal ? ancho * razon : ancho, horizontal ? alto : alto * razon, m)
  const b = normalizar(n.b, horizontal ? ancho * (1 - razon) : ancho, horizontal ? alto : alto * (1 - razon), m)
  return a === n.a && b === n.b && razon === n.razon ? n : { ...n, razon, a, b }
}

export function conRazon(n: Nodo, id: number, razon: number): Nodo {
  if (n.t === 'hoja') return n
  if (n.id === id) return { ...n, razon }
  return { ...n, a: conRazon(n.a, id, razon), b: conRazon(n.b, id, razon) }
}

export function intercambiar(n: Nodo, x: string, y: string): Nodo {
  if (n.t === 'hoja') return n.id === x ? hoja(y) : n.id === y ? hoja(x) : n
  return { ...n, a: intercambiar(n.a, x, y), b: intercambiar(n.b, x, y) }
}

/** Hoja que contiene el punto (fracciones del lienzo). */
export function hojaEn(hojasRect: Record<string, Rect>, x: number, y: number): string | null {
  for (const [id, r] of Object.entries(hojasRect)) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id
  return null
}

/** Quita una hoja: su hermano ocupa su sitio. */
function quitar(n: Nodo, id: string): Nodo | null {
  if (n.t === 'hoja') return n.id === id ? null : n
  const a = quitar(n.a, id)
  const b = quitar(n.b, id)
  if (!a) return b
  if (!b) return a
  return a === n.a && b === n.b ? n : { ...n, a, b }
}

/** Parte en dos la hoja `objetivo` por su lado más largo (en px); la nueva queda en la segunda mitad. */
function partir(n: Nodo, objetivo: string, nuevo: string, dir: Dir): Nodo {
  if (n.t === 'hoja') return n.id === objetivo ? division(dir, 0.5, n, hoja(nuevo)) : n
  return { ...n, a: partir(n.a, objetivo, nuevo, dir), b: partir(n.b, objetivo, nuevo, dir) }
}

/**
 * Ajusta el árbol a la lista de ids. Sin personalizar se reconstruye la cuadrícula; personalizado:
 * los cerrados ceden su sitio al hermano y cada nuevo parte en dos la terminal más grande que admita
 * la división sin bajar del mínimo (si ninguna, la más grande).
 */
export function reconciliar(
  arbol: Nodo | null,
  ids: string[],
  personalizado: boolean,
  m: Medidas
): { arbol: Nodo | null; personalizado: boolean } {
  const actuales = hojas(arbol)
  const mismos = actuales.length === ids.length && ids.every((id) => actuales.includes(id))
  if (mismos) return { arbol, personalizado: personalizado && ids.length > 0 }
  if (!personalizado || !arbol) return { arbol: balanceado(ids), personalizado: false }

  let a: Nodo | null = arbol
  for (const id of actuales) if (!ids.includes(id) && a) a = quitar(a, id)
  for (const id of ids) {
    if (actuales.includes(id)) continue
    if (!a) {
      a = hoja(id)
      continue
    }
    const { hojas: rects } = calcular(a)
    const px = Object.entries(rects).map(([k, r]) => ({ k, w: r.w * m.ancho, h: r.h * m.alto }))
    px.sort((p, q) => q.w * q.h - p.w * p.h)
    const cabe = (p: { w: number; h: number }): boolean => (p.w >= p.h ? p.w >= 2 * m.minAncho : p.h >= 2 * m.minAlto)
    const elegido = px.find(cabe) ?? px[0]
    a = partir(a, elegido.k, id, elegido.w >= elegido.h ? 'h' : 'v')
  }
  return { arbol: a, personalizado: personalizado && a !== null }
}
