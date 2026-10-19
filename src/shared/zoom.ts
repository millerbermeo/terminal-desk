/** Zoom de la interfaz con Ctrl +, Ctrl − y Ctrl 0 (como VS Code). Lógica pura: la usan main (teclas y nivel) y las pruebas. */

export type AccionZoom = 'acercar' | 'alejar' | 'restablecer'

export interface EstadoZoom {
  /** Nivel de zoom de Chromium (0 = 100 %; cada paso multiplica por 1,2). */
  nivel: number
  porcentaje: number
}

export const ZOOM_MIN = -4
export const ZOOM_MAX = 6
const PASO = 0.5

export const porcentajeDe = (nivel: number): number => Math.round(Math.pow(1.2, nivel) * 100)

export function nivelSiguiente(nivel: number, accion: AccionZoom): number {
  if (accion === 'restablecer') return 0
  const n = Math.round((nivel + (accion === 'acercar' ? PASO : -PASO)) / PASO) * PASO
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n))
}

export const estadoDe = (nivel: number): EstadoZoom => ({ nivel, porcentaje: porcentajeDe(nivel) })

/** Qué hace una pulsación (solo Ctrl/Cmd + tecla; sin Alt). `undefined` si no es del zoom. */
export function accionDeTecla(t: { type: string; key: string; control?: boolean; meta?: boolean; alt?: boolean }): AccionZoom | undefined {
  if (t.type !== 'keyDown' || (!t.control && !t.meta) || t.alt) return undefined
  if (t.key === '+' || t.key === '=') return 'acercar'
  if (t.key === '-' || t.key === '_') return 'alejar'
  if (t.key === '0') return 'restablecer'
  return undefined
}
