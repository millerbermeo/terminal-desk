export type TipoAdjunto = 'imagen' | 'pdf' | 'texto'

/** Archivo subido y validado, guardado por la aplicación (se referencia por `id`). */
export interface Adjunto {
  id: string
  nombre: string
  tipo: TipoAdjunto
  mime: string
  bytes: number
  paginas?: number // PDF
  tokens: number // estimación de lo que ocupa en el contexto del modelo
}

export const LIMITES_ADJUNTOS = {
  imagenBytes: 5 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  pdfPaginas: 100,
  textoBytes: 200 * 1024,
  porMensaje: 5,
  ladoMaximoImagen: 8000
} as const

export const EXTENSIONES_TEXTO = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'xml', 'html', 'css', 'scss', 'sql', 'log', 'sh',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'vue', 'svelte', 'ini', 'conf', 'diff', 'patch'
] as const
