import type { ColorTarea, Prioridad } from '@shared/tareas'

export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' }
export const NOMBRE_COLOR: Record<ColorTarea, string> = { rojo: 'Rojo', naranja: 'Naranja', amarillo: 'Amarillo', verde: 'Verde', azul: 'Azul', morado: 'Morado', rosa: 'Rosa', gris: 'Gris' }
/** Símbolo corto de cada prioridad (para chips compactos). */
export const ICONO_PRIORIDAD: Record<Prioridad, string> = { baja: '▾', media: '＝', alta: '▴', urgente: '⚑' }
