/**
 * Tareas de proyectos: tipos y reglas puras (las usan main, renderer y tests). Las reglas de negocio viven aquí para que el usuario
 * y la IA pasen exactamente por las mismas validaciones.
 */

export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente'
export const PRIORIDADES: readonly Prioridad[] = ['baja', 'media', 'alta', 'urgente']
const PESO_PRIORIDAD: Record<Prioridad, number> = { baja: 0, media: 1, alta: 2, urgente: 3 }

/** Qué significa un estado para las reglas (el usuario puede renombrar y añadir estados, pero cada uno tiene una categoría). */
export type CategoriaEstado = 'pendiente' | 'en_curso' | 'bloqueada' | 'hecha' | 'cancelada'
export const CATEGORIAS: readonly CategoriaEstado[] = ['pendiente', 'en_curso', 'bloqueada', 'hecha', 'cancelada']
export const NOMBRE_CATEGORIA: Record<CategoriaEstado, string> = {
  pendiente: 'Sin empezar',
  en_curso: 'En curso',
  bloqueada: 'Bloqueada',
  hecha: 'Terminada',
  cancelada: 'Descartada'
}

export interface EstadoTarea {
  id: string
  nombre: string
  categoria: CategoriaEstado
}

export const ESTADOS_POR_DEFECTO: readonly EstadoTarea[] = [
  { id: 'pendiente', nombre: 'Pendiente', categoria: 'pendiente' },
  { id: 'planificada', nombre: 'Planificada', categoria: 'pendiente' },
  { id: 'lista', nombre: 'Lista para implementar', categoria: 'pendiente' },
  { id: 'en-progreso', nombre: 'En progreso', categoria: 'en_curso' },
  { id: 'en-revision', nombre: 'En revisión', categoria: 'en_curso' },
  { id: 'bloqueada', nombre: 'Bloqueada', categoria: 'bloqueada' },
  { id: 'completada', nombre: 'Completada', categoria: 'hecha' },
  { id: 'cancelada', nombre: 'Cancelada', categoria: 'cancelada' }
]

export type Autor = 'usuario' | 'ia'

export interface ItemLista {
  id: string
  texto: string
  hecho: boolean
}

export type TipoReferencia = 'enlace' | 'archivo' | 'nota'

export interface Referencia {
  id: string
  tipo: TipoReferencia
  titulo: string
  /** URL (enlace), ruta del archivo o imagen (archivo) o el texto (nota). */
  destino: string
}

export interface Comentario {
  id: string
  autor: Autor
  texto: string
  fecha: number
}

export interface Tarea {
  id: string
  /** Número corto y estable (#12): es como se la nombra en el chat y en las dependencias. */
  numero: number
  titulo: string
  descripcion: string
  estado: string
  prioridad: Prioridad
  proyectoId?: string
  grupoId?: string
  etiquetas: string[]
  creada: number
  actualizada: number
  inicio?: number
  vence?: number
  completada?: number
  /** Criterios de aceptación: la tarea no se completa mientras haya alguno sin cumplir. */
  criterios: ItemLista[]
  /** Subtareas. */
  checklist: ItemLista[]
  /** Ids de las tareas que deben terminar antes. */
  dependeDe: string[]
  referencias: Referencia[]
  comentarios: Comentario[]
  notasTecnicas: string
  /** Posición dentro de su columna del tablero (menor = más arriba). */
  orden: number
}

export type TipoActividad =
  | 'creada'
  | 'editada'
  | 'estado'
  | 'comentario'
  | 'criterio'
  | 'checklist'
  | 'dependencias'
  | 'referencia'
  | 'vinculada'
  | 'eliminada'
  | 'estados'

export interface Actividad {
  id: string
  fecha: number
  autor: Autor
  tipo: TipoActividad
  tareaId?: string
  numero?: number
  titulo?: string
  proyectoId?: string
  detalle: string
  motivo?: string
}

export interface FiltroTareas {
  proyectoId?: string
  grupoId?: string
  /** Solo tareas sin proyecto. */
  sinProyecto?: boolean
  /** Ids de estado. */
  estados?: string[]
  categoria?: CategoriaEstado
  prioridad?: Prioridad
  etiqueta?: string
  texto?: string
  /** Solo tareas que no están terminadas ni descartadas. */
  abiertas?: boolean
  /** Solo tareas que ahora mismo se pueden empezar (abiertas y sin dependencias abiertas). */
  disponibles?: boolean
  limite?: number
}

export interface ResumenTareas {
  total: number
  porEstado: { estado: string; nombre: string; categoria: CategoriaEstado; cantidad: number }[]
  /** Terminadas / (total - descartadas), 0-100. */
  progreso: number
  abiertas: number
  hechas: number
  bloqueadas: { id: string; numero: number; titulo: string; motivo: string }[]
  vencidas: { id: string; numero: number; titulo: string; vence: number }[]
  /** Abiertas sin criterios de aceptación (mal definidas). */
  sinCriterios: { id: string; numero: number; titulo: string }[]
  siguiente?: { id: string; numero: number; titulo: string; prioridad: Prioridad }
}

export const MAX_TAREAS = 5000
export const MAX_ESTADOS = 12
const ID_ESTADO = /^[a-z0-9][a-z0-9-]{0,31}$/

export const categoriaDe = (estados: readonly EstadoTarea[], id: string): CategoriaEstado | undefined => estados.find((e) => e.id === id)?.categoria

export const estaAbierta = (t: Pick<Tarea, 'estado'>, estados: readonly EstadoTarea[]): boolean => {
  const c = categoriaDe(estados, t.estado)
  return c !== 'hecha' && c !== 'cancelada'
}

/** Dependencias que aún no han terminado (las descartadas no bloquean). */
export function dependenciasAbiertas(t: Pick<Tarea, 'dependeDe'>, todas: readonly Tarea[], estados: readonly EstadoTarea[]): Tarea[] {
  return t.dependeDe.map((id) => todas.find((x) => x.id === id)).filter((d): d is Tarea => !!d && estaAbierta(d, estados))
}

/** ¿Añadir estas dependencias a `id` crearía un ciclo (A depende de B depende de A)? */
export function haceCiclo(id: string, dependeDe: readonly string[], todas: readonly Tarea[]): boolean {
  const vistos = new Set<string>()
  const pila = [...dependeDe]
  while (pila.length) {
    const actual = pila.pop()!
    if (actual === id) return true
    if (vistos.has(actual)) continue
    vistos.add(actual)
    pila.push(...(todas.find((t) => t.id === actual)?.dependeDe ?? []))
  }
  return false
}

const etiquetaTarea = (t: Pick<Tarea, 'numero' | 'titulo'>): string => `#${t.numero} «${t.titulo}»`

/**
 * Reglas del cambio de estado. Devuelve el motivo del rechazo, o null si se puede.
 * - Terminar exige criterios y subtareas cumplidos y dependencias terminadas.
 * - Bloquear, descartar y reabrir exigen una razón (queda en el historial).
 */
export function evaluarTransicion(
  t: Tarea,
  destino: EstadoTarea,
  todas: readonly Tarea[],
  estados: readonly EstadoTarea[],
  motivo?: string
): string | null {
  const origen = categoriaDe(estados, t.estado)
  if (t.estado === destino.id) return null
  const razon = (motivo ?? '').trim()
  if (destino.categoria === 'hecha') {
    const criterios = t.criterios.filter((c) => !c.hecho)
    if (criterios.length) return `No se puede completar ${etiquetaTarea(t)}: faltan criterios de aceptación por cumplir (${criterios.map((c) => `«${c.texto}»`).join(', ')}).`
    const subtareas = t.checklist.filter((c) => !c.hecho)
    if (subtareas.length) return `No se puede completar ${etiquetaTarea(t)}: quedan subtareas sin terminar (${subtareas.map((c) => `«${c.texto}»`).join(', ')}).`
    const deps = dependenciasAbiertas(t, todas, estados)
    if (deps.length) return `No se puede completar ${etiquetaTarea(t)}: depende de tareas sin terminar (${deps.map(etiquetaTarea).join(', ')}).`
    return null
  }
  if (destino.categoria === 'bloqueada' && !razon) return 'Indica por qué queda bloqueada.'
  if (destino.categoria === 'cancelada' && !razon) return 'Indica por qué se descarta.'
  if ((origen === 'hecha' || origen === 'cancelada') && !razon) return 'Indica por qué se reabre.'
  return null
}

const PESO_ESTADO: Record<CategoriaEstado, number> = { en_curso: 0, pendiente: 1, bloqueada: 2, hecha: 3, cancelada: 3 }

/** Orden de trabajo recomendado: lo que ya está en curso, luego mayor prioridad, vencimiento más cercano y número más bajo. */
export function porPrioridad(a: Tarea, b: Tarea, estados: readonly EstadoTarea[]): number {
  const ca = PESO_ESTADO[categoriaDe(estados, a.estado) ?? 'pendiente']
  const cb = PESO_ESTADO[categoriaDe(estados, b.estado) ?? 'pendiente']
  return (
    ca - cb ||
    PESO_PRIORIDAD[b.prioridad] - PESO_PRIORIDAD[a.prioridad] ||
    (a.vence ?? Infinity) - (b.vence ?? Infinity) ||
    a.numero - b.numero
  )
}

/** La tarea que conviene hacer ahora: abierta, no bloqueada, ni por estado ni por dependencias. */
export function siguienteTarea(tareas: readonly Tarea[], todas: readonly Tarea[], estados: readonly EstadoTarea[]): Tarea | undefined {
  return tareas
    .filter((t) => estaAbierta(t, estados) && categoriaDe(estados, t.estado) !== 'bloqueada' && dependenciasAbiertas(t, todas, estados).length === 0)
    .sort((a, b) => porPrioridad(a, b, estados))[0]
}

export function resumirTareas(tareas: readonly Tarea[], todas: readonly Tarea[], estados: readonly EstadoTarea[], ahora = Date.now()): ResumenTareas {
  const abiertas = tareas.filter((t) => estaAbierta(t, estados))
  const hechas = tareas.filter((t) => categoriaDe(estados, t.estado) === 'hecha').length
  const descartadas = tareas.filter((t) => categoriaDe(estados, t.estado) === 'cancelada').length
  const base = tareas.length - descartadas
  const bloqueadas: ResumenTareas['bloqueadas'] = []
  for (const t of abiertas) {
    if (categoriaDe(estados, t.estado) === 'bloqueada') {
      bloqueadas.push({ id: t.id, numero: t.numero, titulo: t.titulo, motivo: 'estado «bloqueada»' })
      continue
    }
    const deps = dependenciasAbiertas(t, todas, estados)
    if (deps.length) bloqueadas.push({ id: t.id, numero: t.numero, titulo: t.titulo, motivo: `espera a ${deps.map((d) => `#${d.numero}`).join(', ')}` })
  }
  const siguiente = siguienteTarea(tareas, todas, estados)
  return {
    total: tareas.length,
    porEstado: estados.map((e) => ({ estado: e.id, nombre: e.nombre, categoria: e.categoria, cantidad: tareas.filter((t) => t.estado === e.id).length })),
    progreso: base > 0 ? Math.round((hechas / base) * 100) : 0,
    abiertas: abiertas.length,
    hechas,
    bloqueadas,
    vencidas: abiertas.filter((t) => t.vence !== undefined && t.vence < ahora).map((t) => ({ id: t.id, numero: t.numero, titulo: t.titulo, vence: t.vence! })),
    sinCriterios: abiertas.filter((t) => t.criterios.length === 0).map((t) => ({ id: t.id, numero: t.numero, titulo: t.titulo })),
    ...(siguiente ? { siguiente: { id: siguiente.id, numero: siguiente.numero, titulo: siguiente.titulo, prioridad: siguiente.prioridad } } : {})
  }
}

/** Filtra y ordena como la lista de la interfaz (por prioridad de trabajo). */
export function filtrarTareas(todas: readonly Tarea[], estados: readonly EstadoTarea[], f: FiltroTareas = {}): Tarea[] {
  const texto = f.texto?.trim().toLowerCase()
  const salida = todas.filter((t) => {
    if (f.proyectoId !== undefined && t.proyectoId !== f.proyectoId) return false
    if (f.grupoId !== undefined && t.grupoId !== f.grupoId) return false
    if (f.sinProyecto && t.proyectoId) return false
    if (f.estados?.length && !f.estados.includes(t.estado)) return false
    if (f.categoria && categoriaDe(estados, t.estado) !== f.categoria) return false
    if (f.prioridad && t.prioridad !== f.prioridad) return false
    if (f.etiqueta && !t.etiquetas.includes(f.etiqueta)) return false
    if (f.abiertas && !estaAbierta(t, estados)) return false
    if (f.disponibles && (!estaAbierta(t, estados) || categoriaDe(estados, t.estado) === 'bloqueada' || dependenciasAbiertas(t, todas, estados).length > 0)) return false
    if (texto && !`#${t.numero} ${t.titulo} ${t.descripcion} ${t.notasTecnicas} ${t.etiquetas.join(' ')}`.toLowerCase().includes(texto)) return false
    return true
  })
  salida.sort((a, b) => porPrioridad(a, b, estados))
  return f.limite ? salida.slice(0, f.limite) : salida
}

/** Motivo por el que la lista de estados no es válida, o null. */
export function validarEstados(estados: readonly EstadoTarea[]): string | null {
  if (estados.length === 0 || estados.length > MAX_ESTADOS) return `Debe haber entre 1 y ${MAX_ESTADOS} estados.`
  const ids = new Set<string>()
  for (const e of estados) {
    if (!ID_ESTADO.test(e.id)) return `Identificador de estado inválido: «${e.id}» (usa a-z, 0-9 y «-»).`
    if (ids.has(e.id)) return `Estado repetido: «${e.id}».`
    ids.add(e.id)
    if (!e.nombre.trim() || e.nombre.length > 40) return 'Cada estado necesita un nombre de hasta 40 caracteres.'
    if (!CATEGORIAS.includes(e.categoria)) return `Categoría inválida en «${e.nombre}».`
  }
  if (!estados.some((e) => e.categoria === 'pendiente')) return 'Hace falta al menos un estado «sin empezar» (donde nacen las tareas).'
  if (!estados.some((e) => e.categoria === 'hecha')) return 'Hace falta al menos un estado «terminada».'
  return null
}

/** Cómo se muestra una fecha de vencimiento en el contexto que se le da a la IA. */
export const fechaCorta = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// ------------------------------------------------------------------ operaciones (lo que viaja por IPC, MCP y herramientas)

export interface DatosNuevaTarea {
  titulo: string
  descripcion?: string
  prioridad?: Prioridad
  proyectoId?: string
  grupoId?: string
  estado?: string
  etiquetas?: string[]
  inicio?: number
  vence?: number
  criterios?: string[]
  checklist?: string[]
  notasTecnicas?: string
  /** Números o ids de tareas de las que depende. */
  dependeDe?: string[]
  referencias?: { tipo?: TipoReferencia; titulo?: string; destino: string }[]
}

export interface ParcheTarea {
  titulo?: string
  descripcion?: string
  prioridad?: Prioridad
  etiquetas?: string[]
  inicio?: number | null
  vence?: number | null
  notasTecnicas?: string
  /** `null` desvincula. */
  proyectoId?: string | null
  grupoId?: string | null
}

export interface DetalleTarea {
  tarea: Tarea
  bloqueadaPor: { id: string; numero: number; titulo: string }[]
  bloquea: { id: string; numero: number; titulo: string }[]
  actividad: Actividad[]
}

export interface OperacionesTareas {
  listar: { entrada: FiltroTareas; salida: Tarea[] }
  obtener: { entrada: { tarea: string }; salida: DetalleTarea }
  crear: { entrada: DatosNuevaTarea; salida: Tarea }
  /** Varias tareas de una vez; `dependeDeIndices` apunta a otras del mismo lote (0 = la primera). */
  crearVarias: { entrada: { tareas: (DatosNuevaTarea & { dependeDeIndices?: number[] })[] }; salida: Tarea[] }
  editar: { entrada: { tarea: string; parche: ParcheTarea; motivo?: string }; salida: Tarea }
  estado: { entrada: { tarea: string; estado: string; motivo?: string }; salida: Tarea }
  /** Tablero: cambia de columna y de posición (antesDe = id de la tarea delante de la que queda; vacío = al final). */
  mover: { entrada: { tarea: string; estado: string; antesDe?: string; motivo?: string }; salida: Tarea }
  comentar: { entrada: { tarea: string; texto: string }; salida: Tarea }
  item: {
    entrada: { tarea: string; lista: 'criterios' | 'checklist'; accion: 'anadir' | 'marcar' | 'quitar' | 'editar'; texto?: string; itemId?: string; hecho?: boolean }
    salida: Tarea
  }
  dependencias: { entrada: { tarea: string; dependeDe: string[] }; salida: Tarea }
  referencia: {
    entrada: { tarea: string; accion: 'anadir' | 'quitar'; tipo?: TipoReferencia; titulo?: string; destino?: string; referenciaId?: string }
    salida: Tarea
  }
  eliminar: { entrada: { tarea: string }; salida: { ok: true } }
  actividad: { entrada: { tarea?: string; proyectoId?: string; limite?: number }; salida: Actividad[] }
  resumen: { entrada: { proyectoId?: string; grupoId?: string }; salida: ResumenTareas }
  siguiente: { entrada: { proyectoId?: string; grupoId?: string }; salida: Tarea | null }
  estados: { entrada: Record<string, never>; salida: EstadoTarea[] }
  guardarEstados: { entrada: { estados: EstadoTarea[]; reasignar?: Record<string, string> }; salida: EstadoTarea[] }
}

export type NombreOperacionTareas = keyof OperacionesTareas
