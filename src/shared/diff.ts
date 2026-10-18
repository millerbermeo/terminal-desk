/**
 * Diff de líneas (Myers) sin dependencias: distingue líneas agregadas, quitadas y modificadas, agrupa los cambios en bloques con contexto y
 * permite aplicar solo algunos bloques (restaurar cambios concretos). La comparten main, renderer y pruebas.
 */

export interface LineaDiff {
  tipo: 'igual' | 'agregada' | 'quitada'
  texto: string
  /** Número de línea (desde 1) en el texto de origen / de destino. */
  a?: number
  b?: number
  /** Una línea quitada y otra agregada en el mismo punto son una modificación: ambas llevan la marca. */
  modificada?: boolean
}

export interface BloqueDiff {
  /** Posición del bloque (0, 1, 2…): es lo que se pasa a `aplicarBloques`. */
  id: number
  /** Primera línea del bloque en origen y en destino (desde 1). */
  aInicio: number
  bInicio: number
  lineas: LineaDiff[]
  agregadas: number
  quitadas: number
  modificadas: number
}

export interface ResultadoDiff {
  bloques: BloqueDiff[]
  agregadas: number
  quitadas: number
  modificadas: number
  /** No hay ninguna diferencia. */
  iguales: boolean
  /** El texto era tan distinto o tan grande que se comparó por bloques enteros (sin detalle línea a línea). */
  aproximado: boolean
}

type Op = '=' | '+' | '-'

/** Con más cambios que esto no se calcula el diff exacto (la memoria crece con el cuadrado). */
const MAX_D = 1500
const MAX_LINEAS_TOTALES = 60_000

export const lineasDe = (texto: string): string[] => texto.split('\n')

/** Mínima secuencia de ediciones entre dos listas de líneas, o `null` si hay demasiadas diferencias. */
function secuencia(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  if (n === 0) return Array<Op>(m).fill('+')
  if (m === 0) return Array<Op>(n).fill('-')
  const max = Math.min(n + m, MAX_D)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const traza: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    traza.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        const ops: Op[] = []
        let cx = n
        let cy = m
        for (let dd = d; dd > 0; dd--) {
          const prev = traza[dd]!
          const kk = cx - cy
          const prevK = kk === -dd || (kk !== dd && prev[off + kk - 1]! < prev[off + kk + 1]!) ? kk + 1 : kk - 1
          const px = prev[off + prevK]!
          const py = px - prevK
          while (cx > px && cy > py) {
            ops.push('=')
            cx--
            cy--
          }
          ops.push(cx === px ? '+' : '-')
          cx = px
          cy = py
        }
        while (cx > 0 && cy > 0) {
          ops.push('=')
          cx--
          cy--
        }
        return ops.reverse()
      }
    }
  }
  return null
}

interface Analisis {
  lineas: LineaDiff[]
  aproximado: boolean
}

/** Compara dos textos línea a línea: quita el principio y el final comunes (lo habitual) y calcula el resto. */
function analizar(a: string[], b: string[]): Analisis {
  let ini = 0
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++
  let finA = a.length
  let finB = b.length
  while (finA > ini && finB > ini && a[finA - 1] === b[finB - 1]) {
    finA--
    finB--
  }
  const medioA = a.slice(ini, finA)
  const medioB = b.slice(ini, finB)
  let ops: Op[] | null = null
  let aproximado = false
  if (medioA.length + medioB.length <= MAX_LINEAS_TOTALES) ops = secuencia(medioA, medioB)
  if (!ops) {
    aproximado = true
    ops = [...Array<Op>(medioA.length).fill('-'), ...Array<Op>(medioB.length).fill('+')]
  }
  const lineas: LineaDiff[] = []
  for (let i = 0; i < ini; i++) lineas.push({ tipo: 'igual', texto: a[i]!, a: i + 1, b: i + 1 })
  let ia = 0
  let ib = 0
  for (const op of ops) {
    if (op === '=') {
      lineas.push({ tipo: 'igual', texto: medioA[ia]!, a: ini + ia + 1, b: ini + ib + 1 })
      ia++
      ib++
    } else if (op === '-') {
      lineas.push({ tipo: 'quitada', texto: medioA[ia]!, a: ini + ia + 1 })
      ia++
    } else {
      lineas.push({ tipo: 'agregada', texto: medioB[ib]!, b: ini + ib + 1 })
      ib++
    }
  }
  for (let i = finA; i < a.length; i++) lineas.push({ tipo: 'igual', texto: a[i]!, a: i + 1, b: finB + (i - finA) + 1 })
  return { lineas, aproximado }
}

/** Marca como modificadas las quitadas y agregadas que quedan juntas (la i-ésima quitada con la i-ésima agregada). */
function marcarModificadas(lineas: LineaDiff[]): { agregadas: number; quitadas: number; modificadas: number } {
  let agregadas = 0
  let quitadas = 0
  let modificadas = 0
  for (let i = 0; i < lineas.length; ) {
    if (lineas[i]!.tipo === 'igual') {
      i++
      continue
    }
    let j = i
    while (j < lineas.length && lineas[j]!.tipo !== 'igual') j++
    const q = lineas.slice(i, j).filter((l) => l.tipo === 'quitada')
    const g = lineas.slice(i, j).filter((l) => l.tipo === 'agregada')
    const par = Math.min(q.length, g.length)
    for (let k = 0; k < par; k++) {
      q[k]!.modificada = true
      g[k]!.modificada = true
    }
    modificadas += par
    quitadas += q.length - par
    agregadas += g.length - par
    i = j
  }
  return { agregadas, quitadas, modificadas }
}

/** Rangos `[desde, hasta)` de las líneas del análisis que forman cada bloque: cambios más `contexto` líneas a cada lado, unidos si se tocan. */
function rangosDeBloques(lineas: LineaDiff[], contexto: number): [number, number][] {
  const rangos: [number, number][] = []
  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i]!.tipo === 'igual') continue
    const desde = Math.max(0, i - contexto)
    let hasta = i
    while (hasta < lineas.length && lineas[hasta]!.tipo !== 'igual') hasta++
    const fin = Math.min(lineas.length, hasta + contexto)
    const ultimo = rangos.at(-1)
    if (ultimo && desde <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fin)
    else rangos.push([desde, fin])
    i = hasta - 1
  }
  return rangos
}

/** Diferencias de `a` a `b` agrupadas en bloques con contexto. */
export function compararTextos(a: string, b: string, contexto = 3): ResultadoDiff {
  if (a === b) return { bloques: [], agregadas: 0, quitadas: 0, modificadas: 0, iguales: true, aproximado: false }
  const { lineas, aproximado } = analizar(lineasDe(a), lineasDe(b))
  const totales = marcarModificadas(lineas)
  const bloques = rangosDeBloques(lineas, contexto).map<BloqueDiff>(([desde, hasta], id) => {
    const l = lineas.slice(desde, hasta)
    const cambios = l.filter((x) => x.tipo !== 'igual')
    const modificadas = cambios.filter((x) => x.modificada && x.tipo === 'agregada').length
    return {
      id,
      aInicio: l.find((x) => x.a !== undefined)?.a ?? 1,
      bInicio: l.find((x) => x.b !== undefined)?.b ?? 1,
      lineas: l,
      agregadas: cambios.filter((x) => x.tipo === 'agregada').length - modificadas,
      quitadas: cambios.filter((x) => x.tipo === 'quitada').length - modificadas,
      modificadas
    }
  })
  return { bloques, ...totales, iguales: false, aproximado }
}

/**
 * Convierte `actual` en `destino` solo en los bloques elegidos (los números de `compararTextos(actual, destino)`); el resto queda como en
 * `actual`. Con todos los bloques da exactamente `destino`.
 */
export function aplicarBloques(actual: string, destino: string, elegidos: readonly number[]): string {
  if (actual === destino) return actual
  const { lineas } = analizar(lineasDe(actual), lineasDe(destino))
  const rangos = rangosDeBloques(lineas, 3)
  const elegido = new Set<number>()
  for (const id of elegidos) {
    const r = rangos[id]
    if (r) for (let i = r[0]; i < r[1]; i++) elegido.add(i)
  }
  const salida: string[] = []
  lineas.forEach((l, i) => {
    if (l.tipo === 'igual') salida.push(l.texto)
    else if (l.tipo === 'agregada') {
      if (elegido.has(i)) salida.push(l.texto)
    } else if (!elegido.has(i)) salida.push(l.texto)
  })
  return salida.join('\n')
}
