import { readFile, stat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

/**
 * CLAUDE.md grandes en el Asistente (suscripción), para CUALQUIER proyecto.
 *
 * El CLI carga entero cada CLAUDE.md del proyecto (y de sus carpetas padre) y lo reenvía en TODAS las llamadas al modelo: un
 * CLAUDE.md de 56 KB son ~16 k tokens por paso (en una conversación de 46 pasos, ~740 k tokens leídos solo de eso). En vez de
 * pedir a cada proyecto que lo recorte, la app excluye los que pasan del umbral (`claudeMdExcludes` en `--settings`, que el
 * CLI respeta aunque vaya con `--setting-sources project,local`; probado con el CLI real) y pone en el prompt de sistema su
 * comienzo + un índice de secciones con sus líneas. El modelo lee con `Read` (offset/limit) solo la sección que necesita.
 *
 * Los CLAUDE.md de subcarpetas no se tocan: el CLI solo los carga al trabajar en esa carpeta.
 */

/** Tamaño (caracteres) a partir del cual un CLAUDE.md se sirve por partes. `ODESK_CLAUDE_MD_MAX=0` lo desactiva. */
export const umbralClaudeMd = (env: NodeJS.ProcessEnv = process.env): number => {
  const v = env.ODESK_CLAUDE_MD_MAX?.trim()
  const n = Number(v)
  return v && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 12_000
}

/** Caracteres del comienzo del archivo que van siempre en el prompt (comandos, reglas generales: suele ser lo más usado). */
const PREAMBULO = 3_000
/** Si el índice completo pasa de esto, se queda solo con los títulos de nivel 1 y 2. */
const MAX_INDICE = 6_000
/** Sin títulos suficientes, el índice parte el archivo en tramos de estas líneas. */
const TRAMO = 120

const NOMBRES = ['CLAUDE.md', join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']

export interface PlanClaudeMd {
  /** Rutas absolutas que el CLI no debe cargar (`claudeMdExcludes`). */
  excluir: string[]
  /** Texto para el prompt de sistema con el comienzo e índice de cada excluido. Estable mientras los archivos no cambien. */
  guia: string
}

interface Titulo {
  linea: number // 1-based
  nivel: number
  texto: string
}

/** Títulos Markdown (`#`, `##`, `###`) fuera de bloques de código. */
export function titulosMarkdown(lineas: string[]): Titulo[] {
  const salida: Titulo[] = []
  let enBloque = false
  lineas.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) enBloque = !enBloque
    if (enBloque) return
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) salida.push({ linea: i + 1, nivel: m[1]!.length, texto: m[2]! })
  })
  return salida
}

const recortar = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Comienzo + índice de un CLAUDE.md grande (puro). El comienzo termina en un límite de sección si cabe en `PREAMBULO`;
 * el índice lista, desde ahí, cada sección con su rango de líneas.
 */
export function indiceClaudeMd(texto: string, ruta: string): string {
  const lineas = texto.split('\n')
  const titulos = titulosMarkdown(lineas)
  const largoHasta = (linea: number): number => lineas.slice(0, linea - 1).reduce((t, l) => t + l.length + 1, 0)

  // Comienzo: hasta el último título que empiece antes de PREAMBULO caracteres (sin cortar una sección a medias).
  let corte = 0 // nº de líneas del comienzo
  for (const t of titulos) {
    if (t.linea > 1 && largoHasta(t.linea) <= PREAMBULO) corte = t.linea - 1
  }
  let comienzo: string
  if (corte > 0) comienzo = lineas.slice(0, corte).join('\n')
  else {
    // La primera sección ya es enorme: se corta por líneas.
    let n = 0
    let total = 0
    while (n < lineas.length && total + lineas[n]!.length + 1 <= PREAMBULO) total += lineas[n++]!.length + 1
    corte = Math.max(n, 1)
    comienzo = `${lineas.slice(0, corte).join('\n')}\n[…]`
  }

  const resto = titulos.filter((t) => t.linea > corte)
  const fin = (i: number, lista: Titulo[]): number => (i + 1 < lista.length ? lista[i + 1]!.linea - 1 : lineas.length)
  let entradas: string[]
  if (resto.length >= 3) {
    entradas = resto.map((t, i) => `- ${t.linea}-${fin(i, resto)} · ${'  '.repeat(Math.max(0, t.nivel - 2))}${recortar(t.texto, 90)}`)
    if (entradas.join('\n').length > MAX_INDICE) {
      const altos = resto.filter((t) => t.nivel <= 2)
      if (altos.length >= 3) entradas = altos.map((t, i) => `- ${t.linea}-${fin(i, altos)} · ${recortar(t.texto, 90)}`)
    }
  } else {
    entradas = []
    for (let desde = corte + 1; desde <= lineas.length; desde += TRAMO) {
      const hasta = Math.min(lineas.length, desde + TRAMO - 1)
      const primera = lineas.slice(desde - 1, hasta).find((l) => l.trim()) ?? ''
      entradas.push(`- ${desde}-${hasta} · ${recortar(primera.trim(), 80)}`)
    }
  }
  // Las importaciones `@ruta` del archivo excluido ya no las expande el CLI: se nombran para que el modelo sepa que existen.
  const importa = [...new Set(lineas.filter((l) => /^@\S+/.test(l.trim())).map((l) => l.trim()))]

  return [
    `### ${ruta} (${Math.round(texto.length / 1024)} KB, ~${Math.round(texto.length / 3500)} k tokens)`,
    '<comienzo>',
    comienzo.trim(),
    '</comienzo>',
    `Índice del resto (líneas · sección):`,
    ...entradas,
    ...(importa.length ? [`Importa (léelos si hacen falta): ${importa.join(', ')}`] : [])
  ].join('\n')
}

const ENCABEZADO = [
  '## Instrucciones del proyecto (CLAUDE.md por partes)',
  'Estos CLAUDE.md son grandes y no se cargan enteros en cada llamada para ahorrar contexto. Valen igual que si estuvieran completos.',
  'Aquí va su comienzo y el índice del resto. Antes de tocar código de un área, lee con Read (offset = línea inicial, limit = nº de líneas) la sección que le corresponde. Hazlo una sola vez por conversación. Para preguntas que no tocan código no hace falta.'
].join('\n')

/** CLAUDE.md que el CLI cargaría para `cwd`: los de la carpeta y los de cada carpeta padre. */
function candidatos(cwd: string): string[] {
  const salida: string[] = []
  let dir = cwd
  const raiz = parse(cwd).root
  for (;;) {
    for (const n of NOMBRES) salida.push(join(dir, n))
    if (dir === raiz) break
    const padre = dirname(dir)
    if (padre === dir) break
    dir = padre
  }
  return salida
}

const cache = new Map<string, { mtime: number; size: number; indice: string }>()

/** Decide qué CLAUDE.md excluir para `cwd` y arma su guía. Nunca lanza: ante cualquier fallo, sin cambios. */
export async function planClaudeMd(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<PlanClaudeMd> {
  const umbral = umbralClaudeMd(env)
  if (!umbral) return { excluir: [], guia: '' }
  const excluir: string[] = []
  const partes: string[] = []
  for (const ruta of candidatos(cwd)) {
    try {
      const s = await stat(ruta)
      if (!s.isFile() || s.size <= umbral) continue
      let c = cache.get(ruta)
      if (!c || c.mtime !== s.mtimeMs || c.size !== s.size) {
        const texto = await readFile(ruta, 'utf8')
        if (texto.length <= umbral) continue // bytes ≠ caracteres (acentos)
        c = { mtime: s.mtimeMs, size: s.size, indice: indiceClaudeMd(texto, ruta) }
        cache.set(ruta, c)
      }
      excluir.push(ruta)
      partes.push(c.indice)
    } catch {
      // no existe o no se puede leer: el CLI tampoco lo cargará
    }
  }
  return { excluir, guia: partes.length ? [ENCABEZADO, ...partes].join('\n\n') : '' }
}
