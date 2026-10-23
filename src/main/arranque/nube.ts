import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  aplicarComando,
  limpiarLista,
  moverComando,
  renumerar,
  type ComandoArranque,
  type EsperaListo
} from '@shared/arranque'
import { ErrorServidor, ErrorSesion, servidor } from '../servidor/cliente'
import { idProyectoValido, type ResultadoGuardar, type StoreArranque } from './almacen'

/** Un comando tal como lo devuelve `/arranque` del servidor. */
export interface FilaArranque {
  id: string
  projectId: string
  name: string
  command: string
  cwd: string
  port: number | null
  position: number
  waitFor: EsperaListo
  readyText: string | null
  waitMs: number
  always: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CACHE_MS = 2000

export function deFila(f: FilaArranque): ComandoArranque {
  return {
    id: f.id,
    nombre: f.name,
    comando: f.command,
    ...(f.cwd ? { cwd: f.cwd } : {}),
    ...(f.port !== null ? { puerto: f.port } : {}),
    orden: f.position,
    esperar: f.waitFor,
    ...(f.readyText ? { textoListo: f.readyText } : {}),
    esperaMs: f.waitMs,
    siempre: f.always
  }
}

/** Cuerpo de `PUT /arranque` para un comando ya validado. */
export function aCuerpo(proyectoId: string, c: Omit<ComandoArranque, 'orden'>, id?: string): Record<string, unknown> {
  return {
    projectId: proyectoId,
    ...(id ? { id } : {}),
    name: c.nombre,
    command: c.comando,
    cwd: c.cwd ?? '',
    port: c.puerto ?? null,
    waitFor: c.esperar,
    readyText: c.esperar === 'texto' ? (c.textoListo ?? '') : null,
    waitMs: c.esperaMs,
    always: c.siempre
  }
}

/** Sin red o servidor caído (no una respuesta de la API ni un token vencido): se puede seguir con lo último que se supo. */
const sinServidor = (e: unknown): boolean => e instanceof ErrorServidor && !(e instanceof ErrorSesion) && (e.estado === undefined || e.estado >= 500)

/**
 * Comandos de arranque guardados en la cuenta (servidor, tabla `project_start_commands`): lo que se define en un equipo lo ven todos.
 * Para poder arrancar el entorno de desarrollo sin conexión (docker, servidores locales… no la necesitan), cada lectura correcta se
 * copia en `espejo.json`; sin servidor se lee de ahí y solo se bloquea el editar. `dirLegado` es la carpeta de la versión anterior
 * (un JSON por proyecto, solo local): sus comandos se suben una vez y el archivo se aparta (`.migrado`).
 */
export class ArranqueNube implements StoreArranque {
  private cache?: { en: number; filas: FilaArranque[] }
  private migrado = false

  constructor(private readonly dirLegado: string) {}

  olvidar(): void {
    this.cache = undefined
  }

  private get espejo(): string {
    return join(this.dirLegado, 'espejo.json')
  }

  private async leerEspejo(): Promise<FilaArranque[]> {
    try {
      const d = JSON.parse(await readFile(this.espejo, 'utf8')) as { filas?: FilaArranque[] }
      return Array.isArray(d.filas) ? d.filas : []
    } catch {
      return []
    }
  }

  private async todasLasFilas(): Promise<FilaArranque[]> {
    if (this.cache && Date.now() - this.cache.en < CACHE_MS) return this.cache.filas
    let filas: FilaArranque[]
    try {
      filas = (await servidor.get<{ commands: FilaArranque[] }>('/arranque')).commands
    } catch (e) {
      if (sinServidor(e)) return this.cache?.filas ?? (await this.leerEspejo())
      throw e
    }
    this.cache = { en: Date.now(), filas }
    await mkdir(this.dirLegado, { recursive: true, mode: 0o700 }).catch(() => undefined)
    const tmp = `${this.espejo}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, filas }) + '\n', { encoding: 'utf8', mode: 0o600 })
      .then(() => rename(tmp, this.espejo))
      .catch(() => undefined) // el espejo es una ayuda: si no se puede escribir, no pasa nada
    if (!this.migrado) {
      this.migrado = true
      if (await this.migrarLegado(filas)) {
        this.olvidar()
        return this.todasLasFilas()
      }
    }
    return filas
  }

  /** Sube los comandos de los JSON locales de antes que el servidor aún no tiene. `true` si subió alguno. */
  private async migrarLegado(existentes: FilaArranque[]): Promise<boolean> {
    let subio = false
    try {
      for (const f of await readdir(this.dirLegado)) {
        const proyectoId = f.endsWith('.json') ? f.slice(0, -5) : ''
        if (!UUID.test(proyectoId)) continue
        try {
          const doc = JSON.parse(await readFile(join(this.dirLegado, f), 'utf8')) as { comandos?: unknown }
          const ya = renumerar(existentes.filter((x) => x.projectId === proyectoId).map(deFila))
          let lista = ya
          for (const c of limpiarLista(doc.comandos)) {
            const r = aplicarComando(lista, { ...c, id: undefined }, () => 'nuevo')
            if (!r.ok) continue // repetido o ya no válido: se descarta
            lista = r.lista
            await servidor.put('/arranque', aCuerpo(proyectoId, c))
            subio = true
          }
          await rename(join(this.dirLegado, f), join(this.dirLegado, `${f}.migrado`))
        } catch (e) {
          if (e instanceof ErrorServidor) throw e // red o sesión: se reintenta en la próxima lectura
        }
      }
    } catch (e) {
      if (e instanceof ErrorServidor) {
        this.migrado = false
        if (!sinServidor(e)) throw e
        return false
      }
    }
    return subio
  }

  async listar(proyectoId: string): Promise<ComandoArranque[]> {
    idProyectoValido(proyectoId)
    return renumerar((await this.todasLasFilas()).filter((f) => f.projectId === proyectoId).map(deFila))
  }

  async todos(): Promise<{ proyectoId: string; comandos: ComandoArranque[] }[]> {
    const por = new Map<string, FilaArranque[]>()
    for (const f of await this.todasLasFilas()) por.set(f.projectId, [...(por.get(f.projectId) ?? []), f])
    return [...por].map(([proyectoId, filas]) => ({ proyectoId, comandos: renumerar(filas.map(deFila)) }))
  }

  async guardar(proyectoId: string, entrada: unknown): Promise<ResultadoGuardar> {
    idProyectoValido(proyectoId)
    if (!UUID.test(proyectoId)) return { ok: false, mensaje: 'Este proyecto aún no está en la cuenta: los comandos de arranque se guardan en el servidor' }
    const actual = await this.listar(proyectoId)
    // Se valida aquí primero (mismas reglas que el servidor): el mensaje sale al instante y sin gastar una petición.
    const previo = aplicarComando(actual, entrada, () => 'nuevo')
    if (!previo.ok) return previo
    const idEditado = entrada && typeof entrada === 'object' && typeof (entrada as { id?: unknown }).id === 'string' && actual.some((c) => c.id === (entrada as { id: string }).id) ? (entrada as { id: string }).id : undefined
    try {
      const fila = await servidor.put<FilaArranque>('/arranque', aCuerpo(proyectoId, previo.comando, idEditado))
      this.olvidar()
      const lista = await this.listar(proyectoId)
      return { ok: true, comando: lista.find((c) => c.id === fila.id) ?? deFila(fila), lista }
    } catch (e) {
      this.olvidar()
      if (e instanceof ErrorServidor && !(e instanceof ErrorSesion)) return { ok: false, mensaje: e.estado === undefined ? `${e.message} No se puede guardar sin conexión.` : e.message }
      throw e
    }
  }

  async eliminar(proyectoId: string, id: string): Promise<ComandoArranque[]> {
    idProyectoValido(proyectoId)
    if (UUID.test(id)) {
      try {
        await servidor.delete(`/arranque/${id}`)
      } catch (e) {
        if (!(e instanceof ErrorServidor) || e.estado !== 404) throw e // ya no existía: nada que borrar
      } finally {
        this.olvidar()
      }
    }
    return this.listar(proyectoId)
  }

  async mover(proyectoId: string, id: string, indice: number): Promise<ComandoArranque[]> {
    idProyectoValido(proyectoId)
    const nueva = moverComando(await this.listar(proyectoId), id, indice)
    try {
      await servidor.put('/arranque/orden', { projectId: proyectoId, ids: nueva.map((c) => c.id) })
    } finally {
      this.olvidar()
    }
    return this.listar(proyectoId)
  }
}
