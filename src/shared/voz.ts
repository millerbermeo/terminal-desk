/** Dictado por voz: lo comparten el proceso principal y la interfaz. Se transcribe en este equipo (Whisper local), sin claves ni servidor. */

/** Frecuencia de muestreo que espera Whisper: la interfaz le entrega el audio ya convertido a 16 kHz mono. */
export const MUESTREO_VOZ = 16_000

export const LIMITES_GRABACION = {
  maxMs: 180_000,
  /** Menos de esto es un clic sin querer: no se transcribe. */
  minMs: 700,
  /** Opus mono a 64 kbps: voz nítida (los consonantes se entienden). */
  bitsPorSegundo: 64_000,
  /** Margen que se sigue grabando tras pulsar «Terminar»: así no se come la última palabra. */
  colaMs: 350,
  /** Espera con el micrófono ya abierto antes de empezar a grabar: el control automático de ganancia necesita ese instante y sin él se pierde el comienzo. */
  calentamientoMs: 250
}
/** Muestras que se aceptan como máximo (3 min + la cola y un margen). */
export const MAX_MUESTRAS_VOZ = Math.ceil(((LIMITES_GRABACION.maxMs + 5_000) / 1000) * MUESTREO_VOZ)

/** Si en los primeros segundos no se oye nada por encima de esto (0–1), se avisa de que el micrófono no capta sonido. */
export const UMBRAL_SONIDO = 0.03

/** Formatos que graba Chromium, del más eficiente al menos; el primero que admita MediaRecorder. */
export const FORMATOS_GRABACION = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'] as const

export const elegirFormato = (admite: (mime: string) => boolean): string | undefined => FORMATOS_GRABACION.find((f) => admite(f))

export type CodigoVoz =
  /** No se pudo descargar o cargar el modelo de voz. */
  | 'VOZ_MODELO'
  | 'VOZ_FORMATO'
  | 'VOZ_DURACION'
  | 'VOZ_VACIO'
  | 'VOZ_ERROR'
  | 'VOZ_MICROFONO'

/** `modeloListo: false` = el primer dictado descargará el modelo (una sola vez). */
export type EstadoVoz = { ok: true; maxSegundos: number; modeloListo: boolean } | { ok: false; codigo: CodigoVoz; mensaje: string }

/** Solo la transcripción literal: el texto no pasa por ninguna IA de redacción. */
export type ResultadoVoz = { ok: true; texto: string } | { ok: false; codigo: CodigoVoz; mensaje: string }

/** 75 000 ms -> «1:15». */
export const formatoTiempo = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
