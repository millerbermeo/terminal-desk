import { execFile } from 'node:child_process'
import { ipcMain, shell } from 'electron'
import type { CambioArchivo } from '@shared/archivos'
import { CanalesArchivos } from '@shared/ipc'
import { GestorArchivos, Vigilante } from './archivos'
import type { ServicioHistorial } from './historial/servicio'
import { buscarEnPath, buscarHabitual, lanzar } from './plataforma'
import { leerProyectos } from './proyectos'

/** Lanza el primer editor tipo VS Code que exista en el PATH, en ventana nueva, sin esperar a que cierre. */
async function abrirEnVscode(carpeta: string): Promise<{ ok: boolean; mensaje?: string }> {
  const intentar = (bin: string, args: string[]): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let hijo: ReturnType<typeof lanzar>
      try {
        hijo = lanzar(bin, args, { detached: true, stdio: 'ignore' })
      } catch {
        return resolve(false)
      }
      hijo.once('error', () => resolve(false))
      hijo.once('spawn', () => (hijo.unref(), resolve(true)))
    })
  for (const bin of ['code', 'code-insiders', 'codium']) {
    const ruta = buscarEnPath(bin) ?? buscarHabitual(bin)
    if (ruta && (await intentar(ruta, ['-n', carpeta]))) return { ok: true }
  }
  // macOS: abierta desde el Dock la app no hereda el PATH del shell y `code` no aparece aunque VS Code esté instalado.
  if (process.platform === 'darwin') {
    for (const app of ['Visual Studio Code', 'Visual Studio Code - Insiders', 'VSCodium']) {
      const ok = await new Promise<boolean>((resolve) => execFile('open', ['-n', '-a', app, carpeta], { timeout: 10_000 }, (err) => resolve(!err)))
      if (ok) return { ok: true }
    }
  }
  return { ok: false, mensaje: 'No se encontró VS Code: instala el comando «code» (VS Code → Ctrl+Shift+P → «Shell Command: Install \'code\' command in PATH»).' }
}

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
  ipcMain.handle(c.listarTodos, (_e, id: string) => gestor.listarTodos(String(id)))
  ipcMain.handle(c.leer, (_e, id: string, ruta: string) => gestor.leer(String(id), String(ruta)))
  ipcMain.handle(c.guardar, (_e, id: string, ruta: string, contenido: string, mtime?: number) =>
    gestor.guardar(String(id), String(ruta), String(contenido), typeof mtime === 'number' ? mtime : undefined)
  )
  ipcMain.handle(c.crear, (_e, id: string, ruta: string, tipo: 'archivo' | 'carpeta') => gestor.crear(String(id), String(ruta), tipo === 'carpeta' ? 'carpeta' : 'archivo'))
  ipcMain.handle(c.renombrar, (_e, id: string, desde: string, hasta: string) => gestor.renombrar(String(id), String(desde), String(hasta)))
  ipcMain.handle(c.borrar, (_e, id: string, ruta: string) => gestor.borrar(String(id), String(ruta)))
  ipcMain.handle(c.duplicar, (_e, id: string, ruta: string) => gestor.duplicar(String(id), String(ruta)))
  ipcMain.handle(c.rutaAbsoluta, (_e, id: string, ruta: string) => gestor.rutaAbsoluta(String(id), String(ruta ?? '')))
  ipcMain.handle(c.mostrar, async (_e, id: string, ruta: string) => shell.showItemInFolder(await gestor.rutaAbsoluta(String(id), String(ruta ?? ''))))
  ipcMain.handle(c.abrirVscode, async (_e, id: string) => abrirEnVscode(await raizDe(String(id))))
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
