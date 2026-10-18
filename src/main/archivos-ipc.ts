import { ipcMain, shell } from 'electron'
import type { CambioArchivo } from '@shared/archivos'
import { CanalesArchivos } from '@shared/ipc'
import { GestorArchivos, Vigilante } from './archivos'
import type { ServicioHistorial } from './historial/servicio'
import { leerProyectos } from './proyectos'

async function raizDe(proyectoId: string): Promise<string> {
  const p = (await leerProyectos()).proyectos.find((x) => x.id === String(proyectoId))
  if (!p) throw new Error('Proyecto no encontrado')
  return p.ruta
}

/** IPC del editor de archivos integrado. */
export function registrarIpcArchivos(historial?: ServicioHistorial): void {
  const gestor = new GestorArchivos({
    raiz: raizDe,
    papelera: (ruta) => shell.trashItem(ruta),
    ...(historial ? { historial: { antes: (id, ruta) => historial.antesDeEscribir(id, ruta), despues: (id, ruta) => historial.despuesDeEscribir(id, ruta, 'usuario') } } : {})
  })
  const vigilante = new Vigilante(raizDe)
  const suscritos = new Set<number>()
  const c = CanalesArchivos

  ipcMain.handle(c.listar, (_e, id: string, ruta?: string) => gestor.listar(String(id), String(ruta ?? '')))
  ipcMain.handle(c.leer, (_e, id: string, ruta: string) => gestor.leer(String(id), String(ruta)))
  ipcMain.handle(c.guardar, (_e, id: string, ruta: string, contenido: string, mtime?: number) =>
    gestor.guardar(String(id), String(ruta), String(contenido), typeof mtime === 'number' ? mtime : undefined)
  )
  ipcMain.handle(c.crear, (_e, id: string, ruta: string, tipo: 'archivo' | 'carpeta') => gestor.crear(String(id), String(ruta), tipo === 'carpeta' ? 'carpeta' : 'archivo'))
  ipcMain.handle(c.renombrar, (_e, id: string, desde: string, hasta: string) => gestor.renombrar(String(id), String(desde), String(hasta)))
  ipcMain.handle(c.borrar, (_e, id: string, ruta: string) => gestor.borrar(String(id), String(ruta)))
  ipcMain.handle(c.estadoGit, (_e, id: string) => gestor.estadoGit(String(id)))
  ipcMain.handle(c.vigilar, async (e, id: string, carpetas: string[]) => {
    const sender = e.sender
    if (!suscritos.has(sender.id)) {
      suscritos.add(sender.id)
      sender.once('destroyed', () => {
        vigilante.cerrar(sender.id)
        suscritos.delete(sender.id)
      })
    }
    await vigilante.establecer(sender.id, String(id), Array.isArray(carpetas) ? carpetas.map(String) : [], (cambio: CambioArchivo) => {
      if (!sender.isDestroyed()) sender.send(c.cambio, cambio)
    })
  })
}
