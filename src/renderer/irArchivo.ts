import type { ResultadoDiff } from '@shared/diff'

/**
 * «Ir a la línea» desde el historial local: abre el proyecto en su panel de archivos con el cursor en una línea.
 * Quien lo pide deja aquí el destino y avisa con un evento; `App` muestra la celda de archivos del proyecto y el
 * `PanelArchivos` visible de ese proyecto lo recoge (una sola vez) al hacerse visible o al recibir el aviso.
 */
export interface DestinoArchivo {
  proyectoId: string
  /** Ruta relativa a la carpeta del proyecto. */
  ruta: string
  /** Línea desde 1. */
  linea: number
}

export const EVENTO_IR_A_ARCHIVO = 'odesk:ir-a-archivo'

let pendiente: DestinoArchivo | null = null

export function pedirIrAArchivo(d: DestinoArchivo): void {
  pendiente = d
  window.dispatchEvent(new CustomEvent<DestinoArchivo>(EVENTO_IR_A_ARCHIVO, { detail: d }))
}

/** Devuelve (y olvida) el destino pendiente si es de ese proyecto. */
export function tomarIrAArchivo(proyectoId: string): DestinoArchivo | null {
  if (!pendiente || pendiente.proyectoId !== proyectoId) return null
  const d = pendiente
  pendiente = null
  return d
}

/**
 * Traduce una línea del texto de origen (`a`) de un diff a la línea equivalente del de destino (`b`).
 * Fuera de los bloques se desplaza lo que sumaron o restaron los bloques anteriores; dentro de uno, la línea
 * igual o agregada más cercana (una línea quitada ya no existe en el destino).
 */
export function lineaEnDestino(diff: ResultadoDiff, linea: number): number {
  let delta = 0
  for (const b of diff.bloques) {
    const enA = b.lineas.filter((l) => l.tipo !== 'agregada').length
    const enB = b.lineas.filter((l) => l.tipo !== 'quitada').length
    if (linea < b.aInicio) break
    if (linea < b.aInicio + enA) {
      let ultimaB = b.bInicio
      for (const l of b.lineas) {
        if (l.b !== undefined) ultimaB = l.b
        if (l.a === linea) return l.b ?? ultimaB
      }
      return ultimaB
    }
    delta = b.bInicio + enB - (b.aInicio + enA)
  }
  return Math.max(1, linea + delta)
}
