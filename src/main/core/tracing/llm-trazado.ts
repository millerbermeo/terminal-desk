import type { Mensaje } from '@shared/core/agente'
import type { PeticionLLM, ProveedorLLM, RespuestaLLM } from '../agents/llm/proveedor'
import type { Trazador } from './trazador'

const ultimoTexto = (ms: readonly Mensaje[]): string => {
  for (const m of [...ms].reverse())
    for (const b of m.contenido) {
      if (b.tipo === 'texto') return b.texto
      if (b.tipo === 'herramienta_resultado') return `(resultado) ${b.texto}`
    }
  return ''
}

/** Decorador: mide cada llamada al modelo (duración, tokens, modelo) y la cuelga del agente que la hizo. */
export class LlmTrazado implements ProveedorLLM {
  constructor(
    private readonly interno: ProveedorLLM,
    private readonly trazador: Trazador,
    private readonly modeloPorDefecto = 'predeterminado'
  ) {}

  completar(p: PeticionLLM): Promise<RespuestaLLM> {
    return this.trazador.conLlm(
      { modelo: p.modelo ?? this.modeloPorDefecto, entrada: ultimoTexto(p.mensajes), mensajes: p.mensajes.length },
      () => this.interno.completar(p),
      (r) => r.contenido.map((b) => (b.tipo === 'texto' ? b.texto : `[usa ${b.tipo === 'herramienta_uso' ? b.nombre : ''}]`)).join('\n')
    )
  }
}
