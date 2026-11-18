/**
 * Control del Chrome real del usuario desde Odesk (extensión «Odesk Code · Chrome» + puente local). Tipos del IPC `chrome:operar` y lógica
 * pura de permisos por sitio. Ver `docs/chrome.md`.
 */

/** Puertos locales que prueba la extensión, en orden (el puente usa el primero libre). */
export const PUERTOS_CHROME = [47615, 47616, 47617, 47618, 47619] as const

/** Versión del protocolo puente ⇄ extensión. Sube si cambian los mensajes de forma incompatible. */
export const PROTOCOLO_CHROME = 1

/** Cuánto vale un código de emparejamiento y cuántos intentos admite. */
export const VIGENCIA_CODIGO_MS = 5 * 60_000
export const INTENTOS_CODIGO = 5

export interface ExtensionEmparejada {
  id: string
  /** Navegador que la emparejó (p. ej. «Chrome 157 · Linux»). */
  nombre: string
  /** `chrome-extension://<id>`: solo ese origen puede usar el token. */
  origen: string
  creada: number
  ultimoUso?: number
}

export interface PestanaChrome {
  id: number
  url: string
  titulo: string
  cargando: boolean
  activa: boolean
}

export interface EstadoChrome {
  /** El usuario permite que la IA use Chrome (si no, las herramientas responden que está apagado). */
  activo: boolean
  /** Puerto local del puente, o `null` si no pudo abrirse ninguno. */
  puerto: number | null
  /** Hay una extensión emparejada conectada ahora. */
  conectado: boolean
  /** Navegador conectado ahora (nombre y versión de la extensión). */
  navegador?: string
  version?: string
  /** El usuario pausó el control desde la extensión. */
  pausado: boolean
  emparejadas: ExtensionEmparejada[]
  /** Código de emparejamiento en vigor (se muestra en Odesk y se escribe en la extensión). */
  codigo?: { codigo: string; expira: number }
  pestanas: PestanaChrome[]
  /** Sitios (origen) autorizados para siempre. */
  sitios: string[]
  /** Carpeta de la extensión en este equipo (para «Cargar descomprimida» en chrome://extensions). */
  carpetaExtension: string
  /** Mensaje del último problema del puente (puerto ocupado…). */
  error?: string
}

export interface OperacionesChrome {
  estado: { entrada: void; salida: EstadoChrome }
  activar: { entrada: { activo: boolean }; salida: EstadoChrome }
  emparejar: { entrada: void; salida: EstadoChrome }
  cancelarEmparejar: { entrada: void; salida: EstadoChrome }
  olvidar: { entrada: { id?: string }; salida: EstadoChrome }
  quitarSitio: { entrada: { origen: string }; salida: EstadoChrome }
  abrirCarpeta: { entrada: void; salida: EstadoChrome }
}
export type NombreOperacionChrome = keyof OperacionesChrome

/** Origen de una dirección (`https://ejemplo.com`), o `null` si no es http/https. */
export function origenDe(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** Direcciones de este mismo equipo: no hace falta autorizarlas (son los proyectos del usuario). */
export function esLocal(origen: string): boolean {
  try {
    const h = new URL(origen).hostname
    return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0'
  } catch {
    return false
  }
}

/**
 * Clic que puede tener consecuencias que no se deshacen (comprar, pagar, publicar, enviar, borrar…), por el texto del elemento.
 * Conservador: preguntar de más cuesta un clic; de menos, una compra.
 */
const SENSIBLE =
  /\b(compra\w*|comprar|pag(ar|o|ue)\w*|checkout|finalizar pedido|realizar pedido|confirmar|transferi\w*|enviar|env[ií]a\w*|publicar|publica\w*|borrar|elimina\w*|suprimir|darse de baja|cancelar (la )?suscripci[oó]n|suscrib\w*|donar|aceptar y pagar|buy|purchase|pay|place order|checkout|confirm|send|submit|post|publish|tweet|delete|remove|unsubscribe|transfer|donate)\b/i

export const clicSensible = (descripcion: string): boolean => SENSIBLE.test(descripcion)
