/** Dictado por voz: lo comparten el proceso principal y la interfaz. La clave de Groq vive solo en el backend. */

export const LIMITES_GRABACION = {
  /** Debe coincidir con VOZ_MAX_SEGUNDOS del backend (si el backend informa otro, manda el suyo). */
  maxMs: 180_000,
  maxBytes: 5 * 1024 * 1024,
  /** Menos de esto es un clic sin querer: no se envía. */
  minMs: 700,
  /** Opus mono a 24 kbps: voz clara y ~180 KB por minuto. */
  bitsPorSegundo: 24_000
}

/** Formatos que graba Chromium, del más eficiente al menos; el primero que admita MediaRecorder. */
export const FORMATOS_GRABACION = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'] as const

export const elegirFormato = (admite: (mime: string) => boolean): string | undefined => FORMATOS_GRABACION.find((f) => admite(f))

/** Códigos de error del backend (`/voz/*`) más los del propio escritorio. */
export type CodigoVoz =
  | 'VOZ_SIN_CLAVE'
  | 'VOZ_CLAVE_INVALIDA'
  | 'VOZ_SIN_CONEXION'
  | 'VOZ_LIMITE'
  | 'VOZ_FORMATO'
  | 'VOZ_TAMANO'
  | 'VOZ_DURACION'
  | 'VOZ_VACIO'
  | 'VOZ_ERROR'
  | 'VOZ_SESION'
  | 'VOZ_MICROFONO'

export type EstadoVoz = { ok: true; maxSegundos: number; maxBytes: number } | { ok: false; codigo: CodigoVoz; mensaje: string }

export type ResultadoVoz = { ok: true; texto: string; original: string; mejorado: boolean } | { ok: false; codigo: CodigoVoz; mensaje: string }

/** Errores de configuración del servidor: la interfaz muestra las instrucciones y no deja grabar. */
export const esErrorConfiguracion = (c: CodigoVoz): boolean => c === 'VOZ_SIN_CLAVE' || c === 'VOZ_CLAVE_INVALIDA'

/** 75 000 ms -> «1:15». */
export const formatoTiempo = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
