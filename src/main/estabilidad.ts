import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Motivos por los que se cae la interfaz y recargarla tiene sentido (un cierre normal o a propósito no se recarga). */
export function motivoRecuperable(reason: string): boolean {
  return reason !== 'clean-exit' && reason !== 'killed'
}

/** Evita un bucle de recargas: si la interfaz vuelve a caer enseguida y en bucle, se deja de recargar sola y se avisa. */
export class LimitadorRecargas {
  private marcas = new Map<number, number[]>()

  constructor(
    private readonly max = 3,
    private readonly ventanaMs = 60_000,
    private readonly ahora: () => number = Date.now
  ) {}

  /** ¿Se puede recargar la ventana `id` ahora? Cuenta el intento si sí. */
  permitir(id: number): boolean {
    const t = this.ahora()
    const recientes = (this.marcas.get(id) ?? []).filter((m) => t - m < this.ventanaMs)
    if (recientes.length >= this.max) {
      this.marcas.set(id, recientes)
      return false
    }
    this.marcas.set(id, [...recientes, t])
    return true
  }
}

interface MarcaSesion {
  inicio: number
  limpio: boolean
}

/** Si la sesión anterior no terminó bien (la app se cerró de golpe, se colgó o hubo que matarla), devuelve cuándo empezó. */
export function cierreAnteriorInesperado(archivo: string): { inicio: number } | undefined {
  try {
    const m = JSON.parse(readFileSync(archivo, 'utf8')) as Partial<MarcaSesion>
    return m.limpio === false && typeof m.inicio === 'number' ? { inicio: m.inicio } : undefined
  } catch {
    return undefined // primera vez, o archivo ilegible: no hay nada que decir
  }
}

/** Marca que esta sesión empezó y aún no terminó (si sigue así al próximo arranque, el cierre fue inesperado). */
export function marcarInicio(archivo: string, ahora = Date.now()): void {
  try {
    void mkdir(dirname(archivo), { recursive: true }).then(() => escribir(archivo, { inicio: ahora, limpio: false }), () => undefined)
  } catch {
    // sin disco: no se podrá detectar, pero la app sigue
  }
}

/** Marca un cierre normal. Síncrono: se llama justo antes de salir. */
export function marcarCierreLimpio(archivo: string): void {
  try {
    const previa = JSON.parse(readFileSync(archivo, 'utf8')) as Partial<MarcaSesion>
    escribir(archivo, { inicio: typeof previa.inicio === 'number' ? previa.inicio : Date.now(), limpio: true })
  } catch {
    // nada que marcar
  }
}

function escribir(archivo: string, m: MarcaSesion): void {
  writeFileSync(archivo, JSON.stringify(m), { encoding: 'utf8', mode: 0o600 })
}
