import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import {
  bloqueaPuerto,
  clasificarPuerto,
  contieneTexto,
  describirConflicto,
  enCurso,
  ordenar,
  type ComandoArranque,
  type ConflictoPuerto,
  type EstadoArranque,
  type EstadoComando,
  type OperacionesArranque,
  type ProcesoPuerto,
  type ProyectoRuta,
  type PtyArranque,
  type Resolucion,
  type ResultadoArrancar,
  type ResultadoGuardarArranque,
  type TerminalArranque
} from '@shared/arranque'
import type { StoreArranque } from './almacen'

/** Lo que el servicio necesita de las terminales (en producción, `GestorTerminales`). */
export interface TerminalesArranque {
  crear(op: { cwd: string; cols: number; rows: number }): string
  escribir(id: string, datos: string): void
  cerrar(id: string): void
  /** ¿Está el shell esperando una orden (el comando ya terminó)? Solo Linux y macOS; en Windows siempre `false`. */
  enShell(id: string): boolean
  pid(id: string): number | undefined
}

export interface DepsArranque {
  almacen: StoreArranque
  proyectos(): Promise<ProyectoRuta[]>
  terminales: TerminalesArranque
  puertoAbierto(puerto: number): Promise<boolean>
  duenoDePuerto(puerto: number): Promise<ProcesoPuerto | undefined>
  cerrarProceso(pid: number): Promise<boolean>
  alEstado(e: EstadoArranque): void
  alTerminal(t: TerminalArranque): void
}

export interface OpcionesServicio {
  /** Cada cuánto se mira si el comando ya está listo. */
  sondeoMs?: number
  /** Tras escribir el comando, el shell aún puede parecer libre: no se da por terminado hasta pasado este tiempo. */
  graciaShellMs?: number
  /** Cada cuánto se comprueba si un comando en marcha terminó. */
  vigilanciaMs?: number
  /** Máximo que se espera a que un puerto liberado quede libre. */
  liberarEsperaMs?: number
}

interface Vivo {
  proyectoId: string
  comandoId: string
  ptyId: string
  pid: number | undefined
  inicio: number
  buffer: string
  shellLecturas: number
  /** `manual`: lo detuvo el usuario; `salio`: la terminal se cerró sola o desde la interfaz. */
  cerrada?: 'manual' | 'salio'
}

type Espera = { ok: true; mensaje?: string } | { ok: false; mensaje: string; cancelado?: boolean }

const MAX_BUFFER = 64 * 1024
const clave = (proyectoId: string, comandoId: string): string => `${proyectoId}|${comandoId}`

const dormir = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((listo) => {
    if (signal?.aborted) return listo()
    const t = setTimeout(fin, ms)
    function fin(): void {
      clearTimeout(t)
      signal?.removeEventListener('abort', fin)
      listo()
    }
    signal?.addEventListener('abort', fin, { once: true })
  })

/**
 * Arranca los comandos de un proyecto en orden, uno por uno: cada uno en su terminal, esperando a que esté listo (puerto abierto, texto en
 * la salida, una pausa o nada) antes de lanzar el siguiente. Antes de lanzar uno con puerto mira quién lo ocupa: si es algo del mismo
 * proyecto lo da por en marcha; si es de otro proyecto o de un programa ajeno no lo pisa (salvo que el usuario elija liberarlo).
 */
export class ServicioArranque {
  private estados = new Map<string, EstadoArranque>()
  private vivos = new Map<string, Vivo>()
  private porPty = new Map<string, string>()
  private corridas = new Map<string, AbortController>()
  private vigilante: NodeJS.Timeout | undefined
  private readonly sondeoMs: number
  private readonly graciaShellMs: number
  private readonly vigilanciaMs: number
  private readonly liberarEsperaMs: number

  constructor(
    private readonly deps: DepsArranque,
    opciones: OpcionesServicio = {}
  ) {
    this.sondeoMs = opciones.sondeoMs ?? 400
    this.graciaShellMs = opciones.graciaShellMs ?? 1500
    this.vigilanciaMs = opciones.vigilanciaMs ?? 2000
    this.liberarEsperaMs = opciones.liberarEsperaMs ?? 5000
  }

  // ---------- Configuración ----------

  listar(proyectoId: string): Promise<ComandoArranque[]> {
    return this.deps.almacen.listar(proyectoId)
  }

  async guardar(proyectoId: string, entrada: OperacionesArranque['guardar']['entrada']['comando']): Promise<ResultadoGuardarArranque> {
    const r = await this.deps.almacen.guardar(proyectoId, entrada)
    if (!r.ok) return r
    const avisos: string[] = []
    const puerto = r.comando.puerto
    if (puerto !== undefined) {
      const proyectos = await this.deps.proyectos().catch(() => [] as ProyectoRuta[])
      for (const otro of await this.deps.almacen.todos()) {
        if (otro.proyectoId === proyectoId) continue
        const c = otro.comandos.find((x) => x.puerto === puerto)
        const p = proyectos.find((x) => x.id === otro.proyectoId)
        if (c && p) avisos.push(`El puerto ${puerto} también lo usa «${c.nombre}» de «${p.nombre}»: no podrán estar en marcha a la vez`)
      }
    }
    return { ok: true, comandos: r.lista, avisos }
  }

  async eliminar(proyectoId: string, id: string): Promise<ComandoArranque[]> {
    this.detenerClaves([clave(proyectoId, id)])
    this.estados.delete(clave(proyectoId, id))
    return this.deps.almacen.eliminar(proyectoId, id)
  }

  mover(proyectoId: string, id: string, indice: number): Promise<ComandoArranque[]> {
    return this.deps.almacen.mover(proyectoId, id, indice)
  }

  estadosDe(proyectoId?: string): EstadoArranque[] {
    return [...this.estados.values()].filter((e) => !proyectoId || e.proyectoId === proyectoId)
  }

  // ---------- Revisión de puertos ----------

  private ptysVivos(): PtyArranque[] {
    return [...this.vivos.values()].flatMap((v) => (v.pid !== undefined && !v.cerrada ? [{ pid: v.pid, proyectoId: v.proyectoId, comandoId: v.comandoId }] : []))
  }

  private async nombreComando(proyectoId: string, comandoId: string | undefined): Promise<string | undefined> {
    if (!comandoId) return undefined
    return (await this.deps.almacen.listar(proyectoId)).find((c) => c.id === comandoId)?.nombre
  }

  /** Si el puerto del comando está ocupado ahora, quién lo ocupa; `undefined` si está libre. */
  private async inspeccionarPuerto(proyecto: ProyectoRuta, c: ComandoArranque, proyectos: ProyectoRuta[]): Promise<ConflictoPuerto | undefined> {
    if (c.puerto === undefined || !(await this.deps.puertoAbierto(c.puerto))) return undefined
    const proceso = await this.deps.duenoDePuerto(c.puerto).catch(() => undefined)
    const cl = clasificarPuerto(proceso, { proyectoId: proyecto.id, comandoId: c.id, ptys: this.ptysVivos(), proyectos })
    const otroComando = await this.nombreComando(cl.proyectoId ?? proyecto.id, cl.comandoId)
    return {
      comandoId: c.id,
      comandoNombre: c.nombre,
      puerto: c.puerto,
      tipo: cl.tipo,
      bloquea: bloqueaPuerto(cl.tipo),
      ...(proceso ? { pid: proceso.pid, ...(proceso.proceso ? { proceso: proceso.proceso } : {}) } : {}),
      ...(cl.proyectoId && cl.tipo !== 'ajeno' ? { proyectoId: cl.proyectoId } : {}),
      ...(cl.proyectoNombre ? { proyectoNombre: cl.proyectoNombre } : {}),
      ...(otroComando ? { otroComando } : {}),
      puedeLiberar: proceso !== undefined
    }
  }

  async revisar(proyectoId: string, ids?: string[]): Promise<ConflictoPuerto[]> {
    const { proyecto, comandos, proyectos } = await this.contexto(proyectoId, ids)
    const otros = await this.deps.almacen.todos()
    const out: ConflictoPuerto[] = []
    for (const c of comandos) {
      if (c.puerto === undefined) continue
      const ocupado = await this.inspeccionarPuerto(proyecto, c, proyectos)
      if (ocupado) {
        out.push(ocupado)
        continue
      }
      for (const otro of otros) {
        if (otro.proyectoId === proyectoId) continue
        const x = otro.comandos.find((y) => y.puerto === c.puerto)
        const p = proyectos.find((y) => y.id === otro.proyectoId)
        if (x && p) {
          out.push({ comandoId: c.id, comandoNombre: c.nombre, puerto: c.puerto, tipo: 'configurado-en-otro', bloquea: false, proyectoId: p.id, proyectoNombre: p.nombre, otroComando: x.nombre, puedeLiberar: false })
          break
        }
      }
    }
    return out
  }

  // ---------- Arranque ----------

  private async contexto(proyectoId: string, ids?: string[]): Promise<{ proyecto: ProyectoRuta; comandos: ComandoArranque[]; proyectos: ProyectoRuta[] }> {
    const proyectos = await this.deps.proyectos()
    const proyecto = proyectos.find((p) => p.id === proyectoId)
    if (!proyecto) throw new Error('Arranque: el proyecto no está en este equipo')
    const todos = ordenar(await this.deps.almacen.listar(proyectoId))
    const comandos = ids ? todos.filter((c) => ids.includes(c.id)) : todos
    return { proyecto, comandos, proyectos }
  }

  private emitir(proyectoId: string, comandoId: string, estado: EstadoComando, mensaje?: string, ptyId?: string): void {
    const e: EstadoArranque = { proyectoId, comandoId, estado, ...(mensaje ? { mensaje } : {}), ...(ptyId ? { ptyId } : {}), desde: Date.now() }
    this.estados.set(clave(proyectoId, comandoId), e)
    this.deps.alEstado(e)
  }

  async arrancar(proyectoId: string, opciones: { ids?: string[]; resoluciones?: Record<string, Resolucion>; continuarSiFalla?: boolean } = {}): Promise<ResultadoArrancar> {
    if (this.corridas.has(proyectoId)) return { ok: false, mensaje: 'Ya hay un arranque en curso para este proyecto' }
    let ctx
    try {
      ctx = await this.contexto(proyectoId, opciones.ids)
    } catch (e) {
      return { ok: false, mensaje: (e as Error).message }
    }
    if (ctx.comandos.length === 0) return { ok: false, mensaje: 'No hay comandos de arranque que lanzar' }
    if (this.corridas.has(proyectoId)) return { ok: false, mensaje: 'Ya hay un arranque en curso para este proyecto' }
    const control = new AbortController()
    this.corridas.set(proyectoId, control)
    for (const c of ctx.comandos) if (!this.vivos.has(clave(proyectoId, c.id)) || !enCurso(this.estados.get(clave(proyectoId, c.id))?.estado ?? 'pendiente')) this.emitir(proyectoId, c.id, 'pendiente')
    void this.secuencia(ctx.proyecto, ctx.comandos, ctx.proyectos, opciones.resoluciones ?? {}, opciones.continuarSiFalla === true, control.signal).finally(() => this.corridas.delete(proyectoId))
    return { ok: true, comandos: ctx.comandos.length }
  }

  /** Lanza los marcados «siempre» que no estén ya en marcha. Nunca cierra procesos: un puerto ocupado por otro es un error, no una pregunta. */
  async autoarrancar(proyectoId: string): Promise<ResultadoArrancar> {
    const ids = (await this.deps.almacen.listar(proyectoId)).filter((c) => c.siempre).map((c) => c.id)
    if (ids.length === 0) return { ok: true, comandos: 0 }
    return this.arrancar(proyectoId, { ids })
  }

  private async secuencia(proyecto: ProyectoRuta, comandos: ComandoArranque[], proyectos: ProyectoRuta[], resoluciones: Record<string, Resolucion>, continuar: boolean, signal: AbortSignal): Promise<void> {
    for (let i = 0; i < comandos.length; i++) {
      const c = comandos[i]!
      if (signal.aborted) return this.descartar(proyecto.id, comandos.slice(i), 'Cancelado')
      let ok = false
      try {
        ok = await this.arrancarUno(proyecto, c, proyectos, resoluciones[c.id], signal)
      } catch (e) {
        this.emitir(proyecto.id, c.id, 'error', (e as Error).message)
      }
      if (!ok && !continuar) return this.descartar(proyecto.id, comandos.slice(i + 1), signal.aborted ? 'Cancelado' : `No se lanzó porque «${c.nombre}» no quedó listo`)
    }
  }

  private descartar(proyectoId: string, comandos: ComandoArranque[], motivo: string): void {
    for (const c of comandos) if (this.estados.get(clave(proyectoId, c.id))?.estado === 'pendiente') this.emitir(proyectoId, c.id, 'omitido', motivo)
  }

  /** `true` si el comando quedó listo (o ya lo estaba, o se omitió a propósito) y se puede seguir con el siguiente. */
  private async arrancarUno(proyecto: ProyectoRuta, c: ComandoArranque, proyectos: ProyectoRuta[], resolucion: Resolucion | undefined, signal: AbortSignal): Promise<boolean> {
    const k = clave(proyecto.id, c.id)
    const previo = this.vivos.get(k)
    if (previo && !previo.cerrada) {
      if (enCurso(this.estados.get(k)?.estado ?? 'pendiente')) {
        this.emitir(proyecto.id, c.id, 'listo', 'Ya estaba en marcha', previo.ptyId)
        return true
      }
      this.soltar(previo, 'manual') // terminó o falló: se cierra su terminal y se lanza de nuevo
      this.emitir(proyecto.id, c.id, 'detenido', undefined, previo.ptyId)
    }

    const ruta = this.rutaDe(proyecto, c)
    if (typeof ruta !== 'string') {
      this.emitir(proyecto.id, c.id, 'error', ruta.error)
      return false
    }

    if (c.puerto !== undefined) {
      const conflicto = await this.inspeccionarPuerto(proyecto, c, proyectos)
      if (signal.aborted) return false
      if (conflicto) {
        const decision = resolucion ?? (conflicto.bloquea ? undefined : 'omitir')
        if (decision === undefined) {
          this.emitir(proyecto.id, c.id, 'error', `${describirConflicto(conflicto)}. Cambia el puerto, ciérralo o elige «liberar» al arrancar`)
          return false
        }
        if (decision === 'omitir') {
          this.emitir(proyecto.id, c.id, 'omitido', conflicto.bloquea ? `Omitido: ${describirConflicto(conflicto)}` : `Ya estaba en marcha: ${describirConflicto(conflicto)}`)
          return true
        }
        const liberado = await this.liberar(c.puerto, conflicto.pid, signal)
        if (signal.aborted) return false
        if (!liberado.ok) {
          this.emitir(proyecto.id, c.id, 'error', liberado.mensaje)
          return false
        }
      }
    }

    this.emitir(proyecto.id, c.id, 'arrancando')
    const ptyId = this.deps.terminales.crear({ cwd: ruta, cols: 120, rows: 30 })
    const vivo: Vivo = { proyectoId: proyecto.id, comandoId: c.id, ptyId, pid: this.deps.terminales.pid(ptyId), inicio: Date.now(), buffer: '', shellLecturas: 0 }
    this.vivos.set(k, vivo)
    this.porPty.set(ptyId, k)
    this.vigilar()
    this.emitir(proyecto.id, c.id, 'arrancando', undefined, ptyId)
    this.deps.alTerminal({ proyectoId: proyecto.id, comandoId: c.id, nombre: c.nombre, ptyId, cwd: ruta })
    // Se escribe en el shell interactivo (hereda PATH/nvm); si no ha terminado de iniciar, la entrada espera en el pty.
    this.deps.terminales.escribir(ptyId, c.comando + '\r')

    const r = await this.esperarListo(c, vivo, signal)
    if (r.ok) {
      this.emitir(proyecto.id, c.id, 'listo', r.mensaje, ptyId)
      return true
    }
    if (!r.cancelado) this.emitir(proyecto.id, c.id, 'error', r.mensaje, vivo.cerrada ? undefined : ptyId)
    return false
  }

  /** Carpeta donde se ejecuta: la del proyecto más la subcarpeta del comando, sin poder salir de él. */
  private rutaDe(proyecto: ProyectoRuta, c: ComandoArranque): string | { error: string } {
    const base = resolve(proyecto.ruta)
    const ruta = c.cwd ? resolve(base, c.cwd) : base
    if (ruta !== base && !ruta.startsWith(base + sep)) return { error: 'La carpeta del comando queda fuera del proyecto' }
    if (!existsSync(ruta)) return { error: c.cwd ? `La carpeta «${c.cwd}» no existe en el proyecto` : 'La carpeta del proyecto no existe en este equipo' }
    return ruta
  }

  private async liberar(puerto: number, pid: number | undefined, signal: AbortSignal): Promise<{ ok: true } | { ok: false; mensaje: string }> {
    if (pid === undefined) return { ok: false, mensaje: `No se sabe qué proceso usa el puerto ${puerto}: ciérralo a mano` }
    // Solo se cierra el proceso que de verdad escucha ahora en ese puerto (pudo cambiar desde que se revisó).
    const actual = await this.deps.duenoDePuerto(puerto).catch(() => undefined)
    if (actual && actual.pid === pid) {
      if (!(await this.deps.cerrarProceso(pid))) return { ok: false, mensaje: `No se pudo cerrar el proceso ${pid} que usa el puerto ${puerto}` }
    } else if (actual) {
      return { ok: false, mensaje: `El puerto ${puerto} ahora lo usa otro proceso (${actual.pid}): revísalo y vuelve a intentarlo` }
    }
    const limite = Date.now() + this.liberarEsperaMs
    while (await this.deps.puertoAbierto(puerto)) {
      if (signal.aborted) return { ok: false, mensaje: 'Cancelado' }
      if (Date.now() >= limite) return { ok: false, mensaje: `El puerto ${puerto} sigue ocupado tras cerrar el proceso` }
      await dormir(Math.min(this.sondeoMs, 200), signal)
    }
    return { ok: true }
  }

  /** ¿Terminó ya el comando (el shell volvió a esperar órdenes)? Exige dos lecturas seguidas y pasada la gracia inicial. */
  private terminado(v: Vivo): boolean {
    if (Date.now() - v.inicio < this.graciaShellMs) return false
    v.shellLecturas = this.deps.terminales.enShell(v.ptyId) ? v.shellLecturas + 1 : 0
    return v.shellLecturas >= 2
  }

  private async esperarListo(c: ComandoArranque, v: Vivo, signal: AbortSignal): Promise<Espera> {
    const limite = Date.now() + c.esperaMs
    if (c.esperar === 'nada') return { ok: true }
    for (;;) {
      if (signal.aborted || v.cerrada === 'manual') return { ok: false, mensaje: 'Cancelado', cancelado: true }
      if (v.cerrada === 'salio') return { ok: false, mensaje: 'La terminal se cerró antes de que el comando estuviera listo' }
      if (c.esperar === 'puerto' && c.puerto !== undefined && (await this.deps.puertoAbierto(c.puerto))) return { ok: true }
      if (c.esperar === 'texto' && c.textoListo && contieneTexto(v.buffer.split(c.comando).join(''), c.textoListo)) return { ok: true }
      if (c.esperar === 'tiempo' && Date.now() >= limite) return { ok: true }
      if (this.terminado(v)) {
        if (c.esperar === 'tiempo') return { ok: true, mensaje: 'El comando terminó' }
        // un último vistazo: pudo abrir el puerto / escribir el texto justo antes de acabar
        if (c.esperar === 'puerto' && c.puerto !== undefined && (await this.deps.puertoAbierto(c.puerto))) return { ok: true }
        if (c.esperar === 'texto' && c.textoListo && contieneTexto(v.buffer.split(c.comando).join(''), c.textoListo)) return { ok: true }
        return { ok: false, mensaje: c.esperar === 'puerto' ? `El comando terminó sin abrir el puerto ${c.puerto}` : `El comando terminó sin mostrar «${c.textoListo}»` }
      }
      if (c.esperar !== 'tiempo' && Date.now() >= limite) {
        return { ok: false, mensaje: c.esperar === 'puerto' ? `El puerto ${c.puerto} no se abrió en ${Math.round(c.esperaMs / 1000)} s` : `No apareció «${c.textoListo}» en ${Math.round(c.esperaMs / 1000)} s` }
      }
      await dormir(this.sondeoMs, signal)
    }
  }

  // ---------- Detener y eventos de terminal ----------

  /** Quita un comando de las tablas de terminales vivas y mata su terminal. */
  private soltar(v: Vivo, como: 'manual' | 'salio'): void {
    v.cerrada ??= como
    this.vivos.delete(clave(v.proyectoId, v.comandoId))
    this.porPty.delete(v.ptyId)
    if (como === 'manual') this.deps.terminales.cerrar(v.ptyId)
    if (this.vivos.size === 0) this.pararVigilancia()
  }

  private detenerClaves(claves: string[]): void {
    for (const k of claves) {
      const v = this.vivos.get(k)
      if (!v) continue
      this.soltar(v, 'manual')
      this.emitir(v.proyectoId, v.comandoId, 'detenido', 'Detenido', v.ptyId)
    }
  }

  detener(proyectoId: string, ids?: string[]): EstadoArranque[] {
    if (!ids) this.corridas.get(proyectoId)?.abort()
    const claves = [...this.vivos.values()].filter((v) => v.proyectoId === proyectoId && (!ids || ids.includes(v.comandoId))).map((v) => clave(v.proyectoId, v.comandoId))
    this.detenerClaves(claves)
    // lo que quedaba pendiente de esta tanda ya no se va a lanzar
    for (const e of this.estadosDe(proyectoId)) if (e.estado === 'pendiente' && (!ids || ids.includes(e.comandoId))) this.emitir(proyectoId, e.comandoId, 'omitido', 'Cancelado')
    return this.estadosDe(proyectoId)
  }

  /** Salida del pty (`GestorTerminales.onDatos`): sirve para esperar un texto. */
  alDatos(ptyId: string, datos: string): void {
    const k = this.porPty.get(ptyId)
    const v = k ? this.vivos.get(k) : undefined
    if (v) v.buffer = (v.buffer + datos).slice(-MAX_BUFFER)
  }

  /** La terminal se cerró (el usuario la cerró, o el proceso terminó). */
  alSalir(ptyId: string): void {
    const k = this.porPty.get(ptyId)
    const v = k ? this.vivos.get(k) : undefined
    if (!v) return
    const antes = this.estados.get(k!)?.estado
    this.soltar(v, 'salio')
    // si aún se esperaba, `esperarListo` lo marca como error; si ya estaba en marcha, simplemente se detuvo
    if (antes !== 'arrancando') this.emitir(v.proyectoId, v.comandoId, 'detenido', 'La terminal se cerró', ptyId)
  }

  private vigilar(): void {
    if (this.vigilante) return
    this.vigilante = setInterval(() => {
      for (const v of this.vivos.values()) {
        if (this.estados.get(clave(v.proyectoId, v.comandoId))?.estado !== 'listo') continue
        if (this.terminado(v)) this.emitir(v.proyectoId, v.comandoId, 'detenido', 'El comando terminó') // sin ptyId: la terminal sigue abierta con su salida
      }
    }, this.vigilanciaMs)
    this.vigilante.unref()
  }

  private pararVigilancia(): void {
    if (this.vigilante) clearInterval(this.vigilante)
    this.vigilante = undefined
  }

  /** Al cerrar la app: corta las tandas en curso y los temporizadores (las terminales las cierra `GestorTerminales`). */
  cerrar(): void {
    for (const c of this.corridas.values()) c.abort()
    this.pararVigilancia()
  }
}
