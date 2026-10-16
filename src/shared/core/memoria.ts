export type TipoMemoria = 'regla' | 'decision' | 'hecho'

/** Memoria de largo plazo de un proyecto. Las reglas se inyectan siempre; el resto, si es relevante. */
export interface EntradaMemoria {
  id: string
  tipo: TipoMemoria
  titulo: string
  contenido: string
  etiquetas: string[]
  creada: string // ISO
}

export type NuevaEntradaMemoria = Pick<EntradaMemoria, 'tipo' | 'titulo' | 'contenido'> & { etiquetas?: string[] }
