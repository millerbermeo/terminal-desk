/** Esquema JSON (subconjunto) con el que se describe la entrada de una herramienta. */
export interface EsquemaEntrada {
  type: 'object'
  properties?: Record<string, { type?: string; description?: string; enum?: unknown[]; items?: unknown }>
  required?: string[]
}

/** Qué puede hacer una herramienta; decide si necesita aprobación (ver Harness). */
export type Riesgo = 'lectura' | 'escritura' | 'ejecucion'

export interface HerramientaDef {
  nombre: string
  descripcion: string
  esquema: EsquemaEntrada
}

export interface LlamadaHerramienta {
  id: string
  nombre: string
  entrada: Record<string, unknown>
}

export interface ResultadoHerramienta {
  texto: string
  error?: boolean
  /** Imagen adjunta (captura del navegador), en base64. Solo llega a la IA por MCP; en modo API se queda en el texto. */
  imagen?: { datos: string; tipo: 'image/png' | 'image/jpeg' }
}
