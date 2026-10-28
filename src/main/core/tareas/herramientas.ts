import type { ResultadoHerramienta } from '@shared/core/herramientas'
import type { DatosNuevaTarea, FiltroTareas, ParcheTarea, Tarea } from '@shared/tareas'
import { categoriaDe, dependenciasAbiertas, type EstadoTarea } from '@shared/tareas'
import { HERRAMIENTAS_TAREAS } from '@shared/tareas-herramientas'
import { validarEntrada, type Herramienta } from '../tools/registro'
import type { ServicioTareas } from './servicio'

const MAX_SALIDA = 40_000
const MAX_LISTA = 50

export interface ContextoTareasIA {
  /** Proyecto de la conversación: valor por defecto de `proyecto_id`. */
  proyectoId?: string | undefined
}

type Entrada = Record<string, unknown>

const ISO = /^\d{4}-\d{2}-\d{2}$/
const aMs = (v: unknown, campo: string): number => {
  const s = String(v)
  const ms = ISO.test(s) ? new Date(`${s}T23:59:59`).getTime() : NaN
  if (!Number.isFinite(ms)) throw new Error(`«${campo}» debe ser una fecha AAAA-MM-DD.`)
  return ms
}

const FECHAS = new Set(['creada', 'actualizada', 'inicio', 'vence', 'completada', 'fecha'])
/** JSON legible para el modelo: las fechas en ISO en vez de milisegundos. */
const aTexto = (valor: unknown): string => {
  const t = JSON.stringify(valor, (k, v) => (FECHAS.has(k) && typeof v === 'number' ? new Date(v).toISOString() : v))
  return t.length > MAX_SALIDA ? t.slice(0, MAX_SALIDA) + '\n[… truncado: acota la consulta]' : t
}

const opcional = <T>(valor: T | undefined, clave: string): Record<string, T> => (valor === undefined ? {} : { [clave]: valor })

/** Campos de una tarea nueva (nombres de la herramienta -> nombres del servicio). */
function datosNueva(e: Entrada, ctx: ContextoTareasIA): DatosNuevaTarea {
  const proyecto = e.proyecto_id === undefined || e.proyecto_id === '' ? ctx.proyectoId : String(e.proyecto_id)
  return {
    titulo: String(e.titulo ?? ''),
    ...opcional(e.descripcion as string | undefined, 'descripcion'),
    ...opcional(e.prioridad as DatosNuevaTarea['prioridad'], 'prioridad'),
    ...(proyecto ? { proyectoId: proyecto } : {}),
    ...opcional(e.grupo_id as string | undefined, 'grupoId'),
    ...opcional(e.estado as string | undefined, 'estado'),
    ...opcional(e.etiquetas as string[] | undefined, 'etiquetas'),
    ...(e.vence ? { vence: aMs(e.vence, 'vence') } : {}),
    ...opcional(e.criterios as string[] | undefined, 'criterios'),
    ...opcional(e.checklist as string[] | undefined, 'checklist'),
    ...opcional(e.notas_tecnicas as string | undefined, 'notasTecnicas'),
    ...opcional((e.depende_de as unknown[] | undefined)?.map(String), 'dependeDe'),
    ...opcional(e.referencias as DatosNuevaTarea['referencias'], 'referencias')
  }
}

const fila = (t: Tarea, todas: readonly Tarea[], estados: readonly EstadoTarea[]): Record<string, unknown> => ({
  numero: t.numero,
  titulo: t.titulo,
  estado: t.estado,
  categoria: categoriaDe(estados, t.estado),
  prioridad: t.prioridad,
  ...(t.proyectoId ? { proyecto_id: t.proyectoId } : {}),
  ...(t.vence ? { vence: t.vence } : {}),
  ...(t.etiquetas.length ? { etiquetas: t.etiquetas } : {}),
  ...(dependenciasAbiertas(t, todas, estados).length ? { espera_a: dependenciasAbiertas(t, todas, estados).map((d) => d.numero) } : {}),
  criterios: `${t.criterios.filter((c) => c.hecho).length}/${t.criterios.length}`,
  subtareas: `${t.checklist.filter((c) => c.hecho).length}/${t.checklist.length}`
})

type Implementacion = (s: ServicioTareas, e: Entrada, ctx: ContextoTareasIA) => Promise<unknown>

const IMPLEMENTACIONES: Record<string, Implementacion> = {
  async listar_proyectos(s) {
    const d = await s.proyectosYGrupos()
    return { grupos: d.grupos, proyectos: d.proyectos.map((p) => ({ id: p.id, nombre: p.nombre, grupo: p.grupo })) }
  },
  async listar_tareas(s, e, ctx) {
    const proyecto = e.proyecto_id ? String(e.proyecto_id) : e.todos_los_proyectos || e.grupo_id ? undefined : ctx.proyectoId
    const filtro: FiltroTareas = {
      ...(proyecto ? { proyectoId: proyecto } : {}),
      ...opcional(e.grupo_id as string | undefined, 'grupoId'),
      ...(e.estado ? { estados: [String(e.estado)] } : {}),
      ...opcional(e.prioridad as FiltroTareas['prioridad'], 'prioridad'),
      ...opcional(e.etiqueta as string | undefined, 'etiqueta'),
      ...opcional(e.texto as string | undefined, 'texto'),
      ...(e.solo_abiertas ? { abiertas: true } : {}),
      ...(e.solo_disponibles ? { disponibles: true } : {}),
      limite: Math.min(Math.max(Math.trunc(Number(e.limite) || MAX_LISTA), 1), 200)
    }
    const d = await s.leer()
    const tareas = await s.listar(filtro)
    return { total: tareas.length, tareas: tareas.map((t) => fila(t, d.tareas, d.estados)) }
  },
  async obtener_tarea(s, e) {
    return s.obtener(String(e.tarea))
  },
  async crear_tarea(s, e, ctx) {
    return s.crear(datosNueva(e, ctx), 'ia')
  },
  async crear_tareas(s, e, ctx) {
    if (!Array.isArray(e.tareas)) throw new Error('«tareas» debe ser una lista.')
    const tareas = e.tareas.map((x) => {
      const o = (x ?? {}) as Entrada
      const indices = Array.isArray(o.depende_de_indices) ? o.depende_de_indices.map(Number) : undefined
      return { ...datosNueva({ ...o, proyecto_id: o.proyecto_id ?? e.proyecto_id }, ctx), ...(indices ? { dependeDeIndices: indices } : {}) }
    })
    const creadas = await s.crearVarias({ tareas }, 'ia')
    return creadas.map((t) => ({ numero: t.numero, titulo: t.titulo, estado: t.estado, prioridad: t.prioridad }))
  },
  async editar_tarea(s, e) {
    const parche: ParcheTarea = {
      ...opcional(e.titulo as string | undefined, 'titulo'),
      ...opcional(e.descripcion as string | undefined, 'descripcion'),
      ...opcional(e.prioridad as ParcheTarea['prioridad'], 'prioridad'),
      ...opcional(e.etiquetas as string[] | undefined, 'etiquetas'),
      ...(e.color === undefined ? {} : { color: e.color === '' ? null : (e.color as ParcheTarea['color']) }),
      ...opcional(e.notas_tecnicas as string | undefined, 'notasTecnicas'),
      ...(e.vence === undefined ? {} : { vence: e.vence === '' ? null : aMs(e.vence, 'vence') }),
      ...(e.proyecto_id === undefined ? {} : { proyectoId: e.proyecto_id === '' ? null : String(e.proyecto_id) }),
      ...(e.grupo_id === undefined ? {} : { grupoId: e.grupo_id === '' ? null : String(e.grupo_id) })
    }
    return s.editar(String(e.tarea), parche, 'ia', e.motivo as string | undefined)
  },
  async cambiar_estado_tarea(s, e) {
    return s.estado(String(e.tarea), String(e.estado), 'ia', e.motivo as string | undefined)
  },
  async comentar_tarea(s, e) {
    return s.comentar(String(e.tarea), String(e.texto), 'ia')
  },
  async gestionar_lista_tarea(s, e) {
    return s.item(
      {
        tarea: String(e.tarea),
        lista: e.lista as 'criterios' | 'checklist',
        accion: e.accion as 'anadir' | 'marcar' | 'quitar' | 'editar',
        ...opcional(e.texto as string | undefined, 'texto'),
        ...(e.item === undefined ? {} : { itemId: String(e.item) }),
        ...opcional(e.hecho as boolean | undefined, 'hecho')
      },
      'ia'
    )
  },
  async fijar_dependencias_tarea(s, e) {
    return s.dependencias(String(e.tarea), (e.depende_de as unknown[]).map(String), 'ia')
  },
  async referencia_tarea(s, e) {
    return s.referencia(
      {
        tarea: String(e.tarea),
        accion: e.accion as 'anadir' | 'quitar',
        ...opcional(e.tipo as 'enlace' | 'archivo' | 'nota' | undefined, 'tipo'),
        ...opcional(e.titulo as string | undefined, 'titulo'),
        ...opcional(e.destino as string | undefined, 'destino'),
        ...(e.referencia === undefined ? {} : { referenciaId: String(e.referencia) })
      },
      'ia'
    )
  },
  async resumen_tareas(s, e, ctx) {
    const proyecto = e.proyecto_id ? String(e.proyecto_id) : e.grupo_id ? undefined : ctx.proyectoId
    return s.resumen({ ...(proyecto ? { proyectoId: proyecto } : {}), ...(e.grupo_id ? { grupoId: String(e.grupo_id) } : {}) })
  },
  async siguiente_tarea(s, e, ctx) {
    const proyecto = e.proyecto_id ? String(e.proyecto_id) : ctx.proyectoId
    return (await s.siguiente(proyecto ? { proyectoId: proyecto } : {})) ?? 'No hay ninguna tarea disponible (todo está terminado, bloqueado o esperando dependencias).'
  },
  async actividad_tareas(s, e, ctx) {
    const proyecto = e.proyecto_id ? String(e.proyecto_id) : e.tarea ? undefined : ctx.proyectoId
    return s.actividad({ ...(e.tarea ? { tarea: String(e.tarea) } : {}), ...(proyecto ? { proyectoId: proyecto } : {}), limite: Math.trunc(Number(e.limite) || 30) })
  },
  async estados_tareas(s) {
    return s.estados()
  }
}

/** Ejecuta una herramienta de tareas como la IA (autor `ia`): valida la entrada, aplica las reglas del servicio y nunca lanza. */
export async function ejecutarHerramientaTareas(s: ServicioTareas, nombre: string, entrada: unknown, ctx: ContextoTareasIA = {}): Promise<ResultadoHerramienta> {
  const def = HERRAMIENTAS_TAREAS.find((h) => h.nombre === nombre)
  const impl = IMPLEMENTACIONES[nombre]
  if (!def || !impl) return { texto: `Herramienta de tareas desconocida: ${nombre}`, error: true }
  const motivo = validarEntrada(def.esquema, entrada ?? {})
  if (motivo) return { texto: `Entrada inválida para ${nombre}: ${motivo}`, error: true }
  try {
    const r = await impl(s, (entrada ?? {}) as Entrada, ctx)
    return { texto: typeof r === 'string' ? r : aTexto(r) }
  } catch (err) {
    return { texto: (err as Error).message, error: true }
  }
}

/** Las mismas herramientas para el registro del núcleo (modo API); las lecturas no piden confirmación y las escrituras siguen la autonomía. */
export function herramientasTareas(s: ServicioTareas): Herramienta[] {
  return HERRAMIENTAS_TAREAS.map((def) => ({
    nombre: def.nombre,
    descripcion: def.descripcion,
    esquema: def.esquema,
    riesgo: def.riesgo,
    ejecutar: (entrada, ctx) => ejecutarHerramientaTareas(s, def.nombre, entrada, { proyectoId: ctx.proyectoId })
  }))
}
