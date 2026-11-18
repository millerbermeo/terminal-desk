import type { WebContents } from 'electron'
import type { ResultadoHerramienta } from '@shared/core/herramientas'
import { normalizarUrl } from '@shared/navegador'
import type { ControlNavegador } from './core/herramientas-odesk'
import type { Entrada, GestorNavegador } from './navegador'
import { ACCIONES_MOTOR, ejecutarAccion, espera, pie, type CanalPagina, type E } from './navegador-motor'
import { MUNDO_AISLADO } from './navegador-pagina'

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
    const c = this.canal(v)
    await c.esperarCarga(15_000)
    return { texto: `Ventana ${id} abierta.\n${await pie(c)}` }
  }

  private async enVentana(nombre: string, v: Entrada, e: E): Promise<ResultadoHerramienta> {
    const wc = v.vista.webContents
    await this.conectar(wc)
    const desde = Date.now()
    const c = this.canal(v)
    const accion = nombre.slice('navegador_'.length)
    if (ACCIONES_MOTOR.has(accion)) {
      if (accion === 'ir' && typeof e.url === 'string' && e.url) {
        const n = normalizarUrl(e.url)
        if ('error' in n) throw new Error(n.error)
        return ejecutarAccion(c, accion, { ...e, url: n.url })
      }
      return ejecutarAccion(c, accion, e)
    }
    switch (nombre) {
      case 'navegador_tamano': {
        const ancho = Math.min(Math.max(Number(e.ancho), 320), 3840)
        const alto = Math.min(Math.max(Number(e.alto), 240), 2400)
        this.gestor.redimensionar(v.id, ancho, alto)
        this.gestor.marcarIA(v.id, `tamaño ${ancho}×${alto}`)
        await espera(300)
        return { texto: `Página a ${ancho}×${alto} px.\n${await pie(c, desde)}` }
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

  /** La ventana vista por el motor común (`navegador-motor.ts`). */
  private canal(v: Entrada): CanalPagina {
    const wc = v.vista.webContents
    return {
      cdp: (metodo, params = {}) => this.cdp(wc, metodo, params),
      aislado: (codigo) => {
        if (wc.isDestroyed()) return Promise.reject(new Error('La ventana se cerró.'))
        return wc.executeJavaScriptInIsolatedWorld(MUNDO_AISLADO, [{ code: codigo }], true)
      },
      zoom: async () => wc.getZoomFactor(),
      vista: async () => {
        const { width, height } = v.vista.getBounds()
        return { ancho: width, alto: height }
      },
      estado: async () => {
        if (wc.isDestroyed()) throw new Error('La ventana se cerró.')
        return { url: wc.getURL(), titulo: wc.getTitle(), cargando: wc.isLoading(), error: v.error }
      },
      navegar: async (d) => {
        if ('url' in d) return void (await wc.loadURL(d.url).catch(() => undefined)) // el fallo llega como error de la ventana
        if (d.accion === 'atras') wc.navigationHistory.goBack()
        else if (d.accion === 'adelante') wc.navigationHistory.goForward()
        else wc.reload()
      },
      esperarCarga: (maxMs) => this.asentar(wc, maxMs),
      anunciar: (texto) => this.gestor.marcarIA(v.id, texto),
      consola: v.consola,
      red: v.red
    }
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
}
