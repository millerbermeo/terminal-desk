import type { NombreOperacionTareas, OperacionesTareas } from '@shared/tareas'
import type { ServicioTareas } from './servicio'

type Implementaciones = { [K in NombreOperacionTareas]: (s: ServicioTareas, e: OperacionesTareas[K]['entrada']) => Promise<OperacionesTareas[K]['salida']> }

/** Operaciones de la interfaz (autor «usuario»). Todo pasa por las mismas reglas del servicio que usa la IA. */
const OPERACIONES: Implementaciones = {
  listar: (s, e) => s.listar(e),
  paraAsistente: (s, e) => s.paraAsistente(String(e.proyectoId)),
  obtener: (s, e) => s.obtener(e.tarea),
  crear: (s, e) => s.crear(e, 'usuario'),
  crearVarias: (s, e) => s.crearVarias(e, 'usuario'),
  editar: (s, e) => s.editar(e.tarea, e.parche, 'usuario', e.motivo),
  estado: (s, e) => s.estado(e.tarea, e.estado, 'usuario', e.motivo),
  mover: (s, e) => s.mover(e.tarea, e.estado, 'usuario', e.antesDe, e.motivo),
  comentar: (s, e) => s.comentar(e.tarea, e.texto, 'usuario'),
  item: (s, e) => s.item(e, 'usuario'),
  dependencias: (s, e) => s.dependencias(e.tarea, e.dependeDe, 'usuario'),
  referencia: (s, e) => s.referencia(e, 'usuario'),
  eliminar: (s, e) => s.eliminar(e.tarea, 'usuario'),
  actividad: (s, e) => s.actividad(e),
  resumen: (s, e) => s.resumen(e),
  siguiente: (s, e) => s.siguiente(e),
  estados: (s) => s.estados(),
  guardarEstados: (s, e) => s.guardarEstados(e.estados, e.reasignar, 'usuario')
}

export function ejecutarOperacionTareas(s: ServicioTareas, op: unknown, entrada: unknown): Promise<unknown> {
  if (typeof op !== 'string' || !Object.hasOwn(OPERACIONES, op)) return Promise.reject(new Error(`Operación de tareas desconocida: ${String(op)}`))
  const e = entrada !== null && typeof entrada === 'object' ? entrada : {}
  return (OPERACIONES[op as NombreOperacionTareas] as (s: ServicioTareas, e: unknown) => Promise<unknown>)(s, e)
}
