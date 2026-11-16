import { randomUUID } from 'node:crypto'
import type { DecisionHumana, EjecucionIniciada, EventoAgente, ResultadoAgente, SolicitudAgente } from '@shared/core/agente'
import type { TurnoGuardado } from '@shared/core/sesion'
import {
  MAX_PROGRAMADAS,
  MAX_PROMPT_PROGRAMADA,
  siguienteEjecucion,
  validarFrecuencia,
  type EjecucionProgramada,
  type NuevaTareaProgramada,
  type OperacionProgramadas,
  type TareaProgramada
} from '@shared/programadas'
import { AlmacenJson } from './memory/almacen'

/** Lo que el servicio necesita del núcleo (inyectado: así se prueba sin CLI ni Electron). */
export interface DependenciasProgramadas {
  ejecutar(sol: SolicitudAgente, alEvento: (e: EventoAgente) => void): Promise<EjecucionIniciada>
  responder(solicitudId: string, decision: DecisionHumana): boolean
  cancelar(ejecucionId: string): void
  guardarTranscripcion(sesionId: string, turnos: TurnoGuardado[], proyectoId: string): Promise<void>
  fijarTitulo(sesionId: string, titulo: string): Promise<void>
  nombreProyecto(proyectoId: string): Promise<string | undefined>
  avisar(titulo: string, cuerpo: string): void
  ahora?: () => Date
}

interface Documento {
  tareas: TareaProgramada[]
}

/** Va delante del prompt (no se muestra): sin nadie delante, el modelo no debe quedarse esperando una confirmación. */
export const AVISO_SIN_SUPERVISION =
  '<tarea_programada>Ejecución automática programada, sin nadie delante: no puedes pedir confirmaciones ni hacer preguntas (se deniegan solas). Si algo necesita permiso, no lo intentes: dilo en el informe. Termina con un resumen breve y claro de lo que encontraste o hiciste.</tarea_programada>'

const NEGADA: DecisionHumana = {
  aprobado: false,
  comentario: 'Tarea programada sin supervisión: no se puede confirmar nada. No lo intentes de nuevo; continúa sin esa acción e indícalo en el informe final.'
}

const DURACION_MAXIMA_MS = 30 * 60_000
const REVISION_MS = 30_000

const resumir = (t: string): string => {
  const limpio = t.replace(/\s+/g, ' ').trim()
  return limpio.length > 280 ? `${limpio.slice(0, 280)}…` : limpio
}

/**
 * Tareas programadas del Asistente («cada mañana revisa los PRs pendientes»): se guardan en la carpeta de datos (personal de la
 * cuenta), se comprueban cada 30 s mientras la app está abierta y se ejecutan de una en una. Si la app estuvo cerrada a la hora
 * prevista, se ejecuta una vez al abrirla. Cada ejecución deja una conversación en el historial del proyecto y un aviso del sistema.
 */
export class ServicioProgramadas {
  private readonly almacen: AlmacenJson<Documento>
  private readonly enMarcha = new Map<string, string | undefined>() // tarea -> ejecucionId
  private cola: Promise<void> = Promise.resolve()
  private reloj: ReturnType<typeof setInterval> | undefined

  constructor(
    dir: string,
    private readonly deps: DependenciasProgramadas
  ) {
    this.almacen = new AlmacenJson<Documento>(dir, 0o600)
  }

  private ahora(): Date {
    return this.deps.ahora?.() ?? new Date()
  }

  private async leer(): Promise<TareaProgramada[]> {
    return (await this.almacen.leer('tareas').catch(() => undefined))?.tareas ?? []
  }

  private async escribir(f: (ts: TareaProgramada[]) => TareaProgramada[]): Promise<TareaProgramada[]> {
    let resultado: TareaProgramada[] = []
    await this.almacen.actualizar('tareas', (d) => {
      resultado = f(d?.tareas ?? [])
      return { tareas: resultado }
    })
    return resultado
  }

  /** Arranca el reloj (idempotente). */
  iniciar(): void {
    if (this.reloj) return
    this.reloj = setInterval(() => void this.revisar(), REVISION_MS)
    this.reloj.unref?.()
    void this.revisar()
  }

  detener(): void {
    if (this.reloj) clearInterval(this.reloj)
    this.reloj = undefined
    for (const id of this.enMarcha.values()) if (id) this.deps.cancelar(id)
  }

  async operar(o: OperacionProgramadas): Promise<TareaProgramada[] | TareaProgramada> {
    switch (o?.op) {
      case 'listar':
        return this.listar(o.proyectoId)
      case 'guardar':
        return this.guardar(o.tarea)
      case 'eliminar':
        await this.escribir((ts) => ts.filter((t) => t.id !== String(o.id)))
        return this.listar()
      case 'ejecutar': {
        const t = (await this.leer()).find((x) => x.id === String(o.id))
        if (!t) throw new Error('Esa tarea ya no existe.')
        if (this.enMarcha.has(t.id)) throw new Error('Esa tarea ya se está ejecutando.')
        this.encolar(t.id)
        return { ...t, ejecutando: true }
      }
      default:
        throw new Error('Operación no válida.')
    }
  }

  async listar(proyectoId?: string): Promise<TareaProgramada[]> {
    return (await this.leer()).filter((t) => !proyectoId || t.proyectoId === proyectoId).map((t) => (this.enMarcha.has(t.id) ? { ...t, ejecutando: true } : t))
  }

  async guardar(n: NuevaTareaProgramada): Promise<TareaProgramada> {
    const nombre = String(n?.nombre ?? '').trim().slice(0, 80)
    const prompt = String(n?.prompt ?? '').trim()
    const proyectoId = String(n?.proyectoId ?? '')
    if (!nombre) throw new Error('Ponle un nombre a la tarea.')
    if (!prompt) throw new Error('Escribe qué tiene que hacer el Asistente.')
    if (prompt.length > MAX_PROMPT_PROGRAMADA) throw new Error(`La instrucción es demasiado larga (máx. ${MAX_PROMPT_PROGRAMADA} caracteres).`)
    if (!/^[\w-]{1,64}$/.test(proyectoId)) throw new Error('Elige un proyecto.')
    const frecuencia = validarFrecuencia(n.frecuencia)
    const autonomia = n.autonomia === 'ediciones' || n.autonomia === 'autonomo' ? n.autonomia : 'preguntar'
    const modelo = typeof n.modelo === 'string' && /^[\w.[\]-]{1,80}$/.test(n.modelo) ? n.modelo : undefined
    const ahora = this.ahora()
    let guardada: TareaProgramada | undefined
    await this.escribir((ts) => {
      const previa = n.id ? ts.find((t) => t.id === n.id) : undefined
      if (!previa && ts.length >= MAX_PROGRAMADAS) throw new Error(`Puedes tener como mucho ${MAX_PROGRAMADAS} tareas programadas.`)
      const base = previa?.ultima ? new Date(previa.ultima.inicio) : ahora
      const cambioCuando = !previa || JSON.stringify(previa.frecuencia) !== JSON.stringify(frecuencia) || (!previa.activa && n.activa)
      guardada = {
        id: previa?.id ?? randomUUID(),
        nombre,
        proyectoId,
        prompt,
        frecuencia,
        autonomia,
        ...(modelo ? { modelo } : {}),
        activa: n.activa !== false,
        creada: previa?.creada ?? ahora.toISOString(),
        // Al cambiar la frecuencia (o reactivarla) se cuenta desde ahora: no debe dispararse de golpe por lo que pasó mientras estaba parada.
        proxima: (cambioCuando ? siguienteEjecucion(frecuencia, ahora, frecuencia.tipo === 'intervalo' ? ahora : undefined) : previa?.proxima ? new Date(previa.proxima) : siguienteEjecucion(frecuencia, ahora, base)).toISOString(),
        ...(previa?.ultima ? { ultima: previa.ultima } : {})
      }
      return previa ? ts.map((t) => (t.id === previa.id ? guardada! : t)) : [...ts, guardada]
    })
    return guardada!
  }

  /** Lanza las que ya tocan. Público para las pruebas. */
  async revisar(): Promise<void> {
    const ahora = this.ahora().getTime()
    for (const t of await this.leer()) {
      if (!t.activa || this.enMarcha.has(t.id)) continue
      if (!t.proxima || new Date(t.proxima).getTime() <= ahora) this.encolar(t.id)
    }
  }

  /** De una en una: dos tareas a la vez competirían por la misma cuenta y el mismo proyecto. */
  private encolar(id: string): void {
    this.enMarcha.set(id, undefined)
    this.cola = this.cola.then(() => this.correr(id)).catch(() => undefined)
  }

  /** Espera a que terminen las encoladas (pruebas). */
  esperar(): Promise<void> {
    return this.cola
  }

  private async correr(id: string): Promise<void> {
    const tarea = (await this.leer()).find((t) => t.id === id)
    if (!tarea) return void this.enMarcha.delete(id)
    const inicio = this.ahora()
    // La próxima se fija ANTES de ejecutar: si la app se cierra a mitad, no se repite en bucle al abrirla.
    await this.escribir((ts) => ts.map((t) => (t.id === id ? { ...t, proxima: siguienteEjecucion(t.frecuencia, inicio, inicio).toISOString() } : t)))
    let ultima: EjecucionProgramada
    try {
      ultima = await this.ejecutarUna(tarea, inicio)
    } catch (err) {
      ultima = { inicio: inicio.toISOString(), estado: 'error', resumen: resumir((err as Error).message || 'No se pudo ejecutar.') }
    } finally {
      this.enMarcha.delete(id)
    }
    await this.escribir((ts) => ts.map((t) => (t.id === id ? { ...t, ultima } : t)))
    const ok = ultima.estado === 'completado'
    this.deps.avisar(`${ok ? '✓' : '⚠'} Tarea programada: ${tarea.nombre}`, ultima.resumen || (ok ? 'Terminó.' : 'No terminó bien.'))
  }

  private async ejecutarUna(tarea: TareaProgramada, inicio: Date): Promise<EjecucionProgramada> {
    const eventos: EventoAgente[] = []
    let mensajeId: string | undefined
    let resolver!: (r: ResultadoAgente) => void
    const terminado = new Promise<ResultadoAgente>((r) => (resolver = r))
    const alEvento = (e: EventoAgente): void => {
      if (e.tipo === 'texto_delta') return
      eventos.push(e)
      if (e.tipo === 'inicio' && e.mensajeId) mensajeId = e.mensajeId
      if (e.tipo === 'solicitud_humana') this.deps.responder(e.solicitudId, NEGADA)
      if (e.tipo === 'fin' && e.profundidad === 0) resolver(e.resultado)
    }
    const { ejecucionId, sesionId } = await this.deps.ejecutar(
      {
        prompt: `${AVISO_SIN_SUPERVISION}\n\n${tarea.prompt}`,
        proyectoId: tarea.proyectoId,
        ...(tarea.autonomia !== 'preguntar' ? { autonomia: tarea.autonomia } : {}),
        ...(tarea.modelo ? { modelo: tarea.modelo } : {})
      },
      alEvento
    )
    this.enMarcha.set(tarea.id, ejecucionId)
    let tope: ReturnType<typeof setTimeout> | undefined
    const resultado = await Promise.race([
      terminado,
      new Promise<ResultadoAgente>((r) => {
        tope = setTimeout(() => {
          this.deps.cancelar(ejecucionId)
          r({ estado: 'cancelado', texto: '', mensajes: [], uso: { tokensEntrada: 0, tokensSalida: 0 }, pasos: 0, error: 'Superó los 30 minutos y se canceló.' })
        }, DURACION_MAXIMA_MS)
        tope.unref?.()
      })
    ])
    clearTimeout(tope)
    const turno: TurnoGuardado = {
      prompt: tarea.prompt,
      modo: 'chat',
      destino: (await this.deps.nombreProyecto(tarea.proyectoId).catch(() => undefined)) ?? 'proyecto',
      raiz: 'asistente',
      eventos,
      estado: resultado.estado,
      ...(resultado.error ? { error: resultado.error } : {}),
      proyectoId: tarea.proyectoId,
      ...(tarea.autonomia !== 'preguntar' ? { autonomia: tarea.autonomia } : {}),
      ...(mensajeId ? { mensajeId } : {})
    }
    await this.deps.guardarTranscripcion(sesionId, [turno], tarea.proyectoId)
    const fecha = inicio.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    await this.deps.fijarTitulo(sesionId, `⏱ ${tarea.nombre} · ${fecha}`).catch(() => undefined)
    return {
      inicio: inicio.toISOString(),
      estado: resultado.estado,
      sesionId,
      resumen: resumir(resultado.estado === 'completado' ? resultado.texto : (resultado.error ?? resultado.texto) || 'Sin respuesta.')
    }
  }
}
