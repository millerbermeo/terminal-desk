import type { BloqueContenido, Mensaje, ResultadoAgente, Uso } from '@shared/core/agente'
import type { HerramientaDef, LlamadaHerramienta, ResultadoHerramienta } from '@shared/core/herramientas'
import type { ProveedorLLM } from './llm/proveedor'

export interface ConfigBucle {
  llm: ProveedorLLM
  sistema?: string
  modelo?: string
  maxPasos: number
  maxTokens: number
  herramientas: HerramientaDef[]
  /** Ejecuta una herramienta (aplica políticas, subagentes, etc.). No debe lanzar. */
  llamar(llamada: LlamadaHerramienta): Promise<ResultadoHerramienta>
  /** Se invoca antes de cada llamada al modelo; puede devolver una conversación más corta (que sustituye a la actual). */
  preparar?(mensajes: Mensaje[]): Promise<Mensaje[]>
  senal?: AbortSignal
  alPaso?(numero: number): void
  alTexto?(texto: string): void
  /** Trozos de texto mientras el modelo escribe (streaming). */
  alDelta?(delta: string): void
  /** Tokens de cada respuesta del modelo (para presupuestos compartidos entre agentes). */
  alUso?(uso: Uso): void
  /** Si devuelve true, el bucle se detiene tras la respuesta en curso (presupuesto de tokens agotado). */
  agotado?(): boolean
  alHerramientaInicio?(llamada: LlamadaHerramienta): void
  alHerramientaFin?(llamada: LlamadaHerramienta, resultado: ResultadoHerramienta): void
}

const textoDe = (c: BloqueContenido[]): string =>
  c.flatMap((b) => (b.tipo === 'texto' ? [b.texto] : [])).join('\n').trim()

/**
 * Bucle del agente: modelo -> (herramientas) -> modelo… hasta que responde sin pedir herramientas,
 * se agota `maxPasos` o se cancela. Las herramientas de un mismo turno se ejecutan en paralelo.
 */
export async function ejecutarBucle(cfg: ConfigBucle, historial: Mensaje[]): Promise<ResultadoAgente> {
  const mensajes = [...historial]
  const uso: Uso = { tokensEntrada: 0, tokensSalida: 0 }
  let texto = ''
  let pasos = 0
  const resultado = (estado: ResultadoAgente['estado'], error?: string): ResultadoAgente => ({
    estado, texto, mensajes, uso, pasos, ...(error ? { error } : {})
  })

  while (pasos < cfg.maxPasos) {
    if (cfg.senal?.aborted) return resultado('cancelado')
    if (cfg.agotado?.()) return resultado('limite_pasos', 'Presupuesto de tokens agotado: el agente se detuvo')
    pasos++
    cfg.alPaso?.(pasos)
    let r
    try {
      if (cfg.preparar) {
        const preparados = await cfg.preparar(mensajes)
        mensajes.splice(0, mensajes.length, ...preparados)
      }
      r = await cfg.llm.completar({
        mensajes,
        herramientas: cfg.herramientas,
        maxTokens: cfg.maxTokens,
        ...(cfg.alDelta ? { alTexto: cfg.alDelta } : {}),
        ...(cfg.sistema ? { sistema: cfg.sistema } : {}),
        ...(cfg.modelo ? { modelo: cfg.modelo } : {}),
        ...(cfg.senal ? { senal: cfg.senal } : {})
      })
    } catch (err) {
      if (cfg.senal?.aborted) return resultado('cancelado')
      return resultado('error', (err as Error).message)
    }
    uso.tokensEntrada += r.uso.tokensEntrada
    uso.tokensSalida += r.uso.tokensSalida
    cfg.alUso?.(r.uso)
    mensajes.push({ rol: 'assistant', contenido: r.contenido })
    const t = textoDe(r.contenido)
    if (t) {
      texto = t
      cfg.alTexto?.(t)
    }

    if (cfg.agotado?.()) {
      const t0 = textoDe(r.contenido)
      if (t0) texto = t0
      return resultado('limite_pasos', 'Presupuesto de tokens agotado: el agente se detuvo')
    }

    const usos = r.contenido.filter((b): b is Extract<BloqueContenido, { tipo: 'herramienta_uso' }> => b.tipo === 'herramienta_uso')
    if (r.parada !== 'herramientas' || usos.length === 0) {
      return r.parada === 'limite' ? resultado('error', 'Respuesta cortada por maxTokens') : resultado('completado')
    }

    const resultados = await Promise.all(
      usos.map(async (u): Promise<BloqueContenido> => {
        const llamada: LlamadaHerramienta = { id: u.id, nombre: u.nombre, entrada: u.entrada }
        cfg.alHerramientaInicio?.(llamada)
        const res = await cfg.llamar(llamada)
        cfg.alHerramientaFin?.(llamada, res)
        return { tipo: 'herramienta_resultado', usoId: u.id, texto: res.texto, ...(res.error ? { error: true } : {}) }
      })
    )
    mensajes.push({ rol: 'user', contenido: resultados })
  }
  return resultado('limite_pasos')
}
