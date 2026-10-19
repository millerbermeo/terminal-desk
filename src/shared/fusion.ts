/**
 * Fusión a tres bandas (como el editor de fusión de PhpStorm): la base común, «mi» rama (la actual, donde se integra) y la rama de origen
 * (con los cambios que se quieren traer). Lógica pura que comparten main (cuenta conflictos), renderer (editor) y pruebas.
 */
import { cambiosDeLineas, lineasDe, type CambioLineas } from './diff'

export type OrigenTrozo = 'actual' | 'origen' | 'ambos'

export type Trozo =
  /** Líneas que no cambió nadie. */
  | { tipo: 'comun'; lineas: string[] }
  /** Cambio que git podría fusionar solo: lo hizo una sola rama (o las dos igual). */
  | { tipo: 'auto'; de: OrigenTrozo; base: string[]; actual: string[]; origen: string[] }
  /** Las dos ramas cambiaron lo mismo de forma distinta: hay que elegir. */
  | { tipo: 'conflicto'; base: string[]; actual: string[]; origen: string[] }

/** Cómo se resuelve un trozo que no es común. `texto` = editado a mano. */
export type Decision = 'actual' | 'origen' | 'actual-origen' | 'origen-actual' | 'base' | { texto: string }

const aplicar = (base: string[], desde: number, hasta: number, cambios: CambioLineas[]): string[] => {
  const salida: string[] = []
  let pos = desde
  for (const c of cambios) {
    salida.push(...base.slice(pos, c.desde), ...c.nuevas)
    pos = c.hasta
  }
  salida.push(...base.slice(pos, hasta))
  return salida
}

const iguales = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Divide la fusión en trozos. Dos cambios que se tocan (se solapan o son contiguos) forman un solo trozo; si solo cambió una rama, o las
 * dos hicieron lo mismo, es `auto`; si no, `conflicto` (igual que git).
 */
export function fusion3(base: string, actual: string, origen: string): Trozo[] {
  const b = lineasDe(base)
  const hA = cambiosDeLineas(b, lineasDe(actual))
  const hO = cambiosDeLineas(b, lineasDe(origen))
  const todos = [...hA.map((h) => ({ h, lado: 'actual' as const })), ...hO.map((h) => ({ h, lado: 'origen' as const }))].sort((x, y) => x.h.desde - y.h.desde || x.h.hasta - y.h.hasta)

  const trozos: Trozo[] = []
  let pos = 0
  for (let i = 0; i < todos.length; ) {
    const ini = todos[i]!.h.desde
    let fin = todos[i]!.h.hasta
    let j = i
    while (j < todos.length && todos[j]!.h.desde <= fin) fin = Math.max(fin, todos[j++]!.h.hasta)
    const grupo = todos.slice(i, j)
    const delActual = grupo.filter((x) => x.lado === 'actual').map((x) => x.h)
    const delOrigen = grupo.filter((x) => x.lado === 'origen').map((x) => x.h)
    if (ini > pos) trozos.push({ tipo: 'comun', lineas: b.slice(pos, ini) })
    const baseG = b.slice(ini, fin)
    const lA = aplicar(b, ini, fin, delActual)
    const lO = aplicar(b, ini, fin, delOrigen)
    if (delOrigen.length === 0) trozos.push({ tipo: 'auto', de: 'actual', base: baseG, actual: lA, origen: lO })
    else if (delActual.length === 0) trozos.push({ tipo: 'auto', de: 'origen', base: baseG, actual: lA, origen: lO })
    else if (iguales(lA, lO)) trozos.push({ tipo: 'auto', de: 'ambos', base: baseG, actual: lA, origen: lO })
    else trozos.push({ tipo: 'conflicto', base: baseG, actual: lA, origen: lO })
    pos = fin
    i = j
  }
  if (pos < b.length || trozos.length === 0) trozos.push({ tipo: 'comun', lineas: b.slice(pos) })
  return trozos
}

/** Decisión por defecto de un trozo: lo que git fusionaría solo; un conflicto no tiene ninguna hasta que se elige. */
export function decisionAuto(t: Trozo): Decision | undefined {
  if (t.tipo !== 'auto') return undefined
  return t.de === 'origen' ? 'origen' : 'actual' // «actual» ya incluye lo que hicieron las dos ramas iguales
}

/** Líneas que produce una decisión sobre un trozo. */
export function lineasDeDecision(t: Exclude<Trozo, { tipo: 'comun' }>, d: Decision): string[] {
  if (typeof d === 'object') return lineasDe(d.texto)
  switch (d) {
    case 'actual':
      return t.actual
    case 'origen':
      return t.origen
    case 'base':
      return t.base
    case 'actual-origen':
      return [...t.actual, ...t.origen]
    case 'origen-actual':
      return [...t.origen, ...t.actual]
  }
}

/** Texto resultante; con `null` en un conflicto sin resolver se deja el trozo de «mi» rama. */
export function textoFusionado(trozos: readonly Trozo[], decisiones: ReadonlyMap<number, Decision> | Record<number, Decision | undefined>): string {
  const dec = (i: number): Decision | undefined => (decisiones instanceof Map ? decisiones.get(i) : (decisiones as Record<number, Decision | undefined>)[i])
  const salida: string[] = []
  trozos.forEach((t, i) => {
    if (t.tipo === 'comun') salida.push(...t.lineas)
    else salida.push(...lineasDeDecision(t, dec(i) ?? decisionAuto(t) ?? 'actual'))
  })
  return salida.join('\n')
}

/** Cantidad de conflictos de una fusión. */
export const contarConflictos = (trozos: readonly Trozo[]): number => trozos.filter((t) => t.tipo === 'conflicto').length

// ------------------------------------------------------------------ contrato con main

export type EstadoArchivoFusion = 'origen' | 'ambos' | 'conflicto'

export interface ArchivoFusion {
  ruta: string
  /** `origen`: solo cambió la rama de origen (se integra sin más) · `ambos`: cambiaron las dos pero se fusionan solas · `conflicto`. */
  estado: EstadoArchivoFusion
  /** Estado en cada lado respecto a la base: A añadido, M modificado, D borrado. */
  enOrigen: string
  enActual: string
  conflictos: number
  /** No se puede mostrar como texto (binario o enorme): solo se elige una versión entera. */
  noTexto?: boolean
}

export interface PrevisualizacionFusion {
  actual: string
  origen: string
  base: string
  /** Commits de la rama de origen que no están en la actual. */
  commits: number
  archivos: ArchivoFusion[]
  /** Hay más archivos que los mostrados. */
  truncado: boolean
}

export interface DatosArchivoFusion {
  ruta: string
  base: string
  actual: string
  origen: string
  existe: { base: boolean; actual: boolean; origen: boolean }
}

export type ResolucionFusion = { tipo: 'texto'; texto: string } | { tipo: 'actual' } | { tipo: 'origen' }
