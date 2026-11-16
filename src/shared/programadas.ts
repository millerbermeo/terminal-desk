import type { ModoAutonomia } from './core/permisos'

/** Cuándo se repite una tarea programada del Asistente. */
export type Frecuencia =
  | { tipo: 'intervalo'; /** Cada cuántas horas (1–168). */ horas: number }
  /** A una hora fija (`HH:MM`, hora local) los días marcados (0 = domingo … 6 = sábado). */
  | { tipo: 'diaria'; hora: string; dias: number[] }

export interface EjecucionProgramada {
  /** ISO de cuándo empezó. */
  inicio: string
  estado: 'completado' | 'error' | 'cancelado' | 'limite_pasos'
  /** Conversación del Asistente donde quedó el resultado (se abre desde el historial). */
  sesionId?: string
  /** Primeras líneas de la respuesta o del error. */
  resumen: string
}

export interface TareaProgramada {
  id: string
  nombre: string
  proyectoId: string
  prompt: string
  frecuencia: Frecuencia
  /**
   * Sin nadie delante no se puede confirmar nada: con «preguntar» se deniega todo lo que pediría permiso (queda en solo lectura en la
   * práctica); «ediciones» edita archivos pero no ejecuta comandos que pidan permiso; «autonomo» hace todo salvo lo catastrófico.
   */
  autonomia: ModoAutonomia
  modelo?: string
  activa: boolean
  creada: string
  /** ISO de la próxima ejecución prevista. */
  proxima?: string
  ultima?: EjecucionProgramada
  /** Solo en la respuesta de `listar`: se está ejecutando ahora. */
  ejecutando?: boolean
}

export type NuevaTareaProgramada = Pick<TareaProgramada, 'nombre' | 'proyectoId' | 'prompt' | 'frecuencia' | 'autonomia' | 'activa'> & { id?: string; modelo?: string }

/** Operaciones del canal `core:programadas`. */
export type OperacionProgramadas =
  | { op: 'listar'; proyectoId?: string }
  | { op: 'guardar'; tarea: NuevaTareaProgramada }
  | { op: 'eliminar'; id: string }
  | { op: 'ejecutar'; id: string }

export const MAX_PROGRAMADAS = 30
export const MAX_PROMPT_PROGRAMADA = 8_000

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Comprueba y normaliza una frecuencia que llega de la interfaz. Lanza con un mensaje claro si no vale. */
export function validarFrecuencia(f: unknown): Frecuencia {
  const o = (f ?? {}) as Record<string, unknown>
  if (o.tipo === 'intervalo') {
    const horas = Number(o.horas)
    if (!Number.isFinite(horas) || horas < 1 || horas > 168) throw new Error('El intervalo debe estar entre 1 y 168 horas.')
    return { tipo: 'intervalo', horas: Math.round(horas) }
  }
  if (o.tipo === 'diaria') {
    const hora = String(o.hora ?? '')
    if (!HORA.test(hora)) throw new Error('La hora debe tener el formato HH:MM.')
    const dias = [...new Set((Array.isArray(o.dias) ? o.dias : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    if (!dias.length) throw new Error('Elige al menos un día.')
    return { tipo: 'diaria', hora, dias }
  }
  throw new Error('Frecuencia no válida.')
}

/**
 * Próxima ejecución estrictamente posterior a `desde`. Con intervalo cuenta desde `base` (la última ejecución o la creación), así una
 * tarea no se desplaza por lo que tarde cada vuelta; si ya pasó más de un intervalo (la app estuvo cerrada), toca ya mismo.
 */
export function siguienteEjecucion(f: Frecuencia, desde: Date, base?: Date): Date {
  if (f.tipo === 'intervalo') {
    const paso = f.horas * 3_600_000
    const inicio = (base ?? desde).getTime()
    const siguiente = inicio + paso
    return new Date(siguiente > desde.getTime() ? siguiente : desde.getTime() + 1000)
  }
  const [h, m] = f.hora.split(':').map(Number) as [number, number]
  for (let i = 0; i <= 7; i++) {
    const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + i, h, m, 0, 0)
    if (d.getTime() > desde.getTime() && f.dias.includes(d.getDay())) return d
  }
  // Inalcanzable con días válidos; por si acaso, dentro de una semana.
  return new Date(desde.getTime() + 7 * 86_400_000)
}

const NOMBRE_DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** «Cada 6 h», «Todos los días a las 09:00», «Lun–vie a las 08:30», «Lun, mié a las 18:00». */
export function describirFrecuencia(f: Frecuencia): string {
  if (f.tipo === 'intervalo') return f.horas === 1 ? 'Cada hora' : f.horas % 24 === 0 ? `Cada ${f.horas / 24} ${f.horas === 24 ? 'día' : 'días'}` : `Cada ${f.horas} h`
  const d = [...f.dias].sort()
  const cuando = d.length === 7 ? 'Todos los días' : d.join() === '1,2,3,4,5' ? 'Lun–vie' : d.join() === '0,6' ? 'Fines de semana' : d.map((x) => NOMBRE_DIA[x]).join(', ').replace(/^./, (c) => c.toUpperCase())
  return `${cuando} a las ${f.hora}`
}
