import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Cifrado del token con lo que ofrece el sistema (llavero). Se inyecta: en Electron es `safeStorage`. */
export interface Cifrador {
  disponible(): boolean
  cifrar(texto: string): string
  descifrar(cifrado: string): string
}

/** Datos de un token que caduca (OAuth con «Expire user access tokens»): con el `refresh` se pide uno nuevo sin volver a iniciar sesión. */
export interface RenovacionToken {
  refresh?: string
  /** Cuándo caduca el token de acceso (ms desde 1970). */
  expira?: number
  /** Cuándo caduca el `refresh` (ms desde 1970). */
  refrescaHasta?: number
}

export interface TokenGuardado extends RenovacionToken {
  token: string
  usuario?: string
  /** Está guardado cifrado en el disco; si no, solo en memoria. */
  persistente: boolean
}

interface Archivo {
  version: 1
  cifrado: string
  usuario?: string
  /** El `refresh` también va cifrado: nunca en claro. */
  cifradoRefresh?: string
  expira?: number
  refrescaHasta?: number
}

/**
 * Guarda el token de GitHub. En disco solo se escribe cifrado con el llavero del sistema (0600); si el sistema no ofrece cifrado
 * seguro, el token vive únicamente en memoria hasta cerrar la aplicación: nunca se escribe en claro.
 */
export class AlmacenToken {
  private memoria?: { token: string; usuario?: string } & RenovacionToken

  constructor(
    private readonly archivo: string,
    private readonly cifrador: Cifrador
  ) {}

  async leer(): Promise<TokenGuardado | undefined> {
    if (this.memoria) return { ...this.memoria, persistente: false }
    try {
      const a = JSON.parse(await readFile(this.archivo, 'utf8')) as Archivo
      if (a?.version !== 1 || typeof a.cifrado !== 'string' || !this.cifrador.disponible()) return undefined
      return {
        token: this.cifrador.descifrar(a.cifrado),
        ...(a.usuario ? { usuario: a.usuario } : {}),
        ...(a.cifradoRefresh ? { refresh: this.cifrador.descifrar(a.cifradoRefresh) } : {}),
        ...(typeof a.expira === 'number' ? { expira: a.expira } : {}),
        ...(typeof a.refrescaHasta === 'number' ? { refrescaHasta: a.refrescaHasta } : {}),
        persistente: true
      }
    } catch {
      return undefined // sin archivo, ilegible o cifrado con otra clave: es como no tener token
    }
  }

  /** Devuelve si quedó guardado en el disco (`true`) o solo en memoria (`false`). */
  async guardar(token: string, usuario?: string, renovacion: RenovacionToken = {}): Promise<boolean> {
    const extra: RenovacionToken = {
      ...(renovacion.refresh ? { refresh: renovacion.refresh } : {}),
      ...(typeof renovacion.expira === 'number' ? { expira: renovacion.expira } : {}),
      ...(typeof renovacion.refrescaHasta === 'number' ? { refrescaHasta: renovacion.refrescaHasta } : {})
    }
    if (!this.cifrador.disponible()) {
      this.memoria = { token, ...(usuario ? { usuario } : {}), ...extra }
      return false
    }
    this.memoria = undefined
    await mkdir(dirname(this.archivo), { recursive: true })
    const tmp = `${this.archivo}.${process.pid}.tmp`
    const contenido: Archivo = {
      version: 1,
      cifrado: this.cifrador.cifrar(token),
      ...(usuario ? { usuario } : {}),
      ...(extra.refresh ? { cifradoRefresh: this.cifrador.cifrar(extra.refresh) } : {}),
      ...(extra.expira !== undefined ? { expira: extra.expira } : {}),
      ...(extra.refrescaHasta !== undefined ? { refrescaHasta: extra.refrescaHasta } : {})
    }
    await writeFile(tmp, JSON.stringify(contenido), { mode: 0o600 })
    await rename(tmp, this.archivo)
    return true
  }

  async borrar(): Promise<void> {
    this.memoria = undefined
    await rm(this.archivo, { force: true })
  }
}
