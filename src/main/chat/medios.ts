import { randomUUID } from 'node:crypto'
import { open, mkdir, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { FuentePantalla } from '@shared/chat'

/**
 * Lo que una llamada necesita del sistema: elegir qué pantalla o ventana compartir (el renderer no puede listar ventanas) y guardar
 * la grabación de la llamada en disco a trozos (una hora de video no cabe entera en un mensaje IPC).
 */

/** Lo mínimo de `DesktopCapturerSource` que se usa (así se puede probar sin Electron). */
export interface FuenteCaptura {
  id: string
  name: string
  thumbnail: { isEmpty(): boolean; toJPEG(calidad: number): Buffer }
  appIcon?: { isEmpty(): boolean; toPNG(): Buffer } | null
}

export interface DepsMedios {
  listarFuentes(): Promise<FuenteCaptura[]>
  /** Carpeta donde quedan las grabaciones (p. ej. ~/Vídeos/Odesk Code). */
  carpetaGrabaciones(): string
  ahora?(): number
  /** Linux con Wayland: el sistema elige la fuente en su propio diálogo, en cada listado. */
  wayland?: boolean
  /** Avisa al empezar la primera grabación y al terminar la última. */
  alGrabar?(hay: boolean): void
}

const CADUCA_ELECCION_MS = 15_000
/** Tope de una grabación (≈ 3 h a 2,5 Mbps): evita llenar el disco por un fallo. */
const MAX_GRABACION = 4 * 1024 ** 3
const ID_FUENTE = /^(screen|window):[\w:.-]{1,120}$/

const dataUrl = (mime: string, b: Buffer): string => `data:${mime};base64,${b.toString('base64')}`

/** Nombre de archivo seguro y legible: «Llamada con Ana - 2026-11-15 23.40.webm». */
export function nombreGrabacion(con: string, fecha: Date): string {
  const limpio =
    [...con]
      .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'contacto'
  const d = (n: number): string => String(n).padStart(2, '0')
  return `Llamada con ${limpio} - ${fecha.getFullYear()}-${d(fecha.getMonth() + 1)}-${d(fecha.getDate())} ${d(fecha.getHours())}.${d(fecha.getMinutes())}.${d(fecha.getSeconds())}.webm`
}

interface Grabacion {
  archivo: FileHandle
  parcial: string
  nombre: string
  bytes: number
  cola: Promise<void>
}

export class MediosLlamada {
  private fuentes = new Map<string, FuenteCaptura>()
  private eleccion: { fuente: FuenteCaptura; hasta: number } | null = null
  private readonly grabaciones = new Map<string, Grabacion>()
  /** Solo se pueden mostrar en la carpeta las grabaciones hechas en esta sesión (no rutas cualquiera). */
  private readonly guardadas = new Set<string>()

  constructor(private readonly d: DepsMedios) {}

  private ahora(): number {
    return this.d.ahora?.() ?? Date.now()
  }

  async listar(): Promise<{ fuentes: FuentePantalla[]; refrescar: boolean }> {
    const lista = await this.d.listarFuentes()
    this.fuentes = new Map(lista.map((f) => [f.id, f]))
    const fuentes = lista
      .filter((f) => ID_FUENTE.test(f.id))
      .map((f): FuentePantalla => ({
        id: f.id,
        nombre: f.name || (f.id.startsWith('screen:') ? 'Pantalla' : 'Ventana'),
        tipo: f.id.startsWith('screen:') ? 'pantalla' : 'ventana',
        miniatura: f.thumbnail.isEmpty() ? '' : dataUrl('image/jpeg', f.thumbnail.toJPEG(70)),
        ...(f.appIcon && !f.appIcon.isEmpty() ? { icono: dataUrl('image/png', f.appIcon.toPNG()) } : {})
      }))
    return { fuentes, refrescar: !this.d.wayland }
  }

  elegir(id: unknown): void {
    const fuente = typeof id === 'string' ? this.fuentes.get(id) : undefined
    if (!fuente) throw new Error('Esa pantalla o ventana ya no está disponible. Vuelve a elegir.')
    this.eleccion = { fuente, hasta: this.ahora() + CADUCA_ELECCION_MS }
  }

  /**
   * Respuesta al `getDisplayMedia` del renderer: la fuente elegida en el selector propio, una sola vez. Sin elección vigente se deniega
   * (nadie puede capturar la pantalla sin pasar por el selector).
   */
  responderCaptura(): { video: FuenteCaptura } | null {
    const e = this.eleccion
    this.eleccion = null
    if (!e || this.ahora() > e.hasta) return null
    return { video: e.fuente }
  }

  async iniciarGrabacion(con: unknown): Promise<{ id: string }> {
    const carpeta = this.d.carpetaGrabaciones()
    await mkdir(carpeta, { recursive: true })
    const id = randomUUID()
    const nombre = nombreGrabacion(typeof con === 'string' ? con : '', new Date(this.ahora()))
    const parcial = join(carpeta, `.${id}.webm.parcial`)
    const archivo = await open(parcial, 'wx', 0o600)
    this.grabaciones.set(id, { archivo, parcial, nombre, bytes: 0, cola: Promise.resolve() })
    if (this.grabaciones.size === 1) this.d.alGrabar?.(true)
    return { id }
  }

  /** Los trozos se escriben en orden (cola por grabación) aunque lleguen varios a la vez. */
  async trozo(id: unknown, datos: unknown): Promise<void> {
    const g = this.grabacion(id)
    if (!(datos instanceof Uint8Array)) throw new Error('Trozo de grabación no válido')
    if (g.bytes + datos.byteLength > MAX_GRABACION) throw new Error('La grabación llegó al tamaño máximo')
    g.bytes += datos.byteLength
    const escribir = g.cola.then(() => g.archivo.write(datos).then(() => undefined))
    g.cola = escribir.catch(() => undefined)
    return escribir
  }

  async terminarGrabacion(id: unknown): Promise<{ ruta: string; nombre: string }> {
    const g = this.grabacion(id)
    this.quitar(id as string)
    await g.cola
    await g.archivo.close()
    const carpeta = this.d.carpetaGrabaciones()
    let nombre = g.nombre
    // Nunca se pisa otra grabación con el mismo nombre.
    for (let n = 2; await existe(join(carpeta, nombre)); n++) nombre = g.nombre.replace(/\.webm$/, ` (${n}).webm`)
    const ruta = join(carpeta, nombre)
    await rename(g.parcial, ruta)
    this.guardadas.add(ruta)
    return { ruta, nombre }
  }

  async cancelarGrabacion(id: unknown): Promise<void> {
    const g = typeof id === 'string' ? this.grabaciones.get(id) : undefined
    if (!g) return
    this.quitar(id as string)
    await g.cola
    await g.archivo.close().catch(() => undefined)
    await rm(g.parcial, { force: true })
  }

  /** Al cerrar la app con una grabación a medias: se guarda lo que haya (un webm cortado se puede reproducir). */
  async cerrarTodo(): Promise<void> {
    for (const id of [...this.grabaciones.keys()]) await this.terminarGrabacion(id).catch(() => undefined)
  }

  esGuardada(ruta: unknown): ruta is string {
    return typeof ruta === 'string' && this.guardadas.has(ruta)
  }

  private quitar(id: string): void {
    this.grabaciones.delete(id)
    if (this.grabaciones.size === 0) this.d.alGrabar?.(false)
  }

  private grabacion(id: unknown): Grabacion {
    const g = typeof id === 'string' ? this.grabaciones.get(id) : undefined
    if (!g) throw new Error('La grabación no existe o ya terminó')
    return g
  }
}

async function existe(ruta: string): Promise<boolean> {
  return stat(ruta).then(
    () => true,
    () => false
  )
}
