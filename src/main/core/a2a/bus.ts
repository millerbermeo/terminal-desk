import type { Herramienta } from '../tools/registro'

export interface PeticionA2A {
  de: string
  pregunta: string
  /** Agentes por los que ya ha pasado la consulta (evita ciclos A -> B -> A). */
  cadena: readonly string[]
  senal?: AbortSignal
}

export interface Endpoint {
  nombre: string
  descripcion: string
  atender(p: PeticionA2A): Promise<string>
}

export const HERRAMIENTA_CONSULTAR = 'consultar_agente'
const MAX_SALTOS = 3

/** Bus de mensajes entre agentes: petición/respuesta con protección frente a ciclos y cadenas demasiado largas. */
export class BusA2A {
  private readonly endpoints = new Map<string, Endpoint>()

  registrar(e: Endpoint): void {
    if (this.endpoints.has(e.nombre)) throw new Error(`Agente A2A duplicado: ${e.nombre}`)
    this.endpoints.set(e.nombre, e)
  }

  nombres(): string[] {
    return [...this.endpoints.keys()]
  }

  async enviar(p: PeticionA2A & { a: string }): Promise<string> {
    const destino = this.endpoints.get(p.a)
    if (!destino) throw new Error(`Agente desconocido: ${p.a}. Disponibles: ${this.nombres().join(', ')}`)
    if (p.cadena.includes(p.a)) throw new Error(`Ciclo detectado: ${[...p.cadena, p.a].join(' -> ')}`)
    if (p.cadena.length >= MAX_SALTOS) throw new Error(`Cadena de consultas demasiado larga (máx. ${MAX_SALTOS})`)
    return destino.atender({ de: p.de, pregunta: p.pregunta, cadena: p.cadena, ...(p.senal ? { senal: p.senal } : {}) })
  }

  /** Herramienta `consultar_agente` para el agente `de`; ve a todos los demás. */
  herramientaConsultar(
    de: string,
    cadena: readonly string[],
    alMensaje?: (m: { de: string; a: string; fase: 'envio' | 'respuesta'; texto: string }) => void
  ): Herramienta {
    const otros = [...this.endpoints.values()].filter((e) => e.nombre !== de)
    return {
      nombre: HERRAMIENTA_CONSULTAR,
      descripcion:
        'Consulta a otro agente del sistema (cada uno conoce un submódulo). No ve esta conversación: incluye todo el contexto en la pregunta.\n' +
        otros.map((e) => `- ${e.nombre}: ${e.descripcion}`).join('\n'),
      esquema: {
        type: 'object',
        properties: { agente: { type: 'string', enum: otros.map((e) => e.nombre) }, pregunta: { type: 'string' } },
        required: ['agente', 'pregunta']
      },
      riesgo: 'lectura', // los agentes consultados son de solo lectura
      ejecutar: async (entrada, ctx) => {
        const a = String(entrada.agente)
        const pregunta = String(entrada.pregunta)
        alMensaje?.({ de, a, fase: 'envio', texto: pregunta })
        try {
          const texto = await this.enviar({ de, a, pregunta, cadena: [...cadena, de], ...(ctx.senal ? { senal: ctx.senal } : {}) })
          alMensaje?.({ de: a, a: de, fase: 'respuesta', texto })
          return { texto }
        } catch (err) {
          return { texto: (err as Error).message, error: true }
        }
      }
    }
  }
}
