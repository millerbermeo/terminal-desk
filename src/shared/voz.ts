/** Dictado por voz: lo comparten el proceso principal y la interfaz. La clave de Groq vive solo en el backend. */

export const LIMITES_GRABACION = {
  /** Debe coincidir con VOZ_MAX_SEGUNDOS del backend (si el backend informa otro, manda el suyo). */
  maxMs: 180_000,
  maxBytes: 5 * 1024 * 1024,
  /** Menos de esto es un clic sin querer: no se envía. */
  minMs: 700,
  /** Opus mono a 64 kbps: voz nítida (los consonantes se entienden) y ~480 KB por minuto; 3 min caben en `maxBytes`. */
  bitsPorSegundo: 64_000,
  /** Margen que se sigue grabando tras pulsar «Terminar»: así no se come la última palabra. */
  colaMs: 350,
  /** Espera con el micrófono ya abierto antes de empezar a grabar: el control automático de ganancia necesita ese instante y sin él se pierde el comienzo. */
  calentamientoMs: 250
}
/** Si en los primeros segundos no se oye nada por encima de esto (0–1), se avisa de que el micrófono no capta sonido. */
export const UMBRAL_SONIDO = 0.03

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

/** Solo la transcripción literal: el texto no pasa por ninguna IA de redacción. */
export type ResultadoVoz = { ok: true; texto: string } | { ok: false; codigo: CodigoVoz; mensaje: string }

/** Errores de configuración del servidor: la interfaz muestra las instrucciones y no deja grabar. */
export const esErrorConfiguracion = (c: CodigoVoz): boolean => c === 'VOZ_SIN_CLAVE' || c === 'VOZ_CLAVE_INVALIDA'

/** 75 000 ms -> «1:15». */
export const formatoTiempo = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
