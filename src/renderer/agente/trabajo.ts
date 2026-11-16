import type { EventoAgente } from '@shared/core/agente'
import { describirHerramienta, type Categoria } from './actividad'

/**
 * «Ver trabajo»: arma, a partir de los eventos de un turno, el árbol de agentes (raíz → subagentes), lo que hace cada uno, su
 * línea de tiempo y un registro de actividad. Puro y sin estado: se recalcula con cada evento (los turnos tienen cientos, no miles).
 *
 * Un subagente se identifica por la llamada que lo lanzó (`delegar` en modo API, `Agent`/`Task` en suscripción): su id es el
 * `padre` que llevan sus eventos. Así dos subagentes iguales en paralelo son nodos distintos.
 */

export const RAIZ = 'raiz'
const LANZAN_SUBAGENTE = new Set(['delegar', 'Agent', 'Task'])

export type EstadoNodo = 'trabajando' | 'esperando' | 'completado' | 'error' | 'cancelado'

export interface PasoTrabajo {
  id: string
  nodo: string
  nombre: string
  categoria: Categoria
  titulo: string
  detalle: string
  enCurso: string
  entrada: Record<string, unknown>
  inicio: number
  fin?: number
  error?: boolean
  resultado?: string
}

export interface NodoTrabajo {
  id: string
  agente: string
  /** La tarea que recibió (prompt del turno para la raíz, encargo para un subagente). */
  tarea: string
  profundidad: number
  padre?: string
  hijos: string[]
  estado: EstadoNodo
  inicio: number
  fin?: number
  pasos: PasoTrabajo[]
  /** Lo que está haciendo ahora mismo (en curso). */
  actual?: string
  categoriaActual?: Categoria
  ultimoTexto?: string
  tokens?: number
}

export type TipoActividad = 'herramienta' | 'texto' | 'subagente' | 'fin_subagente' | 'permiso' | 'guardrail' | 'contexto' | 'flujo' | 'worktree'

export interface ActividadTrabajo {
  clave: string
  t: number
  nodo: string
  agente: string
  tipo: TipoActividad
  texto: string
  categoria?: Categoria
  error?: boolean
  /** Paso de herramienta asociado (para abrir su detalle). */
  paso?: string
}

export interface Trabajo {
  nodos: Record<string, NodoTrabajo>
  orden: string[]
  actividad: ActividadTrabajo[]
  /** Inicio y fin de la escala de tiempo. */
  desde: number
  hasta: number
  /** Sin tiempos reales (turno del historial): la escala es la secuencia de eventos, no milisegundos. */
  relativo: boolean
  /** Subagentes trabajando ahora mismo. */
  activos: number
  totalPasos: number
}

export interface EntradaTrabajo {
  eventos: readonly EventoAgente[]
  tiempos?: readonly number[]
  prompt: string
  raiz: string
  enCurso: boolean
  estadoTurno?: string
  ahora?: number
}

const corto = (s: string, max = 140): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')

const nombreSubagente = (entrada: Record<string, unknown>): string => cadena(entrada.agente) || cadena(entrada.subagent_type) || 'subagente'
const tareaSubagente = (entrada: Record<string, unknown>): string => cadena(entrada.tarea) || cadena(entrada.description) || cadena(entrada.prompt)

function estadoFinal(estado: string | undefined): EstadoNodo {
  if (estado === 'cancelado') return 'cancelado'
  if (estado === 'error' || estado === 'fallido' || estado === 'rechazado') return 'error'
  return 'completado'
}

export function construirTrabajo(o: EntradaTrabajo): Trabajo {
  const { eventos } = o
  const reales = Boolean(o.tiempos && o.tiempos.length === eventos.length && eventos.length > 0)
  // Sin tiempos reales, cada evento es una unidad: la proporción entre barras sigue siendo útil.
  const tiempo = (i: number): number => (reales ? o.tiempos![i]! : i)
  const desde = reales ? o.tiempos![0]! : 0
  const ahora = o.enCurso ? (reales ? Math.max(o.ahora ?? Date.now(), tiempo(eventos.length - 1)) : eventos.length) : eventos.length ? tiempo(eventos.length - 1) : desde

  const nodos: Record<string, NodoTrabajo> = {}
  const orden: string[] = []
  const pasos = new Map<string, PasoTrabajo>()
  const actividad: ActividadTrabajo[] = []
  const nodoDe = (e: EventoAgente): string => e.padre ?? RAIZ

  const crear = (id: string, datos: Omit<NodoTrabajo, 'id' | 'hijos' | 'pasos' | 'estado'> & { estado?: EstadoNodo }): NodoTrabajo => {
    const n: NodoTrabajo = { id, hijos: [], pasos: [], estado: 'trabajando', ...datos }
    nodos[id] = n
    orden.push(id)
    if (datos.padre && nodos[datos.padre] && !nodos[datos.padre]!.hijos.includes(id)) nodos[datos.padre]!.hijos.push(id)
    return n
  }
  crear(RAIZ, { agente: o.raiz, tarea: o.prompt, profundidad: 0, inicio: desde })

  /** Nodo del evento; si su lanzamiento no se vio (p. ej. turno cortado), se crea colgando de la raíz. */
  const asegurar = (e: EventoAgente, t: number): NodoTrabajo => {
    const id = nodoDe(e)
    return nodos[id] ?? crear(id, { agente: e.agente, tarea: '', profundidad: e.profundidad, padre: RAIZ, inicio: t })
  }
  const anotar = (a: Omit<ActividadTrabajo, 'clave'>, i: number): void => void actividad.push({ clave: `${i}`, ...a })

  eventos.forEach((e, i) => {
    const t = tiempo(i)
    const n = asegurar(e, t)
    if (n.id === RAIZ && e.profundidad === 0) n.agente = e.agente
    if (n.estado === 'esperando' && e.tipo !== 'solicitud_humana') n.estado = 'trabajando'
    switch (e.tipo) {
      case 'inicio':
        if (n.id !== RAIZ && !n.tarea) n.tarea = e.prompt
        break
      case 'texto':
        n.ultimoTexto = e.texto
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'texto', texto: corto(e.texto) }, i)
        break
      case 'herramienta_inicio': {
        const { llamada } = e
        if (LANZAN_SUBAGENTE.has(llamada.nombre)) {
          const hijo = nodos[llamada.id] ?? crear(llamada.id, { agente: nombreSubagente(llamada.entrada), tarea: tareaSubagente(llamada.entrada), profundidad: e.profundidad + 1, padre: n.id, inicio: t })
          if (!hijo.tarea) hijo.tarea = tareaSubagente(llamada.entrada)
          anotar({ t, nodo: n.id, agente: n.agente, tipo: 'subagente', texto: `Delega en ${hijo.agente}${hijo.tarea ? `: ${corto(hijo.tarea, 100)}` : ''}`, categoria: 'agente' }, i)
          break
        }
        if (llamada.nombre === 'TodoWrite') break
        const d = describirHerramienta(llamada.nombre, llamada.entrada)
        const paso: PasoTrabajo = { id: llamada.id, nodo: n.id, nombre: llamada.nombre, categoria: d.categoria, titulo: d.titulo, detalle: d.detalle, enCurso: d.enCurso, entrada: llamada.entrada, inicio: t }
        pasos.set(llamada.id, paso)
        n.pasos.push(paso)
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'herramienta', texto: d.detalle ? `${d.titulo} · ${d.detalle}` : d.titulo, categoria: d.categoria, paso: paso.id }, i)
        break
      }
      case 'herramienta_fin': {
        const hijo = LANZAN_SUBAGENTE.has(e.llamada.nombre) ? nodos[e.llamada.id] : undefined
        if (hijo) {
          hijo.estado = e.resultado.error ? 'error' : 'completado'
          hijo.fin = t
          if (!hijo.ultimoTexto && e.resultado.texto) hijo.ultimoTexto = e.resultado.texto
          anotar({ t, nodo: hijo.id, agente: hijo.agente, tipo: 'fin_subagente', texto: e.resultado.error ? `${hijo.agente} terminó con error` : `${hijo.agente} terminó`, categoria: 'agente', ...(e.resultado.error ? { error: true } : {}) }, i)
          break
        }
        const paso = pasos.get(e.llamada.id)
        if (!paso) break
        paso.fin = t
        paso.resultado = e.resultado.texto
        if (e.resultado.error) {
          paso.error = true
          anotar({ t, nodo: paso.nodo, agente: nodos[paso.nodo]!.agente, tipo: 'herramienta', texto: `Falló: ${paso.titulo}${paso.detalle ? ` · ${paso.detalle}` : ''}`, categoria: paso.categoria, error: true, paso: paso.id }, i)
        }
        break
      }
      case 'fin':
        n.tokens = e.resultado.uso.tokensEntrada + e.resultado.uso.tokensSalida
        if (n.id !== RAIZ) {
          n.estado = estadoFinal(e.resultado.estado)
          n.fin = t
        }
        break
      case 'solicitud_humana':
        n.estado = 'esperando'
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'permiso', texto: e.secretos ? 'Pide permiso: contenido con posibles credenciales' : e.clase === 'pregunta' ? 'Te hace una pregunta' : `Pide permiso${e.herramienta ? ` para ${e.herramienta}` : ''}`, ...(e.destructivo || e.secretos ? { error: true } : {}) }, i)
        break
      case 'guardrail':
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'guardrail', texto: `Guardrail · ${corto(e.motivo, 120)}`, error: true }, i)
        break
      case 'contexto':
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'contexto', texto: `Contexto ${e.estrategia === 'resumen' ? 'resumido' : 'podado'}: ${Math.round(e.tokensAntes / 1000)} k → ${Math.round(e.tokensDespues / 1000)} k tokens` }, i)
        break
      case 'flujo_nodo':
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'flujo', texto: `Fase: ${e.nodo}${e.intento > 1 ? ` (intento ${e.intento})` : ''}` }, i)
        break
      case 'worktree':
        anotar({ t, nodo: n.id, agente: n.agente, tipo: 'worktree', texto: `Rama ${e.rama}: ${e.accion}` }, i)
        break
    }
  })

  // Cierre: lo que sigue abierto al terminar el turno se cierra con el estado del turno; en vivo, se marca lo que está en curso.
  const raiz = nodos[RAIZ]!
  if (!o.enCurso) {
    raiz.estado = estadoFinal(o.estadoTurno)
    raiz.fin = ahora
  }
  for (const n of Object.values(nodos)) {
    const abierto = [...n.pasos].reverse().find((p) => p.fin === undefined)
    if (o.enCurso && abierto && n.estado !== 'completado' && n.estado !== 'error') {
      n.actual = abierto.detalle ? `${abierto.enCurso} · ${abierto.detalle}` : abierto.enCurso
      n.categoriaActual = abierto.categoria
    }
    if (!o.enCurso) {
      if (n.estado === 'trabajando' || n.estado === 'esperando') {
        n.estado = raiz.estado === 'completado' ? 'completado' : raiz.estado
        n.fin ??= ahora
      }
      for (const p of n.pasos) p.fin ??= ahora
    }
  }

  const totalPasos = Object.values(nodos).reduce((s, n) => s + n.pasos.length, 0)
  const activos = Object.values(nodos).filter((n) => n.id !== RAIZ && (n.estado === 'trabajando' || n.estado === 'esperando')).length
  return { nodos, orden, actividad, desde, hasta: Math.max(ahora, desde + 1), relativo: !reales, activos, totalPasos }
}

/** Duración legible («850 ms», «12 s», «3 min 05 s»). */
export function duracion(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return `${m} min ${String(s % 60).padStart(2, '0')} s`
}

/** Profundidad en el árbol, en orden de lectura (padre antes que hijos), para pintar la lista de tarjetas y la línea de tiempo. */
export function enOrdenDeArbol(tr: Trabajo): NodoTrabajo[] {
  const salida: NodoTrabajo[] = []
  const visitar = (id: string): void => {
    const n = tr.nodos[id]
    if (!n || salida.includes(n)) return
    salida.push(n)
    for (const h of n.hijos) visitar(h)
  }
  visitar(RAIZ)
  for (const id of tr.orden) visitar(id) // huérfanos (no deberían quedar)
  return salida
}
