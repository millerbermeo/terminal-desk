import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ID_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/

/** Los ids se usan como nombre de archivo: solo caracteres seguros (evita salir de la carpeta). */
export function validarId(id: string): string {
  if (!ID_VALIDO.test(id)) throw new Error(`Identificador inválido: ${id}`)
  return id
}

/** Almacén de documentos JSON, uno por archivo, con escritura atómica y serializada por archivo. */
export class AlmacenJson<T> {
  private readonly colas = new Map<string, Promise<unknown>>()

  /**
   * `modo`: permisos de los archivos (p. ej. 0o600 si pueden contener datos sensibles).
   * `alGuardar`: se avisa tras cada escritura (`nuevo` indefinido = se borró) con el documento anterior; sirve para sincronizar.
   */
  constructor(
    private readonly dir: string,
    private readonly modo?: number,
    private readonly alGuardar?: (id: string, nuevo: T | undefined, previo: T | undefined) => void
  ) {}

  private ruta(id: string): string {
    return join(this.dir, `${validarId(id)}.json`)
  }

  private enCola<R>(id: string, fn: () => Promise<R>): Promise<R> {
    const p = (this.colas.get(id) ?? Promise.resolve()).then(fn, fn)
    this.colas.set(id, p.catch(() => undefined))
    return p
  }

  async leer(id: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.ruta(id), 'utf8')) as T
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
  }

  /** Ids de los documentos guardados. */
  async ids(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  /** Lee, transforma y guarda sin que otra escritura se intercale. */
  actualizar(id: string, fn: (actual: T | undefined) => T | undefined): Promise<T | undefined> {
    return this.enCola(id, async () => {
      const previo = await this.leer(id)
      const nuevo = fn(previo)
      if (nuevo === undefined) {
        await rm(this.ruta(id), { force: true })
        this.avisar(id, undefined, previo)
        return undefined
      }
      await mkdir(this.dir, { recursive: true })
      const tmp = this.ruta(id) + `.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(nuevo, null, 2) + '\n', { encoding: 'utf8', ...(this.modo ? { mode: this.modo } : {}) })
      await rename(tmp, this.ruta(id))
      this.avisar(id, nuevo, previo)
      return nuevo
    })
  }

  private avisar(id: string, nuevo: T | undefined, previo: T | undefined): void {
    try {
      this.alGuardar?.(id, nuevo, previo)
    } catch (err) {
      console.error('alGuardar falló:', err) // un fallo de sincronización nunca debe impedir guardar
    }
  }
}
