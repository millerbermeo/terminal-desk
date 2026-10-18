import { watch, type FSWatcher } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { LIMITES_EDITOR, type CambioArchivo, type EntradaArchivo, type MarcaGit, type ResultadoGuardar, type ResultadoLeer } from '@shared/archivos'
import { git } from './core/git/git'
import { rutaSegura } from './core/tools/integradas/ruta'

const IGNORADOS = new Set(['.git', 'node_modules', '.DS_Store'])
const MAX_VIGILADAS = 200

const aPosix = (p: string): string => p.split(sep).join('/')

/** Rutas en las que el editor no escribe nunca (la aplicación no es la herramienta adecuada). */
function protegida(ruta: string): string | null {
  const segs = ruta.split(/[\\/]/)
  if (segs.includes('.git')) return 'los metadatos de git'
  if (segs.includes('node_modules')) return 'las dependencias instaladas (node_modules)'
  return null
}

export interface OpcionesGestor {
  /** Raíz de un proyecto por su id. */
  raiz: (proyectoId: string) => Promise<string>
  /** Manda un archivo o carpeta a la papelera del sistema. */
  papelera: (rutaAbsoluta: string) => Promise<void>
  /** Historial local: se avisa antes y después de cada cambio que hace el editor (los errores del historial nunca impiden guardar). */
  historial?: {
    antes: (proyectoId: string, ruta: string) => Promise<unknown>
    despues: (proyectoId: string, ruta: string) => Promise<unknown>
  }
}

/**
 * Operaciones de archivos del editor integrado. Todas son relativas a la raíz de un proyecto y quedan confinadas a ella
 * (se rechazan `..`, rutas absolutas y enlaces simbólicos que escapen), igual que las herramientas del agente.
 */
export class GestorArchivos {
  constructor(private readonly o: OpcionesGestor) {}

  private async anotar(momento: 'antes' | 'despues', proyectoId: string, ruta: string): Promise<void> {
    try {
      await this.o.historial?.[momento](proyectoId, ruta)
    } catch {
      // el historial es un extra: si falla, el editor sigue funcionando
    }
  }

  private async abs(proyectoId: string, ruta: string): Promise<{ raiz: string; abs: string }> {
    const raiz = await this.o.raiz(proyectoId)
    return { raiz, abs: await rutaSegura(raiz, ruta || '.') }
  }

  async listar(proyectoId: string, ruta = ''): Promise<EntradaArchivo[]> {
    const { raiz, abs } = await this.abs(proyectoId, ruta)
    const items = await readdir(abs, { withFileTypes: true })
    const entradas = await Promise.all(
      items
        .filter((i) => !IGNORADOS.has(i.name))
        .map(async (i): Promise<EntradaArchivo> => {
          const rel = aPosix(relative(raiz, join(abs, i.name)))
          if (i.isDirectory()) return { nombre: i.name, ruta: rel, tipo: 'carpeta' }
          if (i.isSymbolicLink()) return { nombre: i.name, ruta: rel, tipo: 'enlace' }
          const bytes = await stat(join(abs, i.name)).then((s) => s.size, () => undefined)
          return { nombre: i.name, ruta: rel, tipo: 'archivo', ...(bytes !== undefined ? { bytes } : {}) }
        })
    )
    return entradas.sort((a, b) => (a.tipo === 'carpeta') === (b.tipo === 'carpeta') ? a.nombre.localeCompare(b.nombre, undefined, { numeric: true, sensitivity: 'base' }) : a.tipo === 'carpeta' ? -1 : 1)
  }

  async leer(proyectoId: string, ruta: string): Promise<ResultadoLeer> {
    const { abs } = await this.abs(proyectoId, ruta)
    const s = await stat(abs).catch(() => undefined)
    if (!s) return { ok: false, motivo: 'no-existe' }
    if (!s.isFile()) return { ok: false, motivo: 'no-es-archivo' }
    if (s.size > LIMITES_EDITOR.lecturaBytes) return { ok: false, motivo: 'demasiado-grande', bytes: s.size }
    const datos = await readFile(abs)
    if (datos.subarray(0, 8000).includes(0)) return { ok: false, motivo: 'binario', bytes: s.size }
    try {
      return { ok: true, contenido: new TextDecoder('utf-8', { fatal: true }).decode(datos), mtimeMs: s.mtimeMs, bytes: s.size }
    } catch {
      return { ok: false, motivo: 'no-utf8', bytes: s.size }
    }
  }

  /**
   * Guarda de forma atómica (archivo temporal + rename). Si se indica `mtimeEsperado` y el archivo cambió en disco desde entonces
   * (otro programa, o el agente), no lo pisa: devuelve `conflicto`.
   */
  async guardar(proyectoId: string, ruta: string, contenido: string, mtimeEsperado?: number): Promise<ResultadoGuardar> {
    const motivo = protegida(ruta)
    if (motivo) return { ok: false, motivo: 'protegido', mensaje: `No se edita en ${motivo}` }
    if (Buffer.byteLength(contenido) > LIMITES_EDITOR.escrituraBytes) return { ok: false, motivo: 'demasiado-grande' }
    const { abs } = await this.abs(proyectoId, ruta)
    const actual = await stat(abs).catch(() => undefined)
    if (actual && mtimeEsperado !== undefined && actual.mtimeMs > mtimeEsperado + 1) return { ok: false, motivo: 'conflicto', mtimeMs: actual.mtimeMs }
    if (actual && !actual.isFile()) return { ok: false, motivo: 'no-existe', mensaje: 'No es un archivo' }
    await this.anotar('antes', proyectoId, ruta) // por si el archivo cambió fuera de la app y aún no se había visto
    await mkdir(dirname(abs), { recursive: true })
    const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.tmp`)
    await writeFile(tmp, contenido, 'utf8')
    if (actual) await chmod(tmp, actual.mode & 0o777).catch(() => undefined) // conserva los permisos (p. ej. ejecutable)
    await rename(tmp, abs)
    await this.anotar('despues', proyectoId, ruta)
    return { ok: true, mtimeMs: (await stat(abs)).mtimeMs }
  }

  async crear(proyectoId: string, ruta: string, tipo: 'archivo' | 'carpeta'): Promise<void> {
    const motivo = protegida(ruta)
    if (motivo) throw new Error(`No se crea nada en ${motivo}`)
    if (!ruta.trim() || /[\\/]$/.test(ruta)) throw new Error('Nombre no válido')
    const { abs } = await this.abs(proyectoId, ruta)
    if (await stat(abs).then(() => true, () => false)) throw new Error(`«${basename(abs)}» ya existe`)
    if (tipo === 'carpeta') await mkdir(abs, { recursive: true })
    else {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, '', { flag: 'wx' })
      await this.anotar('despues', proyectoId, ruta)
    }
  }

  async renombrar(proyectoId: string, desde: string, hasta: string): Promise<void> {
    const motivo = protegida(desde) ?? protegida(hasta)
    if (motivo) throw new Error(`No se modifica ${motivo}`)
    if (!desde.trim() || !hasta.trim()) throw new Error('Nombre no válido')
    const a = await this.abs(proyectoId, desde)
    const b = await this.abs(proyectoId, hasta)
    if (a.abs === a.raiz) throw new Error('No se puede renombrar la raíz del proyecto')
    if (await stat(b.abs).then(() => true, () => false)) throw new Error(`«${basename(b.abs)}» ya existe`)
    await this.anotar('antes', proyectoId, desde)
    await mkdir(dirname(b.abs), { recursive: true })
    await rename(a.abs, b.abs)
    await this.anotar('despues', proyectoId, desde) // el archivo ya no está ahí
    await this.anotar('despues', proyectoId, hasta)
  }

  /** Manda a la papelera (recuperable). */
  async borrar(proyectoId: string, ruta: string): Promise<void> {
    const motivo = protegida(ruta)
    if (motivo) throw new Error(`No se borra en ${motivo}`)
    const { raiz, abs } = await this.abs(proyectoId, ruta)
    if (abs === raiz) throw new Error('No se puede borrar la raíz del proyecto')
    await this.anotar('antes', proyectoId, ruta)
    await this.o.papelera(abs)
    await this.anotar('despues', proyectoId, ruta)
  }

  /** Marcas de git por ruta relativa (las carpetas sin seguimiento llevan la marca de la carpeta). Vacío si no es un repositorio. */
  async estadoGit(proyectoId: string): Promise<Record<string, MarcaGit>> {
    const raiz = await this.o.raiz(proyectoId)
    const r = await git(raiz, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], { timeoutMs: 15_000 })
    if (!r.ok) return {}
    const marcas: Record<string, MarcaGit> = {}
    const partes = r.stdout.split('\0')
    for (let i = 0; i < partes.length; i++) {
      const p = partes[i]!
      if (p.length < 4) continue
      const xy = p.slice(0, 2)
      const ruta = p.slice(3).replace(/\/$/, '')
      if (xy[0] === 'R' || xy[0] === 'C') i++ // en renombrados la ruta anterior viene en la entrada siguiente
      marcas[ruta] = xy === '??' ? 'U' : /U|AA|DD/.test(xy) ? 'C' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : xy.includes('A') ? 'A' : 'M'
    }
    return marcas
  }
}

/**
 * Vigila carpetas (no recursivo: solo las que el editor tiene desplegadas o con archivos abiertos) y avisa de los cambios con un
 * pequeño retardo para agrupar ráfagas. Los archivos temporales de los guardados atómicos no generan avisos.
 */
export class Vigilante {
  private readonly vigilancias = new Map<number, Map<string, { w: FSWatcher; t?: NodeJS.Timeout }>>()

  constructor(private readonly raiz: (proyectoId: string) => Promise<string>) {}

  /** Sustituye el conjunto de carpetas vigiladas de un propietario (una ventana). */
  async establecer(propietario: number, proyectoId: string, carpetas: readonly string[], alCambio: (c: CambioArchivo) => void): Promise<void> {
    const mapa = this.vigilancias.get(propietario) ?? new Map()
    this.vigilancias.set(propietario, mapa)
    const raiz = await this.raiz(proyectoId)
    const quiero = new Set(carpetas.slice(0, MAX_VIGILADAS).map((c) => `${proyectoId}\0${c}`))
    for (const [clave, v] of [...mapa]) {
      if (!clave.startsWith(`${proyectoId}\0`) || quiero.has(clave)) continue
      v.w.close()
      clearTimeout(v.t)
      mapa.delete(clave)
    }
    for (const clave of quiero) {
      if (mapa.has(clave)) continue
      const carpeta = clave.slice(proyectoId.length + 1)
      try {
        const abs = await rutaSegura(raiz, carpeta || '.')
        const entrada: { w: FSWatcher; t?: NodeJS.Timeout } = { w: watch(abs, { persistent: false }, (_ev, nombre) => {
          const n = nombre?.toString()
          if (n && /^\..*\.tmp$/.test(n)) return
          clearTimeout(entrada.t)
          entrada.t = setTimeout(() => alCambio({ proyectoId, carpeta, ...(n ? { nombre: n } : {}) }), 150)
        }) }
        entrada.w.on('error', () => {
          entrada.w.close()
          mapa.delete(clave)
        })
        mapa.set(clave, entrada)
      } catch {
        /* la carpeta ya no existe o no se puede vigilar */
      }
    }
  }

  cerrar(propietario: number): void {
    for (const v of this.vigilancias.get(propietario)?.values() ?? []) {
      v.w.close()
      clearTimeout(v.t)
    }
    this.vigilancias.delete(propietario)
  }
}
