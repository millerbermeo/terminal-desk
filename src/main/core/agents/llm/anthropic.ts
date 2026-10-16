import Anthropic from '@anthropic-ai/sdk'
import type { BloqueContenido, Mensaje } from '@shared/core/agente'
import { MODELOS_CONOCIDOS, VENTANA_POR_DEFECTO, type InfoModelo } from '@shared/core/uso'
import type { PeticionLLM, ProveedorLLM, RespuestaLLM } from './proveedor'

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5'

export interface OpcionesAnthropic {
  /** Lee el contenido de un adjunto por su id (imágenes y PDFs). Sin él, los adjuntos se sustituyen por un aviso. */
  leerAdjunto?: (id: string) => Promise<{ mime: string; base64: string } | undefined>
  /** Se invoca con las cabeceras de cada respuesta (límites de tasa). */
  alCabeceras?: (h: Headers) => void
  /** Implementación de `fetch` (pruebas). */
  fetch?: typeof fetch
  /** Cliente ya creado (pruebas). */
  cliente?: Anthropic
}

type TipoImagen = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export class ProveedorAnthropic implements ProveedorLLM {
  private readonly cliente: Anthropic

  constructor(
    apiKey: string,
    private readonly modeloPorDefecto: string = MODELO_POR_DEFECTO,
    private readonly o: OpcionesAnthropic = {}
  ) {
    this.cliente =
      o.cliente ??
      new Anthropic({
        apiKey,
        // Se leen las cabeceras de cada respuesta (límites de tasa) sin alterar la llamada.
        fetch: async (url, init) => {
          const r = await (o.fetch ?? fetch)(url, init)
          try {
            o.alCabeceras?.(r.headers)
          } catch {
            /* la telemetría nunca debe romper una llamada */
          }
          return r
        }
      })
  }

  /** Modelos disponibles para esta clave (con su ventana de contexto); si la API no responde, los conocidos. */
  async modelos(): Promise<InfoModelo[]> {
    try {
      const salida: InfoModelo[] = []
      for await (const m of this.cliente.models.list({ limit: 100 }, { timeout: 8000 })) {
        if (m.id.startsWith('claude')) salida.push({ id: m.id, nombre: m.display_name || m.id, ventana: m.max_input_tokens ?? VENTANA_POR_DEFECTO })
      }
      if (salida.length) return salida
    } catch {
      /* sin lista: se usan los conocidos */
    }
    return [...MODELOS_CONOCIDOS]
  }

  private async aApi(m: Mensaje): Promise<Anthropic.MessageParam> {
    const content = await Promise.all(
      m.contenido.map(async (b): Promise<Anthropic.ContentBlockParam> => {
        switch (b.tipo) {
          case 'texto':
            return { type: 'text', text: b.texto }
          case 'herramienta_uso':
            return { type: 'tool_use', id: b.id, name: b.nombre, input: b.entrada }
          case 'herramienta_resultado':
            return { type: 'tool_result', tool_use_id: b.usoId, content: b.texto, is_error: b.error ?? false }
          case 'imagen':
          case 'documento': {
            const datos = await this.o.leerAdjunto?.(b.adjuntoId).catch(() => undefined)
            if (!datos) return { type: 'text', text: `[adjunto «${b.nombre}» no disponible: se eliminó del almacén]` }
            return b.tipo === 'imagen'
              ? { type: 'image', source: { type: 'base64', media_type: datos.mime as TipoImagen, data: datos.base64 } }
              : { type: 'document', title: b.nombre, source: { type: 'base64', media_type: 'application/pdf', data: datos.base64 } }
          }
        }
      })
    )
    return { role: m.rol, content }
  }

  async completar(p: PeticionLLM): Promise<RespuestaLLM> {
    const mensajes = await Promise.all(p.mensajes.map((m) => this.aApi(m)))
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: p.modelo ?? this.modeloPorDefecto,
      max_tokens: p.maxTokens,
      ...(p.sistema ? { system: p.sistema } : {}),
      messages: mensajes,
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
