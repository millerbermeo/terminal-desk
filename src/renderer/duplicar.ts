import type { PestanaExtra, TipoCelda } from '@shared/ipc'

export type { PestanaExtra, TipoCelda }

/**
 * Cada celda de un proyecto tiene una pestaña de cada tipo (terminal, asistente, archivos) y se pueden **duplicar** hasta 3 veces cada
 * una: 4 por tipo, 12 pestañas como máximo por celda. Las duplicadas son pestañas extra dentro de la misma celda, cada una con su propio
 * proceso (terminal), su propia conversación (asistente) o su propio árbol y editor (archivos).
 */
export const MAX_DUPLICADOS = 3
export const MAX_POR_TIPO = 1 + MAX_DUPLICADOS
export const MAX_PESTANAS = 3 * MAX_POR_TIPO

export const TIPOS: readonly TipoCelda[] = ['terminal', 'asistente', 'archivos']
const NOMBRE: Record<TipoCelda, string> = { terminal: 'Terminal', asistente: 'Asistente', archivos: 'Archivos' }
const PLURAL: Record<TipoCelda, string> = { terminal: 'terminales', asistente: 'asistentes', archivos: 'paneles de archivos' }

export const tituloPestana = (tipo: TipoCelda, n: number): string => (n > 1 ? `${NOMBRE[tipo]} ${n}` : NOMBRE[tipo])

export interface CeldaPestanas {
  id: string
  /** Tipo que se está mostrando (la pestaña original de ese tipo, o la duplicada `extraActiva`). */
  vista?: TipoCelda
  extras?: PestanaExtra[]
  /** Id de la pestaña duplicada a la vista; sin él se ve la original de `vista`. */
  extraActiva?: string
}

export interface PermisoDuplicar {
  ok: boolean
  /** Cuántas pestañas de ese tipo hay ya (con la original). */
  usadas: number
  max: number
  motivo?: string
}

export function puedeDuplicar(extras: readonly PestanaExtra[] | undefined, tipo: TipoCelda): PermisoDuplicar {
  const usadas = 1 + (extras ?? []).filter((x) => x.tipo === tipo).length
  if (usadas >= MAX_POR_TIPO) return { ok: false, usadas, max: MAX_POR_TIPO, motivo: `Máximo ${MAX_POR_TIPO} ${PLURAL[tipo]} por celda (la original y ${MAX_DUPLICADOS} duplicadas).` }
  return { ok: true, usadas, max: MAX_POR_TIPO }
}

/** Menor número libre (2, 3, 4) para una pestaña nueva de ese tipo: al cerrar una se reutiliza su número. */
export function siguienteNumero(extras: readonly PestanaExtra[] | undefined, tipo: TipoCelda): number {
  const usados = new Set((extras ?? []).filter((x) => x.tipo === tipo).map((x) => x.n))
  for (let n = 2; ; n++) if (!usados.has(n)) return n
}

export type OperacionPestana =
  | { t: 'agregar'; tipo: TipoCelda }
  | { t: 'cerrar'; id: string }
  | { t: 'activar'; id: string }
  | { t: 'pty'; id: string; ptyId: string }

/** Aplica una operación sobre las pestañas de una celda (función pura: no toca nada más de la celda). */
export function reducirPestanas<T extends CeldaPestanas>(c: T, op: OperacionPestana): T {
  const extras = c.extras ?? []
  switch (op.t) {
    case 'agregar': {
      if (!puedeDuplicar(extras, op.tipo).ok) return c
      const n = siguienteNumero(extras, op.tipo)
      const nueva: PestanaExtra = { id: `${c.id}~${op.tipo}${n}`, tipo: op.tipo, n }
      return { ...c, extras: [...extras, nueva], vista: op.tipo, extraActiva: nueva.id }
    }
    case 'cerrar': {
      const x = extras.find((e) => e.id === op.id)
      if (!x) return c
      const resto = extras.filter((e) => e.id !== op.id)
      return { ...c, extras: resto, ...(c.extraActiva === op.id ? { vista: x.tipo, extraActiva: undefined } : {}) }
    }
    case 'activar': {
      const x = extras.find((e) => e.id === op.id)
      return x ? { ...c, vista: x.tipo, extraActiva: x.id } : c
    }
    case 'pty':
      return extras.some((e) => e.id === op.id) ? { ...c, extras: extras.map((e) => (e.id === op.id ? { ...e, ptyId: op.ptyId } : e)) } : c
  }
}

/** Las extras de un tipo, de la más antigua numeración a la más nueva (así se muestran junto a la original). */
export const extrasDe = (extras: readonly PestanaExtra[] | undefined, tipo: TipoCelda): PestanaExtra[] => (extras ?? []).filter((x) => x.tipo === tipo).sort((a, b) => a.n - b.n)

/** ¿Qué pestaña está a la vista? `undefined` = la original del tipo `tipoActivo`. */
export const tipoActivo = (c: Pick<CeldaPestanas, 'vista'>): TipoCelda => c.vista ?? 'terminal'

/** Ptys de las terminales duplicadas de una celda (para transferirlos al separar la ventana). */
export const ptysDeExtras = (c: Pick<CeldaPestanas, 'extras'>): string[] => (c.extras ?? []).flatMap((x) => (x.tipo === 'terminal' && x.ptyId ? [x.ptyId] : []))

/** ¿Falta que alguna terminal duplicada tenga ya su proceso? (no se puede separar la ventana hasta entonces) */
export const extrasSinPty = (c: Pick<CeldaPestanas, 'extras'>): boolean => (c.extras ?? []).some((x) => x.tipo === 'terminal' && !x.ptyId)

interface CeldaConProceso extends CeldaPestanas {
  titulo: string
  ptyId: string
  cwd?: string
  proveedorId?: string
  proyectoId?: string
}

/** Lo que viaja de una celda a otra ventana (y de vuelta): sus datos, sus pestañas duplicadas y cuál estaba a la vista. */
export function aPayload(t: CeldaConProceso) {
  return {
    id: t.id,
    titulo: t.titulo,
    ptyId: t.ptyId,
    cwd: t.cwd,
    proveedorId: t.proveedorId,
    proyectoId: t.proyectoId,
    vista: t.vista,
    ...(t.extras?.length ? { extras: t.extras } : {}),
    ...(t.extraActiva ? { extraActiva: t.extraActiva } : {})
  }
}
