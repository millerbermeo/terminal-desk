/** Tipografías de la interfaz: van empaquetadas con la app (no dependen de lo instalado en el sistema). */
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/jetbrains-mono/wght.css'

/** Misma pila que `--fuente-mono` (diseno/tokens.css), para lo que no se pinta con CSS: xterm y CodeMirror. */
export const FUENTE_MONO = "'JetBrains Mono Variable', 'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', Menlo, Consolas, monospace"

/**
 * Espera a que las fuentes estén cargadas antes de pintar: xterm mide el ancho de la letra al abrirse y,
 * si la fuente llega después, las columnas quedan mal calculadas. Son archivos locales (milisegundos);
 * el tope evita quedarse en blanco si algo falla.
 */
export function fuentesListas(topeMs = 1200): Promise<void> {
  const cargas = Promise.all([
    document.fonts.load("14px 'JetBrains Mono Variable'"),
    document.fonts.load("700 14px 'JetBrains Mono Variable'"),
    document.fonts.load("13px 'Inter Variable'")
  ])
  return Promise.race([cargas.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, topeMs))])
}
