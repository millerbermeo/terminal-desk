import { contextBridge, ipcRenderer } from 'electron'
import type { CambioArchivo } from '@shared/archivos'
import type { EventoAgente } from '@shared/core/agente'
import type { ResumenUso } from '@shared/core/uso'
import { Canales, CanalesArchivos as CA, type ApiCentro, type DatosTerminal, type PayloadVentana, type SalidaTerminal } from '@shared/ipc'

function suscribir<T>(canal: string, cb: (e: T) => void): () => void {
  const handler = (_: unknown, e: T): void => cb(e)
  ipcRenderer.on(canal, handler)
  return () => ipcRenderer.removeListener(canal, handler)
}

const api: ApiCentro = {
  archivos: {
    listar: (id, ruta) => ipcRenderer.invoke(CA.listar, id, ruta),
    leer: (id, ruta) => ipcRenderer.invoke(CA.leer, id, ruta),
    guardar: (id, ruta, contenido, mtime) => ipcRenderer.invoke(CA.guardar, id, ruta, contenido, mtime),
    crear: (id, ruta, tipo) => ipcRenderer.invoke(CA.crear, id, ruta, tipo),
    renombrar: (id, desde, hasta) => ipcRenderer.invoke(CA.renombrar, id, desde, hasta),
    borrar: (id, ruta) => ipcRenderer.invoke(CA.borrar, id, ruta),
    estadoGit: (id) => ipcRenderer.invoke(CA.estadoGit, id),
    vigilar: (id, carpetas) => ipcRenderer.invoke(CA.vigilar, id, carpetas),
    onCambio: (cb) => suscribir<CambioArchivo>(CA.cambio, cb)
  },
  core: {
    ejecutar: (solicitud) => ipcRenderer.invoke(Canales.coreEjecutar, solicitud),
    cancelar: (id) => ipcRenderer.invoke(Canales.coreCancelar, id),
    responder: (solicitudId, decision) => ipcRenderer.invoke(Canales.coreResponder, solicitudId, decision),
    worktreesListar: (proyectoId) => ipcRenderer.invoke(Canales.coreWorktreesListar, proyectoId),
    worktreeDescartar: (proyectoId, id) => ipcRenderer.invoke(Canales.coreWorktreeDescartar, proyectoId, id),
    worktreePublicar: (proyectoId, id) => ipcRenderer.invoke(Canales.coreWorktreePublicar, proyectoId, id),
    trazasListar: (limite) => ipcRenderer.invoke(Canales.coreTrazasListar, limite),
    trazaObtener: (id) => ipcRenderer.invoke(Canales.coreTrazaObtener, id),
    trazaEliminar: (id) => ipcRenderer.invoke(Canales.coreTrazaEliminar, id),
    evalsSuites: () => ipcRenderer.invoke(Canales.coreEvalsSuites),
    evalsEjecutar: (suiteId, casos) => ipcRenderer.invoke(Canales.coreEvalsEjecutar, suiteId, casos),
    evalsInformes: (suiteId) => ipcRenderer.invoke(Canales.coreEvalsInformes, suiteId),
    modelos: () => ipcRenderer.invoke(Canales.coreModelosListar),
    cuentaEstado: () => ipcRenderer.invoke(Canales.coreCuentaEstado),
    cuentaProveedor: (proveedor) => ipcRenderer.invoke(Canales.coreCuentaProveedor, proveedor),
    cuentaIniciarSesion: (id) => ipcRenderer.invoke(Canales.coreCuentaIniciar, id),
    cuentaCerrarSesion: (id) => ipcRenderer.invoke(Canales.coreCuentaCerrar, id),
    cuentaAgregar: (nombre) => ipcRenderer.invoke(Canales.coreCuentaAgregar, nombre),
    cuentaQuitar: (id) => ipcRenderer.invoke(Canales.coreCuentaQuitar, id),
    cuentaActivar: (id) => ipcRenderer.invoke(Canales.coreCuentaActivar, id),
    cuentaCambioAutomatico: (activo) => ipcRenderer.invoke(Canales.coreCuentaAuto, activo),
    uso: () => ipcRenderer.invoke(Canales.coreUsoObtener),
    onUso: (cb) => suscribir<ResumenUso>(Canales.coreUso, cb),
    adjuntoSubir: (nombre, datos) => ipcRenderer.invoke(Canales.coreAdjuntoSubir, nombre, datos),
    adjuntoLeer: (id) => ipcRenderer.invoke(Canales.coreAdjuntoLeer, id),
    adjuntoEliminar: (id) => ipcRenderer.invoke(Canales.coreAdjuntoEliminar, id),
    comandosListar: (ambito) => ipcRenderer.invoke(Canales.coreComandosListar, ambito),
    comandosEfectivos: (proyectoId) => ipcRenderer.invoke(Canales.coreComandosEfectivos, proyectoId),
    comandosGuardar: (comando, ambito) => ipcRenderer.invoke(Canales.coreComandosGuardar, comando, ambito),
    comandosEliminar: (nombre, ambito) => ipcRenderer.invoke(Canales.coreComandosEliminar, nombre, ambito),
    comandoEjecutar: (proyectoId, nombre, argumentos) => ipcRenderer.invoke(Canales.coreComandoEjecutar, proyectoId, nombre, argumentos),
    permisosListar: (ambito) => ipcRenderer.invoke(Canales.corePermisosListar, ambito),
    permisosAgregar: (regla, ambito) => ipcRenderer.invoke(Canales.corePermisosAgregar, regla, ambito),
    permisosEliminar: (id, ambito) => ipcRenderer.invoke(Canales.corePermisosEliminar, id, ambito),
    sesionesListar: (proyectoId) => ipcRenderer.invoke(Canales.coreSesionesListar, proyectoId),
    sesionObtener: (id) => ipcRenderer.invoke(Canales.coreSesionObtener, id),
    sesionTranscripcion: (id, turnos, proyectoId) => ipcRenderer.invoke(Canales.coreSesionTranscripcion, id, turnos, proyectoId),
    sesionBorrar: (id) => ipcRenderer.invoke(Canales.coreSesionBorrar, id),
    memoriaListar: (proyectoId) => ipcRenderer.invoke(Canales.coreMemoriaListar, proyectoId),
    memoriaGuardar: (entrada, proyectoId) => ipcRenderer.invoke(Canales.coreMemoriaGuardar, entrada, proyectoId),
    memoriaEliminar: (id, proyectoId) => ipcRenderer.invoke(Canales.coreMemoriaEliminar, id, proyectoId),
    mcpEstado: () => ipcRenderer.invoke(Canales.coreMcpEstado),
    mcpReiniciar: () => ipcRenderer.invoke(Canales.coreMcpReiniciar),
    onEvento: (cb) => suscribir<EventoAgente>(Canales.coreEvento, cb)
  },
  tareas: {
    operar: (op, entrada) => ipcRenderer.invoke(Canales.tareasOperar, op, entrada),
    onCambio: (cb) => suscribir<null>(Canales.tareasCambio, () => cb())
  },
  agentes: {
    listar: () => ipcRenderer.invoke(Canales.agentesListar),
    guardar: (r) => ipcRenderer.invoke(Canales.agentesGuardar, r),
    eliminar: (id) => ipcRenderer.invoke(Canales.agentesEliminar, id),
    activar: (destino, id, activo) => ipcRenderer.invoke(Canales.agentesActivar, destino, id, activo)
  },
  ventana: {
    separar: (payload, pos) => ipcRenderer.send(Canales.ventanaSeparar, payload, pos),
    tomar: (token) => ipcRenderer.invoke(Canales.ventanaTomar, token),
    devolver: (payload) => ipcRenderer.send(Canales.ventanaDevolver, payload),
    onRecibir: (cb) => suscribir<PayloadVentana>(Canales.ventanaRecibir, cb)
  },
  proveedores: {
    listar: () => ipcRenderer.invoke(Canales.proveedoresListar),
    guardar: (p) => ipcRenderer.invoke(Canales.proveedoresGuardar, p),
    eliminar: (id) => ipcRenderer.invoke(Canales.proveedoresEliminar, id)
  },
  proyectos: {
    listar: () => ipcRenderer.invoke(Canales.proyectosListar),
    validarRuta: (ruta) => ipcRenderer.invoke(Canales.proyectosValidarRuta, ruta),
    agregar: (solicitud) => ipcRenderer.invoke(Canales.proyectosAgregar, solicitud),
    elegirCarpetas: () => ipcRenderer.invoke(Canales.proyectosElegirCarpetas),
    sugerirRutas: (prefijo) => ipcRenderer.invoke(Canales.proyectosSugerirRutas, prefijo),
    eliminar: (id) => ipcRenderer.invoke(Canales.proyectosEliminar, id),
    eliminarGrupo: (id, password) => ipcRenderer.invoke(Canales.grupoEliminar, id, password)
  },
  terminal: {
    crear: (opciones) => ipcRenderer.invoke(Canales.terminalCrear, opciones),
    adjuntar: (ptyId, cols, rows) => ipcRenderer.invoke(Canales.terminalAdjuntar, ptyId, cols, rows),
    escribir: (id, datos) => ipcRenderer.send(Canales.terminalEscribir, id, datos),
    redimensionar: (id, cols, rows) => ipcRenderer.send(Canales.terminalRedimensionar, id, cols, rows),
    cerrar: (id) => ipcRenderer.send(Canales.terminalCerrar, id),
    onDatos: (cb) => suscribir<DatosTerminal>(Canales.terminalDatos, cb),
    onSalida: (cb) => suscribir<SalidaTerminal>(Canales.terminalSalida, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
