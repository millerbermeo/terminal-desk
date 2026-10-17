import { createHash } from 'node:crypto'
import type { Tarea } from '@shared/tareas'
import { ErrorServidor, ErrorSesion, type ClienteServidor } from './cliente'
import { esUuid } from './vinculo'

export type TipoDoc = 'task' | 'chat' | 'trace' | 'event'

interface Pendiente {
  proyectoId: string
  tipo: TipoDoc
  docId: string
  /** `undefined` = borrar en el servidor. */
  data?: Record<string, unknown>
  updatedAt: number
  intentos: number
}

export interface DocRemoto {
  id: string
  data: unknown
  updatedAt: number
}

export interface ContextoRemoto {
  project: { id: string; name: string; repo: string | null; groupId: string | null }
  tasks: DocRemoto[]
  chats: DocRemoto[]
  traces: DocRemoto[]
  events: DocRemoto[]
  /** Documentos borrados en algún equipo (marcas de borrado). */
  deleted?: { kind: TipoDoc; id: string; updatedAt: number }[]
  /** Cursor del servidor: la siguiente consulta pide solo lo que cambió después. */
  cursor?: number
}

const ESPERA_MS = 1500 // agrupa ráfagas de cambios del mismo documento
const MAX_REINTENTOS = 5
const MAX_BYTES = 1_900_000 // el servidor rechaza documentos de más de 2 MB

const hash = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex')

/**
 * Sube al servidor, en segundo plano, lo que cambia en este equipo (tareas, conversaciones, trazas y archivos tocados por la IA)
 * y baja el contexto de un proyecto al abrirlo. Nunca bloquea ni hace fallar la operación local: si no hay sesión o conexión,
 * reintenta con espera creciente y, agotados los reintentos, descarta (el siguiente cambio vuelve a enviar el documento completo).
 */
export class Sincronizador {
  private readonly esperando = new Map<string, { timer: NodeJS.Timeout; p: Pendiente }>()
  private readonly listos: Pendiente[] = []
  private activo = false
  /** Hash de lo último que el servidor tiene de cada documento (evita reenviar lo que no cambió y los rebotes de la descarga). */
  private readonly conocido = new Map<string, string>()
  private avisado = 0

  constructor(
    private readonly cliente: ClienteServidor,
    private readonly espera = ESPERA_MS,
    private readonly aviso: (msg: string) => void = (m) => console.warn(m)
  ) {}

  private clave(p: { proyectoId: string; tipo: TipoDoc; docId: string }): string {
    return `${p.proyectoId}/${p.tipo}/${p.docId}`
  }

  /** Marca un documento como ya presente en el servidor (tras bajarlo). */
  recordar(proyectoId: string, tipo: TipoDoc, docId: string, data: unknown): void {
    this.conocido.set(this.clave({ proyectoId, tipo, docId }), hash(data))
  }

  encolar(proyectoId: string | undefined, tipo: TipoDoc, docId: string, data: Record<string, unknown> | undefined, updatedAt = Date.now()): void {
    if (!esUuid(proyectoId)) return // proyectos locales antiguos o sin proyecto: no hay dónde guardar
    const p: Pendiente = { proyectoId, tipo, docId, ...(data ? { data } : {}), updatedAt, intentos: 0 }
    const k = this.clave(p)
    if (data) {
      if (this.conocido.get(k) === hash(data)) return
    }
    const previo = this.esperando.get(k)
    if (previo) clearTimeout(previo.timer)
    const timer = setTimeout(() => {
      this.esperando.delete(k)
      this.listos.push(p)
      void this.vaciarCola()
    }, this.espera)
    timer.unref?.()
    this.esperando.set(k, { timer, p })
  }

  /**
   * Cambios del documento de tareas: sube las tareas de proyecto que cambiaron y borra las que desaparecieron. Las tareas sin proyecto
   * (y las columnas del tablero) van con los datos de la cuenta (`SincronizadorCuenta`).
   */
  tareasCambiadas(nuevo: { tareas: Tarea[] } | undefined, previo: { tareas: Tarea[] } | undefined): void {
    const ahora = new Map((nuevo?.tareas ?? []).map((t) => [t.id, t]))
    for (const t of ahora.values()) if (t.proyectoId) this.encolar(t.proyectoId, 'task', t.id, t as unknown as Record<string, unknown>, t.actualizada)
    for (const t of previo?.tareas ?? []) if (t.proyectoId && !ahora.has(t.id)) this.encolar(t.proyectoId, 'task', t.id, undefined)
  }

  /** Borrado hecho por el usuario: se propaga a los demás equipos (deja una marca en el servidor). */
  borrar(proyectoId: string | undefined, tipo: Exclude<TipoDoc, 'event'>, docId: string): void {
    this.encolar(proyectoId, tipo, docId, undefined, Date.now())
  }

  evento(proyectoId: string | undefined, tipo: string, data: Record<string, unknown>): void {
    if (!esUuid(proyectoId)) return
    this.listos.push({ proyectoId, tipo: 'event', docId: '', data: { kind: tipo, ...data }, updatedAt: Date.now(), intentos: 0 })
    void this.vaciarCola()
  }

  private async vaciarCola(): Promise<void> {
    if (this.activo) return
    this.activo = true
    try {
      for (let p = this.listos.shift(); p; p = this.listos.shift()) {
        const hecho = await this.enviar(p)
        if (!hecho && p.intentos < MAX_REINTENTOS) {
          p.intentos++
          const t = setTimeout(() => {
            this.listos.push(p)
            void this.vaciarCola()
          }, Math.min(30_000, 1000 * 2 ** p.intentos))
          t.unref?.()
        }
      }
    } finally {
      this.activo = false
    }
  }

  /** `true` = no hay que reintentar (enviado o error definitivo). */
  private async enviar(p: Pendiente): Promise<boolean> {
    const base = `/projects/${p.proyectoId}`
    try {
      if (p.tipo === 'event') {
        const { kind, ...resto } = p.data ?? {}
        await this.cliente.post(`${base}/events`, { kind, data: resto })
      } else if (!p.data) {
        await this.cliente.delete(`${base}/docs/${p.tipo}/${encodeURIComponent(p.docId)}`, { updatedAt: p.updatedAt })
        this.conocido.delete(this.clave(p))
      } else {
        const data = p.data
        if (JSON.stringify(data).length > MAX_BYTES) {
          const { mensajes: _contexto, ...ligero } = data // la conversación completa pesa demasiado: se sube solo lo que se ve en pantalla
          if (JSON.stringify(ligero).length > MAX_BYTES) return this.descartar(p, 'es demasiado grande')
          await this.cliente.put(`${base}/docs/${p.tipo}/${encodeURIComponent(p.docId)}`, { data: ligero, updatedAt: p.updatedAt })
        } else {
          await this.cliente.put(`${base}/docs/${p.tipo}/${encodeURIComponent(p.docId)}`, { data, updatedAt: p.updatedAt })
        }
        this.conocido.set(this.clave(p), hash(data))
      }
      return true
    } catch (err) {
      if (err instanceof ErrorSesion) return true // sin sesión no hay nada que sincronizar; se reenvía al cambiar de nuevo
      if (err instanceof ErrorServidor && err.estado !== undefined && err.estado !== 408 && err.estado !== 429 && err.estado < 500) {
        return this.descartar(p, err.message)
      }
      if (p.intentos + 1 >= MAX_REINTENTOS) this.avisarFallo(`No se pudo sincronizar con el servidor: ${(err as Error).message}`)
      return false
    }
  }

  private descartar(p: Pendiente, motivo: string): true {
    this.avisarFallo(`No se sincronizó ${p.tipo} ${p.docId}: ${motivo}`)
    return true
  }

  private avisarFallo(msg: string): void {
    if (Date.now() - this.avisado < 60_000) return
    this.avisado = Date.now()
    this.aviso(msg)
  }

  /** Envía ya todo lo pendiente (p. ej. al cerrar la app). */
  async vaciar(): Promise<void> {
    for (const { timer, p } of this.esperando.values()) {
      clearTimeout(timer)
      this.listos.push(p)
    }
    this.esperando.clear()
    await this.vaciarCola()
  }

  /** Contexto del proyecto en el servidor: tablero, conversaciones, trazas y eventos (con `desde`, solo lo que cambió después). */
  contexto(proyectoId: string, desde?: number): Promise<ContextoRemoto> {
    return this.cliente.get<ContextoRemoto>(`/projects/${proyectoId}/context${desde !== undefined ? `?since=${desde}` : ''}`)
  }
}
