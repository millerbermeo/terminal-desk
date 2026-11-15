import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IDIOMAS_VOZ, IDIOMA_VOZ_POR_DEFECTO, LIMITES_GRABACION, MAX_MUESTRAS_VOZ, MUESTREO_VOZ, esIdiomaVoz, type CodigoVoz, type EstadoVoz, type ResultadoVoz } from '@shared/voz'

/** Modelo Whisper multilingüe (ONNX). «base» da buena transcripción en español y corre fluido en CPU. */
export const MODELO_VOZ = 'onnx-community/whisper-base'
/** Codificador en fp32 (la calidad cae mucho cuantizado) y decodificador en q8: ~130 MB en total. */
const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'q8' } as const
const ARCHIVOS_MODELO = ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx']

/** Lo que hace falta del reconocedor (así se prueba sin descargar el modelo). */
export interface MotorVoz {
  /** ¿Está ya el modelo en disco? Si no, el primer dictado lo descarga. */
  listo(): boolean
  /** `idioma`: nombre para Whisper («spanish»…); sin él, el modelo lo detecta. */
  transcribir(pcm: Float32Array, idioma?: string): Promise<string>
}

class ErrorModelo extends Error {}

/** Whisper local con transformers.js (onnxruntime-node). Se carga al primer uso y se queda en memoria. */
export function crearMotorWhisper(dirModelos: string): MotorVoz {
  type Transcriptor = (audio: Float32Array, opciones: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>
  let cargando: Promise<Transcriptor> | undefined
  let cola: Promise<unknown> = Promise.resolve()

  const cargar = (): Promise<Transcriptor> =>
    (cargando ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = dirModelos
      env.allowLocalModels = false
      const p = await pipeline('automatic-speech-recognition', MODELO_VOZ, { dtype: DTYPE, device: 'cpu' })
      return p as unknown as Transcriptor
    })().catch((err: unknown) => {
      cargando = undefined // el siguiente intento vuelve a probar (p. ej. sin red la primera vez)
      throw new ErrorModelo(err instanceof Error ? err.message : String(err))
    }))

  return {
    listo: () => ARCHIVOS_MODELO.every((a) => existsSync(join(dirModelos, MODELO_VOZ, a))),
    transcribir: (pcm, idioma) => {
      // Una transcripción a la vez: dos en paralelo solo se estorbarían en la CPU.
      const r = cola.then(async () => {
        const t = await cargar()
        const salida = await t(pcm, { ...(idioma ? { language: idioma } : {}), task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
        return (Array.isArray(salida) ? salida.map((s) => s.text).join(' ') : salida.text).trim()
      })
      cola = r.catch(() => undefined)
      return r
    }
  }
}

/** Dictado: el audio se transcribe en este equipo. Nada sale a internet salvo la descarga única del modelo. */
export class ServicioVoz {
  constructor(private readonly motor: MotorVoz) {}

  estado(): EstadoVoz {
    return { ok: true, maxSegundos: LIMITES_GRABACION.maxMs / 1000, modeloListo: this.motor.listo() }
  }

  async transcribir(pcm: unknown, duracionMs: number, idioma?: unknown): Promise<ResultadoVoz> {
    const mal = (codigo: CodigoVoz, mensaje: string): ResultadoVoz => ({ ok: false, codigo, mensaje })
    if (!(pcm instanceof Float32Array)) return mal('VOZ_FORMATO', 'Formato de audio no admitido.')
    if (pcm.length === 0) return mal('VOZ_VACIO', 'La grabación está vacía.')
    if (pcm.length > MAX_MUESTRAS_VOZ || duracionMs > LIMITES_GRABACION.maxMs + 5_000) return mal('VOZ_DURACION', 'La grabación es demasiado larga.')
    if (pcm.length < (LIMITES_GRABACION.minMs / 1000) * MUESTREO_VOZ * 0.5) return mal('VOZ_VACIO', 'La grabación es demasiado corta.')
    try {
      const codigo = esIdiomaVoz(idioma) ? idioma : IDIOMA_VOZ_POR_DEFECTO
      const texto = await this.motor.transcribir(pcm, IDIOMAS_VOZ[codigo].whisper)
      if (!texto) return mal('VOZ_VACIO', 'No se entendió nada en la grabación: habla más cerca del micrófono.')
      return { ok: true, texto }
    } catch (err) {
      if (err instanceof ErrorModelo) return mal('VOZ_MODELO', `No se pudo preparar el modelo de voz (la primera vez se descarga, ~130 MB; revisa la conexión). ${err.message}`)
      return mal('VOZ_ERROR', 'No se pudo transcribir el audio.')
    }
  }
}
