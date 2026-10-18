/** Tipos y saneado de los registros técnicos (errores, cierres inesperados…) que el escritorio guarda y sube a la cuenta. */

export type NivelRegistro = 'error' | 'warn' | 'info'

export interface EntradaRegistro {
  level: NivelRegistro
  /** `main`, `renderer`, `gpu`, `proceso`. */
  source: string
  /** Clasificación corta para agrupar (`render-process-gone`, `unresponsive`, `react`, `vista-vacia`…). */
  kind: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  /** ms desde 1970 de cuando pasó. */
  at: number
}

export const MAX_MENSAJE = 2000
export const MAX_STACK = 8000

const PATRONES_SECRETOS: [RegExp, string][] = [
  [/GOCSPX-[A-Za-z0-9_-]+/g, 'GOCSPX-***'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh*_***'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, 'sk-***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, 'jwt.***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1***'],
  [/((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi, '$1***'],
  [/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1***@']
]

/**
 * Quita de un texto lo que no debe salir del equipo: la carpeta personal (y el nombre de usuario en rutas de Linux/macOS/Windows),
 * tokens, claves y contraseñas con forma conocida. Recorta a `max`.
 */
export function sanear(texto: unknown, max: number, casa?: string): string {
  let t = typeof texto === 'string' ? texto : texto instanceof Error ? `${texto.name}: ${texto.message}` : String(texto ?? '')
  if (casa && casa.length > 1) t = t.split(casa).join('~')
  t = t.replace(/\/home\/[^/\s:'")]+/g, '/home/~').replace(/\/Users\/[^/\s:'")]+/g, '/Users/~').replace(/[A-Za-z]:\\Users\\[^\\\s:'")]+/g, 'C:\\Users\\~')
  for (const [re, por] of PATRONES_SECRETOS) t = t.replace(re, por)
  return t.length > max ? `${t.slice(0, max)}…[recortado]` : t
}

/** Contexto pequeño y sin objetos raros: solo escalares, a un nivel, con límite de claves. */
export function contextoSeguro(c: Record<string, unknown> | undefined, casa?: string): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  if (!c) return salida
  for (const [k, v] of Object.entries(c).slice(0, 20)) {
    if (typeof v === 'number' || typeof v === 'boolean') salida[k.slice(0, 40)] = v
    else if (typeof v === 'string') salida[k.slice(0, 40)] = sanear(v, 200, casa)
  }
  return salida
}

/** Clave para no repetir el mismo error mil veces seguidas (un bucle de renderizado puede generar miles). */
export const claveDeDuplicado = (e: Pick<EntradaRegistro, 'source' | 'kind' | 'message'>): string => `${e.source}|${e.kind}|${e.message.slice(0, 200)}`
