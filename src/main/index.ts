import { app, BrowserWindow, dialog, ipcMain, session, shell, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import icono from '../../resources/icon.png?asset'
import type { Proveedor, Recurso } from '@shared/modelos'
import type { AccionNavegador } from '@shared/navegador'
import { Canales, type DestinoActivacion, type OpcionesTerminal, type PayloadVentana, type ResultadoEliminarGrupo, type SolicitudAgregar } from '@shared/ipc'
import { registrarIpcArchivos } from './archivos-ipc'
import { ServicioHistorial } from './historial/servicio'
import { ejecutarOperacionHistorial } from './historial/operaciones'
import { Nucleo, registrarIpcCore } from './core'
import { GestorTerminales } from './terminales'
import { eliminarProveedor, enCola as enColaProveedores, guardarProveedor, listarProveedores, obtenerProveedor } from './proveedores'
import { verificarPassword } from './autenticacion'
import { activarRecurso, comandoConAgentes, eliminarRecurso, guardarRecurso, leerBiblioteca, limpiarSesiones } from './agentes'
import { resolverPerfil } from './migracion'
import { repararWorktrees } from './core/git/reparar'
import { ejecutarOperacionGitHub } from './github/operaciones'
import { ServicioEquipos, ejecutarOperacionEquipos, type DepsEquipos } from './servidor/equipos'
import { Repositorio } from './core/git/repositorio'
import { importarProyectosLocales } from './servidor/importar'
import { iniciarSesionGoogle } from './servidor/google'
import { ErrorServidor, ErrorSesion, servidor } from './servidor/cliente'
import { cifradorDelSistema } from './cifrador'
import type { CredencialesSesion, EstadoSesion, NombreOperacionCuenta, ResultadoBoveda, ResultadoPaso, ResultadoSesion } from '@shared/sesion'
import { cambiarPerfil } from './perfiles'
import { Boveda } from './servidor/boveda'
import { seccionesSecretas } from './servidor/secretos'
import { FuenteArchivos, FuenteTareas, SincronizadorCuenta } from './servidor/sync-cuenta'
import { DIR, MIGRACION_DATOS, rutasLocales, agregarProyectos, carpetaDeProyecto, eliminarGrupo, eliminarProyecto, leerProyectos, proyectosSinCarpeta, sugerirRutas, validarRuta } from './proyectos'
import { configurarMcpTareas } from './core/tareas/mcp-config'
import { ejecutarOperacionGit } from './core/git/operaciones'
import { writeFile } from 'node:fs/promises'
import { AlmacenJson } from './core/memory/almacen'
import { ServicioApi } from './api/servicio'
import { ejecutarOperacionApi } from './api/operaciones'
import { abrirEnNavegadorDelSistema, GestorNavegador, rutaPreload } from './navegador'
import { esPaginaDeLaApp } from './navegacion'
import { servidoresLocales } from './puertos'
import { HistorialComandos } from './historial-comandos'
import { iniciarServidorTareas, type ServidorTareas } from './core/tareas/servidor'

// Wayland: auto-detectar X11/Wayland. Debe ir antes de app.ready.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
// En Wayland, Chromium con Vulkan falla ("'--ozone-platform=wayland' is not compatible with Vulkan"); la app no lo necesita.
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-features', 'Vulkan')
app.setName('Odesk Agent')
// Perfil de Electron (localStorage del renderer): carpeta fija con el nombre actual; si solo existe la de un nombre anterior, se mueve.
app.setPath('userData', resolverPerfil(app.getPath('appData'), 'Odesk Agent'))
// Linux: enlaza la ventana con odesk-agent.desktop (nombre e icono en el dock/menú de aplicaciones)
app.setDesktopName('odesk-agent.desktop')

let principal: BrowserWindow | null = null

// Cliente API: los datos (colecciones, entornos con tokens, historial) viven en ~/.odesk-agent/api/ con permisos 0600.
const servicioApi = new ServicioApi(new AlmacenJson(join(DIR, 'api'), 0o600), async (nombre, datos) => {
  const ventana = BrowserWindow.getFocusedWindow() ?? principal
  const opciones = { title: 'Guardar respuesta', defaultPath: join(homedir(), nombre) }
  const r = ventana ? await dialog.showSaveDialog(ventana, opciones) : await dialog.showSaveDialog(opciones)
  if (r.canceled || !r.filePath) return undefined
  await writeFile(r.filePath, datos)
  return r.filePath
})

// Navegador integrado: cada ventana carga la interfaz con ?navegador=<id> (su barra de direcciones).
/** Las ventanas con `window.api` solo muestran la interfaz: un archivo o enlace soltado encima (o un enlace sin `target`) no las lleva fuera. */
function soloPaginasDeLaApp(wc: Electron.WebContents): void {
  const destino = { urlDev: process.env.ELECTRON_RENDERER_URL, indexHtml: join(__dirname, '../renderer/index.html') }
  wc.on('will-navigate', (e) => {
    if (!esPaginaDeLaApp(e.url, destino)) e.preventDefault()
  })
}

const navegador = new GestorNavegador(
  (win, id) => {
    soloPaginasDeLaApp(win.webContents)
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?navegador=${id}`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { navegador: String(id) } })
  },
  icono,
  rutaPreload()
)

// Cada terminal envía su salida a la ventana que la tiene (puede cambiar al separar una pestaña).
const duenos = new Map<string, number>() // id del pty -> id del webContents
const pendientes = new Map<string, PayloadVentana>() // token -> contenido de una ventana separada

const enviarA = (ptyId: string, canal: string, carga: unknown): void => {
  const id = duenos.get(ptyId)
  const wc = id === undefined ? undefined : webContents.fromId(id)
  if (wc && !wc.isDestroyed()) wc.send(canal, carga)
}

const historialComandos = new HistorialComandos(join(DIR, 'historial-comandos.json'))
const terminales = new GestorTerminales({
  onDatos: (id, datos, fin) => enviarA(id, Canales.terminalDatos, { id, datos, fin }),
  onSalida: (id, codigo) => {
    enviarA(id, Canales.terminalSalida, { id, codigo })
    duenos.delete(id)
  }
})

// Núcleo de agentes (Fase 1): sin aprobador, solo herramientas de lectura. La Fase 4 añade confirmación humana.
const nucleo = new Nucleo()

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
    title: opciones.titulo ?? 'Odesk Agent',
    icon: icono,
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
  soloPaginasDeLaApp(win.webContents)

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

// ---------------------------------------------------------------- datos de la cuenta en la nube

/** Memoria, permisos, preferencias, proveedores y MCP (sin claves), tareas sin proyecto y columnas del tablero. */
const syncCuenta = new SincronizadorCuenta(servidor, join(DIR, 'sync-cuenta.json'), [
  new FuenteArchivos(
    DIR,
    (id) => {
      if (id === 'preferencias.json') nucleo.preferencias.olvidarCache()
    },
    async (cambios) => {
      const r = await dialog.showMessageBox({
        type: 'warning',
        title: 'Cambios de comandos desde tu cuenta',
        message: 'Otro equipo o el servidor de tu cuenta quiere añadir o cambiar comandos que se ejecutarían en este equipo.',
        detail: cambios.slice(0, 15).join('\n') + (cambios.length > 15 ? `\n… y ${cambios.length - 15} más` : '') + '\n\nAplícalos solo si los reconoces.',
        buttons: ['Rechazar', 'Aplicar'],
        defaultId: 0,
        cancelId: 0
      })
      return r.response === 1
    }
  ),
  new FuenteTareas(nucleo.tareas)
])
/** Claves (proveedores, MCP, cliente API, GitHub), cifradas en este equipo. */
const boveda = new Boveda(servidor, join(DIR, 'boveda-clave.json'), join(DIR, 'boveda-estado.json'), cifradorDelSistema(), seccionesSecretas(DIR, nucleo.tokenGitHub, undefined, { proveedores: enColaProveedores, api: (d) => servicioApi.reemplazar(d) }))

/** Estado de git de cada proyecto en cada PC de la cuenta, y proyectos de la cuenta que faltan clonar aquí. */
const depsEquipos: DepsEquipos = {
  servidor,
  archivo: join(DIR, 'equipo.json'),
  nombreSistema: hostname() || 'Este equipo',
  proyectos: async () => (await leerProyectos()).proyectos.map((p) => ({ id: p.id, ruta: p.ruta })),
  repositorio: (ruta) => new Repositorio(ruta, nucleo.github.credencialesPara),
  pendientes: proyectosSinCarpeta,
  clonarProyecto: (e) => nucleo.github.clonarProyecto(e),
  alClonar: async (id) => void (await nucleo.hidratar(id))
}
const equipos = new ServicioEquipos(depsEquipos)

/**
 * Historial local de versiones de los archivos de cada proyecto (independiente de git). Cada versión lleva quién (usuario de GitHub, cuenta)
 * y desde qué equipo. Funciona sin conexión: solo necesita saber qué carpeta tiene cada proyecto en este equipo.
 */
const historial = new ServicioHistorial({
  dir: join(DIR, 'historial'),
  identidad: async () => {
    const [sesion, github, yo] = await Promise.all([servidor.estado().catch(() => undefined), nucleo.tokenGitHub.leer().catch(() => undefined), equipos.equipo().catch(() => undefined)])
    return { ...(github?.usuario ? { usuario: github.usuario } : {}), ...(sesion?.email ? { cuenta: sesion.email } : {}), ...(yo ? { equipoId: yo.id, equipo: yo.nombre } : {}) }
  }
})
depsEquipos.historial = (proyectoId) => historial.resumen(proyectoId)
nucleo.alEscribirIA = (momento, proyectoId, ruta, meta) => {
  const hecho = momento === 'antes' ? historial.antesDeEscribir(proyectoId, ruta) : historial.despuesDeEscribir(proyectoId, ruta, 'ia', meta)
  void hecho.catch(() => undefined)
}
async function sincronizarHistorial(): Promise<void> {
  try {
    await historial.sincronizarProyectos(Object.entries(await rutasLocales.todas()).map(([id, ruta]) => ({ id, ruta })))
  } catch (err) {
    console.warn('No se pudo preparar el historial local:', (err as Error).message)
  }
}

let bucleCuenta: NodeJS.Timeout | undefined
const CADA_MS = 30_000

let pasadaEnCurso: Promise<{ ok: boolean; mensaje: string }> | undefined

/**
 * Una pasada: datos de la cuenta (crean proveedores y servidores MCP), sus claves, y los cambios de los proyectos. Nunca lanza. Si ya hay
 * una en marcha (el bucle, el botón «Sincronizar» y el cierre pueden coincidir; con muchos proyectos una pasada supera los 30 s) se
 * espera a esa: dos a la vez subirían la bóveda sobre la misma versión y bajarían dos veces lo mismo.
 */
function sincronizarCuenta(): Promise<{ ok: boolean; mensaje: string }> {
  pasadaEnCurso ??= pasadaCuenta().finally(() => (pasadaEnCurso = undefined))
  return pasadaEnCurso
}

async function pasadaCuenta(): Promise<{ ok: boolean; mensaje: string }> {
  try {
    const r = await syncCuenta.sincronizar()
    const b = await boveda.sincronizar()
    await nucleo.sync.vaciar() // lo que esperaba para subirse (tareas, conversaciones…)
    await equipos.informar(true).catch((err) => console.warn('No se pudo informar el estado de git:', (err as Error).message)) // rama y commit de este equipo
    const p = await nucleo.hidratarTodos(true) // y lo que cambió en los proyectos desde otros equipos
    const bajados = r.bajados + b.bajadas + p.tareas + p.chats + p.trazas
    return { ok: true, mensaje: `Sincronizado: ${r.subidos + b.subidas} subido(s), ${bajados} bajado(s), ${r.borrados + p.borrados} borrado(s).` }
  } catch (err) {
    if (!(err instanceof ErrorSesion)) console.warn('No se pudo sincronizar la cuenta:', (err as Error).message)
    return { ok: false, mensaje: err instanceof ErrorServidor ? err.message : 'No se pudo sincronizar.' }
  }
}

function iniciarBucleCuenta(): void {
  detenerBucleCuenta()
  void sincronizarCuenta()
  bucleCuenta = setInterval(() => void sincronizarCuenta(), CADA_MS)
  bucleCuenta.unref()
}

function detenerBucleCuenta(): void {
  if (bucleCuenta) clearInterval(bucleCuenta)
  bucleCuenta = undefined
}

async function conBoveda(fn: () => Promise<unknown>): Promise<ResultadoBoveda> {
  try {
    await fn()
    return { ok: true, estado: await boveda.estado() }
  } catch (err) {
    if (err instanceof ErrorServidor) return { ok: false, mensaje: err.message }
    throw err
  }
}

/** Error del servidor -> resultado para la interfaz (con la marca de «cuenta sin activar»). Lo demás se propaga. */
function falloSesion(err: unknown): { ok: false; mensaje: string; verificacionPendiente?: boolean } {
  if (err instanceof ErrorServidor) return { ok: false, mensaje: err.message, ...(err.codigo === 'VERIFICACION_PENDIENTE' ? { verificacionPendiente: true } : {}) }
  throw err
}

/**
 * Tras abrir sesión: deja en `~/.odesk-agent` los datos locales de ESA cuenta (si eran de otra, se apartan y la app se reinicia para
 * no usar nada cacheado), importa los proyectos del formato antiguo y baja el contexto de los proyectos de este equipo.
 */
async function conSesion(entrar: () => Promise<EstadoSesion>): Promise<ResultadoSesion> {
  let estado: EstadoSesion
  try {
    estado = await entrar()
  } catch (err) {
    return falloSesion(err)
  }
  if (estado.usuarioId && (await cambiarPerfil(DIR, estado.usuarioId)) === 'cambiado') {
    // Lo del navegador integrado (cookies, historial) y lo guardado por la interfaz también era de la otra cuenta.
    await session.fromPartition('persist:navegador').clearStorageData().catch(() => undefined)
    await session.defaultSession.clearStorageData({ storages: ['localstorage', 'indexdb'] }).catch(() => undefined)
    terminales.cerrarTodas()
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 200)
    return { ok: true, estado }
  }
  await importarProyectosLocales().catch((err) => console.error('No se pudieron importar los proyectos locales:', err))
  void nucleo.hidratarTodos()
  iniciarBucleCuenta()
  return { ok: true, estado }
}

async function paso(fn: () => Promise<{ mensaje?: string } | void>, exito: string): Promise<ResultadoPaso> {
  try {
    const r = await fn()
    return { ok: true, mensaje: (r && r.mensaje) || exito }
  } catch (err) {
    return falloSesion(err)
  }
}

/** Operaciones de cuenta (canal `sesion:cuenta`). */
function operarCuenta(op: NombreOperacionCuenta, e: Record<string, unknown>): Promise<unknown> {
  const t = (k: string): string => String(e[k] ?? '')
  switch (op) {
    case 'registrar':
      return paso(() => servidor.registrar(t('email'), t('password')), 'Te enviamos un código a tu correo.')
    case 'verificar':
      return conSesion(() => servidor.verificar(t('email'), t('code'), t('password')))
    case 'reenviar':
      return paso(() => servidor.reenviarVerificacion(t('email')), 'Te enviamos un código nuevo.')
    case 'olvido':
      return paso(() => servidor.olvidePassword(t('email')), 'Si hay una cuenta con ese correo, te enviamos un código.')
    case 'restablecer':
      return conSesion(() => servidor.restablecer(t('email'), t('code'), t('password')))
    case 'cambiarPassword':
      return paso(() => servidor.cambiarPassword(t('actual'), t('nueva')), 'Contraseña cambiada. Se cerró la sesión en tus otros equipos.')
    case 'cerrarTodas':
      detenerBucleCuenta()
      return servidor.cerrarTodas()
    case 'sincronizar':
      return sincronizarCuenta()
    case 'bovedaEstado':
      return conBoveda(async () => undefined)
    case 'bovedaCrear':
      return conBoveda(() => boveda.crear(t('frase')))
    case 'bovedaDesbloquear':
      return conBoveda(() => boveda.desbloquear(t('frase')))
    case 'bovedaCambiarFrase':
      return conBoveda(() => boveda.cambiarFrase(t('actual'), t('nueva')))
    case 'bovedaBloquear':
      return conBoveda(() => boveda.bloquear())
    case 'bovedaReiniciar':
      return conBoveda(() => boveda.reiniciar())
    default:
      throw new Error(`Operación de cuenta desconocida: ${String(op)}`)
  }
}

function registrarIpc(): void {
  registrarIpcCore(nucleo)
  registrarIpcArchivos(historial)
  ipcMain.handle(Canales.gitOperar, (_e, op: string, entrada: unknown) => ejecutarOperacionGit(carpetaDeProyecto, op, entrada, nucleo.github.credencialesPara))
  ipcMain.handle(Canales.githubOperar, (_e, op: string, entrada: unknown) => ejecutarOperacionGitHub(nucleo.github, op, entrada))
  ipcMain.handle(Canales.historialOperar, (_e, op: string, entrada: unknown) => ejecutarOperacionHistorial(historial, op, entrada))
  ipcMain.handle(Canales.equiposOperar, (_e, op: string, entrada: unknown) => ejecutarOperacionEquipos(equipos, depsEquipos, op, entrada))
  ipcMain.handle(Canales.apiOperar, (_e, op: string, entrada: unknown) => ejecutarOperacionApi(servicioApi, op, entrada))
  ipcMain.handle(Canales.navegadorAbrir, (_e, url: string) => navegador.abrir(String(url)))
  ipcMain.handle(Canales.navegadorAccion, (e, id: number, accion: AccionNavegador) => navegador.accion(Number(id), accion, e.sender))
  ipcMain.handle(Canales.navegadorObtener, (e, id: number) => navegador.obtener(Number(id), e.sender))
  ipcMain.handle(Canales.navegadorPuertos, () => servidoresLocales())
  ipcMain.handle(Canales.navegadorExterno, (_e, url: string) => abrirEnNavegadorDelSistema(String(url)))
  ipcMain.handle(Canales.sesionEstado, () => servidor.estado())
  ipcMain.handle(Canales.sesionIniciar, (_e, c: CredencialesSesion) =>
    conSesion(() => servidor.iniciar(String(c?.email ?? ''), String(c?.password ?? '')))
  )
  ipcMain.handle(Canales.sesionGoogleDisponible, () => servidor.googleDisponible().catch(() => false))
  ipcMain.handle(Canales.sesionGoogle, () => conSesion(() => iniciarSesionGoogle(servidor, (url) => shell.openExternal(url))))
  ipcMain.handle(Canales.sesionCuenta, (_e, op: NombreOperacionCuenta, entrada: Record<string, unknown>) => operarCuenta(op, entrada ?? {}))
  ipcMain.handle(Canales.sesionServidor, async (_e, url: string): Promise<ResultadoSesion> => {
    try {
      return { ok: true, estado: await servidor.fijarUrl(String(url ?? '')) }
    } catch (err) {
      if (err instanceof ErrorServidor) return { ok: false, mensaje: err.message }
      throw err
    }
  })
  ipcMain.handle(Canales.sesionCerrar, () => {
    detenerBucleCuenta()
    return servidor.cerrar()
  })
  ipcMain.handle(Canales.proyectosListar, () => leerProyectos())
  ipcMain.handle(Canales.proyectosValidarRuta, (_e, ruta: string) => validarRuta(ruta))
  ipcMain.handle(Canales.proyectosAgregar, async (_e, sol: SolicitudAgregar) => {
    const r = await agregarProyectos(sol)
    // Carpetas que ya eran un proyecto de la cuenta (otra computadora): se baja su tablero y conversaciones en segundo plano.
    for (const id of r.reanudados ?? []) void nucleo.hidratar(id).catch((err) => console.warn('No se pudo bajar el contexto del proyecto:', (err as Error).message))
    return r
  })
  ipcMain.handle(Canales.proyectosElegirCarpetas, async (e) => {
    const ventana = BrowserWindow.fromWebContents(e.sender)
    const opciones = { title: 'Abrir carpeta', defaultPath: homedir(), properties: ['openDirectory', 'multiSelections', 'createDirectory'] as ('openDirectory' | 'multiSelections' | 'createDirectory')[] }
    const r = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle(Canales.proyectosSugerirRutas, (_e, prefijo: string) => sugerirRutas(String(prefijo ?? '')))
  ipcMain.handle(Canales.proyectosEliminar, async (_e, id: string) => {
    const datos = await eliminarProyecto(id)
    await nucleo.tareas.desvincular({ proyectoId: id }) // sus tareas no se pierden: quedan sueltas
    return datos
  })
  ipcMain.handle(Canales.grupoEliminar, async (_e, id: string, password: string): Promise<ResultadoEliminarGrupo> => {
    const auth = await verificarPassword(String(password ?? ''))
    if (!auth.ok) return auth
    const datos = await eliminarGrupo(id)
    await nucleo.tareas.desvincular({ grupoId: id })
    return { ok: true, datos }
  })
  ipcMain.handle(Canales.agentesListar, () => leerBiblioteca())
  ipcMain.handle(Canales.agentesGuardar, (_e, r: Recurso) => guardarRecurso(r))
  ipcMain.handle(Canales.agentesEliminar, (_e, id: string) => eliminarRecurso(id))
  ipcMain.handle(Canales.agentesActivar, (_e, d: DestinoActivacion, id: string, activo: boolean) => activarRecurso(d, id, activo))
  ipcMain.handle(Canales.proveedoresListar, () => listarProveedores())
  ipcMain.handle(Canales.proveedoresGuardar, (_e, p: Proveedor) => guardarProveedor(p))
  ipcMain.handle(Canales.proveedoresEliminar, (_e, id: string) => eliminarProveedor(id))
  ipcMain.handle(Canales.terminalCrear, async (e, op: OpcionesTerminal) => {
    // El renderer solo envía el id: el comando se resuelve aquí, desde la config guardada.
    const prov = op.proveedorId ? await obtenerProveedor(op.proveedorId) : undefined
    // Con Claude Code se le cargan los agentes y skills activos del proyecto; una terminal normal no los lleva.
    const comando = prov ? await comandoConAgentes(prov.comando, op.proyectoId) : undefined
    const id = terminales.crear(op, prov && { comando: comando!, env: prov.env })
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
      titulo: `${payload.nombre} · Odesk Agent`,
      ...(pos ? { x: Math.round(pos.x - 120), y: Math.round(pos.y - 20) } : {})
    })
  })
  // Devolver: los ptys pasan a ser de la ventana principal (así cerrar la separada no los mata),
  // se avisa a la principal para que los adjunte como pestaña y se cierra la ventana separada.
  ipcMain.on(Canales.ventanaDevolver, (e, payload: PayloadVentana) => {
    const origen = BrowserWindow.fromWebContents(e.sender)
    if (principal && !principal.isDestroyed()) {
      for (const t of payload.terminales) duenos.set(t.ptyId, principal.webContents.id)
      principal.webContents.send(Canales.ventanaRecibir, payload)
      if (principal.isMinimized()) principal.restore()
      principal.focus()
    }
    origen?.close()
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
  ipcMain.handle(Canales.terminalEnShell, (_e, id: string) => terminales.enShell(String(id)))
  ipcMain.handle(Canales.terminalHistorialComandos, () => historialComandos.lista())
  ipcMain.on(Canales.terminalRegistrarComando, (_e, comando: string) => void historialComandos.agregar(comando))
}

let servidorTareas: ServidorTareas | undefined

app.whenReady().then(() => {
  servidor.configurar(join(DIR, 'sesion.json'), cifradorDelSistema(), join(DIR, 'servidor.json'))
  servidor.alPerderSesion = () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(Canales.sesionPerdida)
  }
  // Con sesión ya iniciada, se baja el contexto (tablero, conversaciones) de los proyectos de este equipo.
  void servidor
    .estado()
    .then((e) => {
      if (!e.activa) return
      void nucleo.hidratarTodos()
      iniciarBucleCuenta()
    })
    .catch(() => undefined)
  configurarMcpTareas({ raizApp: app.getAppPath(), dirDatos: DIR })
  // Se movieron los datos desde ~/.centro-proyectos: los worktrees de los agentes guardan rutas absolutas y hay que rehacerlas.
  if (MIGRACION_DATOS.migrado) void leerProyectos().then((d) => repararWorktrees(DIR, d.proyectos)).catch(() => undefined)
  // Socket local para que la IA (servidor MCP, en otro proceso) use las tareas; solo este proceso las escribe.
  void sincronizarHistorial()
  setInterval(() => void sincronizarHistorial(), 15_000).unref() // proyectos nuevos o quitados
  void iniciarServidorTareas(DIR, nucleo.ejecutarHerramienta, async (p, proyectoId) => {
    // Claude Code escribió (o va a escribir) un archivo en una terminal: el gancho del plugin avisa por aquí.
    await (p.momento === 'antes'
      ? historial.antesDeEscribir(proyectoId, p.ruta)
      : historial.despuesDeEscribir(proyectoId, p.ruta, 'ia', { herramienta: p.herramienta, ...(p.sesion ? { ejecucionId: p.sesion } : {}) }))
  })
    .then((s) => (servidorTareas = s))
    .catch((err) => console.error('Servidor de tareas no iniciado:', err))
  registrarIpc()
  void limpiarSesiones()
  void nucleo.iniciarMcp()
  void nucleo.adjuntos.limpiar().catch(() => undefined) // adjuntos de más de 30 días
  principal = crearVentana()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) principal = crearVentana()
  })
})

app.on('window-all-closed', () => {
  terminales.cerrarTodas()
  app.quit()
})

// Antes de salir se envía lo que aún esté esperando para subirse al servidor (máximo 3 s: sin red no se retiene el cierre).
let sincronizadoAlSalir = false
app.on('before-quit', (e) => {
  terminales.cerrarTodas()
  if (!sincronizadoAlSalir) {
    e.preventDefault()
    sincronizadoAlSalir = true
    detenerBucleCuenta()
    void Promise.race([Promise.all([nucleo.sync.vaciar(), sincronizarCuenta()]), new Promise((r) => setTimeout(r, 3000))])
      .catch(() => undefined)
      .finally(() => app.quit())
    return
  }
  void servidorTareas?.cerrar()
  void nucleo.detener()
})
app.on('will-quit', () => {
  terminales.cerrarTodas()
  historial.detener()
})

for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(senal, () => {
    terminales.cerrarTodas()
    app.quit()
  })
}
