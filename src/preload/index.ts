import { contextBridge, ipcRenderer } from 'electron'
import { Canales, type ApiCentro, type DatosTerminal, type SalidaTerminal } from '@shared/ipc'

function suscribir<T>(canal: string, cb: (e: T) => void): () => void {
  const handler = (_: unknown, e: T): void => cb(e)
  ipcRenderer.on(canal, handler)
  return () => ipcRenderer.removeListener(canal, handler)
}

const api: ApiCentro = {
  proveedores: {
    listar: () => ipcRenderer.invoke(Canales.proveedoresListar),
    guardar: (p) => ipcRenderer.invoke(Canales.proveedoresGuardar, p),
    eliminar: (id) => ipcRenderer.invoke(Canales.proveedoresEliminar, id)
  },
  proyectos: {
    listar: () => ipcRenderer.invoke(Canales.proyectosListar),
    validarRuta: (ruta) => ipcRenderer.invoke(Canales.proyectosValidarRuta, ruta),
    agregar: (solicitud) => ipcRenderer.invoke(Canales.proyectosAgregar, solicitud),
    eliminar: (id) => ipcRenderer.invoke(Canales.proyectosEliminar, id),
    eliminarGrupo: (id, password) => ipcRenderer.invoke(Canales.grupoEliminar, id, password)
  },
  terminal: {
    crear: (opciones) => ipcRenderer.invoke(Canales.terminalCrear, opciones),
    escribir: (id, datos) => ipcRenderer.send(Canales.terminalEscribir, id, datos),
    redimensionar: (id, cols, rows) => ipcRenderer.send(Canales.terminalRedimensionar, id, cols, rows),
    cerrar: (id) => ipcRenderer.send(Canales.terminalCerrar, id),
    onDatos: (cb) => suscribir<DatosTerminal>(Canales.terminalDatos, cb),
    onSalida: (cb) => suscribir<SalidaTerminal>(Canales.terminalSalida, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
