import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Cifrado del token con lo que ofrece el sistema (llavero). Se inyecta: en Electron es `safeStorage`. */
export interface Cifrador {
  disponible(): boolean
  cifrar(texto: string): string
  descifrar(cifrado: string): string
}

export interface TokenGuardado {
  token: string
  usuario?: string
  /** Está guardado cifrado en el disco; si no, solo en memoria. */
  persistente: boolean
}

interface Archivo {
  version: 1
  cifrado: string
  usuario?: string
}

/**
 * Guarda el token de GitHub. En disco solo se escribe cifrado con el llavero del sistema (0600); si el sistema no ofrece cifrado
 * seguro, el token vive únicamente en memoria hasta cerrar la aplicación: nunca se escribe en claro.
 */
export class AlmacenToken {
  private memoria?: { token: string; usuario?: string }

  constructor(
    private readonly archivo: string,
    private readonly cifrador: Cifrador
  ) {}

  async leer(): Promise<TokenGuardado | undefined> {
    if (this.memoria) return { ...this.memoria, persistente: false }
    try {
      const a = JSON.parse(await readFile(this.archivo, 'utf8')) as Archivo
      if (a?.version !== 1 || typeof a.cifrado !== 'string' || !this.cifrador.disponible()) return undefined
      return { token: this.cifrador.descifrar(a.cifrado), ...(a.usuario ? { usuario: a.usuario } : {}), persistente: true }
    } catch {
      return undefined // sin archivo, ilegible o cifrado con otra clave: es como no tener token
    }
  }

  /** Devuelve si quedó guardado en el disco (`true`) o solo en memoria (`false`). */
  async guardar(token: string, usuario?: string): Promise<boolean> {
    if (!this.cifrador.disponible()) {
      this.memoria = { token, ...(usuario ? { usuario } : {}) }
      return false
    }
    this.memoria = undefined
    await mkdir(dirname(this.archivo), { recursive: true })
    const tmp = `${this.archivo}.${process.pid}.tmp`
    const contenido: Archivo = { version: 1, cifrado: this.cifrador.cifrar(token), ...(usuario ? { usuario } : {}) }
    await writeFile(tmp, JSON.stringify(contenido), { mode: 0o600 })
    await rename(tmp, this.archivo)
    return true
  }

  async borrar(): Promise<void> {
    this.memoria = undefined
    await rm(this.archivo, { force: true })
  }
}
