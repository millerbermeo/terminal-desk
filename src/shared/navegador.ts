/** Navegador integrado: tipos y lógica pura (la comparten main, renderer y tests). */

export interface EstadoNavegador {
  url: string
  titulo: string
  cargando: boolean
  puedeAtras: boolean
  puedeAdelante: boolean
  /** Por qué falló la última carga (servidor apagado, certificado…). */
  error?: string
  /** La ventana la maneja la IA: última acción que hizo (se ve en la barra). */
  ia?: string
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

/** Tecla para el protocolo de DevTools (Input.dispatchKeyEvent): la IA la pide por nombre («Enter», «Control+a», «Shift+Tab»). */
export interface TeclaCdp {
  key: string
  code: string
  vk: number
  /** Texto que inserta (solo sin Control/Alt/Meta). */
  texto?: string
  /** Máscara de modificadores de CDP: Alt=1, Control=2, Meta=4, Shift=8. */
  modificadores: number
}

const TECLAS_ESPECIALES: Record<string, [code: string, vk: number, texto?: string]> = {
  Enter: ['Enter', 13, '\r'],
  Tab: ['Tab', 9],
  Escape: ['Escape', 27],
  Backspace: ['Backspace', 8],
  Delete: ['Delete', 46],
  Insert: ['Insert', 45],
  ArrowUp: ['ArrowUp', 38],
  ArrowDown: ['ArrowDown', 40],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 39],
  Home: ['Home', 36],
  End: ['End', 35],
  PageUp: ['PageUp', 33],
  PageDown: ['PageDown', 34],
  ' ': ['Space', 32, ' ']
}
const ALIAS_TECLAS: Record<string, string> = {
  intro: 'Enter', return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', retroceso: 'Backspace',
  delete: 'Delete', del: 'Delete', supr: 'Delete', insert: 'Insert', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', inicio: 'Home', end: 'End', fin: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', space: ' ', espacio: ' ', spacebar: ' '
}
const MODIFICADORES: Record<string, number> = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, super: 4, shift: 8, mayus: 8 }

export function analizarTecla(spec: string): TeclaCdp {
  const partes = (spec ?? '').split('+')
  // «Control++» o «+»: la última parte vacía es la tecla «+».
  if (partes.length > 1 && partes[partes.length - 1] === '' && partes[partes.length - 2] === '') partes.splice(-2, 2, '+')
  const base = partes.pop() ?? ''
  if (!base) throw new Error('Indica una tecla, p. ej. Enter, Escape o Control+a.')
  let modificadores = 0
  for (const m of partes) {
    const bit = MODIFICADORES[m.trim().toLowerCase()]
    if (!bit) throw new Error(`Modificador desconocido: «${m}» (usa Control, Alt, Shift o Meta).`)
    modificadores |= bit
  }
  const nombre = base.length === 1 ? base : (ALIAS_TECLAS[base.toLowerCase()] ?? base)
  const especial = TECLAS_ESPECIALES[nombre]
  const conTexto = (modificadores & 7) === 0
  if (especial) {
    const [code, vk, texto] = especial
    return { key: nombre === ' ' ? ' ' : nombre, code, vk, ...(texto && conTexto ? { texto } : {}), modificadores }
  }
  const f = /^f([1-9]|1[0-2])$/i.exec(nombre)
  if (f) return { key: `F${f[1]}`, code: `F${f[1]}`, vk: 111 + Number(f[1]), modificadores }
  if ([...nombre].length !== 1) throw new Error(`Tecla desconocida: «${base}». Ejemplos: Enter, Tab, Escape, ArrowDown, F5, a, Control+a.`)
  const c = nombre
  const letra = /^[a-z]$/i.test(c)
  const digito = /^\d$/.test(c)
  const key = letra && modificadores & 8 ? c.toUpperCase() : c
  return {
    key,
    code: letra ? `Key${c.toUpperCase()}` : digito ? `Digit${c}` : '',
    vk: letra || digito ? c.toUpperCase().charCodeAt(0) : 0,
    ...(conTexto ? { texto: key } : {}),
    modificadores
  }
}
