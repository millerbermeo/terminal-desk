import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { aplicarBloques, compararTextos } from '@shared/diff'
import {
  POLITICA_HISTORIAL,
  type ArchivoHistorial,
  type AutorVersion,
  type EstadoHistorial,
  type FiltroHistorial,
  type InfoVersion,
  type OperacionesHistorial,
  type OrigenVersion,
  type ResultadoComparar,
  type ResumenHistorial,
  type Version
} from '@shared/historial'
import { git as gitReal, type ResultadoGit } from '../core/git/git'
import { rutaSegura } from '../core/tools/integradas/ruta'
import { AlmacenHistorial, nuevoIdVersion } from './almacen'
import { esBinario, esDemasiadoGrande, motivoOmitir } from './reglas'
import { VigilanteProyecto } from './vigilante'

const aPosix = (p: string): string => p.split(sep).join('/')

export interface DepsHistorial {
  /** Carpeta donde vive el historial de todos los proyectos (cada uno en una subcarpeta). */
  dir: string
  /** Quién está trabajando ahora y desde qué equipo. */
  identidad: () => Promise<AutorVersion>
  ahora?: () => number
  git?: typeof gitReal
  /** Cada cuánto se recorta el historial (ms); 0 para no hacerlo solo. */
  cadaLimpiezaMs?: number
  /** `false` desactiva el vigilante de archivos (solo se registra lo que se comunica explícitamente): para pruebas deterministas. */
  vigilar?: boolean
  /** Para las pruebas: ajustes del vigilante. */
  debounceMs?: number
  maxCarpetas?: number
  /** Cuántos archivos distintos en este tiempo (ms) se toman por un cambio masivo de git (cambio de rama, pull…). */
  masivoArchivos?: number
}

export interface MetaVersion {
  herramienta?: string
  ejecucionId?: string
  nota?: string
}

interface Proyecto {
  id: string
  raiz: string
  almacen: AlmacenHistorial
  activo: boolean
  vigilante?: VigilanteProyecto
  vigilancia: 'completa' | 'limitada' | 'apagada'
  /** Última marca de tiempo usada: cada versión tiene una estrictamente posterior (los ids se ordenan por ella aunque haya dos en el mismo milisegundo). */
  ultimoTs: number
  gitHasta: number
  recientes: { ruta: string; t: number }[]
  ignorados: Map<string, { ignorado: boolean; hasta: number }>
}

type EstadoDisco = { tipo: 'archivo'; datos: Buffer } | { tipo: 'ausente' } | { tipo: 'omitir'; motivo: 'binario' | 'grande' | 'no-archivo' }

async function leerEstadoDisco(abs: string): Promise<EstadoDisco> {
  const s = await stat(abs).catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' || e.code === 'ENOTDIR' ? null : undefined))
  if (s === null) return { tipo: 'ausente' }
  if (!s) return { tipo: 'omitir', motivo: 'no-archivo' }
  if (!s.isFile()) return { tipo: 'omitir', motivo: 'no-archivo' }
  if (esDemasiadoGrande(s.size)) return { tipo: 'omitir', motivo: 'grande' }
  try {
    const datos = await readFile(abs)
    return esBinario(datos) ? { tipo: 'omitir', motivo: 'binario' } : { tipo: 'archivo', datos }
  } catch {
    return { tipo: 'ausente' } // desapareció mientras se leía
  }
}

/** Líneas añadidas y quitadas al pasar de `antes` a `despues` (`null` = el archivo no existía / se borró). */
function contarLineas(antes: string | null, despues: string | null): { mas: number; menos: number } {
  const n = (t: string): number => (t === '' ? 0 : t.endsWith('\n') ? t.split('\n').length - 1 : t.split('\n').length)
  if (antes === null) return { mas: n(despues ?? ''), menos: 0 }
  if (despues === null) return { mas: 0, menos: n(antes) }
  const d = compararTextos(antes, despues)
  return { mas: d.agregadas + d.modificadas, menos: d.quitadas + d.modificadas }
}

/**
 * Historial local de versiones de los proyectos: registra cada cambio de los archivos (a mano en el editor, de la IA, de otros programas
 * o de git) sin hacer commits, y permite consultarlo, compararlo y restaurarlo. Todo en este equipo.
 */
export class ServicioHistorial {
  private readonly proyectos = new Map<string, Proyecto>()
  private ajustes?: Record<string, { activo: boolean }>
  private autorCache?: { autor: AutorVersion; hasta: number }
  private temporizador?: NodeJS.Timeout
  private readonly git: typeof gitReal
  private readonly ahora: () => number

  constructor(private readonly d: DepsHistorial) {
    this.git = d.git ?? gitReal
    this.ahora = d.ahora ?? Date.now
    const cada = d.cadaLimpiezaMs ?? 3_600_000
    if (cada > 0) {
      this.temporizador = setInterval(() => void this.recortar(), cada)
      this.temporizador.unref()
    }
  }

  // ---------------------------------------------------------------- proyectos y ajustes

  private get archivoAjustes(): string {
    return join(this.d.dir, 'ajustes.json')
  }

  private async leerAjustes(): Promise<Record<string, { activo: boolean }>> {
    if (this.ajustes) return this.ajustes
    try {
      const j = JSON.parse(await readFile(this.archivoAjustes, 'utf8')) as { proyectos?: Record<string, { activo?: unknown }> }
      this.ajustes = Object.fromEntries(Object.entries(j.proyectos ?? {}).map(([id, v]) => [id, { activo: v?.activo !== false }]))
    } catch {
      this.ajustes = {}
    }
    return this.ajustes
  }

  private async guardarAjustes(): Promise<void> {
    await mkdir(this.d.dir, { recursive: true })
    const tmp = `${this.archivoAjustes}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, proyectos: this.ajustes ?? {} }, null, 2) + '\n', 'utf8')
    await rename(tmp, this.archivoAjustes)
  }

  /** Pone al día los proyectos que se registran: empieza con los nuevos (si están activos) y deja los que ya no están. */
  async sincronizarProyectos(lista: { id: string; ruta: string }[]): Promise<void> {
    const ajustes = await this.leerAjustes()
    const ids = new Set(lista.map((p) => p.id))
    for (const [id, p] of [...this.proyectos]) {
      if (!ids.has(id) || lista.find((x) => x.id === id)!.ruta !== p.raiz) {
        p.vigilante?.detener()
        this.proyectos.delete(id)
      }
    }
    for (const { id, ruta } of lista) {
      if (this.proyectos.has(id)) continue
      const p: Proyecto = {
        id,
        raiz: ruta,
        almacen: new AlmacenHistorial(join(this.d.dir, id)),
        activo: ajustes[id]?.activo !== false,
        vigilancia: 'apagada',
        ultimoTs: 0,
        gitHasta: 0,
        recientes: [],
        ignorados: new Map()
      }
      this.proyectos.set(id, p)
      if (p.activo && this.d.vigilar !== false) void this.iniciarVigilancia(p)
    }
  }

  private async iniciarVigilancia(p: Proyecto): Promise<void> {
    const v = new VigilanteProyecto({
      raiz: p.raiz,
      debounceMs: this.d.debounceMs,
      maxCarpetas: this.d.maxCarpetas,
      alCambio: (ruta) => void this.cambioExterno(p, ruta),
      alGit: () => {
        p.gitHasta = this.ahora() + 5000
      },
      ignoradasPorGit: (carpetas) => this.ignoradasPorGit(p, carpetas)
    })
    p.vigilante = v
    try {
      const r = await v.iniciar()
      p.vigilancia = !p.activo ? 'apagada' : r.limitada ? 'limitada' : 'completa'
    } catch {
      p.vigilancia = 'limitada'
    }
    if (!p.activo || this.proyectos.get(p.id) !== p) {
      v.detener()
      p.vigilancia = 'apagada'
    }
  }

  private proyecto(proyectoId: string): Proyecto {
    const p = this.proyectos.get(String(proyectoId))
    if (!p) throw new Error('Este proyecto no está en este equipo.')
    return p
  }

  private async autor(): Promise<AutorVersion> {
    const t = this.ahora()
    if (this.autorCache && this.autorCache.hasta > t) return this.autorCache.autor
    const autor = await this.d.identidad().catch(() => ({}) as AutorVersion)
    this.autorCache = { autor, hasta: t + 30_000 }
    return autor
  }

  // ---------------------------------------------------------------- git: ignorados y versión base

  private async ignoradasPorGit(p: Proyecto, rutas: string[]): Promise<Set<string>> {
    const hecho = new Set<string>()
    const pedir: string[] = []
    const ahora = this.ahora()
    for (const r of rutas) {
      const c = p.ignorados.get(r)
      if (c && c.hasta > ahora) {
        if (c.ignorado) hecho.add(r)
      } else pedir.push(r)
    }
    if (pedir.length) {
      const r = await this.git(p.raiz, ['check-ignore', '--stdin', '-z'], { entrada: pedir.join('\0') + '\0', okCodigos: [0, 1], timeoutMs: 10_000 })
      const ignoradas = new Set(r.ok ? r.stdout.split('\0').filter(Boolean) : [])
      for (const x of pedir) {
        p.ignorados.set(x, { ignorado: ignoradas.has(x), hasta: ahora + 60_000 })
        if (ignoradas.has(x)) hecho.add(x)
      }
    }
    return hecho
  }

  /** El archivo tal como está en el último commit (`HEAD`), si es un archivo versionado de texto. */
  private async baseGit(p: Proyecto, ruta: string): Promise<{ datos: Buffer; fecha: number } | undefined> {
    const tam: ResultadoGit = await this.git(p.raiz, ['cat-file', '-s', `HEAD:${ruta}`], { timeoutMs: 5000 })
    if (!tam.ok || esDemasiadoGrande(Number(tam.stdout.trim()))) return undefined
    const r = await this.git(p.raiz, ['show', `HEAD:${ruta}`], { timeoutMs: 10_000 })
    if (!r.ok) return undefined
    const datos = Buffer.from(r.stdout, 'utf8')
    if (esBinario(datos)) return undefined
    const f = await this.git(p.raiz, ['log', '-1', '--format=%cI', 'HEAD', '--', ruta], { timeoutMs: 5000 })
    const fecha = f.ok ? Date.parse(f.stdout.trim()) : NaN
    return { datos, fecha: Number.isFinite(fecha) ? fecha : this.ahora() - 1 }
  }

  // ---------------------------------------------------------------- captura

  /**
   * Ruta relativa con `/` dentro del proyecto, o `undefined` si queda fuera o es la raíz. Se resuelve antes de comprobar: `a/../../x` o
   * (en Windows) una ruta de otra unidad no pueden colarse. Las rutas llegan también del gancho de Claude Code, es decir, de la IA.
   */
  private relativa(p: Proyecto, cruda: string): string | undefined {
    const r = relative(p.raiz, resolve(p.raiz, cruda))
    if (!r || r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) return undefined
    return aPosix(r)
  }

  /**
   * Registra cómo está ahora un archivo (su contenido, o que ya no existe) si cambió desde la última versión. Es la única puerta de
   * entrada de versiones: el editor, la IA, el vigilante y las restauraciones pasan por aquí.
   */
  registrarRuta(proyectoId: string, ruta: string, origen: OrigenVersion, meta: MetaVersion = {}): Promise<Version | null> {
    const p = this.proyectos.get(String(proyectoId))
    const rel = p && this.relativa(p, ruta)
    if (!p || !p.activo || !rel) return Promise.resolve(null)
    return p.almacen.serializar(() => this.registrar(p, rel, origen, meta))
  }

  private async registrar(p: Proyecto, ruta: string, origen: OrigenVersion, meta: MetaVersion): Promise<Version | null> {
    if (motivoOmitir(ruta)) return null
    if ((await this.ignoradasPorGit(p, [ruta])).has(ruta)) return null
    const estado = await leerEstadoDisco(join(p.raiz, ruta))
    if (estado.tipo === 'omitir') return null
    let ultima = await p.almacen.ultima(ruta)
    const hash = estado.tipo === 'archivo' ? AlmacenHistorial.hashDe(estado.datos) : null
    if (ultima && ultima.hash === hash) return null // nada cambió

    // Primera vez que se ve el archivo: si git lo tiene, su versión de HEAD es el punto de partida (así el primer cambio ya tiene diff).
    if (!ultima) {
      const base = await this.baseGit(p, ruta)
      if (!base) {
        if (hash === null) return null // nunca existió (para git) y sigue sin existir
      } else {
        const hb = AlmacenHistorial.hashDe(base.datos)
        const t = Math.min(base.fecha, this.ahora() - 1)
        ultima = {
          id: nuevoIdVersion(t),
          ruta,
          hash: await p.almacen.guardarContenido(base.datos),
          bytes: base.datos.length,
          fecha: new Date(t).toISOString(),
          origen: 'base',
          autor: {},
          nota: 'Versión del último commit de git',
          ...contarLineas(null, base.datos.toString('utf8')),
          eliminada: false
        }
        await p.almacen.anotar(ultima)
        if (hb === hash) return null // igual que git: solo queda como punto de partida
      }
    }

    const antes = ultima?.hash ? (await p.almacen.leerContenido(ultima.hash)).toString('utf8') : null
    const despues = estado.tipo === 'archivo' ? estado.datos.toString('utf8') : null
    const contenido = estado.tipo === 'archivo' ? await p.almacen.guardarContenido(estado.datos) : null
    const t = Math.max(this.ahora(), p.ultimoTs + 1)
    p.ultimoTs = t
    const v: Version = {
      id: nuevoIdVersion(t),
      ruta,
      hash: contenido,
      bytes: estado.tipo === 'archivo' ? estado.datos.length : 0,
      fecha: new Date(t).toISOString(),
      origen,
      autor: await this.autor(),
      ...(meta.herramienta ? { herramienta: meta.herramienta } : {}),
      ...(meta.ejecucionId ? { ejecucionId: meta.ejecucionId } : {}),
      ...(meta.nota ? { nota: meta.nota } : {}),
      ...contarLineas(antes, despues),
      eliminada: estado.tipo !== 'archivo'
    }
    await p.almacen.anotar(v)
    return v
  }

  /** Antes de que alguien escriba un archivo: guarda lo que haya en disco por si cambió fuera de la app (así nada se pierde). */
  antesDeEscribir(proyectoId: string, ruta: string): Promise<Version | null> {
    return this.registrarRuta(proyectoId, ruta, 'externo', { nota: 'Estado justo antes de escribir' })
  }

  /** Después de que alguien escribió un archivo: lo registra con su origen (`usuario` o `ia`). */
  despuesDeEscribir(proyectoId: string, ruta: string, origen: 'usuario' | 'ia', meta: MetaVersion = {}): Promise<Version | null> {
    return this.registrarRuta(proyectoId, ruta, origen, meta)
  }

  /** Cambio detectado por el vigilante: de git si acaba de cambiar de rama (o son muchos archivos de golpe); si no, de otro programa. */
  private async cambioExterno(p: Proyecto, ruta: string): Promise<void> {
    if (!p.activo) return
    const t = this.ahora()
    p.recientes = p.recientes.filter((r) => t - r.t < 1500 && r.ruta !== ruta)
    p.recientes.push({ ruta, t })
    if (p.recientes.length >= (this.d.masivoArchivos ?? 25)) p.gitHasta = Math.max(p.gitHasta, t + 5000)
    const origen: OrigenVersion = p.gitHasta > t ? 'git' : 'externo'
    const nota = origen === 'git' ? 'Cambio de git (rama, pull o fusión)' : undefined
    try {
      await this.registrarRuta(p.id, ruta, origen, nota ? { nota } : {})
      // Si era una carpeta que desapareció, también sus archivos.
      const ausente = (await stat(join(p.raiz, ruta)).catch(() => undefined)) === undefined
      if (ausente) {
        for (const f of await p.almacen.archivos()) {
          if (f.ruta.startsWith(`${ruta}/`) && !f.eliminado) await this.registrarRuta(p.id, f.ruta, origen, nota ? { nota } : {})
        }
      }
    } catch {
      // un archivo que no se pudo leer no debe tumbar al vigilante
    }
  }

  // ---------------------------------------------------------------- consulta

  private async estadoDe(p: Proyecto): Promise<EstadoHistorial> {
    const e = await p.almacen.estadisticas()
    return {
      activo: p.activo,
      vigilancia: p.activo ? p.vigilancia : 'apagada',
      carpetasVigiladas: p.vigilante?.carpetas ?? 0,
      archivos: e.archivos,
      versiones: e.versiones,
      bytes: e.bytes,
      limiteBytes: POLITICA_HISTORIAL.maxBytes,
      diasCompletos: POLITICA_HISTORIAL.diasCompletos
    }
  }

  estado(proyectoId: string): Promise<EstadoHistorial> {
    return this.estadoDe(this.proyecto(proyectoId))
  }

  async ajustar(proyectoId: string, activo: boolean): Promise<EstadoHistorial> {
    const p = this.proyecto(proyectoId)
    const ajustes = await this.leerAjustes()
    ajustes[p.id] = { activo: activo === true }
    await this.guardarAjustes()
    p.activo = activo === true
    if (p.activo) {
      if (!p.vigilante && this.d.vigilar !== false) await this.iniciarVigilancia(p)
    } else {
      p.vigilante?.detener()
      p.vigilante = undefined
      p.vigilancia = 'apagada'
    }
    return this.estadoDe(p)
  }

  private coincide(v: Version, filtro: Pick<FiltroHistorial, 'origen' | 'autor'>): boolean {
    if (filtro.origen && v.origen !== filtro.origen) return false
    const a = filtro.autor?.trim().toLowerCase()
    if (a && ![v.autor.usuario, v.autor.cuenta, v.autor.equipo].some((x) => x?.toLowerCase().includes(a))) return false
    return true
  }

  async archivos(proyectoId: string, filtro: FiltroHistorial = {}, limite = 200): Promise<{ archivos: ArchivoHistorial[]; hayMas: boolean }> {
    const p = this.proyecto(proyectoId)
    const texto = filtro.texto?.trim().toLowerCase()
    const desde = filtro.desde ? Date.parse(filtro.desde) : undefined
    const todos: ArchivoHistorial[] = []
    for (const f of await p.almacen.archivos()) {
      if (texto && !f.ruta.toLowerCase().includes(texto)) continue
      if (desde !== undefined && Date.parse(f.ultima.fecha) < desde) continue
      if (filtro.origen || filtro.autor) {
        const vs = await p.almacen.versiones(f.ruta)
        if (!vs.some((v) => this.coincide(v, filtro))) continue
      }
      todos.push(f)
    }
    todos.sort((a, b) => (a.ultima.id < b.ultima.id ? 1 : -1))
    const max = Math.max(1, Math.min(limite, 2000))
    return { archivos: todos.slice(0, max), hayMas: todos.length > max }
  }

  async versiones(proyectoId: string, ruta: string, filtro: Pick<FiltroHistorial, 'origen' | 'autor'> = {}): Promise<Version[]> {
    const p = this.proyecto(proyectoId)
    const rel = this.relativa(p, ruta)
    if (!rel) return []
    return (await p.almacen.versiones(rel)).filter((v) => this.coincide(v, filtro)).reverse() // la más reciente primero
  }

  private info = (v: Version): InfoVersion => ({ id: v.id, fecha: v.fecha, origen: v.origen, autor: v.autor, eliminada: v.eliminada })

  /** Texto de una versión, de `actual` (el archivo en disco) o `anterior` (la previa a `hasta`). */
  private async textoDe(p: Proyecto, ruta: string, que: string, referencia?: string): Promise<{ texto: string; info: InfoVersion | 'actual' | 'vacio'; omitido?: 'binario' | 'grande' }> {
    if (que === 'actual') {
      const e = await leerEstadoDisco(join(p.raiz, ruta))
      if (e.tipo === 'ausente') return { texto: '', info: 'vacio' }
      if (e.tipo === 'omitir') return { texto: '', info: 'actual', omitido: e.motivo === 'grande' ? 'grande' : 'binario' }
      return { texto: e.datos.toString('utf8'), info: 'actual' }
    }
    const vs = await p.almacen.versiones(ruta)
    let v: Version | undefined
    if (que === 'anterior') {
      const i = vs.findIndex((x) => x.id === referencia)
      v = i > 0 ? vs[i - 1] : undefined
      if (!v) return { texto: '', info: 'vacio' }
    } else v = vs.find((x) => x.id === que)
    if (!v) throw new Error('Esa versión ya no existe (se recortó el historial antiguo).')
    if (!v.hash) return { texto: '', info: this.info(v) }
    return { texto: (await p.almacen.leerContenido(v.hash)).toString('utf8'), info: this.info(v) }
  }

  async leer(proyectoId: string, ruta: string, version: string): Promise<OperacionesHistorial['leer']['salida']> {
    const p = this.proyecto(proyectoId)
    const rel = this.relativa(p, ruta)
    if (!rel) throw new Error('Ruta no válida.')
    const r = await this.textoDe(p, rel, version)
    if (r.omitido) return { omitido: r.omitido }
    if (r.info !== 'actual' && r.info !== 'vacio' && r.info.eliminada) return { omitido: 'borrada' }
    return { texto: r.texto }
  }

  async comparar(proyectoId: string, ruta: string, desde: string, hasta: string): Promise<ResultadoComparar> {
    const p = this.proyecto(proyectoId)
    const rel = this.relativa(p, ruta)
    if (!rel) throw new Error('Ruta no válida.')
    const b = await this.textoDe(p, rel, hasta)
    const a = await this.textoDe(p, rel, desde, hasta)
    const omitido = a.omitido ?? b.omitido
    return { desde: a.info, hasta: b.info, diff: compararTextos(a.texto, b.texto), ...(omitido ? { omitido } : {}) }
  }

  // ---------------------------------------------------------------- restaurar

  /**
   * Restaura una versión (entera, o solo los bloques elegidos de la comparación «actual → versión»). Antes guarda como versión el estado
   * actual del archivo, así siempre se puede volver atrás. Escribe de forma atómica y conserva los permisos.
   */
  async restaurar(proyectoId: string, ruta: string, versionId: string, bloques?: readonly number[]): Promise<Version> {
    const p = this.proyecto(proyectoId)
    const rel = this.relativa(p, ruta)
    if (!rel) throw new Error('Ruta no válida.')
    if (rel.split('/').some((s) => s === '.git' || s === 'node_modules')) throw new Error('No se restaura dentro de .git ni node_modules.')
    return p.almacen.serializar(async () => {
      const objetivo = (await p.almacen.versiones(rel)).find((v) => v.id === versionId)
      if (!objetivo) throw new Error('Esa versión ya no existe (se recortó el historial antiguo).')
      if (!objetivo.hash) throw new Error('Esa versión es el momento en que se borró el archivo: elige una versión anterior con contenido.')
      const abs = await rutaSegura(p.raiz, rel)
      await this.registrar(p, rel, 'externo', { nota: 'Estado justo antes de restaurar' }) // red de seguridad
      const destino = await p.almacen.leerContenido(objetivo.hash)
      let salida: Buffer = destino
      if (bloques && bloques.length > 0) {
        const actual = await leerEstadoDisco(abs)
        if (actual.tipo !== 'archivo') throw new Error('Para restaurar solo algunos bloques el archivo tiene que existir y ser de texto.')
        salida = Buffer.from(aplicarBloques(actual.datos.toString('utf8'), destino.toString('utf8'), bloques), 'utf8')
      }
      await this.escribirAtomico(abs, salida)
      const fecha = new Date(objetivo.fecha).toLocaleString('es')
      const nota = bloques?.length ? `Restaurados ${bloques.length} bloque${bloques.length === 1 ? '' : 's'} de la versión del ${fecha}` : `Restaurado desde la versión del ${fecha}`
      const v = await this.registrar(p, rel, 'restauracion', { nota })
      if (!v) throw new Error('El archivo ya es igual a esa versión: no hay nada que restaurar.')
      return v
    })
  }

  private async escribirAtomico(abs: string, datos: Buffer): Promise<void> {
    const actual = await stat(abs).catch(() => undefined)
    await mkdir(dirname(abs), { recursive: true })
    const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.tmp`)
    await writeFile(tmp, datos)
    if (actual) await chmod(tmp, actual.mode & 0o777).catch(() => undefined)
    await rename(tmp, abs)
  }

  // ---------------------------------------------------------------- mantenimiento

  async olvidar(proyectoId: string, ruta?: string): Promise<EstadoHistorial> {
    const p = this.proyecto(proyectoId)
    if (ruta) {
      const rel = this.relativa(p, ruta)
      if (rel) await p.almacen.borrarArchivo(rel)
    } else await p.almacen.borrarTodo()
    return this.estadoDe(p)
  }

  /** Recorta el historial de todos los proyectos según la política (se hace solo cada hora). */
  async recortar(): Promise<void> {
    for (const p of this.proyectos.values()) await p.almacen.limpiar(this.ahora()).catch(() => undefined)
  }

  /** Lo que cambió hace poco, para que otros equipos de la cuenta vean que aquí hay historial (solo nombres y fechas, nunca contenido). */
  async resumen(proyectoId: string, max = 30): Promise<{ total: number; archivos: ResumenHistorial[] }> {
    const p = this.proyectos.get(String(proyectoId))
    if (!p?.activo) return { total: 0, archivos: [] }
    const todos = await p.almacen.archivos()
    return {
      total: todos.reduce((n, f) => n + f.versiones, 0),
      archivos: todos
        .sort((a, b) => (a.ultima.id < b.ultima.id ? 1 : -1))
        .slice(0, max)
        .map((f) => ({ ruta: f.ruta, versiones: f.versiones, ultima: f.ultima.fecha }))
    }
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    for (const p of this.proyectos.values()) p.vigilante?.detener()
    this.proyectos.clear()
  }
}
