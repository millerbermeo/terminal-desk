/**
 * Estado de git de un proyecto en cada equipo de la cuenta («mis PCs») y proyectos de la cuenta que aún no están en este equipo.
 * Los equipos informan su rama, commit y cuánto van adelante/atrás de su remoto; nunca rutas.
 */

/** M modificado · A añadido · D borrado · R renombrado · C copiado · T tipo cambiado · U conflicto · N nuevo (sin seguimiento). */
export type EstadoArchivoEquipo = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | 'N'

/** Un archivo con cambios en un equipo. Solo nombre, estado y líneas: nunca su contenido. */
export interface ArchivoEquipo {
  ruta: string
  estado: EstadoArchivoEquipo
  mas: number
  menos: number
}

export interface EquipoProyecto {
  /** Id del equipo (lo genera cada escritorio la primera vez). */
  idEquipo: string
  nombre: string
  esteEquipo: boolean
  /** `undefined` = cabeza suelta. */
  rama?: string
  commit?: string
  asunto?: string
  /** Commits que este equipo tiene y su remoto no / que el remoto tiene y a este equipo le faltan. Solo valen con `seguimiento`. */
  adelante: number
  atras: number
  /** La rama sigue a una rama remota. */
  seguimiento: boolean
  /** Archivos con cambios sin guardar. */
  cambios: number
  /** Cuáles son (hasta 50) y cuántas líneas se añadieron y quitaron en total (respecto al último commit). */
  archivos: ArchivoEquipo[]
  lineasMas: number
  lineasMenos: number
  /** Historial local de ese equipo: los archivos con versiones guardadas más recientes (solo nombre, cuántas y cuándo; el contenido no sale de ese equipo). */
  historial: { ruta: string; versiones: number; ultima: string }[]
  versionesHistorial: number
  /** ISO 8601: la última vez que se modificó uno de esos archivos (no cuándo informó). */
  ultimaActividad?: string
  /** ISO 8601: fecha del último commit de ese equipo. */
  fechaCommit?: string
  /** ISO 8601: cuándo informó por última vez. */
  actualizado: string
}

export type SituacionEquipo = 'al-dia' | 'adelantado' | 'atrasado' | 'divergido' | 'sin-remoto'

export function situacionDe(e: Pick<EquipoProyecto, 'adelante' | 'atras' | 'seguimiento'>): SituacionEquipo {
  if (!e.seguimiento) return 'sin-remoto'
  if (e.adelante > 0 && e.atras > 0) return 'divergido'
  if (e.adelante > 0) return 'adelantado'
  if (e.atras > 0) return 'atrasado'
  return 'al-dia'
}

/** Un equipo que no informa en este tiempo se pinta como apagado. */
export const EQUIPO_INACTIVO_MS = 10 * 60_000
/** Si se tocó un archivo hace menos que esto, se considera que ese equipo está trabajando ahora. */
export const TRABAJANDO_MS = 3 * 60_000

/** El equipo está encendido y editó archivos hace muy poco. */
export function trabajandoAhora(e: Pick<EquipoProyecto, 'ultimaActividad' | 'actualizado'>, ahora = Date.now()): boolean {
  if (!e.ultimaActividad) return false
  const actividad = Date.parse(e.ultimaActividad)
  const visto = Date.parse(e.actualizado)
  return Number.isFinite(actividad) && Number.isFinite(visto) && ahora - actividad < TRABAJANDO_MS && ahora - visto < EQUIPO_INACTIVO_MS
}

/** Otro equipo con trabajo que aún no está en el remoto (cambios sin guardar o commits sin enviar): lo que conviene saber antes de editar. */
export interface AvisoEquipo {
  proyectoId: string
  idEquipo: string
  equipo: string
  rama?: string
  cambios: number
  adelante: number
  lineasMas: number
  lineasMenos: number
  ultimaActividad?: string
  actualizado: string
}

export interface PendienteClonar {
  id: string
  nombre: string
  /** Remoto del proyecto tal como lo registró el equipo que lo creó. */
  repo: string
  grupoId?: string
}

export interface OperacionesEquipos {
  /** Los equipos que han informado de este proyecto (primero este equipo). */
  listar: { entrada: { proyectoId: string }; salida: { equipos: EquipoProyecto[]; equipo: { id: string; nombre: string } } }
  /** Qué otros equipos tienen trabajo pendiente en los proyectos de este equipo (para avisar sin abrir cada proyecto). */
  resumen: { entrada: Record<string, never>; salida: AvisoEquipo[] }
  /** Sube ya el estado de git de los proyectos de este equipo (con `traer`, consulta antes el remoto). */
  informar: { entrada: { traer?: boolean }; salida: { informados: number } }
  renombrar: { entrada: { nombre: string }; salida: { id: string; nombre: string } }
  /** Quita a un equipo de la lista (por ejemplo, una computadora que ya no usas). */
  olvidar: { entrada: { proyectoId: string; idEquipo: string }; salida: { ok: true } }
  /** Proyectos de la cuenta con repositorio y sin carpeta en este equipo. */
  pendientes: { entrada: Record<string, never>; salida: PendienteClonar[] }
  /** Clona el repositorio de un proyecto de la cuenta y lo deja enlazado a ese mismo proyecto (conserva su tablero y conversaciones). */
  clonarPendiente: { entrada: { proyectoId: string; carpetaPadre: string; protocolo?: 'https' | 'ssh' }; salida: { ruta: string } }
}

export type NombreOperacionEquipos = keyof OperacionesEquipos
