import type { BloqueContenido, Mensaje } from '@shared/core/agente'
import type { PeticionLLM, ProveedorLLM, RespuestaLLM } from '../src/main/core/agents/llm/proveedor'

export const texto = (t: string): RespuestaLLM => ({
  contenido: [{ tipo: 'texto', texto: t }],
  parada: 'fin',
  uso: { tokensEntrada: 10, tokensSalida: 5 }
})

export const usar = (id: string, nombre: string, entrada: Record<string, unknown> = {}): RespuestaLLM => ({
  contenido: [{ tipo: 'herramienta_uso', id, nombre, entrada }],
  parada: 'herramientas',
  uso: { tokensEntrada: 10, tokensSalida: 5 }
})

/** LLM guionizado: devuelve las respuestas en orden y guarda las peticiones recibidas. */
export class LlmFalso implements ProveedorLLM {
  readonly peticiones: PeticionLLM[] = []
  constructor(private readonly guion: (RespuestaLLM | ((p: PeticionLLM) => RespuestaLLM))[]) {}
  async completar(p: PeticionLLM): Promise<RespuestaLLM> {
    this.peticiones.push({ ...p, mensajes: [...p.mensajes] })
    const siguiente = this.guion.shift()
    if (!siguiente) throw new Error('guion agotado')
    return typeof siguiente === 'function' ? siguiente(p) : siguiente
  }
}

export const resultadosDe = (m: Mensaje): Extract<BloqueContenido, { tipo: 'herramienta_resultado' }>[] =>
  m.contenido.filter((b): b is Extract<BloqueContenido, { tipo: 'herramienta_resultado' }> => b.tipo === 'herramienta_resultado')
