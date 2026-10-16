import type { EntradaMemoria } from '@shared/core/memoria'

const PARADA = new Set(
  'a al algo con de del el ella en es esta este esto la las lo los muy no o para por que se si sin su sus un una unos unas y ya the and for with'.split(' ')
)

/** Minúsculas, sin acentos, sin palabras vacías y con plural recortado. */
export function tokenizar(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !PARADA.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

export interface Resultado {
  entrada: EntradaMemoria
  puntaje: number
}

/**
 * Búsqueda léxica BM25 (sin embeddings: funciona offline y sin dependencias).
 * Interfaz `buscar(consulta, entradas, k)` pensada para poder sustituirla por una vectorial.
 */
export function buscar(consulta: string, entradas: readonly EntradaMemoria[], k: number): Resultado[] {
  const q = [...new Set(tokenizar(consulta))]
  if (q.length === 0 || entradas.length === 0) return []
  const docs = entradas.map((e) => ({
    e,
    // El título y las etiquetas pesan más: se repiten.
    t: tokenizar(`${e.titulo} ${e.titulo} ${e.etiquetas.join(' ')} ${e.etiquetas.join(' ')} ${e.contenido}`)
  }))
  const media = docs.reduce((s, d) => s + d.t.length, 0) / docs.length || 1
  const K1 = 1.5
  const B = 0.75
  const puntuados = docs.map(({ e, t }) => {
    const frec = new Map<string, number>()
    for (const x of t) frec.set(x, (frec.get(x) ?? 0) + 1)
    let puntaje = 0
    for (const termino of q) {
      const f = frec.get(termino) ?? 0
      if (!f) continue
      const n = docs.filter((d) => d.t.includes(termino)).length
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      puntaje += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * t.length) / media))
    }
    return { entrada: e, puntaje }
  })
  return puntuados.filter((r) => r.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje).slice(0, k)
}
