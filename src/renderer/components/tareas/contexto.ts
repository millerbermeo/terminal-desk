import { createContext, useContext } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import type { DatosNuevaTarea, EstadoTarea, ParcheTarea, Tarea } from '@shared/tareas'

/** Lo que las vistas de Tareas pueden hacer sin conocer cómo se guarda: lo provee `Tareas.tsx`. */
export interface AccionesTareas {
  todas: Tarea[]
  estados: EstadoTarea[]
  datos: DatosProyectos
  nombreProyecto: Map<string, string>
  etiquetasUsadas: string[]
  hitosUsados: string[]
  abrir: (id: string) => void
  /** Cambia de columna (y de posición). Si la regla pide un motivo, lo pregunta. */
  mover: (t: Tarea, estado: string, antesDe?: string) => Promise<void>
  /** Edita campos; con `deshacer` ofrece volver atrás en un aviso. */
  editar: (t: Tarea, parche: ParcheTarea, deshacer?: boolean) => Promise<boolean>
  crear: (datos: DatosNuevaTarea) => Promise<Tarea | undefined>
  duplicar: (t: Tarea) => Promise<void>
  eliminar: (ts: Tarea[]) => void
  /** Abre el menú del clic derecho (o del botón «⋯») de una tarea. */
  menu: (x: number, y: number, t: Tarea) => void
  /** Selección múltiple (la lista y el tablero la comparten). */
  seleccion: ReadonlySet<string>
  alternarSeleccion: (id: string, rango: boolean) => void
  /** Reemplaza la selección entera (vacío = limpiar). */
  seleccionar: (ids: string[]) => void
  /** Tarea marcada con el teclado (J/K). */
  enfocada?: string
}

export const ContextoAcciones = createContext<AccionesTareas | null>(null)

export function useAcciones(): AccionesTareas {
  const c = useContext(ContextoAcciones)
  if (!c) throw new Error('useAcciones fuera de <Tareas>')
  return c
}
