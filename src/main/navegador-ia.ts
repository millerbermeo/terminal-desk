import { nativeImage, type WebContents } from 'electron'
import type { ResultadoHerramienta } from '@shared/core/herramientas'
import { analizarTecla, normalizarUrl } from '@shared/navegador'
import type { ControlNavegador } from './core/herramientas-odesk'
import type { Entrada, GestorNavegador } from './navegador'
import { MUNDO_AISLADO, SCRIPT_PAGINA } from './navegador-pagina'

const MAX_TEXTO = 40_000
const ANCHO_CAPTURA = 1280
/** Las imágenes de más de 8000 px de lado no se aceptan: una página muy larga se corta. */
const ALTO_MAX_CAPTURA = 7800
const MAX_ESPERA_MS = 30_000

type E = Record<string, unknown>
interface Punto {
  x: number
  y: number
  desc: string
  tapa: string | null
  deshabilitado: boolean
  archivo: boolean
}

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const recortar = (t: string): string => (t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO) + '\n[… recortado]' : t)
const BOTONES: Record<string, string> = { izquierdo: 'left', derecho: 'right', central: 'middle' }

/**
 * La IA maneja el navegador integrado (`GestorNavegador`): las mismas ventanas que usa la persona, visibles, varias a la vez. Habla con
 * cada página por el depurador de Electron (protocolo de DevTools sin abrir ningún puerto) y lee la página desde un mundo aislado.
 * Solo toca las vistas web del navegador, nunca las ventanas de la aplicación.
 */
export class NavegadorIA implements ControlNavegador {
  /** Última ventana que usó la IA: la de por defecto cuando no indica `ventana`. */
  private ultima?: number
  private readonly conectadas = new Set<number>()
  /** Una acción a la vez por ventana: dos conversaciones sobre la misma ventana no se pisan el ratón. */
  private readonly colas = new Map<number, Promise<unknown>>()

  constructor(private readonly gestor: GestorNavegador) {}

  async ejecutar(nombre: string, e: E): Promise<ResultadoHerramienta> {
    if (nombre === 'navegador_abrir') return this.abrir(e)
    if (nombre === 'navegador_ventanas') return { texto: this.listar() }
    const v = this.ventana(e.ventana)
    const previa = this.colas.get(v.id) ?? Promise.resolve()
    const actual = previa.catch(() => undefined).then(() => this.enVentana(nombre, v, e))
    this.colas.set(v.id, actual)
    try {
      return await actual
    } finally {
      if (this.colas.get(v.id) === actual) this.colas.delete(v.id)
    }
  }

  private listar(): string {
    const lista = this.gestor.lista()
    if (!lista.length) return 'No hay ventanas del navegador abiertas. Abre una con navegador_abrir.'
    return lista
      .map((x) => {
        const wc = x.vista.webContents
        const marcas = [x.ia ? 'IA' : 'usuario', ...(wc.isLoading() ? ['cargando'] : []), ...(x.id === this.ultima ? ['la última que usaste'] : []), ...(x.error ? [`error: ${x.error}`] : [])]
        return `ventana ${x.id}: «${wc.getTitle()}» — ${wc.getURL()} (${marcas.join(', ')})`
      })
      .join('\n')
  }

  private ventana(v: unknown): Entrada {
    if (typeof v === 'number') {
      const e = this.gestor.entrada(v)
      if (!e) throw new Error(`No hay ninguna ventana ${v}.\n${this.listar()}`)
      this.ultima = v
      return e
    }
    const ultima = this.ultima !== undefined ? this.gestor.entrada(this.ultima) : undefined
    if (ultima) return ultima
    const lista = this.gestor.lista()
    if (lista.length === 1) return ((this.ultima = lista[0]!.id), lista[0]!)
    if (!lista.length) throw new Error('No hay ventanas del navegador abiertas: abre una con navegador_abrir.')
    throw new Error(`Hay varias ventanas abiertas: indica «ventana».\n${this.listar()}`)
  }

  private async abrir(e: E): Promise<ResultadoHerramienta> {
    const ancho = typeof e.ancho === 'number' ? Math.min(Math.max(e.ancho, 320), 3840) : undefined
    const alto = typeof e.alto === 'number' ? Math.min(Math.max(e.alto, 240), 2400) : undefined
    const id = this.gestor.abrir(String(e.url), { ia: true, ...(ancho ? { ancho } : {}), ...(alto ? { alto } : {}) })
    this.ultima = id
    const v = this.gestor.entrada(id)!
    this.gestor.marcarIA(id, 'abriendo la página')
    await this.conectar(v.vista.webContents)
    await this.asentar(v.vista.webContents, 15_000)
    return { texto: `Ventana ${id} abierta.\n${this.pie(v)}` }
  }

  private async enVentana(nombre: string, v: Entrada, e: E): Promise<ResultadoHerramienta> {
    const wc = v.vista.webContents
    await this.conectar(wc)
    const desde = Date.now()
    const urlAntes = wc.getURL()
    const accion = async (texto: string, hacer: () => Promise<string>): Promise<ResultadoHerramienta> => {
      this.gestor.marcarIA(v.id, texto)
      const r = await hacer()
      await this.asentar(wc)
      return { texto: `${r}\n${this.pie(v, desde, urlAntes)}` }
    }
    switch (nombre) {
      case 'navegador_ir': {
        if (typeof e.url === 'string' && e.url) {
          const n = normalizarUrl(e.url)
          if ('error' in n) throw new Error(n.error)
          this.gestor.marcarIA(v.id, `yendo a ${n.url}`)
          await wc.loadURL(n.url).catch(() => undefined) // el fallo llega como error de la ventana
          await this.asentar(wc, 15_000)
          return { texto: this.pie(v, desde) }
        }
        const a = e.accion
        if (a === 'atras') wc.navigationHistory.goBack()
        else if (a === 'adelante') wc.navigationHistory.goForward()
        else if (a === 'recargar') wc.reload()
        else throw new Error('Indica url o accion (atras, adelante, recargar).')
        this.gestor.marcarIA(v.id, String(a))
        await this.asentar(wc, 15_000)
        return { texto: this.pie(v, desde) }
      }
      case 'navegador_instantanea':
        this.gestor.marcarIA(v.id, 'leyendo la página')
        return { texto: recortar(String(await this.pagina(wc, 'instantanea'))) + this.avisos(v, desde) }
      case 'navegador_clic': {
        const p = await this.apuntar(wc, String(e.ref))
        if (p.archivo) throw new Error(`${p.desc} es un selector de archivos: no se puede elegir un archivo desde aquí.`)
        return accion(`clic en ${p.desc}`, async () => {
          await this.marcar(wc, p, `clic en ${p.desc}`)
          await this.clic(wc, p, BOTONES[String(e.boton ?? 'izquierdo')] ?? 'left', e.doble === true ? 2 : 1)
          return `${e.doble === true ? 'Doble clic' : 'Clic'} en ${p.desc}.`
        })
      }
      case 'navegador_escribir': {
        const p = await this.apuntar(wc, String(e.ref))
        const texto = String(e.texto ?? '')
        return accion(`escribiendo en ${p.desc}`, async () => {
          await this.marcar(wc, p, `escribiendo en ${p.desc}`)
          await this.clic(wc, p, 'left', 1)
          if (e.limpiar !== false) {
            const seleccionado = await this.pagina(wc, 'seleccionarTodo', e.ref)
            if (!seleccionado) await this.tecla(wc, 'Control+a')
            if (!texto) await this.tecla(wc, 'Backspace')
          }
          if (texto) await this.cdp(wc, 'Input.insertText', { text: texto })
          if (e.enviar === true) await this.tecla(wc, 'Enter')
          return `Escrito en ${p.desc}${e.enviar === true ? ' y pulsado Intro' : ''}.`
        })
      }
      case 'navegador_tecla': {
        const tecla = String(e.tecla)
        analizarTecla(tecla) // valida antes de marcar nada
        return accion(`tecla ${tecla}`, async () => (await this.tecla(wc, tecla), `Pulsada ${tecla}.`))
      }
      case 'navegador_seleccionar': {
        const valores = (Array.isArray(e.valores) ? e.valores : [e.valores]).map(String)
        return accion('eligiendo una opción', async () => {
          const p = await this.apuntar(wc, String(e.ref), false)
          await this.marcar(wc, p, `eligiendo en ${p.desc}`)
          const elegidas = (await this.pagina(wc, 'elegir', e.ref, valores)) as string[]
          return `Elegido en ${p.desc}: ${elegidas.join(', ')}.`
        })
      }
      case 'navegador_pasar_raton': {
        const p = await this.apuntar(wc, String(e.ref), false)
        return accion(`ratón sobre ${p.desc}`, async () => {
          await this.marcar(wc, p, `ratón sobre ${p.desc}`)
          await this.raton(wc, 'mouseMoved', p)
          return `Ratón sobre ${p.desc}.`
        })
      }
      case 'navegador_desplazar': {
        if (typeof e.ref === 'string' && e.ref) return accion('desplazando', async () => `Vista llevada a ${String(await this.pagina(wc, 'llevar', e.ref))}.`)
        const { width: ancho, height: alto } = v.vista.getBounds()
        const pixeles = typeof e.pixeles === 'number' ? e.pixeles : Math.round(alto * 0.85)
        const z = wc.getZoomFactor()
        return accion('desplazando', async () => {
          await this.cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: ancho / 2, y: alto / 2, deltaX: 0, deltaY: pixeles * z })
          await espera(250)
          return `Desplazado ${pixeles} px.`
        })
      }
      case 'navegador_esperar': {
        this.gestor.marcarIA(v.id, 'esperando')
        const tope = Math.min(Math.max(Number(e.segundos) || 0, 0) * 1000 || (e.texto || e.desaparece ? 10_000 : 1000), MAX_ESPERA_MS)
        if (typeof e.texto !== 'string' && typeof e.desaparece !== 'string') {
          await espera(tope)
          return { texto: `Esperados ${Math.round(tope / 1000)} s.\n${this.pie(v, desde)}` }
        }
        const fin = Date.now() + tope
        for (;;) {
          const aparece = typeof e.texto !== 'string' || ((await this.pagina(wc, 'tieneTexto', e.texto).catch(() => false)) as boolean)
          const seFue = typeof e.desaparece !== 'string' || !((await this.pagina(wc, 'tieneTexto', e.desaparece).catch(() => true)) as boolean)
          if (aparece && seFue) return { texto: `Listo${e.texto ? `: aparece «${String(e.texto)}»` : ''}${e.desaparece ? `${e.texto ? ' y' : ':'} ya no está «${String(e.desaparece)}»` : ''}.\n${this.pie(v, desde)}` }
          if (Date.now() > fin) throw new Error(`Pasaron ${Math.round(tope / 1000)} s y ${!aparece ? `no aparece «${String(e.texto)}»` : `sigue «${String(e.desaparece)}»`}.\n${this.pie(v, desde)}`)
          await espera(300)
        }
      }
      case 'navegador_captura':
        this.gestor.marcarIA(v.id, 'haciendo una captura')
        return this.captura(wc, e)
      case 'navegador_consola': {
        const lista = v.consola.filter((m) => e.solo_errores !== true || m.nivel === 'error' || m.nivel === 'warning').slice(-150)
        if (e.limpiar === true) v.consola.length = 0
        if (!lista.length) return { texto: e.solo_errores === true ? 'Sin errores ni avisos en la consola.' : 'La consola está vacía.' }
        return { texto: recortar(lista.map((m) => `[${m.nivel}] ${m.texto}${m.origen ? `  (${m.origen})` : ''}`).join('\n')) }
      }
      case 'navegador_red': {
        const filtro = typeof e.filtro === 'string' ? e.filtro : ''
        const lista = v.red.filter((r) => (e.solo_fallos !== true || r.error || (r.estado ?? 0) >= 400) && (!filtro || r.url.includes(filtro))).slice(-150)
        if (e.limpiar === true) v.red.length = 0
        if (!lista.length) return { texto: 'No hay peticiones que mostrar.' }
        return { texto: recortar(lista.map((r) => `${r.metodo} ${r.error ? `ERROR ${r.error}` : r.estado} ${r.tipo} ${r.url}`).join('\n')) }
      }
      case 'navegador_evaluar':
        this.gestor.marcarIA(v.id, 'ejecutando JavaScript')
        return { texto: recortar(await this.evaluar(wc, String(e.codigo))) + this.avisos(v, desde) }
      case 'navegador_tamano': {
        const ancho = Math.min(Math.max(Number(e.ancho), 320), 3840)
        const alto = Math.min(Math.max(Number(e.alto), 240), 2400)
        this.gestor.redimensionar(v.id, ancho, alto)
        this.gestor.marcarIA(v.id, `tamaño ${ancho}×${alto}`)
        await espera(300)
        return { texto: `Página a ${ancho}×${alto} px.\n${this.pie(v, desde)}` }
      }
      case 'navegador_cerrar': {
        // close() es asíncrono: se espera a que la ventana desaparezca de verdad para que la lista ya no la muestre.
        const cerrada = new Promise<void>((r) => (v.win.once('closed', () => r()), setTimeout(r, 3000)))
        v.win.close()
        await cerrada
        if (this.ultima === v.id) this.ultima = undefined
        return { texto: `Ventana ${v.id} cerrada.` }
      }
    }
    throw new Error(`Herramienta del navegador desconocida: ${nombre}`)
  }

  /** Engancha el depurador a la página (una vez): foco simulado para que varias ventanas respondan a la vez, y diálogos aceptados solos. */
  private async conectar(wc: WebContents): Promise<void> {
    if (this.conectadas.has(wc.id) && wc.debugger.isAttached()) return
    const id = wc.id
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    } catch (err) {
      throw new Error(`No se pudo controlar la página (${(err as Error).message}). Si tienes abiertas sus herramientas de desarrollo, ciérralas y repite.`, { cause: err })
    }
    this.conectadas.add(id)
    wc.debugger.on('detach', () => this.conectadas.delete(id))
    wc.once('destroyed', () => this.conectadas.delete(id))
    wc.debugger.on('message', (_e, metodo, params: { type?: string; message?: string; defaultPrompt?: string }) => {
      if (metodo !== 'Page.javascriptDialogOpening') return
      // alert/confirm/prompt bloquean la página: la IA no puede pulsar el diálogo nativo, así que se acepta y queda en la consola.
      const v = this.gestor.lista().find((x) => x.vista.webContents.id === id)
      v?.consola.push({ nivel: 'warning', texto: `[diálogo ${params.type ?? ''}] ${params.message ?? ''} → aceptado automáticamente`, cuando: Date.now() })
      void wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true, promptText: params.defaultPrompt ?? '' }).catch(() => undefined)
    })
    await this.cdp(wc, 'Page.enable')
    await this.cdp(wc, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
  }

  private async cdp<T = unknown>(wc: WebContents, metodo: string, params: object = {}): Promise<T> {
    if (wc.isDestroyed()) throw new Error('La ventana se cerró.')
    return (await wc.debugger.sendCommand(metodo, params)) as T
  }

  /** Llama a una función de `window.__odesk` (mundo aislado). Los errores de la página vuelven como Error con su mensaje. */
  private async pagina(wc: WebContents, funcion: string, ...args: unknown[]): Promise<unknown> {
    const codigo = `${SCRIPT_PAGINA}\n;(() => { try { return { ok: window.__odesk.${funcion}(...${JSON.stringify(args)}) } } catch (e) { return { error: String((e && e.message) || e) } } })()`
    const r = (await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(MUNDO_AISLADO, [{ code: codigo }], true),
      espera(15_000).then(() => ({ error: 'La página no responde (¿sigue cargando o está colgada?).' }))
    ])) as { ok?: unknown; error?: string } | undefined
    if (!r) throw new Error('La página no devolvió nada (¿se estaba recargando?). Repite.')
    if (r.error) throw new Error(r.error)
    return r.ok
  }

  private async apuntar(wc: WebContents, ref: string, exigirLibre = true): Promise<Punto> {
    const p = (await this.pagina(wc, 'punto', ref)) as Punto
    if (exigirLibre && p.deshabilitado) throw new Error(`${p.desc} está deshabilitado.`)
    if (exigirLibre && p.tapa) throw new Error(`No se puede hacer clic en ${p.desc}: lo tapa ${p.tapa} (¿un modal, un aviso de cookies o un menú abierto?).`)
    return p
  }

  private async marcar(wc: WebContents, p: Punto, texto: string): Promise<void> {
    await this.pagina(wc, 'marcar', p.x, p.y, texto).catch(() => undefined)
    await espera(220) // lo justo para que se vea el círculo moverse antes del clic
  }

  private async raton(wc: WebContents, tipo: string, p: Punto, extra: object = {}): Promise<void> {
    const z = wc.getZoomFactor()
    await this.cdp(wc, 'Input.dispatchMouseEvent', { type: tipo, x: p.x * z, y: p.y * z, ...extra })
  }

  private async clic(wc: WebContents, p: Punto, boton: string, veces: number): Promise<void> {
    await this.raton(wc, 'mouseMoved', p)
    for (let i = 1; i <= veces; i++) {
      await this.raton(wc, 'mousePressed', p, { button: boton, buttons: 1, clickCount: i })
      await this.raton(wc, 'mouseReleased', p, { button: boton, buttons: 0, clickCount: i })
    }
  }

  private async tecla(wc: WebContents, spec: string): Promise<void> {
    const k = analizarTecla(spec)
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.modificadores }
    await this.cdp(wc, 'Input.dispatchKeyEvent', { type: k.texto ? 'keyDown' : 'rawKeyDown', ...base, ...(k.texto ? { text: k.texto, unmodifiedText: k.texto } : {}) })
    await this.cdp(wc, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Tras una acción: si arrancó una navegación, se espera a que termine (como haría una persona antes de mirar). */
  private async asentar(wc: WebContents, maxMs = 10_000): Promise<void> {
    await espera(200)
    if (wc.isDestroyed() || !wc.isLoading()) return
    await new Promise<void>((resolver) => {
      const fin = (): void => {
        clearTimeout(t)
        if (!wc.isDestroyed()) wc.off('did-stop-loading', fin)
        resolver()
      }
      const t = setTimeout(fin, maxMs)
      wc.on('did-stop-loading', fin)
    })
    await espera(150)
  }

  /** Estado de la página tras actuar: dónde está, si navegó, errores nuevos en la consola o en la red. */
  private pie(v: Entrada, desde?: number, urlAntes?: string): string {
    const wc = v.vista.webContents
    if (wc.isDestroyed()) return 'La ventana se cerró.'
    const url = wc.getURL()
    const lineas = [`Página: «${wc.getTitle()}» — ${url}${wc.isLoading() ? ' (sigue cargando)' : ''}${urlAntes && urlAntes !== url ? ' (navegó)' : ''}`]
    if (v.error) lineas.push(`Error al cargar: ${v.error}`)
    return lineas.join('\n') + (desde ? this.avisos(v, desde) : '')
  }

  private avisos(v: Entrada, desde: number): string {
    const errores = v.consola.filter((m) => m.cuando >= desde && (m.nivel === 'error' || m.texto.startsWith('[diálogo')))
    const fallos = v.red.filter((r) => r.cuando >= desde && (r.error || (r.estado ?? 0) >= 400))
    const x: string[] = []
    if (errores.length) x.push(`Consola (${errores.length} nuevos):\n${errores.slice(-5).map((m) => `  [${m.nivel}] ${m.texto.slice(0, 300)}`).join('\n')}`)
    if (fallos.length) x.push(`Red con fallos (${fallos.length}):\n${fallos.slice(-5).map((r) => `  ${r.metodo} ${r.error ?? r.estado} ${r.url.slice(0, 200)}`).join('\n')}`)
    return x.length ? '\n' + x.join('\n') : ''
  }

  private async evaluar(wc: WebContents, codigo: string): Promise<string> {
    type Res = { result?: { value?: unknown; type?: string; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
    const correr = (expresion: string): Promise<Res> => this.cdp<Res>(wc, 'Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 20_000 })
    // Primero como expresión (o función flecha sin argumentos); si no compila, como cuerpo de función (con return).
    let r = await correr(`(async () => { const __v = (${codigo}\n); return typeof __v === 'function' ? await __v() : await __v })()`)
    if (r.exceptionDetails?.exception?.description?.startsWith('SyntaxError')) r = await correr(`(async () => { ${codigo}\n})()`)
    if (r.exceptionDetails) throw new Error(`Error en la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'desconocido'}`)
    const valor = r.result?.value
    if (valor === undefined) return r.result?.type === 'undefined' ? 'undefined' : (r.result?.description ?? 'undefined')
    return typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2)
  }

  private async captura(wc: WebContents, e: E): Promise<ResultadoHerramienta> {
    let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined
    let que = 'la parte visible de la página'
    if (typeof e.ref === 'string' && e.ref) {
      const r = (await this.pagina(wc, 'rect', e.ref)) as { x: number; y: number; ancho: number; alto: number; desc: string }
      if (r.ancho < 1 || r.alto < 1) throw new Error(`${r.desc} no tiene tamaño visible.`)
      clip = { x: r.x, y: r.y, width: r.ancho, height: r.alto, scale: 1 }
      que = r.desc
    } else if (e.completa === true) {
      const m = await this.cdp<{ cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }>(wc, 'Page.getLayoutMetrics')
      const t = m.cssContentSize ?? m.contentSize
      clip = { x: 0, y: 0, width: Math.ceil(t.width), height: Math.min(Math.ceil(t.height), 16_000), scale: 1 }
      que = 'la página completa'
    }
    const { data } = await this.cdp<{ data: string }>(wc, 'Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) })
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
}
