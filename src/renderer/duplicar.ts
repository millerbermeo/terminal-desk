/** Tipos de contenido que una celda puede tener y duplicarse: una terminal, un asistente o el panel de archivos. */
export type TipoCelda = 'terminal' | 'asistente' | 'archivos'

/** Máximo de celdas del mismo proyecto y tipo, y máximo de celdas por pestaña (para que la interfaz y los procesos sigan fluidos). */
export const MAX_POR_TIPO = 3
export const MAX_CELDAS = 12

export interface CeldaMinima {
  id: string
  proyectoId?: string
  vista?: TipoCelda
}

export const tipoDe = (c: CeldaMinima): TipoCelda => c.vista ?? 'terminal'

export interface PermisoDuplicar {
  ok: boolean
  /** Cuántas hay ya de ese tipo en ese proyecto. */
  usadas: number
  max: number
  /** Por qué no, si no se puede. */
  motivo?: string
}

const NOMBRE: Record<TipoCelda, string> = { terminal: 'terminales', asistente: 'asistentes', archivos: 'paneles de archivos' }

/** ¿Se puede añadir otra celda de `tipo` para el proyecto de `origen`? Cuenta las de su pestaña (`celdas`). */
export function puedeDuplicar(celdas: readonly CeldaMinima[], origen: CeldaMinima, tipo: TipoCelda): PermisoDuplicar {
  if (!origen.proyectoId) return { ok: false, usadas: 0, max: MAX_POR_TIPO, motivo: 'Solo se pueden duplicar celdas de un proyecto.' }
  const usadas = celdas.filter((c) => c.proyectoId === origen.proyectoId && tipoDe(c) === tipo).length
  if (celdas.length >= MAX_CELDAS) return { ok: false, usadas, max: MAX_POR_TIPO, motivo: `Esta pestaña ya tiene ${MAX_CELDAS} celdas (el máximo). Cierra alguna para abrir otra.` }
  if (usadas >= MAX_POR_TIPO) return { ok: false, usadas, max: MAX_POR_TIPO, motivo: `Máximo ${MAX_POR_TIPO} ${NOMBRE[tipo]} de este proyecto.` }
  return { ok: true, usadas, max: MAX_POR_TIPO }
}

/** Título de la celda nueva: nombre del proyecto + el tipo, sin repetir uno ya usado. */
export function tituloDuplicado(proyecto: string, tipo: TipoCelda, usados: readonly string[]): string {
  const base = tipo === 'terminal' ? proyecto : `${proyecto} · ${tipo === 'asistente' ? 'Asistente' : 'Archivos'}`
  const ocupados = new Set(usados)
  if (!ocupados.has(base)) return base
  for (let n = 2; ; n++) if (!ocupados.has(`${base} · ${n}`)) return `${base} · ${n}`
}
