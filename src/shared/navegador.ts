/** Navegador integrado: tipos y lógica pura (la comparten main, renderer y tests). */

export interface EstadoNavegador {
  url: string
  titulo: string
  cargando: boolean
  puedeAtras: boolean
  puedeAdelante: boolean
  /** Por qué falló la última carga (servidor apagado, certificado…). */
  error?: string
}

export type AccionNavegador =
  | { tipo: 'ir'; url: string }
  | { tipo: 'atras' | 'adelante' | 'recargar' | 'detener' | 'devtools' | 'externo' | 'cerrar' }

export interface ServidorLocal {
  puerto: number
  url: string
  /** Título de la página, si responde con HTML. */
  titulo?: string
}

/** Alto (px) de la barra de direcciones: la vista web ocupa el resto de la ventana. */
export const ALTO_BARRA_NAVEGADOR = 52

/** Puertos donde suelen escuchar los servidores de desarrollo (Vite, Next, CRA, Angular, Astro, Django, Rails…). */
export const PUERTOS_COMUNES: readonly number[] = [3000, 3001, 3002, 4000, 4200, 4321, 5000, 5173, 5174, 5500, 8000, 8080, 8081, 8888, 9000]

const ESQUEMA_PELIGROSO = /^(javascript|data|file|about|chrome|vbscript|blob|view-source|devtools|ftp):/i

/** ¿La dirección apunta a esta máquina o a la red local? (se abre con http en vez de https cuando no se indica el esquema). */
export function esDireccionLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '0.0.0.0' ||
    /^[^.]+$/.test(h) // nombres de una sola palabra (hosts de la red local, contenedores)
  )
}

/**
 * Convierte lo que escribe el usuario en una URL http(s) válida:
 * `3000` y `:3000/api` → localhost; `localhost:5173` → http; `ejemplo.com` → https. Solo http y https.
 */
export function normalizarUrl(entrada: string): { url: string } | { error: string } {
  const t = (entrada ?? '').trim()
  if (!t) return { error: 'Escribe una dirección.' }
  if (/\s/.test(t)) return { error: 'La dirección no puede llevar espacios.' }
  if (ESQUEMA_PELIGROSO.test(t)) return { error: 'Solo se admiten direcciones http y https.' }
  let candidata: string
  if (/^\d{1,5}(\/.*)?$/.test(t)) candidata = `http://localhost:${t}`
  else if (/^:\d{1,5}(\/.*)?$/.test(t)) candidata = `http://localhost${t}`
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) candidata = t
  else {
    const host = t.split(/[/?#]/)[0]!.replace(/:\d+$/, '')
    if (!host.includes('.') && !esDireccionLocal(host)) return { error: 'No parece una dirección. Ejemplos: localhost:3000, 5173 o ejemplo.com' }
    candidata = `${esDireccionLocal(host) ? 'http' : 'https'}://${t}`
  }
  let u: URL
  try {
    u = new URL(candidata)
  } catch {
    return { error: 'La dirección no es válida.' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Solo se admiten direcciones http y https.' }
  if (!u.hostname) return { error: 'Falta el servidor en la dirección.' }
  const puerto = u.port ? Number(u.port) : 80
  if (puerto < 1 || puerto > 65535) return { error: 'Puerto fuera de rango.' }
  return { url: u.href }
}
