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

interface CuentaArchivo {
  usuario: string
  cifrado: string
  /** El `refresh` también va cifrado: nunca en claro. */
  cifradoRefresh?: string
  expira?: number
  refrescaHasta?: number
}

/** Versión 1 = una sola cuenta (la anterior); versión 2 = varias, con una activa. */
interface Archivo {
  version: 1 | 2
  cifrado?: string
  usuario?: string
  cifradoRefresh?: string
  expira?: number
  refrescaHasta?: number
  activa?: string
  cuentas?: CuentaArchivo[]
}

interface CuentaMem extends RenovacionToken {
  token: string
  usuario: string
}
interface Estado {
  activa?: string
  cuentas: CuentaMem[]
}

/** Resumen de una cuenta guardada (nunca el token). */
export interface CuentaListada {
  usuario: string
  activa: boolean
  renovable: boolean
}

const mismo = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * Guarda los tokens de GitHub (una o varias cuentas, una activa). En disco solo se escribe cifrado con el llavero del sistema (0600);
 * si el sistema no ofrece cifrado seguro, los tokens viven únicamente en memoria hasta cerrar la aplicación: nunca se escriben en claro.
 * `leer`/`guardar`/`borrar` actúan sobre la cuenta activa, así el resto de la app sigue viendo «un token».
 */
export class AlmacenToken {
  private memoria?: Estado

  constructor(
    private readonly archivo: string,
    private readonly cifrador: Cifrador
  ) {}

  private async cargar(): Promise<{ estado: Estado; persistente: boolean; leido?: boolean }> {
    if (this.memoria) return { estado: this.memoria, persistente: false }
    const vacio = { estado: { cuentas: [] }, persistente: true }
    try {
      const a = JSON.parse(await readFile(this.archivo, 'utf8')) as Archivo
      if (!this.cifrador.disponible()) return vacio
      const rec = (c: CuentaArchivo): CuentaMem => ({
        token: this.cifrador.descifrar(c.cifrado),
        usuario: c.usuario,
        ...(c.cifradoRefresh ? { refresh: this.cifrador.descifrar(c.cifradoRefresh) } : {}),
        ...(typeof c.expira === 'number' ? { expira: c.expira } : {}),
        ...(typeof c.refrescaHasta === 'number' ? { refrescaHasta: c.refrescaHasta } : {})
      })
      if (a?.version === 1 && typeof a.cifrado === 'string') {
        const c = rec({ usuario: a.usuario ?? '', cifrado: a.cifrado, ...(a.cifradoRefresh ? { cifradoRefresh: a.cifradoRefresh } : {}), ...(a.expira !== undefined ? { expira: a.expira } : {}), ...(a.refrescaHasta !== undefined ? { refrescaHasta: a.refrescaHasta } : {}) })
        return { estado: { activa: c.usuario, cuentas: [c] }, persistente: true, leido: true }
      }
      if (a?.version === 2 && Array.isArray(a.cuentas)) {
        // Una entrada que no se puede descifrar se omite; no tumba a las demás cuentas.
        const cuentas = a.cuentas.flatMap((c) => {
          if (typeof c?.cifrado !== 'string' || typeof c.usuario !== 'string') return []
          try {
            return [rec(c)]
          } catch {
            return []
          }
        })
        return { estado: { ...(a.activa !== undefined ? { activa: a.activa } : {}), cuentas }, persistente: true, leido: true }
      }
      return vacio
    } catch {
      return vacio // sin archivo, ilegible o cifrado con otra clave: es como no tener token
    }
  }

  private activaDe(e: Estado): CuentaMem | undefined {
    return e.cuentas.find((c) => e.activa !== undefined && mismo(c.usuario, e.activa)) ?? e.cuentas[0]
  }

  private async escribir(e: Estado): Promise<boolean> {
    if (!e.cuentas.length) {
      this.memoria = undefined
      await rm(this.archivo, { force: true })
      return true
    }
    if (!this.cifrador.disponible()) {
      this.memoria = e
      return false
    }
    this.memoria = undefined
    await mkdir(dirname(this.archivo), { recursive: true })
    const tmp = `${this.archivo}.${process.pid}.tmp`
    const contenido: Archivo = {
      version: 2,
      ...(this.activaDe(e) ? { activa: this.activaDe(e)!.usuario } : {}),
      cuentas: e.cuentas.map((c) => ({
        usuario: c.usuario,
        cifrado: this.cifrador.cifrar(c.token),
        ...(c.refresh ? { cifradoRefresh: this.cifrador.cifrar(c.refresh) } : {}),
        ...(c.expira !== undefined ? { expira: c.expira } : {}),
        ...(c.refrescaHasta !== undefined ? { refrescaHasta: c.refrescaHasta } : {})
      }))
    }
    await writeFile(tmp, JSON.stringify(contenido), { mode: 0o600 })
    await rename(tmp, this.archivo)
    return true
  }

  /** La cuenta activa. */
  async leer(): Promise<TokenGuardado | undefined> {
    const { estado, persistente } = await this.cargar()
    const c = this.activaDe(estado)
    if (!c) return undefined
    const { usuario, ...resto } = c
    return { ...resto, ...(usuario ? { usuario } : {}), persistente }
  }

  /** Todas las cuentas con su token, solo si están guardadas en disco (para la bóveda). Nunca llega a la interfaz. */
  async listarCompleto(): Promise<(RenovacionToken & { token: string; usuario: string })[]> {
    const { estado, persistente } = await this.cargar()
    return persistente ? estado.cuentas.filter((c) => c.usuario) : []
  }

  async listar(): Promise<CuentaListada[]> {
    const { estado } = await this.cargar()
    const a = this.activaDe(estado)
    return estado.cuentas.filter((c) => c.usuario).map((c) => ({ usuario: c.usuario, activa: c === a, renovable: Boolean(c.refresh) }))
  }

  /**
   * Guarda (o actualiza, por usuario) una cuenta. Por defecto pasa a ser la activa; con `activar: false` solo lo hace si aún no hay ninguna.
   * Devuelve si quedó guardado en el disco (`true`) o solo en memoria (`false`).
   */
  async guardar(token: string, usuario?: string, renovacion: RenovacionToken = {}, opciones: { activar?: boolean } = {}): Promise<boolean> {
    const { estado } = await this.cargar()
    const nombre = usuario ?? ''
    const cuenta: CuentaMem = {
      token,
      usuario: nombre,
      ...(renovacion.refresh ? { refresh: renovacion.refresh } : {}),
      ...(typeof renovacion.expira === 'number' ? { expira: renovacion.expira } : {}),
      ...(typeof renovacion.refrescaHasta === 'number' ? { refrescaHasta: renovacion.refrescaHasta } : {})
    }
    const cuentas = estado.cuentas.filter((c) => !mismo(c.usuario, nombre))
    // Una cuenta sin nombre (token sin `/user`) reemplaza a la activa sin nombre, como antes; no se acumulan.
    cuentas.push(cuenta)
    const hayActiva = this.activaDe(estado) !== undefined && estado.cuentas.length > 0
    const activa = opciones.activar === false && hayActiva ? this.activaDe(estado)!.usuario : nombre
    return this.escribir({ activa, cuentas })
  }

  /** Cambia la cuenta activa. `false` si no existe. */
  async activar(usuario: string): Promise<boolean> {
    const { estado } = await this.cargar()
    const c = estado.cuentas.find((x) => mismo(x.usuario, usuario))
    if (!c) return false
    await this.escribir({ activa: c.usuario, cuentas: estado.cuentas })
    return true
  }

  /** Quita una cuenta (la activa pasa a la primera que quede). */
  async quitar(usuario: string): Promise<boolean> {
    const { estado } = await this.cargar()
    const actual = this.activaDe(estado)
    const cuentas = estado.cuentas.filter((c) => !mismo(c.usuario, usuario))
    if (cuentas.length === estado.cuentas.length) return false
    const sigue = actual && !mismo(actual.usuario, usuario) ? actual.usuario : cuentas[0]?.usuario
    await this.escribir({ ...(sigue !== undefined ? { activa: sigue } : {}), cuentas })
    return true
  }

  /** Quita la cuenta activa (las demás se conservan). */
  async borrar(): Promise<void> {
    const { estado, leido } = await this.cargar()
    const a = this.activaDe(estado)
    if (!a) {
      this.memoria = undefined
      // Solo se borra el archivo si se leyó y de verdad no hay cuentas; con el llavero bloqueado o el archivo ilegible no se pierde nada.
      if (leido) await rm(this.archivo, { force: true })
      return
    }
    await this.quitar(a.usuario)
  }
}
