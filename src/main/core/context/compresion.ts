import type { BloqueContenido, Mensaje } from '@shared/core/agente'
import type { HerramientaDef } from '@shared/core/herramientas'
import type { ProveedorLLM } from '../agents/llm/proveedor'
import type { MonitorContexto } from './monitor'

export const MARCA_RESUMEN = '[Resumen de la conversación anterior]'

export interface OpcionesCompresor {
  llm: ProveedorLLM
  modeloResumen?: string // modelo barato para resumir
  recientes?: number // mensajes finales que nunca se tocan
  minResultado?: number // resultados de herramienta más cortos que esto no se podan
}

export interface ResultadoCompresion {
  mensajes: Mensaje[]
  estrategia: 'ninguna' | 'poda' | 'resumen'
  tokensAntes: number
  tokensDespues: number
}

const esResultado = (b: BloqueContenido): boolean => b.tipo === 'herramienta_resultado'

/**
 * Reduce el ruido de la conversación sin llamar al modelo: los resultados de herramientas antiguos y largos y los adjuntos
 * (imágenes y PDFs) de mensajes antiguos se sustituyen por un marcador.
 */
export function podarResultados(mensajes: readonly Mensaje[], recientes: number, minimo: number): Mensaje[] {
  const limite = mensajes.length - recientes
  const esAdjunto = (b: BloqueContenido): boolean => b.tipo === 'imagen' || b.tipo === 'documento'
  const podable = (b: BloqueContenido): boolean => (b.tipo === 'herramienta_resultado' && b.texto.length > minimo) || esAdjunto(b)
  return mensajes.map((m, i) =>
    i >= limite || !m.contenido.some(podable)
      ? m
      : {
          ...m,
          contenido: m.contenido.map((b): BloqueContenido => {
            if (b.tipo === 'herramienta_resultado' && b.texto.length > minimo) return { ...b, texto: `[resultado antiguo omitido: ${b.texto.length} caracteres]` }
            if (b.tipo === 'imagen' || b.tipo === 'documento') return { tipo: 'texto', texto: `[adjunto antiguo omitido: ${b.nombre}]` }
            return b
          })
        }
  )
}

/**
 * Primer índice >= desde donde se puede cortar: un mensaje del usuario SIN resultados de herramienta
 * (así nunca se separa un tool_use de su tool_result). -1 si no existe.
 */
export function puntoDeCorte(mensajes: readonly Mensaje[], desde: number): number {
  for (let i = Math.max(1, desde); i < mensajes.length; i++) {
    const m = mensajes[i]!
    if (m.rol === 'user' && !m.contenido.some(esResultado)) return i
  }
  return -1
}

function transcribir(mensajes: readonly Mensaje[]): string {
  const recorte = (t: string): string => (t.length > 2000 ? t.slice(0, 2000) + '…' : t)
  return mensajes
    .map((m) => {
      const cuerpo = m.contenido
        .map((b) => {
          if (b.tipo === 'texto') return recorte(b.texto)
          if (b.tipo === 'herramienta_uso') return `(usa ${b.nombre} ${recorte(JSON.stringify(b.entrada))})`
          if (b.tipo === 'imagen' || b.tipo === 'documento') return `(adjunto ${b.tipo}: ${b.nombre})`
          return `(resultado${b.error ? ' con error' : ''}: ${recorte(b.texto)})`
        })
        .join('\n')
      return `${m.rol === 'user' ? 'USUARIO' : 'ASISTENTE'}:\n${cuerpo}`
    })
    .join('\n\n')
}

const PROMPT_RESUMEN =
  'Resume la conversación para que otro asistente pueda continuarla sin perder nada importante. ' +
  'Incluye, en español y de forma concisa: objetivo del usuario, decisiones tomadas, archivos leídos o modificados (con rutas), ' +
  'hallazgos relevantes, errores encontrados y tareas pendientes. No inventes nada.'

/** Compresión automática de la conversación antes de enviarla al modelo. */
export class CompresorContexto {
  constructor(
    private readonly monitor: MonitorContexto,
    private readonly o: OpcionesCompresor
  ) {}

  async preparar(
    ctx: { sistema?: string; herramientas: readonly HerramientaDef[] },
    mensajes: readonly Mensaje[]
  ): Promise<ResultadoCompresion> {
    const medir = (ms: readonly Mensaje[]): ReturnType<MonitorContexto['medir']> =>
      this.monitor.medir(ctx.sistema, ms, ctx.herramientas)
    const antes = medir(mensajes)
    const salida = (ms: Mensaje[], estrategia: ResultadoCompresion['estrategia']): ResultadoCompresion => ({
      mensajes: ms, estrategia, tokensAntes: antes.tokens, tokensDespues: medir(ms).tokens
    })
    if (!antes.sobreUmbral) return salida([...mensajes], 'ninguna')

    const recientes = this.o.recientes ?? 6
    const podados = podarResultados(mensajes, recientes, this.o.minResultado ?? 500)
    if (!medir(podados).sobreUmbral) return salida(podados, 'poda')

    const corte = puntoDeCorte(podados, podados.length - recientes)
    if (corte < 1) return salida(podados, 'poda') // no hay dónde cortar sin romper una llamada a herramienta
    try {
      const r = await this.o.llm.completar({
        sistema: PROMPT_RESUMEN,
        mensajes: [{ rol: 'user', contenido: [{ tipo: 'texto', texto: transcribir(podados.slice(0, corte)) }] }],
        herramientas: [],
        maxTokens: 1500,
        ...(this.o.modeloResumen ? { modelo: this.o.modeloResumen } : {})
      })
      const resumen = r.contenido.flatMap((b) => (b.tipo === 'texto' ? [b.texto] : [])).join('\n').trim()
      if (!resumen) return salida(podados, 'poda')
      // El resumen se fusiona con el primer mensaje conservado (que es del usuario): los roles siguen alternando.
      const [primero, ...resto] = podados.slice(corte) as [Mensaje, ...Mensaje[]]
      const fusionado: Mensaje = {
        rol: 'user',
        contenido: [{ tipo: 'texto', texto: `${MARCA_RESUMEN}\n${resumen}` }, ...primero.contenido]
      }
      return salida([fusionado, ...resto], 'resumen')
    } catch {
      return salida(podados, 'poda') // si el resumen falla, se sigue con la poda
    }
  }
}
