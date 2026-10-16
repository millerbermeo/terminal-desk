import { randomUUID } from 'node:crypto'
import type { BloqueContenido, EventoAgente, Mensaje, ResultadoAgente } from '@shared/core/agente'
import type { LlamadaHerramienta, ResultadoHerramienta, Riesgo } from '@shared/core/herramientas'
import type { CompresorContexto } from '../context/compresion'
import { ejecutarHerramienta, type ContextoHerramienta, type Herramienta, type RegistroHerramientas } from '../tools/registro'
import type { Agente } from './agente'
import { ejecutarBucle } from './bucle'
import type { ProveedorLLM } from './llm/proveedor'
import type { Trazador } from '../tracing/trazador'
import { herramientaDelegar, HERRAMIENTA_DELEGAR } from './subagentes'

/** Decide si una llamada que no es de solo lectura puede ejecutarse. La Fase 4 enchufa aquí la confirmación humana. */
export type Aprobador = (llamada: LlamadaHerramienta, riesgo: Riesgo, agente: string) => Promise<boolean>

/**
 * Guardrail previo a cualquier llamada (también las de lectura). Devuelve el motivo del bloqueo o null.
 * Se evalúa antes del aprobador: lo que se bloquea no se le ofrece al usuario.
 */
export type Validador = (llamada: LlamadaHerramienta, riesgo: Riesgo, agente: string, ctx: ContextoHerramienta) => Promise<string | null>

export interface OpcionesHarness {
  llm: ProveedorLLM
  registro: RegistroHerramientas
  /** Sin aprobador, solo se ejecutan herramientas de lectura. */
  aprobar?: Aprobador
  validar?: Validador
  /** Si se indica, cada agente y cada herramienta quedan registrados como spans de la traza de la ejecución. */
  trazador?: Trazador
  /** Tokens máximos de toda la ejecución (agentes, subagentes y fases del flujo juntos); sin él, sin límite. */
  presupuestoTokens?: number
  maxProfundidad?: number
  maxTokens?: number
}

export interface PeticionEjecucion {
  prompt: string
  cwd: string
  ejecucionId?: string
  proyectoId?: string
  /** Modelo del agente raíz (p. ej. elegido por el Router); los subagentes usan el suyo. */
  modelo?: string
  /** Bloques adicionales del mensaje del usuario (imágenes, PDFs, texto adjunto), antes del prompt. Solo para el agente raíz. */
  bloquesUsuario?: readonly BloqueContenido[]
  /** Herramientas solo para esta ejecución (agente raíz), p. ej. `consultar_agente` de A2A. */
  extras?: readonly Herramienta[]
  /** Sustituye al aprobador del Harness solo para esta ejecución. */
  aprobar?: Aprobador
  /** Texto añadido al prompt de sistema del agente raíz (p. ej. memoria del proyecto). */
  sistemaExtra?: string
  /** Si se indica, la conversación se comprime automáticamente cuando se acerca al límite de la ventana. */
  contexto?: CompresorContexto
  historial?: Mensaje[]
  senal?: AbortSignal
  alEvento?(e: EventoAgente): void
}

const MAX_PASOS = 25

/** Punto único de ejecución: ensambla agente + LLM + herramientas + política + eventos. */
export class Harness {
  private gastado = 0

  constructor(private readonly o: OpcionesHarness) {}

  ejecutar(agente: Agente, p: PeticionEjecucion): Promise<ResultadoAgente> {
    return this.correr(agente, p.prompt, p, p.ejecucionId ?? randomUUID(), 0, p.historial ?? [])
  }

  private correr(agente: Agente, prompt: string, p: PeticionEjecucion, ejecucionId: string, profundidad: number, historial: Mensaje[]): Promise<ResultadoAgente> {
    const interno = (): Promise<ResultadoAgente> => this.correrInterno(agente, prompt, p, ejecucionId, profundidad, historial)
    const modelo = (profundidad === 0 ? p.modelo : undefined) ?? agente.def.modelo
    return this.o.trazador
      ? this.o.trazador.conAgente(ejecucionId, { nombre: agente.nombre, profundidad, prompt, ...(modelo ? { modelo } : {}) }, interno)
      : interno()
  }

  private async correrInterno(
    agente: Agente,
    prompt: string,
    p: PeticionEjecucion,
    ejecucionId: string,
    profundidad: number,
    historial: Mensaje[]
  ): Promise<ResultadoAgente> {
    const { registro } = this.o
    const emitir = (e: Omit<EventoAgente, 'ejecucionId' | 'agente' | 'profundidad'> & Record<string, unknown>): void =>
      p.alEvento?.({ ejecucionId, agente: agente.nombre, profundidad, ...e } as EventoAgente)
    emitir({ tipo: 'inicio', prompt })

    const puedeDelegar = agente.subagentes.size > 0 && profundidad < (this.o.maxProfundidad ?? 3)
    const delegar = puedeDelegar
      ? herramientaDelegar(agente, async (hijo, tarea) => {
          const r = await this.correr(hijo, tarea, p, ejecucionId, profundidad + 1, [])
          return { texto: r.estado === 'completado' ? r.texto : `El subagente terminó con estado «${r.estado}»${r.error ? `: ${r.error}` : ''}. ${r.texto}`.trim(), error: r.estado !== 'completado' }
        })
      : undefined

    const extras = new Map((profundidad === 0 ? (p.extras ?? []) : []).map((h) => [h.nombre, h]))
    const defs = registro.definiciones(agente.def.herramientas)
    for (const h of extras.values()) defs.push({ nombre: h.nombre, descripcion: h.descripcion, esquema: h.esquema })
    if (delegar) defs.push({ nombre: delegar.nombre, descripcion: delegar.descripcion, esquema: delegar.esquema })
    const permitidas = new Set(defs.map((d) => d.nombre))
    const sistema = profundidad === 0 && p.sistemaExtra ? `${agente.def.sistema}\n\n${p.sistemaExtra}` : agente.def.sistema

    const ejecutarLlamada = async (llamada: LlamadaHerramienta): Promise<ResultadoHerramienta> => {
      if (!permitidas.has(llamada.nombre)) return { texto: `Herramienta no disponible para este agente: ${llamada.nombre}`, error: true }
      if (delegar && llamada.nombre === HERRAMIENTA_DELEGAR) return delegar.ejecutar(llamada.entrada, { cwd: p.cwd })
      const h = extras.get(llamada.nombre) ?? registro.obtener(llamada.nombre)
      const riesgo = h?.clasificar?.(llamada.entrada) ?? h?.riesgo ?? 'ejecucion'
      const ctx = { cwd: p.cwd, ...(p.proyectoId ? { proyectoId: p.proyectoId } : {}), ...(p.senal ? { senal: p.senal } : {}) }
      const bloqueo = await this.o.validar?.(llamada, riesgo, agente.nombre, ctx)
      if (bloqueo) {
        emitir({ tipo: 'guardrail', herramienta: llamada.nombre, motivo: bloqueo })
        return { texto: `Bloqueado por guardrails: ${bloqueo}. No lo reintentes tal cual; busca otra forma que no implique ese riesgo.`, error: true }
      }
      if (riesgo !== 'lectura') {
        const ok = (await (p.aprobar ?? this.o.aprobar)?.(llamada, riesgo, agente.nombre)) ?? false
        if (!ok) return { texto: `Acción denegada (${riesgo}): ${llamada.nombre} no fue aprobada.`, error: true }
      }
      return extras.has(llamada.nombre) ? ejecutarHerramienta(h!, llamada.entrada, ctx) : registro.llamar(llamada.nombre, llamada.entrada, ctx)
    }

    const llamar = (llamada: LlamadaHerramienta): Promise<ResultadoHerramienta> =>
      this.o.trazador ? this.o.trazador.conHerramienta(llamada, () => ejecutarLlamada(llamada)) : ejecutarLlamada(llamada)

    const resultado = await ejecutarBucle(
      {
        llm: this.o.llm,
        sistema,
        ...((profundidad === 0 && p.modelo) || agente.def.modelo ? { modelo: (profundidad === 0 ? p.modelo : undefined) ?? agente.def.modelo! } : {}),
        maxPasos: agente.def.maxPasos ?? MAX_PASOS,
        maxTokens: this.o.maxTokens ?? 4096,
        herramientas: defs,
        llamar,
        ...(p.contexto
          ? {
              preparar: async (mensajes: Mensaje[]): Promise<Mensaje[]> => {
                const r = await p.contexto!.preparar({ sistema, herramientas: defs }, mensajes)
                if (r.estrategia !== 'ninguna')
                  emitir({ tipo: 'contexto', estrategia: r.estrategia, tokensAntes: r.tokensAntes, tokensDespues: r.tokensDespues })
                return r.mensajes
              }
            }
          : {}),
        ...(p.senal ? { senal: p.senal } : {}),
        alUso: (u) => {
          this.gastado += u.tokensEntrada + u.tokensSalida
        },
        agotado: () => this.o.presupuestoTokens !== undefined && this.gastado >= this.o.presupuestoTokens,
        alPaso: (numero) => emitir({ tipo: 'paso', numero }),
        alDelta: (delta) => emitir({ tipo: 'texto_delta', texto: delta }),
        alTexto: (texto) => emitir({ tipo: 'texto', texto }),
        alHerramientaInicio: (llamada) => emitir({ tipo: 'herramienta_inicio', llamada }),
        alHerramientaFin: (llamada, res) => emitir({ tipo: 'herramienta_fin', llamada, resultado: res })
      },
      [...historial, { rol: 'user', contenido: [...(profundidad === 0 ? (p.bloquesUsuario ?? []) : []), { tipo: 'texto', texto: prompt }] }]
    )
    emitir({ tipo: 'fin', resultado })
    return resultado
  }
}
