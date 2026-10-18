import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { deflate, inflate } from 'node:zlib'
import { POLITICA_HISTORIAL, type ArchivoHistorial, type Version } from '@shared/historial'

const comprimir = promisify(deflate)
const descomprimir = promisify(inflate)

const DIA_MS = 86_400_000
const sha1 = (t: string): string => createHash('sha1').update(t).digest('hex')

/** Id ordenable por fecha (la parte de tiempo ocupa siempre el mismo ancho) y único aunque haya dos en el mismo milisegundo. */
export const nuevoIdVersion = (ts = Date.now()): string => `${ts.toString(36).padStart(9, '0')}-${randomBytes(3).toString('hex')}`

export interface ResultadoLimpieza {
  versionesBorradas: number
  bytesLiberados: number
}

/**
 * Almacén de versiones de un proyecto, en una carpeta:
 * - `objetos/ab/cdef…`: el contenido de cada versión, comprimido y con el sha256 como nombre (el mismo contenido se guarda una sola vez);
 * - `indice/<sha1 de la ruta>.jsonl`: una línea por versión de ese archivo (se añade al final; solo se reescribe al recortar).
 * Todas las escrituras pasan por una cola: no se pisan entre sí.
 */
export class AlmacenHistorial {
  private indice = new Map<string, Version[]>()
  private cargando?: Promise<void>
  private tamanos?: Map<string, number>
  private cola: Promise<unknown> = Promise.resolve()

  constructor(readonly dir: string) {}

  /** Ejecuta `f` cuando terminen las operaciones anteriores. */
  serializar<T>(f: () => Promise<T>): Promise<T> {
    const p = this.cola.then(f, f)
    this.cola = p.catch(() => undefined)
    return p
  }

  private rutaIndice = (ruta: string): string => join(this.dir, 'indice', `${sha1(ruta)}.jsonl`)
  private rutaObjeto = (hash: string): string => join(this.dir, 'objetos', hash.slice(0, 2), hash.slice(2))

  private cargar(): Promise<void> {
    this.cargando ??= (async () => {
      const nombres = await readdir(join(this.dir, 'indice')).catch(() => undefined)
      if (!nombres) return
      for (const n of nombres.filter((x) => x.endsWith('.jsonl'))) {
        const versiones: Version[] = []
        for (const linea of (await readFile(join(this.dir, 'indice', n), 'utf8').catch(() => '')).split('\n')) {
          if (!linea.trim()) continue
          try {
            const v = JSON.parse(linea) as Version
            if (v && typeof v.id === 'string' && typeof v.ruta === 'string') versiones.push(v)
          } catch {
            // línea a medio escribir (corte de luz): se ignora
          }
        }
        if (versiones.length) this.indice.set(versiones[0]!.ruta, versiones.sort((a, b) => (a.id < b.id ? -1 : 1)))
      }
    })()
    return this.cargando
  }

  private async cargarTamanos(): Promise<Map<string, number>> {
    if (this.tamanos) return this.tamanos
    const m = new Map<string, number>()
    try {
      for (const carpeta of await readdir(join(this.dir, 'objetos'))) {
        for (const archivo of await readdir(join(this.dir, 'objetos', carpeta)).catch(() => [])) {
          if (archivo.endsWith('.tmp')) continue
          m.set(carpeta + archivo, (await stat(join(this.dir, 'objetos', carpeta, archivo)).catch(() => undefined))?.size ?? 0)
        }
      }
    } catch {
      // sin objetos todavía
    }
    return (this.tamanos = m)
  }

  static hashDe(contenido: Uint8Array): string {
    return createHash('sha256').update(contenido).digest('hex')
  }

  /** Guarda el contenido (comprimido) si no estaba y devuelve su hash. */
  async guardarContenido(contenido: Buffer): Promise<string> {
    const hash = AlmacenHistorial.hashDe(contenido)
    const tamanos = await this.cargarTamanos()
    if (tamanos.has(hash)) return hash
    const destino = this.rutaObjeto(hash)
    await mkdir(join(destino, '..'), { recursive: true })
    const datos = await comprimir(contenido)
    const tmp = `${destino}.${process.pid}.tmp`
    await writeFile(tmp, datos)
    await rename(tmp, destino)
    tamanos.set(hash, datos.length)
    return hash
  }

  async leerContenido(hash: string): Promise<Buffer> {
    return descomprimir(await readFile(this.rutaObjeto(hash)))
  }

  async versiones(ruta: string): Promise<Version[]> {
    await this.cargar()
    return [...(this.indice.get(ruta) ?? [])]
  }

  async ultima(ruta: string): Promise<Version | undefined> {
    await this.cargar()
    return this.indice.get(ruta)?.at(-1)
  }

  /** Apunta una versión nueva al final del índice de su archivo. */
  async anotar(v: Version): Promise<void> {
    await this.cargar()
    await mkdir(join(this.dir, 'indice'), { recursive: true })
    await appendFile(this.rutaIndice(v.ruta), JSON.stringify(v) + '\n', 'utf8')
    const lista = this.indice.get(v.ruta) ?? []
    lista.push(v)
    this.indice.set(v.ruta, lista)
  }

  async archivos(): Promise<ArchivoHistorial[]> {
    await this.cargar()
    return [...this.indice.entries()].map(([ruta, vs]) => ({ ruta, versiones: vs.length, ultima: vs.at(-1)!, eliminado: vs.at(-1)!.eliminada }))
  }

  async estadisticas(): Promise<{ archivos: number; versiones: number; bytes: number }> {
    await this.cargar()
    let versiones = 0
    for (const vs of this.indice.values()) versiones += vs.length
    const bytes = [...(await this.cargarTamanos()).values()].reduce((n, b) => n + b, 0)
    return { archivos: this.indice.size, versiones, bytes }
  }

  private async reescribir(ruta: string, versiones: Version[]): Promise<void> {
    const archivo = this.rutaIndice(ruta)
    if (versiones.length === 0) {
      await rm(archivo, { force: true })
      this.indice.delete(ruta)
      return
    }
    const tmp = `${archivo}.${process.pid}.tmp`
    await writeFile(tmp, versiones.map((v) => JSON.stringify(v)).join('\n') + '\n', 'utf8')
    await rename(tmp, archivo)
    this.indice.set(ruta, versiones)
  }

  /** Borra los objetos que ya ninguna versión usa. Devuelve los bytes liberados. */
  private async recolectar(): Promise<number> {
    const usados = new Set<string>()
    for (const vs of this.indice.values()) for (const v of vs) if (v.hash) usados.add(v.hash)
    const tamanos = await this.cargarTamanos()
    let liberados = 0
    for (const [hash, bytes] of [...tamanos]) {
      if (usados.has(hash)) continue
      await rm(this.rutaObjeto(hash), { force: true })
      tamanos.delete(hash)
      liberados += bytes
    }
    return liberados
  }

  /**
   * Recorta el historial según la política: todo durante `diasCompletos`; después una versión por día (hasta `diasDiarias`) y una por
   * semana (hasta `diasSemanales`); lo más viejo se descarta. La última versión de cada archivo se conserva siempre. Si aun así supera
   * `maxBytes`, se descartan las versiones más antiguas de cualquier archivo hasta quedar al 90 %.
   */
  limpiar(ahora = Date.now(), p: { diasCompletos: number; diasDiarias: number; diasSemanales: number; maxBytes: number } = POLITICA_HISTORIAL): Promise<ResultadoLimpieza> {
    return this.serializar(async () => {
      await this.cargar()
      const borrar = new Set<string>()
      for (const vs of this.indice.values()) {
        const ultima = vs.at(-1)!
        if (ultima.eliminada && ahora - Date.parse(ultima.fecha) > p.diasSemanales * DIA_MS) {
          for (const v of vs) borrar.add(v.id) // se borró hace más de un año: ya no hay nada que recuperar
          continue
        }
        const vistas = new Set<string>()
        for (let i = vs.length - 2; i >= 0; i--) {
          const v = vs[i]!
          const edad = ahora - Date.parse(v.fecha)
          if (edad <= p.diasCompletos * DIA_MS) continue
          if (edad > p.diasSemanales * DIA_MS) {
            borrar.add(v.id)
            continue
          }
          const t = Date.parse(v.fecha)
          const clave = edad <= p.diasDiarias * DIA_MS ? `d${new Date(t).toLocaleDateString('sv')}` : `s${Math.floor((t + 4 * DIA_MS) / (7 * DIA_MS))}`
          if (vistas.has(clave)) borrar.add(v.id)
          else vistas.add(clave)
        }
      }

      // Si tras recortar por antigüedad sigue sin caber, se descartan las versiones más viejas de cualquier archivo.
      const tamanos = await this.cargarTamanos()
      const usos = new Map<string, number>() // cuántas versiones que se quedan usan cada contenido
      for (const vs of this.indice.values()) for (const v of vs) if (v.hash && !borrar.has(v.id)) usos.set(v.hash, (usos.get(v.hash) ?? 0) + 1)
      let total = [...usos.keys()].reduce((n, h) => n + (tamanos.get(h) ?? 0), 0)
      if (total > p.maxBytes) {
        const candidatas = [...this.indice.values()]
          .flatMap((vs) => vs.slice(0, -1)) // la última de cada archivo nunca se descarta
          .filter((v) => !borrar.has(v.id))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
        for (const v of candidatas) {
          if (total <= p.maxBytes * 0.9) break
          if (v.hash) {
            const quedan = usos.get(v.hash)! - 1
            usos.set(v.hash, quedan)
            if (quedan === 0) total -= tamanos.get(v.hash) ?? 0
          }
          borrar.add(v.id)
        }
      }

      if (borrar.size === 0) return { versionesBorradas: 0, bytesLiberados: 0 }
      let borradas = 0
      for (const [ruta, vs] of [...this.indice]) {
        const quedan = vs.filter((v) => !borrar.has(v.id))
        if (quedan.length === vs.length) continue
        borradas += vs.length - quedan.length
        await this.reescribir(ruta, quedan)
      }
      return { versionesBorradas: borradas, bytesLiberados: await this.recolectar() }
    })
  }

  /** Borra todo el historial de un archivo. */
  borrarArchivo(ruta: string): Promise<void> {
    return this.serializar(async () => {
      await this.cargar()
      await this.reescribir(ruta, [])
      await this.recolectar()
    })
  }

  /** Borra todo el historial del proyecto. */
  borrarTodo(): Promise<void> {
    return this.serializar(async () => {
      await this.cargar()
      this.indice.clear()
      this.tamanos = new Map()
      await rm(this.dir, { recursive: true, force: true })
    })
  }
}
