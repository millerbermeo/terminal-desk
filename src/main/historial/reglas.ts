import { esArchivoSensible } from '@shared/github'
import { POLITICA_HISTORIAL } from '@shared/historial'

/** Carpetas que nunca se vigilan ni se registran: dependencias, resultados de compilar y cachés. */
const CARPETAS_IGNORADAS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', 'target', 'vendor', 'venv',
  '__pycache__', 'coverage', 'obj', 'Pods', '.gradle', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn'
])
/** Las carpetas «ocultas» (`.cache`, `.local`, `.npm`…) casi nunca son código del usuario; estas sí. */
const OCULTAS_PERMITIDAS = new Set(['.github', '.vscode', '.husky', '.storybook', '.devcontainer', '.changeset', '.gitlab', '.circleci'])

const EXTENSIONES_NO_TEXTO = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|bin|class|o|a|wasm|mp3|mp4|m4a|wav|ogg|webm|mov|avi|mkv|woff2?|ttf|otf|eot|sqlite3?|db|lock|log|map|min\.js|min\.css|pyc|node)$/i
/** Archivos de bloqueo y salida generada: muy grandes y sin interés como historial. */
const ARCHIVOS_GENERADOS = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'Cargo.lock', 'poetry.lock', '.DS_Store', 'Thumbs.db'])

export function carpetaIgnorada(nombre: string): boolean {
  if (CARPETAS_IGNORADAS.has(nombre)) return true
  return nombre.startsWith('.') && !OCULTAS_PERMITIDAS.has(nombre)
}

/** Motivo por el que un archivo (ruta relativa con `/`) no se registra, o `null` si sí. No mira su contenido. */
export function motivoOmitir(ruta: string): 'carpeta' | 'sensible' | 'no-texto' | 'generado' | 'temporal' | null {
  const partes = ruta.split('/')
  const nombre = partes.at(-1) ?? ''
  if (partes.slice(0, -1).some(carpetaIgnorada)) return 'carpeta'
  if (/^\..*\.tmp$/.test(nombre) || nombre.endsWith('~') || /\.sw[pxo]$/.test(nombre) || nombre === '4913') return 'temporal' // guardados atómicos y archivos de vim
  if (esArchivoSensible(ruta)) return 'sensible'
  if (ARCHIVOS_GENERADOS.has(nombre)) return 'generado'
  if (EXTENSIONES_NO_TEXTO.test(nombre)) return 'no-texto'
  return null
}

/** Contenido que no es texto (tiene bytes nulos al principio). */
export const esBinario = (datos: Uint8Array): boolean => datos.subarray(0, 8000).includes(0)

export const esDemasiadoGrande = (bytes: number): boolean => bytes > POLITICA_HISTORIAL.maxBytesArchivo
