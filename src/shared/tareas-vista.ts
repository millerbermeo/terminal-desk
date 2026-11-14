/**
 * Lógica pura de la vista de Tareas (agrupar, ordenar, filtrar, calendario, cronograma). Vive aquí para probarla sin interfaz.
 */
import {
  NOMBRE_RESPONSABLE,
  categoriaDe,
  dependenciasAbiertas,
  estaAbierta,
  porPrioridad,
  type CategoriaEstado,
  type EstadoTarea,
  type Prioridad,
  type Responsable,
  type Tarea
} from './tareas'

const PESO_PRIORIDAD: Record<Prioridad, number> = { baja: 0, media: 1, alta: 2, urgente: 3 }
const DIA_MS = 86_400_000

// ------------------------------------------------------------------ filtros

export type Vencimiento = 'vencidas' | 'hoy' | 'semana' | 'sin-fecha'

export interface FiltroVista {
  texto: string
  prioridades: Prioridad[]
  etiquetas: string[]
  responsables: (Responsable | 'sin')[]
  /** Ids de estado. */
  estados: string[]
  vencimiento?: Vencimiento
  /** Solo tareas que esperan a otras o están en un estado «bloqueada». */
  bloqueadas: boolean
  hito?: string
  verTerminadas: boolean
}

export const FILTRO_VACIO: FiltroVista = { texto: '', prioridades: [], etiquetas: [], responsables: [], estados: [], bloqueadas: false, verTerminadas: true }

/** ¿Hay algún filtro puesto (sin contar «ver terminadas»)? */
export const hayFiltros = (f: FiltroVista): boolean =>
  Boolean(f.texto.trim() || f.prioridades.length || f.etiquetas.length || f.responsables.length || f.estados.length || f.vencimiento || f.bloqueadas || f.hito) || !f.verTerminadas

/** Cuántos «filtros» activos hay (para la insignia del botón). */
export const contarFiltros = (f: FiltroVista): number =>
  (f.prioridades.length ? 1 : 0) + (f.etiquetas.length ? 1 : 0) + (f.responsables.length ? 1 : 0) + (f.estados.length ? 1 : 0) + (f.vencimiento ? 1 : 0) + (f.bloqueadas ? 1 : 0) + (f.hito ? 1 : 0) + (f.verTerminadas ? 0 : 1)

/** Filtros guardados de serie: un clic y listo. */
export const FILTROS_RAPIDOS: { id: string; nombre: string; filtro: Partial<FiltroVista> }[] = [
  { id: 'mias', nombre: 'Mías', filtro: { responsables: ['usuario'], verTerminadas: false } },
  { id: 'ia', nombre: 'De la IA', filtro: { responsables: ['ia'], verTerminadas: false } },
  { id: 'vencidas', nombre: 'Vencidas', filtro: { vencimiento: 'vencidas', verTerminadas: false } },
  { id: 'semana', nombre: 'Esta semana', filtro: { vencimiento: 'semana', verTerminadas: false } },
  { id: 'bloqueadas', nombre: 'Bloqueadas', filtro: { bloqueadas: true, verTerminadas: false } },
  { id: 'urgentes', nombre: 'Urgentes', filtro: { prioridades: ['urgente', 'alta'], verTerminadas: false } }
]

/** Fin del día local (23:59:59.999) de un instante. */
export const finDelDia = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export const inicioDelDia = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Lunes de la semana de una fecha (la semana empieza en lunes). */
export const inicioDeSemana = (ms: number): number => {
  const d = new Date(inicioDelDia(ms))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

export function aplicarFiltroVista(tareas: readonly Tarea[], todas: readonly Tarea[], estados: readonly EstadoTarea[], f: FiltroVista, ahora = Date.now()): Tarea[] {
  const texto = f.texto.trim().toLowerCase()
  const finHoy = finDelDia(ahora)
  const finSemana = finDelDia(inicioDeSemana(ahora) + 6 * DIA_MS)
  return tareas.filter((t) => {
    const abierta = estaAbierta(t, estados)
    if (!f.verTerminadas && !abierta) return false
    if (f.prioridades.length && !f.prioridades.includes(t.prioridad)) return false
    if (f.etiquetas.length && !f.etiquetas.some((e) => t.etiquetas.includes(e))) return false
    if (f.responsables.length && !f.responsables.includes(t.responsable ?? 'sin')) return false
    if (f.estados.length && !f.estados.includes(t.estado)) return false
    if (f.hito !== undefined && (t.hito ?? '') !== f.hito) return false
    if (f.bloqueadas && !(abierta && (categoriaDe(estados, t.estado) === 'bloqueada' || dependenciasAbiertas(t, todas, estados).length > 0))) return false
    if (f.vencimiento) {
      if (f.vencimiento === 'sin-fecha') {
        if (t.vence !== undefined) return false
      } else {
        if (t.vence === undefined || !abierta) return false
        if (f.vencimiento === 'vencidas' && t.vence >= ahora) return false
        if (f.vencimiento === 'hoy' && !(t.vence >= inicioDelDia(ahora) && t.vence <= finHoy)) return false
        if (f.vencimiento === 'semana' && t.vence > finSemana) return false
      }
    }
    if (texto && !`#${t.numero} ${t.titulo} ${t.descripcion} ${t.notasTecnicas} ${t.etiquetas.join(' ')} ${t.hito ?? ''}`.toLowerCase().includes(texto)) return false
    return true
  })
}

// ------------------------------------------------------------------ progreso y totales

export interface ProgresoTarea {
  hechos: number
  total: number
  /** 0–100. */
  pct: number
}

/** Avance de una tarea: subtareas y criterios juntos. */
export function progresoTarea(t: Pick<Tarea, 'checklist' | 'criterios'>): ProgresoTarea {
  const items = [...t.checklist, ...t.criterios]
  const hechos = items.filter((i) => i.hecho).length
  return { hechos, total: items.length, pct: items.length ? Math.round((hechos / items.length) * 100) : 0 }
}

export const totalEstimacion = (tareas: readonly Pick<Tarea, 'estimacion'>[]): number => Math.round(tareas.reduce((s, t) => s + (t.estimacion ?? 0), 0) * 10) / 10

/** Cuántas tareas cuentan para el límite de trabajo en curso de una columna. */
export const superaLimite = (cantidad: number, limite: number | undefined): boolean => limite !== undefined && limite > 0 && cantidad > limite

// ------------------------------------------------------------------ agrupar y ordenar

export type AgruparPor = 'ninguno' | 'estado' | 'proyecto' | 'prioridad' | 'etiqueta' | 'responsable' | 'hito'
export const NOMBRE_AGRUPAR: Record<AgruparPor, string> = {
  ninguno: 'Sin agrupar',
  estado: 'Estado',
  proyecto: 'Proyecto',
  prioridad: 'Prioridad',
  etiqueta: 'Etiqueta',
  responsable: 'Responsable',
  hito: 'Hito'
}

export interface ContextoVista {
  estados: readonly EstadoTarea[]
  nombreProyecto: ReadonlyMap<string, string>
}

export interface GrupoTareas {
  clave: string
  nombre: string
  tareas: Tarea[]
}

const NOMBRE_PRIORIDAD: Record<Prioridad, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' }

/**
 * Reparte las tareas en grupos (carriles). Los grupos salen en un orden útil: prioridad de mayor a menor, estados del flujo, el resto
 * por nombre y «Sin …» al final. Una tarea con varias etiquetas aparece en cada una de ellas.
 */
export function agruparTareas(tareas: readonly Tarea[], por: AgruparPor, ctx: ContextoVista): GrupoTareas[] {
  if (por === 'ninguno') return [{ clave: '', nombre: '', tareas: [...tareas] }]
  const mapa = new Map<string, GrupoTareas>()
  const poner = (clave: string, nombre: string, t: Tarea): void => {
    let g = mapa.get(clave)
    if (!g) mapa.set(clave, (g = { clave, nombre, tareas: [] }))
    g.tareas.push(t)
  }
  for (const t of tareas) {
    switch (por) {
      case 'estado':
        poner(t.estado, ctx.estados.find((e) => e.id === t.estado)?.nombre ?? t.estado, t)
        break
      case 'proyecto':
        poner(t.proyectoId ?? '', t.proyectoId ? (ctx.nombreProyecto.get(t.proyectoId) ?? 'Proyecto eliminado') : 'Sin proyecto', t)
        break
      case 'prioridad':
        poner(t.prioridad, NOMBRE_PRIORIDAD[t.prioridad], t)
        break
      case 'responsable':
        poner(t.responsable ?? '', t.responsable ? NOMBRE_RESPONSABLE[t.responsable] : 'Sin asignar', t)
        break
      case 'hito':
        poner(t.hito ?? '', t.hito ?? 'Sin hito', t)
        break
      case 'etiqueta':
        if (t.etiquetas.length === 0) poner('', 'Sin etiqueta', t)
        else for (const e of t.etiquetas) poner(e, e, t)
        break
    }
  }
  const lista = [...mapa.values()]
  const vacio = (g: GrupoTareas): number => (g.clave === '' ? 1 : 0)
  if (por === 'prioridad') lista.sort((a, b) => PESO_PRIORIDAD[b.clave as Prioridad] - PESO_PRIORIDAD[a.clave as Prioridad])
  else if (por === 'estado') lista.sort((a, b) => ctx.estados.findIndex((e) => e.id === a.clave) - ctx.estados.findIndex((e) => e.id === b.clave))
  else lista.sort((a, b) => vacio(a) - vacio(b) || a.nombre.localeCompare(b.nombre, 'es'))
  return lista
}

export type CampoOrden = 'numero' | 'titulo' | 'estado' | 'prioridad' | 'vence' | 'proyecto' | 'responsable' | 'estimacion' | 'actualizada'
export type DireccionOrden = 'asc' | 'desc'

/** Ordena para la tabla. Los vacíos (sin fecha, sin proyecto…) quedan siempre al final, sea cual sea la dirección. */
export function ordenarTareas(tareas: readonly Tarea[], campo: CampoOrden, dir: DireccionOrden, ctx: ContextoVista): Tarea[] {
  const signo = dir === 'asc' ? 1 : -1
  const valor = (t: Tarea): number | string | undefined => {
    switch (campo) {
      case 'numero':
        return t.numero
      case 'titulo':
        return t.titulo.toLowerCase()
      case 'estado':
        return ctx.estados.findIndex((e) => e.id === t.estado)
      case 'prioridad':
        return PESO_PRIORIDAD[t.prioridad]
      case 'vence':
        return t.vence
      case 'proyecto':
        return t.proyectoId ? (ctx.nombreProyecto.get(t.proyectoId) ?? '').toLowerCase() : undefined
      case 'responsable':
        return t.responsable
      case 'estimacion':
        return t.estimacion
      case 'actualizada':
        return t.actualizada
    }
  }
  return [...tareas].sort((a, b) => {
    const va = valor(a)
    const vb = valor(b)
    if (va === undefined && vb === undefined) return a.numero - b.numero
    if (va === undefined) return 1
    if (vb === undefined) return -1
    const c = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'es') : (va as number) - (vb as number)
    return c * signo || a.numero - b.numero
  })
}

/** Orden por defecto del tablero y de la lista: el de trabajo recomendado. */
export const ordenDeTrabajo = (tareas: readonly Tarea[], estados: readonly EstadoTarea[]): Tarea[] => [...tareas].sort((a, b) => porPrioridad(a, b, estados))

// ------------------------------------------------------------------ selección con teclado

/** Id de la tarea que queda seleccionada al moverse `delta` posiciones (sin dar la vuelta). */
export function moverSeleccion(ids: readonly string[], actual: string | undefined, delta: number): string | undefined {
  if (ids.length === 0) return undefined
  const i = actual ? ids.indexOf(actual) : -1
  if (i < 0) return delta >= 0 ? ids[0] : ids[ids.length - 1]
  return ids[Math.min(ids.length - 1, Math.max(0, i + delta))]
}

/** Ids entre dos tareas de una lista (para Shift+clic), incluidas las dos. */
export function rangoIds(ids: readonly string[], a: string, b: string): string[] {
  const i = ids.indexOf(a)
  const j = ids.indexOf(b)
  if (i < 0 || j < 0) return [b]
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1)
}

// ------------------------------------------------------------------ calendario

/** Clave AAAA-MM-DD en hora local. */
export function diaClave(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Las 6 semanas (42 días, de lunes a domingo) que cubren un mes. `mes` va de 0 a 11. */
export function celdasMes(anio: number, mes: number): Date[] {
  const primero = new Date(anio, mes, 1)
  const desfase = (primero.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => new Date(anio, mes, 1 - desfase + i))
}

/** Tareas con vencimiento, por día. */
export function tareasPorDia(tareas: readonly Tarea[]): Map<string, Tarea[]> {
  const m = new Map<string, Tarea[]>()
  for (const t of tareas) {
    if (t.vence === undefined) continue
    const k = diaClave(t.vence)
    m.set(k, [...(m.get(k) ?? []), t])
  }
  return m
}

/** Nuevo vencimiento al soltar una tarea en un día (AAAA-MM-DD): siempre al final de ese día, como el selector de fecha. */
export function vencimientoEnDia(clave: string): number {
  const [a, m, d] = clave.split('-').map(Number)
  return new Date(a!, m! - 1, d, 23, 59, 59, 0).getTime()
}

// ------------------------------------------------------------------ cronograma

export interface RangoCronograma {
  inicio: number
  fin: number
  dias: number
}

/** Inicio y fin de la barra de una tarea en el cronograma; `undefined` si no tiene ninguna fecha. */
export function tramoTarea(t: Pick<Tarea, 'inicio' | 'vence' | 'creada'>): { desde: number; hasta: number } | undefined {
  if (t.vence === undefined && t.inicio === undefined) return undefined
  const hasta = t.vence ?? finDelDia((t.inicio as number) + 2 * DIA_MS)
  const desde = t.inicio ?? Math.min(inicioDelDia(hasta), hasta)
  return { desde: Math.min(desde, hasta), hasta: Math.max(desde, hasta) }
}

/** Ventana de días que muestra el cronograma: cubre todas las barras (y hoy) con un margen. */
export function rangoCronograma(tareas: readonly Tarea[], ahora = Date.now()): RangoCronograma {
  let min = inicioDelDia(ahora)
  let max = finDelDia(ahora + 13 * DIA_MS)
  for (const t of tareas) {
    const tr = tramoTarea(t)
    if (!tr) continue
    min = Math.min(min, tr.desde)
    max = Math.max(max, tr.hasta)
  }
  const inicio = inicioDelDia(min - 2 * DIA_MS)
  const fin = finDelDia(max + 2 * DIA_MS)
  return { inicio, fin, dias: Math.max(1, Math.round((fin - inicio) / DIA_MS)) }
}

/** Posición de una barra dentro del rango, en porcentaje del ancho total. */
export function barraCronograma(t: Pick<Tarea, 'inicio' | 'vence' | 'creada'>, r: RangoCronograma): { izq: number; ancho: number } | undefined {
  const tr = tramoTarea(t)
  if (!tr) return undefined
  const total = r.fin - r.inicio
  const izq = ((tr.desde - r.inicio) / total) * 100
  const ancho = Math.max(((tr.hasta - tr.desde) / total) * 100, (DIA_MS / total) * 100 * 0.6)
  return { izq, ancho }
}

/** Convierte un desplazamiento en píxeles de una barra en días enteros. */
export const diasDeDesplazamiento = (px: number, anchoTotalPx: number, r: RangoCronograma): number => Math.round((px / anchoTotalPx) * r.dias)

/** Mueve el tramo de una tarea `dias` días (las dos fechas a la vez, o solo el vencimiento si no tiene inicio). */
export function desplazarTramo(t: Pick<Tarea, 'inicio' | 'vence'>, dias: number): { inicio?: number; vence?: number } {
  const cambio = dias * DIA_MS
  return {
    ...(t.inicio !== undefined ? { inicio: t.inicio + cambio } : {}),
    ...(t.vence !== undefined ? { vence: t.vence + cambio } : {})
  }
}

/** Etiquetas y hitos que existen en un conjunto de tareas (para los selectores de filtro). */
export function valoresUsados(tareas: readonly Tarea[]): { etiquetas: string[]; hitos: string[] } {
  const etiquetas = new Set<string>()
  const hitos = new Set<string>()
  for (const t of tareas) {
    for (const e of t.etiquetas) etiquetas.add(e)
    if (t.hito) hitos.add(t.hito)
  }
  return { etiquetas: [...etiquetas].sort((a, b) => a.localeCompare(b, 'es')), hitos: [...hitos].sort((a, b) => a.localeCompare(b, 'es')) }
}

/** Categorías que cuentan como «trabajo en curso» para el límite de una columna. */
export const CATEGORIAS_CON_LIMITE: readonly CategoriaEstado[] = ['en_curso', 'pendiente', 'bloqueada']
