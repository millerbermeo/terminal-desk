import { app, BrowserWindow, ipcMain, shell, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Proveedor } from '@shared/modelos'
import { Canales, type OpcionesTerminal, type PayloadVentana, type ResultadoEliminarGrupo, type SolicitudAgregar } from '@shared/ipc'
import { GestorTerminales } from './terminales'
import { eliminarProveedor, guardarProveedor, listarProveedores, obtenerProveedor } from './proveedores'
import { verificarPassword } from './autenticacion'
import { agregarProyectos, eliminarGrupo, eliminarProyecto, leerProyectos, validarRuta } from './proyectos'

// Wayland: auto-detectar X11/Wayland. Debe ir antes de app.ready.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

let principal: BrowserWindow | null = null

// Cada terminal envía su salida a la ventana que la tiene (puede cambiar al separar una pestaña).
const duenos = new Map<string, number>() // id del pty -> id del webContents
const pendientes = new Map<string, PayloadVentana>() // token -> contenido de una ventana separada

const enviarA = (ptyId: string, canal: string, carga: unknown): void => {
  const id = duenos.get(ptyId)
  const wc = id === undefined ? undefined : webContents.fromId(id)
  if (wc && !wc.isDestroyed()) wc.send(canal, carga)
}

const terminales = new GestorTerminales({
  onDatos: (id, datos) => enviarA(id, Canales.terminalDatos, { id, datos }),
  onSalida: (id, codigo) => {
    enviarA(id, Canales.terminalSalida, { id, codigo })
    duenos.delete(id)
  }
})

/** Cierra las terminales de una ventana (se recargó o se cerró). */
function cerrarDe(webContentsId: number): void {
  for (const [pty, dueno] of [...duenos]) {
    if (dueno !== webContentsId) continue
    terminales.cerrar(pty)
    duenos.delete(pty)
  }
}

function crearVentana(opciones: { token?: string; x?: number; y?: number; titulo?: string } = {}): BrowserWindow {
  const esPrincipal = !opciones.token
  const win = new BrowserWindow({
    width: esPrincipal ? 1280 : 1000,
    height: esPrincipal ? 800 : 700,
    ...(opciones.x !== undefined && opciones.y !== undefined ? { x: opciones.x, y: opciones.y } : {}),
    title: opciones.titulo ?? 'Centro de Proyectos',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const wcId = win.webContents.id

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Recarga de la página: los ptys del renderer anterior quedan huérfanos.
  win.webContents.on('did-start-navigation', (_e, _url, enLugar, enPrincipal) => {
    if (enPrincipal && !enLugar) cerrarDe(wcId)
  })
  win.on('closed', () => {
    cerrarDe(wcId)
    if (win === principal) {
      principal = null
      app.quit() // al cerrar la ventana principal se cierra todo
    }
  })

  const query = opciones.token ? { ventana: opciones.token } : undefined
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + (query ? `?ventana=${query.ventana}` : ''))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
  }
  return win
}

function registrarIpc(): void {
  ipcMain.handle(Canales.proyectosListar, () => leerProyectos())
  ipcMain.handle(Canales.proyectosValidarRuta, (_e, ruta: string) => validarRuta(ruta))
  ipcMain.handle(Canales.proyectosAgregar, (_e, sol: SolicitudAgregar) => agregarProyectos(sol))
  ipcMain.handle(Canales.proyectosEliminar, (_e, id: string) => eliminarProyecto(id))
  ipcMain.handle(Canales.grupoEliminar, async (_e, id: string, password: string): Promise<ResultadoEliminarGrupo> => {
    const auth = await verificarPassword(String(password ?? ''))
    if (!auth.ok) return auth
    return { ok: true, datos: await eliminarGrupo(id) }
  })
  ipcMain.handle(Canales.proveedoresListar, () => listarProveedores())
  ipcMain.handle(Canales.proveedoresGuardar, (_e, p: Proveedor) => guardarProveedor(p))
  ipcMain.handle(Canales.proveedoresEliminar, (_e, id: string) => eliminarProveedor(id))
  ipcMain.handle(Canales.terminalCrear, async (e, op: OpcionesTerminal) => {
    // El renderer solo envía el id: el comando se resuelve aquí, desde la config guardada.
    const prov = op.proveedorId ? await obtenerProveedor(op.proveedorId) : undefined
    const id = terminales.crear(op, prov && { comando: prov.comando, env: prov.env })
    duenos.set(id, e.sender.id)
    return id
  })
  // La ventana que adjunta pasa a ser la dueña; se le devuelve lo ya mostrado para repintarlo.
  ipcMain.handle(Canales.terminalAdjuntar, (e, id: string, cols: number, rows: number) => {
    duenos.set(id, e.sender.id)
    terminales.redimensionar(id, cols, rows)
    return terminales.historialDe(id)
  })
  ipcMain.on(Canales.ventanaSeparar, (_e, payload: PayloadVentana, pos?: { x: number; y: number }) => {
    const token = randomUUID()
    pendientes.set(token, payload)
    crearVentana({
      token,
      titulo: `${payload.nombre} · Centro de Proyectos`,
      ...(pos ? { x: Math.round(pos.x - 120), y: Math.round(pos.y - 20) } : {})
    })
  })
  ipcMain.handle(Canales.ventanaTomar, (_e, token: string) => {
    const payload = pendientes.get(token) ?? null
    pendientes.delete(token)
    return payload
  })
  ipcMain.on(Canales.terminalEscribir, (_e, id: string, datos: string) => terminales.escribir(id, datos))
  ipcMain.on(Canales.terminalRedimensionar, (_e, id: string, cols: number, rows: number) =>
    terminales.redimensionar(id, cols, rows)
  )
  ipcMain.on(Canales.terminalCerrar, (_e, id: string) => terminales.cerrar(id))
}

app.whenReady().then(() => {
  registrarIpc()
  principal = crearVentana()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) principal = crearVentana()
  })
})

app.on('window-all-closed', () => {
  terminales.cerrarTodas()
  app.quit()
})

app.on('before-quit', () => terminales.cerrarTodas())
app.on('will-quit', () => terminales.cerrarTodas())

for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(senal, () => {
    terminales.cerrarTodas()
    app.quit()
  })
}
