export type TipoEntrada = 'archivo' | 'carpeta' | 'enlace'

export interface EntradaArchivo {
  nombre: string
  ruta: string // relativa a la raíz del proyecto, con «/»
  tipo: TipoEntrada
  bytes?: number
}

export type ResultadoLeer =
  | { ok: true; contenido: string; mtimeMs: number; bytes: number }
  | { ok: false; motivo: 'binario' | 'demasiado-grande' | 'no-utf8' | 'no-existe' | 'no-es-archivo'; bytes?: number }

export type ResultadoGuardar =
  | { ok: true; mtimeMs: number }
  | { ok: false; motivo: 'conflicto' | 'protegido' | 'demasiado-grande' | 'no-existe'; mtimeMs?: number; mensaje?: string }

/** Cambio detectado en disco dentro de una carpeta vigilada. */
export interface CambioArchivo {
  proyectoId: string
  carpeta: string // ruta relativa de la carpeta vigilada ('' = raíz)
  nombre?: string // archivo o carpeta afectado dentro de ella (si el sistema lo informa)
}

/** Marca de git de un archivo: M modificado, A añadido, D borrado, R renombrado, U sin seguimiento, C conflicto. */
export type MarcaGit = 'M' | 'A' | 'D' | 'R' | 'U' | 'C'

export const LIMITES_EDITOR = {
  lecturaBytes: 1024 * 1024, // más de 1 MB no se abre
  escrituraBytes: 5 * 1024 * 1024
} as const
