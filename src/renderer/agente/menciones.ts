import { buscarArchivos } from '../editor/busqueda'

export interface Mencion {
  /** Posición del «@» en el texto. */
  inicio: number
  /** Lo escrito después del «@» hasta el cursor. */
  consulta: string
}

export interface OpcionMencion {
  ruta: string // sin «/» final; las carpetas se reconocen por `carpeta`
  carpeta: boolean
  posiciones: number[]
}

const MAX_OPCIONES = 30

/** ¿El cursor está escribiendo una mención («@ruta»)? Solo cuenta un «@» al inicio o tras un espacio. */
export function detectarMencion(texto: string, cursor: number): Mencion | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(texto.slice(0, cursor))
  return m ? { inicio: cursor - m[2]!.length - 1, consulta: m[2]! } : null
}

/** Sustituye la mención por la ruta elegida. Un archivo cierra con un espacio; una carpeta termina en «/» para seguir bajando. */
export function aplicarMencion(texto: string, cursor: number, mencion: Mencion, ruta: string, carpeta: boolean): { texto: string; cursor: number } {
  const insertado = carpeta ? `@${ruta}/` : `@${ruta} `
  const resto = texto.slice(cursor)
  const nuevo = texto.slice(0, mencion.inicio) + insertado + (carpeta || !resto.startsWith(' ') ? resto : resto.slice(1))
  return { texto: nuevo, cursor: mencion.inicio + insertado.length }
}

/** Carpetas que contienen alguna de las rutas (cada una una sola vez). */
function carpetasDe(rutas: readonly string[]): string[] {
  const s = new Set<string>()
  for (const r of rutas) {
    const partes = r.split('/').slice(0, -1)
    for (let i = 1; i <= partes.length; i++) s.add(partes.slice(0, i).join('/'))
  }
  return [...s]
}

/**
 * Opciones del menú «@»: archivos y carpetas del proyecto que coinciden con lo escrito. Sin nada escrito, lo más cercano a la raíz.
 * `archivos` son rutas de archivos (como las da `archivos.listarTodos`).
 */
export function opcionesMencion(archivos: readonly string[], consulta: string): OpcionMencion[] {
  const carpetas = carpetasDe(archivos)
  const todas = [...carpetas.map((c) => c + '/'), ...archivos]
  if (!consulta) {
    return todas
      .map((r) => ({ r, nivel: r.replace(/\/$/, '').split('/').length }))
      .sort((a, b) => a.nivel - b.nivel || Number(b.r.endsWith('/')) - Number(a.r.endsWith('/')) || a.r.localeCompare(b.r))
      .slice(0, MAX_OPCIONES)
      .map(({ r }) => ({ ruta: r.replace(/\/$/, ''), carpeta: r.endsWith('/'), posiciones: [] }))
  }
  return buscarArchivos(todas, consulta, MAX_OPCIONES).map((c) => ({ ruta: c.ruta.replace(/\/$/, ''), carpeta: c.ruta.endsWith('/'), posiciones: c.posiciones }))
}
