export interface Coincidencia {
  ruta: string
  puntos: number
  /** Posiciones de `ruta` que coinciden con lo escrito (para resaltarlas). */
  posiciones: number[]
}

const SEPARADORES = new Set(['/', '.', '-', '_', ' '])

/**
 * Coincidencia difusa de «Ir al archivo»: las letras escritas deben aparecer en orden en la ruta.
 * Puntúa más cuando son seguidas, empiezan una palabra o caen en el nombre del archivo y no en las carpetas.
 */
export function coincidir(ruta: string, consulta: string): Coincidencia | null {
  const q = consulta.toLowerCase().replace(/\s+/g, '')
  if (!q) return null
  const r = ruta.toLowerCase()
  const inicioNombre = ruta.lastIndexOf('/') + 1

  // Una subcadena exacta (mejor si está en el nombre) gana siempre a una coincidencia dispersa.
  const enNombreIdx = r.indexOf(q, inicioNombre)
  const dentro = enNombreIdx >= 0 ? enNombreIdx : r.indexOf(q)
  if (dentro >= 0) {
    const enNombre = dentro >= inicioNombre
    const alInicio = dentro === inicioNombre || SEPARADORES.has(ruta[dentro - 1] ?? '/')
    return { ruta, puntos: 1000 + (enNombre ? 400 : 0) + (alInicio ? 200 : 0) - ruta.length, posiciones: Array.from({ length: q.length }, (_, i) => dentro + i) }
  }

  const posiciones: number[] = []
  let puntos = 0
  let desde = 0
  let previa = -2
  for (const ch of q) {
    const i = r.indexOf(ch, desde)
    if (i < 0) return null
    posiciones.push(i)
    puntos += i === previa + 1 ? 15 : 1
    if (i === 0 || SEPARADORES.has(ruta[i - 1]!)) puntos += 10
    if (i >= inicioNombre) puntos += 3
    previa = i
    desde = i + 1
  }
  return { ruta, puntos: puntos - ruta.length / 10, posiciones }
}

/** Mejores coincidencias, de más a menos relevante (a igualdad, la ruta más corta y luego el orden alfabético). */
export function buscarArchivos(rutas: readonly string[], consulta: string, limite = 100): Coincidencia[] {
  const encontradas: Coincidencia[] = []
  for (const ruta of rutas) {
    const c = coincidir(ruta, consulta)
    if (c) encontradas.push(c)
  }
  return encontradas.sort((a, b) => b.puntos - a.puntos || a.ruta.length - b.ruta.length || a.ruta.localeCompare(b.ruta)).slice(0, limite)
}
