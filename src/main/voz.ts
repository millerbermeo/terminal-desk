import { LIMITES_GRABACION, type CodigoVoz, type EstadoVoz, type ResultadoVoz } from '@shared/voz'
import { ErrorServidor, ErrorSesion, type ClienteServidor } from './servidor/cliente'

type Cliente = Pick<ClienteServidor, 'get' | 'binario'>

const CODIGOS: readonly CodigoVoz[] = ['VOZ_SIN_CLAVE', 'VOZ_CLAVE_INVALIDA', 'VOZ_SIN_CONEXION', 'VOZ_LIMITE', 'VOZ_FORMATO', 'VOZ_TAMANO', 'VOZ_DURACION', 'VOZ_VACIO', 'VOZ_ERROR']

/** Los errores viajan como datos (por IPC un `throw` pierde el código, que la interfaz necesita para mostrar instrucciones). */
function fallo(err: unknown): { ok: false; codigo: CodigoVoz; mensaje: string } {
  if (err instanceof ErrorSesion) return { ok: false, codigo: 'VOZ_SESION', mensaje: err.message }
  if (err instanceof ErrorServidor) {
    if (err.estado === 404) return { ok: false, codigo: 'VOZ_ERROR', mensaje: 'Este servidor aún no tiene el dictado por voz: actualiza el backend (terminal-desk-api).' }
    const codigo = CODIGOS.find((c) => c === err.codigo) ?? (err.estado === 429 ? 'VOZ_LIMITE' : err.estado === undefined ? 'VOZ_SIN_CONEXION' : 'VOZ_ERROR')
    return { ok: false, codigo, mensaje: err.message }
  }
  return { ok: false, codigo: 'VOZ_ERROR', mensaje: 'No se pudo procesar el audio.' }
}

/** Dictado: el audio va al backend, que lo transcribe con Groq. El escritorio nunca tiene la clave. */
export class ServicioVoz {
  constructor(private readonly cliente: Cliente) {}

  async estado(): Promise<EstadoVoz> {
    try {
      const r = await this.cliente.get<{ disponible: boolean; codigo?: string; mensaje?: string; maxSegundos: number; maxBytes: number }>('/voz/estado')
      if (r.disponible) return { ok: true, maxSegundos: r.maxSegundos, maxBytes: r.maxBytes }
      return { ok: false, codigo: CODIGOS.find((c) => c === r.codigo) ?? 'VOZ_ERROR', mensaje: r.mensaje ?? 'El dictado no está disponible.' }
    } catch (err) {
      return fallo(err)
    }
  }

  async transcribir(audio: Uint8Array, mime: string, duracionMs: number, mejorar: boolean): Promise<ResultadoVoz> {
    // Defensa local: no se sube nada que el backend vaya a rechazar.
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) return { ok: false, codigo: 'VOZ_VACIO', mensaje: 'La grabación está vacía.' }
    if (audio.byteLength > LIMITES_GRABACION.maxBytes) return { ok: false, codigo: 'VOZ_TAMANO', mensaje: 'La grabación es demasiado grande.' }
    if (!/^audio\/[a-z0-9.+-]+(;.*)?$/i.test(mime)) return { ok: false, codigo: 'VOZ_FORMATO', mensaje: 'Formato de audio no admitido.' }
    const tipo = mime.split(';')[0]!
    try {
      const r = await this.cliente.binario<{ texto: string; original: string; mejorado: boolean }>(`/voz/transcribir${mejorar ? '' : '?mejorar=0'}`, audio, tipo, { 'x-duracion-ms': String(Math.round(duracionMs)) })
      return { ok: true, texto: r.texto, original: r.original, mejorado: r.mejorado }
    } catch (err) {
      return fallo(err)
    }
  }
}
