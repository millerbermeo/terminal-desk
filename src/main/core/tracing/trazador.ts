import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { EstadoEjecucion, EventoAgente, ResultadoAgente, Uso } from '@shared/core/agente'
import type { LlamadaHerramienta, ResultadoHerramienta } from '@shared/core/herramientas'
import type { EstadoTraza, Span, TipoSpan, Traza } from '@shared/core/traza'
import { redactarSecretos } from '../guardrails/secretos'
import type { AlmacenTrazas } from './almacen'

const MAX_SPANS = 2000
const MAX_TEXTO = 4000

interface Contexto {
  traza: Traza
  span: Span
}

const recortar = (t: string): string => {
  const r = redactarSecretos(t)
  return r.length > MAX_TEXTO ? r.slice(0, MAX_TEXTO) + `… [+${r.length - MAX_TEXTO} caracteres]` : r
}

/** Eventos que aportan información propia (el resto ya queda reflejado en los spans de agente, llm y herramienta). */
const EVENTOS_REGISTRADOS = new Set(['ruta', 'flujo_nodo', 'solicitud_humana', 'guardrail', 'worktree', 'contexto', 'a2a', 'flujo_fin', 'aprobacion_automatica'])

/**
 * Observabilidad: construye el árbol de spans de cada ejecución. El padre de cada span se propaga con
 * AsyncLocalStorage, así que las llamadas paralelas, los subagentes y las consultas A2A quedan bien anidados
 * sin cambiar las firmas del resto del código.
 */
export class Trazador {
  private readonly activas = new Map<string, Traza>()
  private readonly contexto = new AsyncLocalStorage<Contexto>()

  constructor(
    private readonly almacen?: AlmacenTrazas,
    private readonly ahora: () => number = Date.now
  ) {}

  iniciar(id: string, meta: Pick<Traza, 'prompt' | 'agente' | 'modo'> & { proyectoId?: string }): void {
    this.activas.set(id, {
      id,
      inicio: this.ahora(),
      prompt: recortar(meta.prompt),
      agente: meta.agente,
      modo: meta.modo,
      ...(meta.proyectoId ? { proyectoId: meta.proyectoId } : {}),
      estado: 'en_curso',
      uso: { tokensEntrada: 0, tokensSalida: 0 },
      spans: []
    })
  }

  /** Cierra la traza, la guarda y la devuelve. `porDefecto` se usa si no hay un estado claro (p. ej. excepción). */
  async finalizar(id: string, porDefecto: EstadoTraza = 'error'): Promise<Traza | undefined> {
    const t = this.activas.get(id)
    if (!t) return undefined
    this.activas.delete(id)
    t.fin = this.ahora()
    t.duracionMs = t.fin - t.inicio
    for (const s of t.spans) if (s.tipo === 'llm' && s.uso) this.sumar(t.uso, s.uso)
    const fin = [...t.spans].reverse().find((s) => s.tipo === 'evento' && s.nombre === 'flujo_fin')
    const raiz = t.spans.find((s) => s.tipo === 'agente' && !s.padre)
    t.estado = ((fin?.atributos?.estado ?? raiz?.atributos?.estado ?? porDefecto) as EstadoTraza)
    await this.almacen?.guardar(t).catch((err) => console.error('No se pudo guardar la traza:', err))
    return t
  }

  /** Traza en curso o recién finalizada en memoria (para tests y la UI en vivo). */
  enCurso(id: string): Traza | undefined {
    return this.activas.get(id)
  }

  /** Traza a la que pertenece el código que se está ejecutando, si hay una. */
  actual(): Traza | undefined {
    return this.contexto.getStore()?.traza
  }

  private sumar(total: Uso, uso: Uso): void {
    total.tokensEntrada += uso.tokensEntrada
    total.tokensSalida += uso.tokensSalida
  }

  private abrir(traza: Traza, tipo: TipoSpan, nombre: string, extra: Partial<Span> = {}): Span | undefined {
    if (traza.spans.length >= MAX_SPANS) {
      traza.truncada = true
      return undefined
    }
    const padre = this.contexto.getStore()?.traza === traza ? this.contexto.getStore()!.span.id : undefined
    const span: Span = { id: randomUUID().slice(0, 8), ...(padre ? { padre } : {}), tipo, nombre, inicio: this.ahora(), estado: 'ok', ...extra }
    traza.spans.push(span)
    return span
  }

  private cerrar(span: Span | undefined, cambios: Partial<Span>): void {
    if (!span) return
    span.fin = this.ahora()
    span.duracionMs = span.fin - span.inicio
    Object.assign(span, cambios)
  }

  private async medir<T>(
    traza: Traza | undefined,
    tipo: TipoSpan,
    nombre: string,
    extra: Partial<Span>,
    fn: () => Promise<T>,
    resultado: (r: T) => Partial<Span>
  ): Promise<T> {
    if (!traza) return fn()
    const span = this.abrir(traza, tipo, nombre, extra)
    if (!span) return fn()
    try {
      const r = await this.contexto.run({ traza, span }, fn)
      this.cerrar(span, resultado(r))
      return r
    } catch (err) {
      this.cerrar(span, { estado: 'error', salida: recortar((err as Error).message) })
      throw err
    }
  }

  conAgente(ejecucionId: string, p: { nombre: string; profundidad: number; prompt: string; modelo?: string }, fn: () => Promise<ResultadoAgente>): Promise<ResultadoAgente> {
    return this.medir(
      this.activas.get(ejecucionId),
      'agente',
      p.nombre,
      { entrada: recortar(p.prompt), atributos: { profundidad: p.profundidad, ...(p.modelo ? { modelo: p.modelo } : {}) } },
      fn,
      (r) => ({
        estado: r.estado === 'completado' ? 'ok' : 'error',
        salida: recortar(r.texto || r.error || ''),
        uso: r.uso,
        atributos: { profundidad: p.profundidad, ...(p.modelo ? { modelo: p.modelo } : {}), estado: r.estado as EstadoEjecucion, pasos: r.pasos }
      })
    )
  }

  conHerramienta(l: LlamadaHerramienta, fn: () => Promise<ResultadoHerramienta>): Promise<ResultadoHerramienta> {
    const traza = this.actual()
    return this.medir(traza, 'herramienta', l.nombre, { entrada: recortar(JSON.stringify(l.entrada)) }, fn, (r) => ({
      estado: r.error ? 'error' : 'ok',
      salida: recortar(r.texto)
    }))
  }

  /** Llamada al modelo: la usa el decorador `LlmTrazado`. */
  conLlm<T extends { uso: Uso; parada: string }>(p: { modelo: string; entrada: string; mensajes: number }, fn: () => Promise<T>, salidaDe: (r: T) => string): Promise<T> {
    return this.medir(this.actual(), 'llm', p.modelo, { entrada: recortar(p.entrada), atributos: { mensajes: p.mensajes } }, fn, (r) => ({
      salida: recortar(salidaDe(r)),
      uso: r.uso,
      atributos: { mensajes: p.mensajes, parada: r.parada }
    }))
  }

  /** Registra un evento puntual de interés (aprobaciones, guardrails, pasos del flujo, compresión de contexto…). */
  registrarEvento(e: EventoAgente): void {
    if (!EVENTOS_REGISTRADOS.has(e.tipo)) return
    const traza = this.activas.get(e.ejecucionId)
    if (!traza) return
    const { ejecucionId: _id, profundidad: _p, tipo, ...resto } = e as EventoAgente & Record<string, unknown>
    const atributos: Record<string, string | number | boolean> = {}
    let entrada: string | undefined
    for (const [k, v] of Object.entries(resto)) {
      if (k === 'contenido' || k === 'texto') entrada = recortar(String(v))
      else if (typeof v === 'string') atributos[k] = recortar(v).slice(0, 500)
      else if (typeof v === 'number' || typeof v === 'boolean') atributos[k] = v
    }
    const span = this.abrir(traza, 'evento', tipo, { ...(entrada ? { entrada } : {}), atributos })
    this.cerrar(span, { estado: tipo === 'guardrail' ? 'error' : 'ok' })
  }
}
