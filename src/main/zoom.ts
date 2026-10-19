import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { Canales } from '@shared/ipc'
import { accionDeTecla, estadoDe, nivelSiguiente, ZOOM_MAX, ZOOM_MIN } from '@shared/zoom'
import { DIR } from './proyectos'

const ARCHIVO = join(DIR, 'zoom.json')

function leerNivel(): number {
  try {
    const n = Number((JSON.parse(readFileSync(ARCHIVO, 'utf8')) as { nivel?: unknown }).nivel)
    return Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : 0
  } catch {
    return 0
  }
}

/** Último nivel elegido: las ventanas nuevas y el siguiente arranque lo recuerdan. */
let nivelGuardado = leerNivel()

/**
 * Zoom de una ventana con Ctrl + / Ctrl − / Ctrl 0 (solo con el teclado: la rueda del ratón no hace zoom). Se intercepta la tecla antes de
 * que llegue a la página, así que tampoco la usa el menú predeterminado y el terminal no la recibe. Avisa al renderer para que muestre
 * el porcentaje unos segundos.
 */
export function instalarZoom(wc: WebContents): void {
  wc.setVisualZoomLevelLimits(1, 1).catch(() => undefined) // sin zoom de pellizco
  const aplicar = (): void => {
    if (!wc.isDestroyed()) wc.setZoomLevel(nivelGuardado)
  }
  aplicar()
  wc.on('did-finish-load', aplicar)
  wc.on('before-input-event', (evento, input) => {
    const accion = accionDeTecla(input)
    if (!accion) return
    evento.preventDefault()
    nivelGuardado = nivelSiguiente(wc.getZoomLevel(), accion)
    aplicar()
    wc.send(Canales.zoomCambio, estadoDe(nivelGuardado))
    void writeFile(ARCHIVO, JSON.stringify({ nivel: nivelGuardado }) + '\n').catch(() => undefined)
  })
}
