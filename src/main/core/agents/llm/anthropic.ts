import Anthropic from '@anthropic-ai/sdk'
import type { BloqueContenido, Mensaje } from '@shared/core/agente'
import type { PeticionLLM, ProveedorLLM, RespuestaLLM } from './proveedor'

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5'

function aApi(m: Mensaje): Anthropic.MessageParam {
  const content = m.contenido.map((b): Anthropic.ContentBlockParam => {
    switch (b.tipo) {
      case 'texto':
        return { type: 'text', text: b.texto }
      case 'herramienta_uso':
        return { type: 'tool_use', id: b.id, name: b.nombre, input: b.entrada }
      case 'herramienta_resultado':
        return { type: 'tool_result', tool_use_id: b.usoId, content: b.texto, is_error: b.error ?? false }
    }
  })
  return { role: m.rol, content }
}

export class ProveedorAnthropic implements ProveedorLLM {
  private readonly cliente: Anthropic

  constructor(apiKey: string, private readonly modeloPorDefecto: string = MODELO_POR_DEFECTO) {
    this.cliente = new Anthropic({ apiKey })
  }

  async completar(p: PeticionLLM): Promise<RespuestaLLM> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: p.modelo ?? this.modeloPorDefecto,
      max_tokens: p.maxTokens,
      ...(p.sistema ? { system: p.sistema } : {}),
      messages: p.mensajes.map(aApi),
      ...(p.herramientas.length
        ? {
            tools: p.herramientas.map((h) => ({
              name: h.nombre,
              description: h.descripcion,
              input_schema: h.esquema as Anthropic.Tool.InputSchema
            }))
          }
        : {})
    }
    const opciones = p.senal ? { signal: p.senal } : undefined
    let r: Anthropic.Message
    if (p.alTexto) {
      // Streaming: el texto se entrega según se genera; el mensaje completo llega al final.
      const stream = this.cliente.messages.stream(params, opciones)
      stream.on('text', (delta) => p.alTexto!(delta))
      r = await stream.finalMessage()
    } else {
      r = await this.cliente.messages.create(params, opciones)
    }
    const contenido: BloqueContenido[] = []
    for (const b of r.content) {
      if (b.type === 'text') contenido.push({ tipo: 'texto', texto: b.text })
      else if (b.type === 'tool_use')
        contenido.push({ tipo: 'herramienta_uso', id: b.id, nombre: b.name, entrada: (b.input ?? {}) as Record<string, unknown> })
    }
    return {
      contenido,
      parada: r.stop_reason === 'tool_use' ? 'herramientas' : r.stop_reason === 'max_tokens' ? 'limite' : 'fin',
      uso: { tokensEntrada: r.usage.input_tokens, tokensSalida: r.usage.output_tokens }
    }
  }
}
