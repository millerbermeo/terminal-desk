import { nativeImage } from 'electron'
import type { ResultadoHerramienta } from '@shared/core/herramientas'
import { analizarTecla } from '@shared/navegador'
import type { MensajeConsola, PeticionRed } from './navegador'
import { SCRIPT_PAGINA } from './navegador-pagina'

/**
 * Motor común de las herramientas de navegador de la IA: leer la página (instantánea con refs), ratón y teclado reales, esperar, capturas,
 * consola, red y JavaScript. No sabe DÓNDE está la página: habla con ella por un `CanalPagina` (protocolo de DevTools + un mundo aislado).
 * Lo usan el navegador integrado (`navegador-ia.ts`, depurador de Electron) y el Chrome real del usuario (`chrome-ia.ts`, por la extensión).
 */

export const MAX_TEXTO = 40_000
const ANCHO_CAPTURA = 1280
/** Las imágenes de más de 8000 px de lado no se aceptan: una página muy larga se corta. */
const ALTO_MAX_CAPTURA = 7800
const MAX_ESPERA_MS = 30_000

export type E = Record<string, unknown>

export type { MensajeConsola, PeticionRed }

export interface EstadoPagina {
  url: string
  titulo: string
  cargando: boolean
  /** Error de carga de la última navegación, si hubo. */
  error?: string | undefined
}

/** Cómo llega el motor a una página concreta. */
export interface CanalPagina {
  cdp<T = unknown>(metodo: string, params?: object): Promise<T>
  /** Ejecuta código en el mundo aislado de la página y devuelve lo que devuelva (debe ser serializable). */
  aislado(codigo: string): Promise<unknown>
  /** Factor de zoom de la página (las coordenadas CSS se multiplican por él para el ratón). */
  zoom(): Promise<number>
  /** Tamaño visible de la página en px. */
  vista(): Promise<{ ancho: number; alto: number }>
  estado(): Promise<EstadoPagina>
  /** Ir a una dirección ya normalizada, o moverse por el historial. */
  navegar(destino: { url: string } | { accion: 'atras' | 'adelante' | 'recargar' }): Promise<void>
  /** Espera a que termine la navegación en curso, si la hay. */
  esperarCarga(maxMs: number): Promise<void>
  /** Lo que se está haciendo (para que el usuario lo vea). */
  anunciar(texto: string): void
  readonly consola: MensajeConsola[]
  readonly red: PeticionRed[]
}

interface Punto {
  x: number
  y: number
  desc: string
  tapa: string | null
  deshabilitado: boolean
  archivo: boolean
}

export const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
export const recortar = (t: string): string => (t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO) + '\n[… recortado]' : t)
const BOTONES: Record<string, string> = { izquierdo: 'left', derecho: 'right', central: 'middle' }

/** Acciones que el motor resuelve igual en cualquier navegador (nombre sin prefijo: `clic`, `instantanea`…). */
export const ACCIONES_MOTOR = new Set(['ir', 'instantanea', 'clic', 'escribir', 'tecla', 'seleccionar', 'pasar_raton', 'desplazar', 'esperar', 'captura', 'consola', 'red', 'evaluar'])

/** Llama a una función de `window.__odesk` (mundo aislado). Los errores de la página vuelven como Error con su mensaje. */
export async function enPagina(c: CanalPagina, funcion: string, ...args: unknown[]): Promise<unknown> {
  const codigo = `${SCRIPT_PAGINA}\n;(() => { try { return { ok: window.__odesk.${funcion}(...${JSON.stringify(args)}) } } catch (e) { return { error: String((e && e.message) || e) } } })()`
  const r = (await Promise.race([c.aislado(codigo), espera(15_000).then(() => ({ error: 'La página no responde (¿sigue cargando o está colgada?).' }))])) as { ok?: unknown; error?: string } | undefined
  if (!r) throw new Error('La página no devolvió nada (¿se estaba recargando?). Repite.')
  if (r.error) throw new Error(r.error)
  return r.ok
}

/** Descripción de un elemento por su ref (para avisos y confirmaciones antes de actuar). */
export async function describirRef(c: CanalPagina, ref: string): Promise<string> {
  return ((await enPagina(c, 'punto', ref)) as Punto).desc
}

/** Estado de la página tras actuar: dónde está, si navegó, errores nuevos en la consola o en la red. */
export async function pie(c: CanalPagina, desde?: number, urlAntes?: string): Promise<string> {
  const s = await c.estado().catch(() => undefined)
  if (!s) return 'La página se cerró.'
  const lineas = [`Página: «${s.titulo}» — ${s.url}${s.cargando ? ' (sigue cargando)' : ''}${urlAntes && urlAntes !== s.url ? ' (navegó)' : ''}`]
  if (s.error) lineas.push(`Error al cargar: ${s.error}`)
  return lineas.join('\n') + (desde ? avisos(c, desde) : '')
}

export function avisos(c: CanalPagina, desde: number): string {
  const errores = c.consola.filter((m) => m.cuando >= desde && (m.nivel === 'error' || m.texto.startsWith('[diálogo')))
  const fallos = c.red.filter((r) => r.cuando >= desde && (r.error || (r.estado ?? 0) >= 400))
  const x: string[] = []
  if (errores.length) x.push(`Consola (${errores.length} nuevos):\n${errores.slice(-5).map((m) => `  [${m.nivel}] ${m.texto.slice(0, 300)}`).join('\n')}`)
  if (fallos.length) x.push(`Red con fallos (${fallos.length}):\n${fallos.slice(-5).map((r) => `  ${r.metodo} ${r.error ?? r.estado} ${r.url.slice(0, 200)}`).join('\n')}`)
  return x.length ? '\n' + x.join('\n') : ''
}

async function apuntar(c: CanalPagina, ref: string, exigirLibre = true): Promise<Punto> {
  const p = (await enPagina(c, 'punto', ref)) as Punto
  if (exigirLibre && p.deshabilitado) throw new Error(`${p.desc} está deshabilitado.`)
  if (exigirLibre && p.tapa) throw new Error(`No se puede hacer clic en ${p.desc}: lo tapa ${p.tapa} (¿un modal, un aviso de cookies o un menú abierto?).`)
  return p
}

async function marcar(c: CanalPagina, p: Punto, texto: string): Promise<void> {
  await enPagina(c, 'marcar', p.x, p.y, texto).catch(() => undefined)
  await espera(220) // lo justo para que se vea el círculo moverse antes del clic
}

async function raton(c: CanalPagina, tipo: string, p: Punto, extra: object = {}): Promise<void> {
  const z = await c.zoom()
  await c.cdp('Input.dispatchMouseEvent', { type: tipo, x: p.x * z, y: p.y * z, ...extra })
}

async function clic(c: CanalPagina, p: Punto, boton: string, veces: number): Promise<void> {
  await raton(c, 'mouseMoved', p)
  for (let i = 1; i <= veces; i++) {
    await raton(c, 'mousePressed', p, { button: boton, buttons: 1, clickCount: i })
    await raton(c, 'mouseReleased', p, { button: boton, buttons: 0, clickCount: i })
  }
}

export async function tecla(c: CanalPagina, spec: string): Promise<void> {
  const k = analizarTecla(spec)
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.modificadores }
  await c.cdp('Input.dispatchKeyEvent', { type: k.texto ? 'keyDown' : 'rawKeyDown', ...base, ...(k.texto ? { text: k.texto, unmodifiedText: k.texto } : {}) })
  await c.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

async function evaluar(c: CanalPagina, codigo: string): Promise<string> {
  type Res = { result?: { value?: unknown; type?: string; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
  const correr = (expresion: string): Promise<Res> => c.cdp<Res>('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 20_000 })
  // Primero como expresión (o función flecha sin argumentos); si no compila, como cuerpo de función (con return).
  let r = await correr(`(async () => { const __v = (${codigo}\n); return typeof __v === 'function' ? await __v() : await __v })()`)
  if (r.exceptionDetails?.exception?.description?.startsWith('SyntaxError')) r = await correr(`(async () => { ${codigo}\n})()`)
  if (r.exceptionDetails) throw new Error(`Error en la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'desconocido'}`)
  const valor = r.result?.value
  if (valor === undefined) return r.result?.type === 'undefined' ? 'undefined' : (r.result?.description ?? 'undefined')
  return typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2)
}

async function captura(c: CanalPagina, e: E): Promise<ResultadoHerramienta> {
  let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined
  let que = 'la parte visible de la página'
  if (typeof e.ref === 'string' && e.ref) {
    const r = (await enPagina(c, 'rect', e.ref)) as { x: number; y: number; ancho: number; alto: number; desc: string }
    if (r.ancho < 1 || r.alto < 1) throw new Error(`${r.desc} no tiene tamaño visible.`)
    clip = { x: r.x, y: r.y, width: r.ancho, height: r.alto, scale: 1 }
    que = r.desc
  } else if (e.completa === true) {
    const m = await c.cdp<{ cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }>('Page.getLayoutMetrics')
    const t = m.cssContentSize ?? m.contentSize
    clip = { x: 0, y: 0, width: Math.ceil(t.width), height: Math.min(Math.ceil(t.height), 16_000), scale: 1 }
    que = 'la página completa'
  }
  const { data } = await c.cdp<{ data: string }>('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) })
  let img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
  if (img.isEmpty()) throw new Error('La captura salió vacía (¿ventana minimizada?).')
  let { width, height } = img.getSize()
  if (width > ANCHO_CAPTURA) {
    img = img.resize({ width: ANCHO_CAPTURA, quality: 'good' })
    ;({ width, height } = img.getSize())
  }
  let cortada = false
  if (height > ALTO_MAX_CAPTURA) {
    img = img.crop({ x: 0, y: 0, width, height: ALTO_MAX_CAPTURA })
    height = ALTO_MAX_CAPTURA
    cortada = true
  }
  const jpeg = img.toJPEG(80)
  return {
    texto: `Captura de ${que} (${width}×${height} px${cortada ? ', cortada por abajo: es muy larga' : ''}).`,
    imagen: { datos: jpeg.toString('base64'), tipo: 'image/jpeg' }
  }
}

/**
 * Ejecuta una acción del motor (`accion` sin prefijo, ver `ACCIONES_MOTOR`). En `ir`, la `url` llega ya normalizada por quien llama
 * (cada navegador decide qué direcciones admite).
 */
export async function ejecutarAccion(c: CanalPagina, accion: string, e: E): Promise<ResultadoHerramienta> {
  const desde = Date.now()
  const urlAntes = (await c.estado().catch(() => undefined))?.url
  const hecho = async (texto: string, hacer: () => Promise<string>): Promise<ResultadoHerramienta> => {
    c.anunciar(texto)
    const r = await hacer()
    await c.esperarCarga(10_000)
    return { texto: `${r}\n${await pie(c, desde, urlAntes)}` }
  }
  switch (accion) {
    case 'ir': {
      if (typeof e.url === 'string' && e.url) {
        c.anunciar(`yendo a ${e.url}`)
        await c.navegar({ url: e.url })
      } else {
        const a = e.accion
        if (a !== 'atras' && a !== 'adelante' && a !== 'recargar') throw new Error('Indica url o accion (atras, adelante, recargar).')
        c.anunciar(String(a))
        await c.navegar({ accion: a })
      }
      await c.esperarCarga(15_000)
      return { texto: await pie(c, desde) }
    }
    case 'instantanea':
      c.anunciar('leyendo la página')
      return { texto: recortar(String(await enPagina(c, 'instantanea'))) + avisos(c, desde) }
    case 'clic': {
      const p = await apuntar(c, String(e.ref))
      if (p.archivo) throw new Error(`${p.desc} es un selector de archivos: no se puede elegir un archivo desde aquí.`)
      return hecho(`clic en ${p.desc}`, async () => {
        await marcar(c, p, `clic en ${p.desc}`)
        await clic(c, p, BOTONES[String(e.boton ?? 'izquierdo')] ?? 'left', e.doble === true ? 2 : 1)
        return `${e.doble === true ? 'Doble clic' : 'Clic'} en ${p.desc}.`
      })
    }
    case 'escribir': {
      const p = await apuntar(c, String(e.ref))
      const texto = String(e.texto ?? '')
      return hecho(`escribiendo en ${p.desc}`, async () => {
        await marcar(c, p, `escribiendo en ${p.desc}`)
        await clic(c, p, 'left', 1)
        if (e.limpiar !== false) {
          const seleccionado = await enPagina(c, 'seleccionarTodo', e.ref)
          if (!seleccionado) await tecla(c, 'Control+a')
          if (!texto) await tecla(c, 'Backspace')
        }
        if (texto) await c.cdp('Input.insertText', { text: texto })
        if (e.enviar === true) await tecla(c, 'Enter')
        return `Escrito en ${p.desc}${e.enviar === true ? ' y pulsado Intro' : ''}.`
      })
    }
    case 'tecla': {
      const t = String(e.tecla)
      analizarTecla(t) // valida antes de marcar nada
      return hecho(`tecla ${t}`, async () => (await tecla(c, t), `Pulsada ${t}.`))
    }
    case 'seleccionar': {
      const valores = (Array.isArray(e.valores) ? e.valores : [e.valores]).map(String)
      return hecho('eligiendo una opción', async () => {
        const p = await apuntar(c, String(e.ref), false)
        await marcar(c, p, `eligiendo en ${p.desc}`)
        const elegidas = (await enPagina(c, 'elegir', e.ref, valores)) as string[]
        return `Elegido en ${p.desc}: ${elegidas.join(', ')}.`
      })
    }
    case 'pasar_raton': {
      const p = await apuntar(c, String(e.ref), false)
      return hecho(`ratón sobre ${p.desc}`, async () => {
        await marcar(c, p, `ratón sobre ${p.desc}`)
        await raton(c, 'mouseMoved', p)
        return `Ratón sobre ${p.desc}.`
      })
    }
    case 'desplazar': {
      if (typeof e.ref === 'string' && e.ref) return hecho('desplazando', async () => `Vista llevada a ${String(await enPagina(c, 'llevar', e.ref))}.`)
      const { ancho, alto } = await c.vista()
      const pixeles = typeof e.pixeles === 'number' ? e.pixeles : Math.round(alto * 0.85)
      const z = await c.zoom()
      return hecho('desplazando', async () => {
        await c.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: ancho / 2, y: alto / 2, deltaX: 0, deltaY: pixeles * z })
        await espera(250)
        return `Desplazado ${pixeles} px.`
      })
    }
    case 'esperar': {
      c.anunciar('esperando')
      const tope = Math.min(Math.max(Number(e.segundos) || 0, 0) * 1000 || (e.texto || e.desaparece ? 10_000 : 1000), MAX_ESPERA_MS)
      if (typeof e.texto !== 'string' && typeof e.desaparece !== 'string') {
        await espera(tope)
        return { texto: `Esperados ${Math.round(tope / 1000)} s.\n${await pie(c, desde)}` }
      }
      const fin = Date.now() + tope
      for (;;) {
        const aparece = typeof e.texto !== 'string' || ((await enPagina(c, 'tieneTexto', e.texto).catch(() => false)) as boolean)
        const seFue = typeof e.desaparece !== 'string' || !((await enPagina(c, 'tieneTexto', e.desaparece).catch(() => true)) as boolean)
        if (aparece && seFue) return { texto: `Listo${e.texto ? `: aparece «${String(e.texto)}»` : ''}${e.desaparece ? `${e.texto ? ' y' : ':'} ya no está «${String(e.desaparece)}»` : ''}.\n${await pie(c, desde)}` }
        if (Date.now() > fin) throw new Error(`Pasaron ${Math.round(tope / 1000)} s y ${!aparece ? `no aparece «${String(e.texto)}»` : `sigue «${String(e.desaparece)}»`}.\n${await pie(c, desde)}`)
        await espera(300)
      }
    }
    case 'captura':
      c.anunciar('haciendo una captura')
      return captura(c, e)
    case 'consola': {
      const lista = c.consola.filter((m) => e.solo_errores !== true || m.nivel === 'error' || m.nivel === 'warning').slice(-150)
      if (e.limpiar === true) c.consola.length = 0
      if (!lista.length) return { texto: e.solo_errores === true ? 'Sin errores ni avisos en la consola.' : 'La consola está vacía.' }
      return { texto: recortar(lista.map((m) => `[${m.nivel}] ${m.texto}${m.origen ? `  (${m.origen})` : ''}`).join('\n')) }
    }
    case 'red': {
      const filtro = typeof e.filtro === 'string' ? e.filtro : ''
      const lista = c.red.filter((r) => (e.solo_fallos !== true || r.error || (r.estado ?? 0) >= 400) && (!filtro || r.url.includes(filtro))).slice(-150)
      if (e.limpiar === true) c.red.length = 0
      if (!lista.length) return { texto: 'No hay peticiones que mostrar.' }
      return { texto: recortar(lista.map((r) => `${r.metodo} ${r.error ? `ERROR ${r.error}` : r.estado} ${r.tipo} ${r.url}`).join('\n')) }
    }
    case 'evaluar':
      c.anunciar('ejecutando JavaScript')
      return { texto: recortar(await evaluar(c, String(e.codigo))) + avisos(c, desde) }
  }
  throw new Error(`Acción del navegador desconocida: ${accion}`)
}
