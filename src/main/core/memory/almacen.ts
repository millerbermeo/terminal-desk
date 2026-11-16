import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  /** Cuántas veces se escribió cada documento desde este proceso (parte de la firma de `resumidor`). */
  private readonly versiones = new Map<string, number>()

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
    const cola = p.catch(() => undefined)
    this.colas.set(id, cola)
    // Sin nada detrás, la cola de ese documento se suelta (si no, el mapa crecía con cada id escrito alguna vez).
    void cola.then(() => {
      if (this.colas.get(id) === cola) this.colas.delete(id)
    })
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

  /**
   * Función que devuelve `resumir(doc)` de todos los documentos sin volver a leer y parsear los que no cambiaron (firma: fecha y
   * tamaño del archivo + escrituras de este proceso). Listar conversaciones o trazas leía y parseaba todos los JSON en cada llamada,
   * en el hilo principal (pueden pesar varios MB cada uno). `resumir` debe devolver datos nuevos e independientes del documento.
   */
  resumidor<R>(resumir: (doc: T) => R): () => Promise<R[]> {
    const cache = new Map<string, { firma: string; r: R }>()
    return async () => {
      const ids = await this.ids()
      const vivos = new Set(ids)
      for (const id of cache.keys()) if (!vivos.has(id)) cache.delete(id)
      const filas: ({ r: R } | undefined)[] = await Promise.all(
        ids.map(async (id): Promise<{ r: R } | undefined> => {
          try {
            const st = await stat(this.ruta(id))
            const firma = `${st.mtimeMs}:${st.size}:${this.versiones.get(id) ?? 0}`
            const previa = cache.get(id)
            if (previa?.firma === firma) return { r: previa.r }
            const doc = await this.leer(id)
            if (doc === undefined) return undefined
            const r = resumir(doc)
            cache.set(id, { firma, r })
            return { r }
          } catch {
            return undefined // ilegible o con nombre no válido: se omite, como antes
          }
        })
      )
      return filas.flatMap((f) => (f ? [f.r] : []))
    }
  }

  /** Lee, transforma y guarda sin que otra escritura se intercale. */
  actualizar(id: string, fn: (actual: T | undefined) => T | undefined): Promise<T | undefined> {
    return this.enCola(id, async () => {
      const previo = await this.leer(id)
      const nuevo = fn(previo)
      this.versiones.set(id, (this.versiones.get(id) ?? 0) + 1)
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
