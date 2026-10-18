import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ¿Es `url` una página de la propia interfaz? Las ventanas de la app tienen `window.api` (terminales, archivos, git…): si navegaran a
 * otra cosa (un `.html` o un enlace soltado sobre la ventana, un enlace sin `target`), esa página tendría el mismo poder. En desarrollo
 * vale el servidor de Vite (`urlDev`); empaquetada, solo el `index.html` de la interfaz.
 */
export function esPaginaDeLaApp(url: string, o: { urlDev?: string; indexHtml: string }): boolean {
  try {
    const u = new URL(url)
    if (o.urlDev) return u.origin === new URL(o.urlDev).origin
    return u.protocol === 'file:' && resolve(fileURLToPath(u)) === resolve(o.indexHtml)
  } catch {
    return false
  }
}
