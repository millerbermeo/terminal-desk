import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ArchivoEquipo, AvisoEquipo, EquipoProyecto, EstadoArchivoEquipo, NombreOperacionEquipos, OperacionesEquipos, PendienteClonar } from '@shared/equipos'
import type { ArchivoCambio, CodigoEstado, Commit, EstadoGit } from '@shared/versiones'

/** Lo que usa de git: el estado de la carpeta, su último commit y consultar el remoto. */
export interface RepoEquipos {
  /** `agrupado`: sin seguimiento por carpeta (barato). `ligero`: solo lo versionado (no recorre los archivos sin seguimiento). */
  estado(modo?: 'completo' | 'agrupado' | 'ligero'): Promise<EstadoGit>
  historial(o: { limite: number }): Promise<{ commits: Commit[] }>
  /** Líneas añadidas y quitadas por archivo respecto al último commit. */
  lineasCambiadas(): Promise<Map<string, { mas: number; menos: number }>>
  obtener(): Promise<unknown>
}

export interface DepsEquipos {
  servidor: { get<T>(ruta: string): Promise<T>; put<T>(ruta: string, cuerpo: unknown): Promise<T>; delete(ruta: string): Promise<unknown> }
  /** Archivo donde se guarda el id (y el nombre) de este equipo. */
  archivo: string
  /** Nombre por defecto de este equipo (el del sistema). */
  nombreSistema: string
  /** Proyectos de la cuenta que tienen carpeta en este equipo. */
  proyectos(): Promise<{ id: string; ruta: string }[]>
  repositorio(ruta: string): RepoEquipos
  pendientes(): Promise<PendienteClonar[]>
  clonarProyecto(e: { proyectoId: string; repo: string; carpetaPadre: string; protocolo?: 'https' | 'ssh' }): Promise<{ ruta: string }>
  /** Tras enlazar un proyecto clonado (por ejemplo, para bajar su tablero y conversaciones). */
  alClonar?(proyectoId: string): Promise<void>
  /** Resumen del historial local de un proyecto (solo nombres, número de versiones y fecha) para que otros equipos vean que aquí hay actividad. */
  historial?: (proyectoId: string) => Promise<{ total: number; archivos: { ruta: string; versiones: number; ultima: string }[] }>
  /** Cada cuánto, como máximo, se consulta el remoto de un proyecto (ms). */
  cadaTraerMs?: number
  /** Cada cuánto se vuelve a informar aunque nada haya cambiado, para que se vea que el equipo sigue encendido (ms). */
  cadaLatidoMs?: number
  ahora?: () => number
}

interface FilaServidor {
  projectId?: string
  deviceId: string
  deviceName: string
  branch: string | null
  commit: string | null
  subject: string | null
  ahead: number
  behind: number
  hasUpstream: boolean
  dirty: number
  files?: { path: string; status: EstadoArchivoEquipo; add: number; del: number }[]
  insertions?: number
  deletions?: number
  lastActivity?: string | null
  commitDate?: string | null
  history?: { path: string; count: number; last: string }[]
  historyTotal?: number
  updatedAt: string
}

interface CuerpoEquipo {
  name: string
  branch: string | null
  commit: string | null
  subject: string | null
  ahead: number
  behind: number
  upstream: boolean
  dirty: number
  files: { path: string; status: EstadoArchivoEquipo; add: number; del: number }[]
  insertions: number
  deletions: number
  activity: string | null
  commitDate: string | null
  history: { path: string; count: number; last: string }[]
  historyTotal: number
}

const MAX_ARCHIVOS = 50
/** Un aviso de otro equipo deja de mostrarse si no informa en este tiempo (equipo viejo o apagado hace semanas). */
const AVISO_CADUCA_MS = 30 * 24 * 3_600_000

/** La letra que mejor resume qué le pasó al archivo (lo del árbol de trabajo manda sobre lo del índice). */
export function estadoDeArchivo(a: Pick<ArchivoCambio, 'conflicto' | 'sinSeguimiento' | 'indice' | 'trabajo'>): EstadoArchivoEquipo {
  if (a.conflicto) return 'U'
  if (a.sinSeguimiento) return 'N'
  const c: CodigoEstado = a.trabajo !== '.' ? a.trabajo : a.indice
  return c === '.' || c === 'U' ? 'M' : c
}

const nombreValido = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) throw new Error('Escribe un nombre para este equipo.')
  if (t.length > 120 || /[\r\n\0]/.test(t)) throw new Error('Nombre no válido.')
  return t
}

/**
 * Estado de git de los proyectos en cada computadora de la cuenta. Este equipo sube el suyo (rama, commit, cuánto va adelante o atrás
 * de su remoto, cambios sin guardar) y baja el de los demás para mostrarlo. Sin rutas. Los fallos de un proyecto no frenan al resto.
 */
export class ServicioEquipos {
  private yo?: { id: string; nombre: string }
  private readonly ultimoTraer = new Map<string, number>()
  private readonly enviado = new Map<string, { clave: string; en: number }>()
  /** Un repositorio lento (millones de archivos) se consulta menos: hasta que pase esta hora no se vuelve a mirar. */
  private readonly noAntesDe = new Map<string, number>()
  /** Repositorios tan grandes que recorrer sus archivos sin seguimiento tarda demasiado: solo se mira lo versionado. */
  private readonly lentos = new Set<string>()
  private readonly ahora: () => number

  constructor(private readonly d: DepsEquipos) {
    this.ahora = d.ahora ?? Date.now
  }

  async equipo(): Promise<{ id: string; nombre: string }> {
    if (this.yo) return this.yo
    try {
      const j = JSON.parse(await readFile(this.d.archivo, 'utf8')) as { id?: unknown; nombre?: unknown }
      if (typeof j.id === 'string' && /^[0-9a-f-]{36}$/i.test(j.id)) {
        this.yo = { id: j.id, nombre: typeof j.nombre === 'string' && j.nombre.trim() ? j.nombre : this.d.nombreSistema }
        return this.yo
      }
    } catch {
      // primera vez en este equipo
    }
    this.yo = { id: randomUUID(), nombre: this.d.nombreSistema }
    await this.guardarEquipo()
    return this.yo
  }

  private async guardarEquipo(): Promise<void> {
    await mkdir(dirname(this.d.archivo), { recursive: true })
    const tmp = `${this.d.archivo}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(this.yo), { mode: 0o600 })
    await rename(tmp, this.d.archivo)
  }

  async renombrar(nombre: unknown): Promise<{ id: string; nombre: string }> {
    const yo = await this.equipo()
    this.yo = { id: yo.id, nombre: nombreValido(nombre) }
    await this.guardarEquipo()
    this.enviado.clear() // se vuelve a informar con el nombre nuevo
    return this.yo
  }

  /** Estado de git de una carpeta, o `undefined` si no es un repositorio con commits. */
  private async estadoLocal(ruta: string, proyectoId: string, traer: boolean): Promise<CuerpoEquipo | undefined> {
    const repo = this.d.repositorio(ruta)
    const ahora = this.ahora()
    if (traer && ahora - (this.ultimoTraer.get(proyectoId) ?? 0) >= (this.d.cadaTraerMs ?? 5 * 60_000)) {
      this.ultimoTraer.set(proyectoId, ahora)
      await repo.obtener().catch(() => undefined) // sin red o sin credenciales: se informa con lo último que se sabe
    }
    let st: EstadoGit
    const inicio = Date.now()
    try {
      st = await repo.estado(this.lentos.has(proyectoId) ? 'ligero' : 'agrupado')
    } catch {
      return undefined
    } finally {
      const duracion = Date.now() - inicio
      if (duracion > 1000) {
        this.lentos.add(proyectoId)
        this.noAntesDe.set(proyectoId, this.ahora() + duracion * 60)
      } else this.noAntesDe.delete(proyectoId)
    }
    if (!st.repo || st.sinCommits) return undefined
    const ultimo = (await repo.historial({ limite: 1 }).catch(() => ({ commits: [] as Commit[] }))).commits[0]
    const lineas = st.archivos.some((f) => !f.sinSeguimiento) ? await repo.lineasCambiadas().catch(() => new Map<string, { mas: number; menos: number }>()) : new Map<string, { mas: number; menos: number }>()
    const archivos = [...st.archivos].sort((a, b) => Number(b.conflicto) - Number(a.conflicto) || a.ruta.localeCompare(b.ruta)).slice(0, MAX_ARCHIVOS)
    return {
      name: (await this.equipo()).nombre,
      branch: st.rama ?? null,
      commit: ultimo?.hash ?? null,
      subject: ultimo?.asunto.slice(0, 300) ?? null,
      ahead: st.adelante,
      behind: st.atras,
      upstream: Boolean(st.upstream),
      dirty: st.archivos.length,
      files: archivos.map((f) => ({ path: f.ruta.slice(0, 500), status: estadoDeArchivo(f), add: lineas.get(f.ruta)?.mas ?? 0, del: lineas.get(f.ruta)?.menos ?? 0 })),
      insertions: [...lineas.values()].reduce((n, l) => n + l.mas, 0),
      deletions: [...lineas.values()].reduce((n, l) => n + l.menos, 0),
      activity: await this.ultimaModificacion(st.raiz ?? ruta, archivos),
      commitDate: ultimo?.fecha ?? null,
      ...(await this.resumenHistorial(proyectoId))
    }
  }

  private async resumenHistorial(proyectoId: string): Promise<{ history: CuerpoEquipo['history']; historyTotal: number }> {
    try {
      const r = (await this.d.historial?.(proyectoId)) ?? { total: 0, archivos: [] }
      return { history: r.archivos.slice(0, 30).map((a) => ({ path: a.ruta.slice(0, 500), count: a.versiones, last: a.ultima })), historyTotal: r.total }
    } catch {
      return { history: [], historyTotal: 0 }
    }
  }

  /** La hora más reciente a la que se modificó alguno de los archivos con cambios (los borrados ya no existen y no cuentan). */
  private async ultimaModificacion(raiz: string, archivos: ArchivoCambio[]): Promise<string | null> {
    const horas = await Promise.all(
      archivos.map((f) =>
        stat(join(raiz, f.ruta)).then(
          (st) => st.mtimeMs,
          () => 0 // borrado o movido: no tiene hora
        )
      )
    )
    const max = Math.max(0, ...horas)
    return max > 0 ? new Date(max).toISOString() : null
  }

  private async subir(proyectoId: string, ruta: string, traer: boolean, forzar: boolean): Promise<boolean> {
    if (!forzar && (this.noAntesDe.get(proyectoId) ?? 0) > this.ahora()) return false
    const e = await this.estadoLocal(ruta, proyectoId, traer)
    if (!e) return false
    const clave = JSON.stringify(e)
    const previo = this.enviado.get(proyectoId)
    const ahora = this.ahora()
    if (!forzar && previo?.clave === clave && ahora - previo.en < (this.d.cadaLatidoMs ?? 5 * 60_000)) return false
    await this.d.servidor.put(`/projects/${encodeURIComponent(proyectoId)}/devices/${(await this.equipo()).id}`, e)
    this.enviado.set(proyectoId, { clave, en: ahora })
    return true
  }

  /** Sube el estado de todos los proyectos de este equipo. Los errores del servidor (sesión, red) se propagan; los de un repo, no. */
  async informar(traer = false, forzar = false): Promise<number> {
    let n = 0
    for (const p of await this.d.proyectos()) {
      try {
        if (await this.subir(p.id, p.ruta, traer, forzar)) n++
      } catch (err) {
        if ((err as { estado?: number }).estado === 404) continue // el proyecto ya no existe en la cuenta
        throw err
      }
    }
    return n
  }

  async listar(proyectoId: string): Promise<{ equipos: EquipoProyecto[]; equipo: { id: string; nombre: string } }> {
    const yo = await this.equipo()
    const aqui = (await this.d.proyectos()).find((p) => p.id === proyectoId)
    if (aqui) await this.subir(proyectoId, aqui.ruta, true, true).catch(() => undefined) // que este equipo salga con lo último
    const { devices } = await this.d.servidor.get<{ devices: FilaServidor[] }>(`/projects/${encodeURIComponent(proyectoId)}/devices`)
    const equipos = devices
      .map<EquipoProyecto>((f) => ({
        idEquipo: f.deviceId,
        nombre: f.deviceName,
        esteEquipo: f.deviceId === yo.id,
        ...(f.branch ? { rama: f.branch } : {}),
        ...(f.commit ? { commit: f.commit } : {}),
        ...(f.subject ? { asunto: f.subject } : {}),
        adelante: f.ahead,
        atras: f.behind,
        seguimiento: f.hasUpstream,
        cambios: f.dirty,
        archivos: (f.files ?? []).map<ArchivoEquipo>((a) => ({ ruta: a.path, estado: a.status, mas: a.add, menos: a.del })),
        lineasMas: f.insertions ?? 0,
        lineasMenos: f.deletions ?? 0,
        historial: (f.history ?? []).map((h) => ({ ruta: h.path, versiones: h.count, ultima: h.last })),
        versionesHistorial: f.historyTotal ?? 0,
        ...(f.lastActivity ? { ultimaActividad: new Date(f.lastActivity).toISOString() } : {}),
        ...(f.commitDate ? { fechaCommit: new Date(f.commitDate).toISOString() } : {}),
        actualizado: new Date(f.updatedAt).toISOString()
      }))
      .sort((a, b) => Number(b.esteEquipo) - Number(a.esteEquipo) || b.actualizado.localeCompare(a.actualizado))
    return { equipos, equipo: yo }
  }

  /**
   * Otros equipos con trabajo que aún no está en el remoto (archivos sin guardar o commits sin enviar), en los proyectos de este equipo.
   * Es lo que conviene saber antes de empezar a editar aquí.
   */
  async resumen(): Promise<AvisoEquipo[]> {
    const yo = await this.equipo()
    const locales = new Set((await this.d.proyectos()).map((p) => p.id))
    const { devices } = await this.d.servidor.get<{ devices: FilaServidor[] }>('/devices')
    const ahora = this.ahora()
    return devices
      .filter((f) => f.projectId && locales.has(f.projectId) && f.deviceId !== yo.id && (f.dirty > 0 || f.ahead > 0) && ahora - Date.parse(f.updatedAt) < AVISO_CADUCA_MS)
      .map<AvisoEquipo>((f) => ({
        proyectoId: f.projectId!,
        idEquipo: f.deviceId,
        equipo: f.deviceName,
        ...(f.branch ? { rama: f.branch } : {}),
        cambios: f.dirty,
        adelante: f.ahead,
        lineasMas: f.insertions ?? 0,
        lineasMenos: f.deletions ?? 0,
        ...(f.lastActivity ? { ultimaActividad: new Date(f.lastActivity).toISOString() } : {}),
        actualizado: new Date(f.updatedAt).toISOString()
      }))
      .sort((a, b) => (b.ultimaActividad ?? b.actualizado).localeCompare(a.ultimaActividad ?? a.actualizado))
  }

  async olvidar(proyectoId: string, idEquipo: string): Promise<{ ok: true }> {
    if ((await this.equipo()).id === idEquipo) throw new Error('Este es tu equipo actual: no se puede quitar de la lista.')
    await this.d.servidor.delete(`/projects/${encodeURIComponent(proyectoId)}/devices/${encodeURIComponent(idEquipo)}`)
    return { ok: true }
  }

  async clonarPendiente(e: OperacionesEquipos['clonarPendiente']['entrada']): Promise<{ ruta: string }> {
    const p = (await this.d.pendientes()).find((x) => x.id === e.proyectoId)
    if (!p) throw new Error('Ese proyecto ya está en este equipo o no tiene repositorio.')
    const r = await this.d.clonarProyecto({ proyectoId: p.id, repo: p.repo, carpetaPadre: e.carpetaPadre, ...(e.protocolo ? { protocolo: e.protocolo } : {}) })
    await this.d.alClonar?.(p.id).catch(() => undefined)
    return r
  }
}

type Entrada<K extends NombreOperacionEquipos> = OperacionesEquipos[K]['entrada']
type Implementaciones = { [K in NombreOperacionEquipos]: (s: ServicioEquipos, d: DepsEquipos, e: Entrada<K>) => Promise<OperacionesEquipos[K]['salida']> }

const id = (v: unknown, campo: string): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > 80) throw new Error(`Falta ${campo}.`)
  return v.trim()
}

const OPERACIONES: Implementaciones = {
  listar: (s, _d, e) => s.listar(id(e.proyectoId, 'el proyecto')),
  informar: async (s, _d, e) => ({ informados: await s.informar(e.traer === true, true) }),
  renombrar: (s, _d, e) => s.renombrar(e.nombre),
  olvidar: (s, _d, e) => s.olvidar(id(e.proyectoId, 'el proyecto'), id(e.idEquipo, 'el equipo')),
  resumen: (s) => s.resumen(),
  pendientes: (_s, d) => d.pendientes(),
  clonarPendiente: (s, _d, e) => s.clonarPendiente({ ...e, proyectoId: id(e.proyectoId, 'el proyecto'), protocolo: e.protocolo === 'ssh' ? 'ssh' : 'https' })
}

/** Operaciones de equipos de la interfaz. El renderer manda ids de proyecto y de equipo, nunca rutas. */
export function ejecutarOperacionEquipos(s: ServicioEquipos, d: DepsEquipos, op: unknown, entrada: unknown): Promise<unknown> {
  if (typeof op !== 'string' || !Object.hasOwn(OPERACIONES, op)) return Promise.reject(new Error(`Operación de equipos desconocida: ${String(op)}`))
  const e = entrada !== null && typeof entrada === 'object' ? entrada : {}
  return (async () => (OPERACIONES[op as NombreOperacionEquipos] as (s: ServicioEquipos, d: DepsEquipos, e: unknown) => Promise<unknown>)(s, d, e))()
}

