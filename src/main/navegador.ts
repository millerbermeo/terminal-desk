import { app, BrowserWindow, screen, session, shell, WebContentsView, type WebContents } from 'electron'
import { join } from 'node:path'
import { Canales } from '@shared/ipc'
import { ALTO_BARRA_NAVEGADOR, normalizarUrl, esDireccionLocal, type AccionNavegador, type EstadoNavegador } from '@shared/navegador'

const PARTICION = 'persist:navegador'
const MAX_VENTANAS = 16
/** Mensajes de consola y peticiones de red que se recuerdan por ventana (para que la IA los consulte). */
const MAX_REGISTROS = 300

export interface MensajeConsola {
  nivel: 'debug' | 'info' | 'warning' | 'error'
  texto: string
  origen?: string
  cuando: number
}

export interface PeticionRed {
  metodo: string
  url: string
  estado?: number
  tipo: string
  error?: string
  cuando: number
}

export interface Entrada {
  id: number
  win: BrowserWindow
  vista: WebContentsView
  barra: WebContents
  error?: string
  /** La abrió la IA, o la IA ya la ha manejado: la barra lo indica. */
  ia: boolean
  /** Última acción de la IA en esta ventana (se ve en la barra). */
  accionIA?: string
  consola: MensajeConsola[]
  red: PeticionRed[]
}

export interface OpcionesAbrir {
  /** La abre la IA: no roba el foco y se coloca en cascada para que se vean varias a la vez. */
  ia?: boolean
  /** Tamaño de la página (sin la barra). */
  ancho?: number
  alto?: number
}

const anadir = <T>(lista: T[], x: T): void => {
  lista.push(x)
  if (lista.length > MAX_REGISTROS) lista.splice(0, lista.length - MAX_REGISTROS)
}

const protocoloWeb = (url: string): boolean => /^https?:\/\//i.test(url)

/**
 * Navegador integrado para probar lo que se desarrolla: una ventana con barra de direcciones propia (nuestra interfaz) y, debajo, una
 * vista web aislada (sin acceso a Node ni a la aplicación, con su propia sesión). Solo http y https; sin permisos del sistema.
 */
export class GestorNavegador {
  private readonly ventanas = new Map<number, Entrada>()
  private siguiente = 1
  private preparado = false
  private abiertasIA = 0

  constructor(
    private readonly cargarBarra: (win: BrowserWindow, id: number) => void,
    private readonly icono: string,
    private readonly preload: string
  ) {}

  /** Configura la sesión del navegador. Se hace al abrir la primera ventana: antes de que la aplicación esté lista no hay sesiones. */
  private preparar(): void {
    if (this.preparado) return
    this.preparado = true
    const ses = session.fromPartition(PARTICION)
    // Una página que se está probando no necesita cámara, ubicación ni notificaciones: se deniega todo salvo copiar y pantalla completa.
    const permitido = (p: string): boolean => p === 'clipboard-sanitized-write' || p === 'fullscreen'
    ses.setPermissionRequestHandler((_wc, permiso, respuesta) => respuesta(permitido(permiso)))
    ses.setPermissionCheckHandler((_wc, permiso) => permitido(permiso))
    // Peticiones de red por ventana (la IA las consulta con navegador_red). La sesión solo la usa el navegador integrado.
    const deVista = (wcId: number | undefined): Entrada | undefined => {
      if (wcId === undefined) return undefined
      for (const e of this.ventanas.values()) if (!e.vista.webContents.isDestroyed() && e.vista.webContents.id === wcId) return e
      return undefined
    }
    ses.webRequest.onCompleted((d) => {
      const e = deVista(d.webContentsId)
      if (e) anadir(e.red, { metodo: d.method, url: d.url, estado: d.statusCode, tipo: d.resourceType, cuando: Date.now() })
    })
    ses.webRequest.onErrorOccurred((d) => {
      const e = deVista(d.webContentsId)
      if (e && d.error !== 'net::ERR_ABORTED') anadir(e.red, { metodo: d.method, url: d.url, tipo: d.resourceType, error: d.error.replace(/^net::/, ''), cuando: Date.now() })
    })
    // Servidores locales con https autofirmado: se aceptan solo en esta máquina o red local.
    app.on('certificate-error', (evento, wc, url, _error, _cert, respuesta) => {
      if (!this.esVista(wc)) return respuesta(false)
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        /* url ilegible: se rechaza */
      }
      if (host && esDireccionLocal(host)) {
        evento.preventDefault()
        respuesta(true)
      } else respuesta(false)
    })
  }

  private esVista(wc: WebContents): boolean {
    for (const e of this.ventanas.values()) if (e.vista.webContents.id === wc.id) return true
    return false
  }

  abrir(entrada: string, opciones: OpcionesAbrir = {}): number {
    this.preparar()
    const n = normalizarUrl(entrada)
    if ('error' in n) throw new Error(n.error)
    if (this.ventanas.size >= MAX_VENTANAS) throw new Error(`Hay demasiadas ventanas de navegador abiertas (${MAX_VENTANAS}): cierra alguna.`)
    const id = this.siguiente++
    const ancho = opciones.ancho ? Math.round(opciones.ancho) : 1280
    const alto = opciones.alto ? Math.round(opciones.alto) + ALTO_BARRA_NAVEGADOR : 820
    const posicion = opciones.ia ? this.enCascada(ancho, alto) : {}
    const win = new BrowserWindow({
      width: ancho,
      height: alto,
      ...posicion,
      useContentSize: true,
      show: !opciones.ia,
      minWidth: 320,
      minHeight: 320,
      title: 'Navegador',
      icon: this.icono,
      backgroundColor: '#0b0c0f',
      autoHideMenuBar: true,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    const vista = new WebContentsView({ webPreferences: { partition: PARTICION, contextIsolation: true, nodeIntegration: false, sandbox: true } })
    const entradaMapa: Entrada = { id, win, vista, barra: win.webContents, ia: opciones.ia === true, consola: [], red: [] }
    this.ventanas.set(id, entradaMapa)
    win.contentView.addChildView(vista)
    if (opciones.ia) win.showInactive() // a la vista, pero sin quitarle el teclado al usuario

    const ajustar = (): void => {
      const { width, height } = win.getContentBounds()
      vista.setBounds({ x: 0, y: ALTO_BARRA_NAVEGADOR, width, height: Math.max(0, height - ALTO_BARRA_NAVEGADOR) })
    }
    ajustar()
    win.on('resize', ajustar)
    win.on('maximize', ajustar)
    win.on('unmaximize', ajustar)
    win.on('enter-full-screen', ajustar)
    win.on('leave-full-screen', ajustar)

    const wc = vista.webContents
    const avisar = (): void => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(Canales.navegadorEstado, this.estado(id))
    }
    wc.on('did-start-loading', () => {
      delete entradaMapa.error
      avisar()
    })
    wc.on('did-stop-loading', avisar)
    wc.on('did-navigate', avisar)
    wc.on('did-navigate-in-page', avisar)
    wc.on('page-title-updated', (_e, titulo) => {
      if (!win.isDestroyed()) win.setTitle(`${titulo} · Navegador`)
      avisar()
    })
    wc.on('did-fail-load', (_e, codigo, descripcion, _url, esPrincipal) => {
      if (!esPrincipal || codigo === -3) return // -3: navegación cancelada por otra nueva
      entradaMapa.error = descripcion.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase()
      avisar()
    })
    // Solo se navega a páginas web: nada de file:, javascript: ni protocolos de la aplicación.
    const bloquear = (e: Electron.Event, url: string): void => {
      if (!protocoloWeb(url)) e.preventDefault()
    }
    wc.on('will-navigate', (e) => bloquear(e, e.url))
    wc.on('will-redirect', (e) => bloquear(e, e.url))
    wc.setWindowOpenHandler(({ url }) => {
      if (protocoloWeb(url)) void wc.loadURL(url).catch(() => undefined) // ventanas emergentes (p. ej. un inicio de sesión) se abren en la misma vista
      return { action: 'deny' }
    })
    wc.on('console-message', (d) => {
      if (d.message.startsWith('%cElectron Security Warning')) return // aviso de Electron en desarrollo, no de la página
      anadir(entradaMapa.consola, { nivel: d.level, texto: d.message, ...(d.sourceId ? { origen: `${d.sourceId}:${d.lineNumber}` } : {}), cuando: Date.now() })
    })
    wc.on('render-process-gone', (_e, d) => {
      entradaMapa.error = `la página se cerró (${d.reason})`
      avisar()
    })

    win.on('closed', () => {
      this.ventanas.delete(id)
      if (!wc.isDestroyed()) wc.close()
    })
    this.cargarBarra(win, id)
    void wc.loadURL(n.url).catch(() => undefined)
    return id
  }

  estado(id: number): EstadoNavegador {
    const e = this.ventanas.get(id)
    if (!e || e.vista.webContents.isDestroyed()) return { url: '', titulo: '', cargando: false, puedeAtras: false, puedeAdelante: false }
    const wc = e.vista.webContents
    return {
      url: wc.getURL(),
      titulo: wc.getTitle(),
      cargando: wc.isLoading(),
      puedeAtras: wc.navigationHistory.canGoBack(),
      puedeAdelante: wc.navigationHistory.canGoForward(),
      ...(e.error ? { error: e.error } : {}),
      ...(e.ia ? { ia: e.accionIA ?? 'controlada por la IA' } : {})
    }
  }

  /** Coloca las ventanas de la IA escalonadas dentro de la pantalla: con varias abiertas se ven todas. */
  private enCascada(ancho: number, alto: number): { x?: number; y?: number } {
    try {
      const area = screen.getPrimaryDisplay().workArea
      const paso = 36
      const k = this.abiertasIA++ % 8
      return { x: area.x + Math.max(0, Math.min(area.width - ancho, 40 + k * paso)), y: area.y + Math.max(0, Math.min(area.height - alto, 30 + k * paso)) }
    } catch {
      return {}
    }
  }

  /** Ventanas abiertas (para la IA). */
  lista(): Entrada[] {
    return [...this.ventanas.values()].filter((e) => !e.win.isDestroyed() && !e.vista.webContents.isDestroyed())
  }

  entrada(id: number): Entrada | undefined {
    const e = this.ventanas.get(id)
    return e && !e.win.isDestroyed() && !e.vista.webContents.isDestroyed() ? e : undefined
  }

  /** La IA hizo algo en esa ventana: queda marcada y la barra lo muestra en directo. */
  marcarIA(id: number, accion: string): void {
    const e = this.ventanas.get(id)
    if (!e || e.win.isDestroyed()) return
    e.ia = true
    e.accionIA = accion
    if (!e.barra.isDestroyed()) e.barra.send(Canales.navegadorEstado, this.estado(id))
  }

  /** Tamaño de la página (sin la barra de direcciones). */
  redimensionar(id: number, ancho: number, alto: number): void {
    const e = this.entrada(id)
    if (!e) throw new Error(`No hay ninguna ventana de navegador con id ${id}.`)
    if (e.win.isMaximized()) e.win.unmaximize()
    if (e.win.isFullScreen()) e.win.setFullScreen(false)
    e.win.setContentSize(Math.round(ancho), Math.round(alto) + ALTO_BARRA_NAVEGADOR)
  }

  /** Solo la barra de esa ventana puede mandarle órdenes (no cualquier página de la aplicación). */
  private de(id: number, emisor: WebContents): Entrada {
    const e = this.ventanas.get(id)
    if (!e || e.barra.id !== emisor.id) throw new Error('Ventana de navegador no válida.')
    return e
  }

  obtener(id: number, emisor: WebContents): EstadoNavegador {
    this.de(id, emisor)
    return this.estado(id)
  }

  async accion(id: number, a: AccionNavegador, emisor: WebContents): Promise<void> {
    const e = this.de(id, emisor)
    const wc = e.vista.webContents
    switch (a.tipo) {
      case 'ir': {
        const n = normalizarUrl(a.url)
        if ('error' in n) throw new Error(n.error)
        await wc.loadURL(n.url).catch(() => undefined) // los fallos de carga llegan como estado (did-fail-load)
        return
      }
      case 'atras':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        return
      case 'adelante':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        return
      case 'recargar':
        wc.reload()
        return
      case 'detener':
        wc.stop()
        return
      case 'devtools':
        if (wc.isDevToolsOpened()) wc.closeDevTools()
        else wc.openDevTools({ mode: 'detach' })
        return
      case 'externo': {
        const url = wc.getURL()
        if (protocoloWeb(url)) await shell.openExternal(url)
        return
      }
      case 'cerrar':
        e.win.close()
        return
      default:
        throw new Error('Acción de navegador desconocida.')
    }
  }

  cerrarTodas(): void {
    for (const e of this.ventanas.values()) if (!e.win.isDestroyed()) e.win.close()
  }
}

/** Abre una dirección en el navegador del sistema (solo http y https). */
export async function abrirEnNavegadorDelSistema(entrada: string): Promise<void> {
  const n = normalizarUrl(entrada)
  if ('error' in n) throw new Error(n.error)
  await shell.openExternal(n.url)
}

export const rutaPreload = (): string => join(__dirname, '../preload/index.js')
