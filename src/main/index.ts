import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { Canales, type OpcionesTerminal, type SolicitudAgregar } from '@shared/ipc'
import { GestorTerminales } from './terminales'
import { agregarProyectos, eliminarGrupo, eliminarProyecto, leerProyectos } from './proyectos'

// Wayland: auto-detectar X11/Wayland. Debe ir antes de app.ready.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

let ventana: BrowserWindow | null = null

const terminales = new GestorTerminales({
  onDatos: (id, datos) => ventana?.webContents.send(Canales.terminalDatos, { id, datos }),
  onSalida: (id, codigo) => ventana?.webContents.send(Canales.terminalSalida, { id, codigo })
})

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Centro de Proyectos',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Recarga/cierre de la página: los ptys del renderer anterior quedan huérfanos.
  ventana.webContents.on('did-start-navigation', (_e, _url, _inPlace, esPrincipal) => {
    if (esPrincipal) terminales.cerrarTodas()
  })
  ventana.on('closed', () => {
    ventana = null
    terminales.cerrarTodas()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void ventana.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void ventana.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registrarIpc(): void {
  ipcMain.handle(Canales.proyectosListar, () => leerProyectos())
  ipcMain.handle(Canales.proyectosAgregar, (_e, sol: SolicitudAgregar) => agregarProyectos(sol))
  ipcMain.handle(Canales.proyectosEliminar, (_e, id: string) => eliminarProyecto(id))
  ipcMain.handle(Canales.grupoEliminar, (_e, id: string) => eliminarGrupo(id))
  ipcMain.handle(Canales.terminalCrear, (_e, op: OpcionesTerminal) => terminales.crear(op))
  ipcMain.on(Canales.terminalEscribir, (_e, id: string, datos: string) => terminales.escribir(id, datos))
  ipcMain.on(Canales.terminalRedimensionar, (_e, id: string, cols: number, rows: number) =>
    terminales.redimensionar(id, cols, rows)
  )
  ipcMain.on(Canales.terminalCerrar, (_e, id: string) => terminales.cerrar(id))
}

app.whenReady().then(() => {
  registrarIpc()
  crearVentana()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana()
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
