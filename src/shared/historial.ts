/**
 * Historial local de versiones, independiente de git: cada vez que un archivo del proyecto cambia (a mano, por la IA o por otro programa)
 * se guarda una copia con fecha, origen y autor. Vive en este equipo; no hace falta confirmar ni cambiar de rama.
 * El renderer solo manda ids de proyecto y rutas relativas; main resuelve la carpeta.
 */
import type { ResultadoDiff } from './diff'

/**
 * usuario: lo editó la persona en el editor de la app · ia: lo escribió un agente de IA · externo: otro programa (otro editor, una terminal) ·
 * git: lo cambió git (cambio de rama, pull…) · restauracion: se restauró desde el historial · base: la versión de git (HEAD) de la que se partió.
 */
export type OrigenVersion = 'usuario' | 'ia' | 'externo' | 'git' | 'restauracion' | 'base'

export const ORIGENES: readonly OrigenVersion[] = ['usuario', 'ia', 'externo', 'git', 'restauracion', 'base']

export const ETIQUETA_ORIGEN: Record<OrigenVersion, string> = {
  usuario: 'A mano',
  ia: 'IA',
  externo: 'Otro programa',
  git: 'Git',
  restauracion: 'Restauración',
  base: 'Versión de git'
}

/** Quién y desde dónde: el mismo usuario de GitHub puede trabajar en varios equipos, y varias personas en el mismo equipo. */
export interface AutorVersion {
  /** Usuario de GitHub conectado en ese momento (o el nombre de git si no hay cuenta). */
  usuario?: string
  /** Correo de la cuenta de Odesk Agent. */
  cuenta?: string
  equipoId?: string
  equipo?: string
}

export interface Version {
  id: string
  ruta: string
  /** Contenido (sha256) o `null` si en esta versión el archivo se borró. */
  hash: string | null
  bytes: number
  /** ISO 8601. */
  fecha: string
  origen: OrigenVersion
  autor: AutorVersion
  /** Herramienta de la IA (`Write`, `Edit`, `escribir_archivo`…) y ejecución en la que ocurrió. */
  herramienta?: string
  ejecucionId?: string
  nota?: string
  /** Líneas añadidas y quitadas respecto a la versión anterior. */
  mas: number
  menos: number
  eliminada: boolean
}

export interface ArchivoHistorial {
  ruta: string
  versiones: number
  ultima: Version
  /** Su última versión es un borrado: se puede recuperar. */
  eliminado: boolean
}

export interface FiltroHistorial {
  texto?: string
  origen?: OrigenVersion
  /** Usuario de GitHub (o texto del autor). */
  autor?: string
  /** Solo lo que cambió desde esta fecha (ISO). */
  desde?: string
}

export interface EstadoHistorial {
  /** Se registran los cambios de este proyecto. */
  activo: boolean
  /** completa: se vigila todo el proyecto · limitada: es tan grande que solo se vigilan las carpetas más cercanas · apagada. */
  vigilancia: 'completa' | 'limitada' | 'apagada'
  carpetasVigiladas: number
  archivos: number
  versiones: number
  /** Espacio que ocupa en disco (comprimido) y el máximo antes de empezar a recortar lo más antiguo. */
  bytes: number
  limiteBytes: number
  /** Cuánto se conserva completo y hasta cuándo se guardan versiones sueltas. */
  diasCompletos: number
}

export interface InfoVersion {
  id: string
  fecha: string
  origen: OrigenVersion
  autor: AutorVersion
  eliminada: boolean
}

export interface ResultadoComparar {
  desde: InfoVersion | 'actual' | 'vacio'
  hasta: InfoVersion | 'actual' | 'vacio'
  diff: ResultadoDiff
  /** El archivo es binario o demasiado grande: no hay diferencias que mostrar. */
  omitido?: 'binario' | 'grande'
}

export interface ResumenHistorial {
  ruta: string
  versiones: number
  /** ISO 8601 de la última versión. */
  ultima: string
}

export interface OperacionesHistorial {
  estado: { entrada: { proyectoId: string }; salida: EstadoHistorial }
  /** Enciende o apaga el registro de este proyecto. Apagado no se borra nada de lo ya guardado. */
  ajustar: { entrada: { proyectoId: string; activo: boolean }; salida: EstadoHistorial }
  archivos: { entrada: { proyectoId: string; filtro?: FiltroHistorial; limite?: number }; salida: { archivos: ArchivoHistorial[]; hayMas: boolean } }
  versiones: { entrada: { proyectoId: string; ruta: string; filtro?: Pick<FiltroHistorial, 'origen' | 'autor'> }; salida: Version[] }
  /** Texto de una versión (o del archivo tal como está ahora con `actual`). */
  leer: { entrada: { proyectoId: string; ruta: string; version: string }; salida: { texto: string } | { omitido: 'binario' | 'grande' | 'borrada' } }
  /** Compara dos versiones: `anterior` (solo en `desde`) es la inmediatamente previa a `hasta`; `actual` es el archivo en disco. */
  comparar: { entrada: { proyectoId: string; ruta: string; desde: string; hasta: string }; salida: ResultadoComparar }
  /** Restaura una versión completa o solo algunos bloques (los números de `comparar(actual → versión)`). Antes guarda el estado actual. */
  restaurar: { entrada: { proyectoId: string; ruta: string; version: string; bloques?: number[] }; salida: { version: Version } }
  /** Borra el historial de un archivo (o de todo el proyecto sin `ruta`). */
  olvidar: { entrada: { proyectoId: string; ruta?: string }; salida: EstadoHistorial }
}

export type NombreOperacionHistorial = keyof OperacionesHistorial

/** Política de conservación: todo durante `diasCompletos`; después una versión por día, luego por semana, y se descarta lo más viejo. */
export const POLITICA_HISTORIAL = { diasCompletos: 30, diasDiarias: 90, diasSemanales: 365, maxBytes: 500 * 1024 * 1024, maxBytesArchivo: 1_000_000 } as const
