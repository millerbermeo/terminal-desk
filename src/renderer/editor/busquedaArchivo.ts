import type { EditorState } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'

/** Opciones del buscador dentro del archivo (las mismas que el de VS Code). */
export interface OpcionesBusqueda {
  texto: string
  reemplazo: string
  mayusculas: boolean
  palabra: boolean
  regex: boolean
}

/** A partir de este número de coincidencias se deja de contar (el contador muestra «10000+»). */
export const MAX_COINCIDENCIAS = 10_000

export const consultaDe = (o: OpcionesBusqueda): SearchQuery =>
  new SearchQuery({ search: o.texto, replace: o.reemplazo, caseSensitive: o.mayusculas, wholeWord: o.palabra, regexp: o.regex })

/**
 * Cuántas coincidencias hay y cuál es la seleccionada (1-based; 0 si la selección no es una coincidencia).
 * `valida` es false con una expresión regular mal escrita.
 */
export function contarCoincidencias(state: EditorState, q: SearchQuery): { total: number; actual: number; valida: boolean; tope: boolean } {
  if (!q.search) return { total: 0, actual: 0, valida: true, tope: false }
  if (!q.valid) return { total: 0, actual: 0, valida: false, tope: false }
  const sel = state.selection.main
  const cursor = q.getCursor(state)
  let total = 0
  let actual = 0
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++
    if (r.value.from === sel.from && r.value.to === sel.to) actual = total
    if (total >= MAX_COINCIDENCIAS) return { total, actual, valida: true, tope: true }
  }
  return { total, actual, valida: true, tope: false }
}

/** La primera coincidencia desde `desde` (y si no hay, desde el principio): así se salta a ella mientras se escribe. */
export function coincidenciaDesde(state: EditorState, q: SearchQuery, desde: number): { from: number; to: number } | undefined {
  if (!q.search || !q.valid) return undefined
  const tras = q.getCursor(state, desde).next()
  const m = tras.done ? q.getCursor(state).next() : tras
  return m.done ? undefined : { from: m.value.from, to: m.value.to }
}

/** Texto de la selección para sembrar el buscador al abrirlo (solo si es de una línea, como en VS Code). */
export function semillaDeSeleccion(state: EditorState): string | undefined {
  const sel = state.selection.main
  if (sel.empty) return undefined
  const texto = state.sliceDoc(sel.from, sel.to)
  return texto.includes('\n') || texto.length > 200 ? undefined : texto
}
