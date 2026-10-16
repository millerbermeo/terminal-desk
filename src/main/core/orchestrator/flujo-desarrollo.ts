import type { DecisionHumana, EstadoFlujo, EventoAgente, NodoFlujo } from '@shared/core/agente'
import type { Agente } from '../agents/agente'
import type { Aprobador, Harness, PeticionEjecucion } from '../agents/harness'
import type { CompresorContexto } from '../context/compresion'
import { FIN, GrafoEstados, type Nodo } from './grafo'
import type { PuertaHumana } from './puerta'
import { correrVerificaciones, type EjecutorVerificacion, type ResultadoPruebas, type Verificacion } from './verificaciones'
import { AGENTE_GENERADOR } from '../agentes-base'

export const MAX_INTENTOS = 3

export interface EstadoFlujoDev {
  peticion: string
  plan?: string
  feedback?: string // comentario del usuario al rechazar
  planes: number
  generaciones: number
  pruebas?: ResultadoPruebas
  resumen?: string // última respuesta del generador
  estado: EstadoFlujo | 'en_curso'
  motivo?: string
}

export interface DepsFlujo {
  harness: Harness
  puerta: PuertaHumana
  cwd: string
  proyectoId: string
  ejecucionId: string
  verificaciones: readonly Verificacion[]
  ejecutarVerificacion: EjecutorVerificacion
  /** Aprobador para todo lo que no sea la escritura ya autorizada por el plan (normalmente el humano). */
  aprobar?: Aprobador
  /** Modo autónomo: el plan se aprueba solo (la confirmación del resultado sigue siendo del usuario). */
  autoAprobarPlan?: boolean
  /** Imágenes, PDFs o texto adjuntos por el usuario: los ven el planificador y el generador. */
  bloquesUsuario?: PeticionEjecucion['bloquesUsuario']
  sistemaExtra?: string
  contexto?: CompresorContexto
  modelo?: string
  senal?: AbortSignal
  alEvento: (e: EventoAgente) => void
}

/**
 * Tras aprobar el plan, el generador puede escribir archivos del proyecto (confinados a su carpeta).
 * Cualquier otra acción no de lectura sigue denegada.
 */
const conEscrituraDelGenerador = (resto?: Aprobador): Aprobador => async (llamada, riesgo, agente) =>
  (agente === AGENTE_GENERADOR && llamada.nombre === 'escribir_archivo') || ((await resto?.(llamada, riesgo, agente)) ?? false)

const recortar = (t: string, n = 3000): string => (t.length > n ? '[…]\n' + t.slice(-n) : t)

/** Planificación -> Aprobación -> Generación -> Pruebas -> Confirmación, con reintentos acotados. */
export function crearFlujoDesarrollo(d: DepsFlujo, planificador: Agente, generador: Agente): GrafoEstados<EstadoFlujoDev> {
  const base: Pick<PeticionEjecucion, 'bloquesUsuario' | 'cwd' | 'proyectoId' | 'ejecucionId' | 'alEvento' | 'sistemaExtra' | 'contexto' | 'modelo' | 'senal'> = {
    ...(d.bloquesUsuario ? { bloquesUsuario: d.bloquesUsuario } : {}),
    cwd: d.cwd,
    proyectoId: d.proyectoId,
    ejecucionId: d.ejecucionId,
    alEvento: d.alEvento,
    ...(d.sistemaExtra ? { sistemaExtra: d.sistemaExtra } : {}),
    ...(d.contexto ? { contexto: d.contexto } : {}),
    ...(d.modelo ? { modelo: d.modelo } : {}),
    ...(d.senal ? { senal: d.senal } : {})
  }
  const preguntar = (clase: 'plan' | 'confirmacion', contenido: string, detalle?: string): Promise<DecisionHumana> =>
    d.puerta.solicitar(
      { clase, contenido, ...(detalle ? { detalle } : {}) },
      (solicitudId, s) => d.alEvento({ ejecucionId: d.ejecucionId, agente: 'flujo', profundidad: 0, tipo: 'solicitud_humana', solicitudId, ...s }),
      d.senal
    )
  const terminar = (e: EstadoFlujoDev, estado: EstadoFlujo, motivo: string) => ({ estado: { ...e, estado, motivo }, siguiente: FIN })

  const planificacion: Nodo<EstadoFlujoDev> = async (e) => {
    const prompt = e.feedback
      ? `${e.peticion}\n\nEl usuario rechazó el plan anterior con este comentario: ${e.feedback}\nPlan rechazado:\n${e.plan ?? ''}`
      : e.peticion
    const r = await d.harness.ejecutar(planificador, { ...base, prompt })
    if (r.estado !== 'completado' || !r.texto) return terminar(e, 'fallido', `La planificación terminó con estado «${r.estado}»${r.error ? `: ${r.error}` : ''}`)
    return { estado: { ...e, plan: r.texto, planes: e.planes + 1 }, siguiente: 'aprobacion' }
  }

  const aprobacion: Nodo<EstadoFlujoDev> = async (e) => {
    const detalle =
      'Al aprobar, el agente podrá escribir archivos dentro del proyecto' +
      (d.verificaciones.length
        ? ` y se ejecutará para validar: ${d.verificaciones.map((v) => v.comando.join(' ')).join(' · ')}.`
        : '. No se detectaron scripts de typecheck, lint ni test.')
    if (d.autoAprobarPlan) {
      d.alEvento({ ejecucionId: d.ejecucionId, agente: 'flujo', profundidad: 0, tipo: 'aprobacion_automatica', clase: 'plan', motivo: 'modo autónomo' })
      const { feedback: _descartado, ...sinComentario } = e
      return { estado: sinComentario, siguiente: 'generacion' }
    }
    const dec = await preguntar('plan', e.plan ?? '', detalle)
    if (dec.aprobado) {
      const { feedback: _descartado, ...sinComentario } = e
      return { estado: sinComentario, siguiente: 'generacion' }
    }
    if (e.planes >= MAX_INTENTOS) return terminar(e, 'rechazado', 'El plan fue rechazado demasiadas veces')
    return { estado: { ...e, feedback: dec.comentario ?? 'sin comentario' }, siguiente: 'planificacion' }
  }

  const generacion: Nodo<EstadoFlujoDev> = async (e) => {
    let prompt = `Implementa este plan aprobado por el usuario:\n\n${e.plan}`
    if (e.pruebas && !e.pruebas.ok) prompt += `\n\nLas verificaciones del proyecto fallaron tras tu último intento; corrige el código:\n${recortar(e.pruebas.salida)}`
    if (e.feedback) prompt += `\n\nEl usuario no aceptó el resultado anterior: ${e.feedback}`
    const r = await d.harness.ejecutar(generador, { ...base, prompt, aprobar: conEscrituraDelGenerador(d.aprobar) })
    if (r.estado !== 'completado') return terminar(e, 'fallido', `La generación terminó con estado «${r.estado}»${r.error ? `: ${r.error}` : ''}`)
    return { estado: { ...e, generaciones: e.generaciones + 1, resumen: r.texto }, siguiente: 'pruebas' }
  }

  const pruebas: Nodo<EstadoFlujoDev> = async (e) => {
    const r: ResultadoPruebas = await correrVerificaciones(d.cwd, d.verificaciones, d.ejecutarVerificacion, d.senal)
    if (r.ok) return { estado: { ...e, pruebas: r }, siguiente: 'confirmacion' }
    if (e.generaciones >= MAX_INTENTOS) return terminar({ ...e, pruebas: r }, 'fallido', `La verificación «${r.fallo ?? 'pruebas'}» sigue fallando tras varios intentos`)
    return { estado: { ...e, pruebas: r }, siguiente: 'generacion' }
  }

  const confirmacion: Nodo<EstadoFlujoDev> = async (e) => {
    const estadoPruebas = e.pruebas?.omitidas ? 'sin verificaciones automáticas' : 'verificaciones superadas'
    const dec = await preguntar('confirmacion', `${e.resumen ?? ''}`, `Resultado: ${estadoPruebas}. Revisa los cambios antes de confirmar.`)
    if (dec.aprobado) return terminar(e, 'completado', 'Aceptado por el usuario')
    if (e.generaciones >= MAX_INTENTOS) return terminar(e, 'rechazado', 'El resultado fue rechazado demasiadas veces')
    return { estado: { ...e, feedback: dec.comentario ?? 'sin comentario' }, siguiente: 'generacion' }
  }

  return new GrafoEstados({ planificacion, aprobacion, generacion, pruebas, confirmacion }, 'planificacion')
}

export const NODOS: readonly NodoFlujo[] = ['planificacion', 'aprobacion', 'generacion', 'pruebas', 'confirmacion']

export function estadoInicial(peticion: string): EstadoFlujoDev {
  return { peticion, planes: 0, generaciones: 0, estado: 'en_curso' }
}
