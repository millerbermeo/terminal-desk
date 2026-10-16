import type { BloqueContenido, Mensaje, Uso } from '@shared/core/agente'
import type { HerramientaDef } from '@shared/core/herramientas'

export interface PeticionLLM {
  sistema?: string
  mensajes: Mensaje[]
  herramientas: HerramientaDef[]
  modelo?: string
  maxTokens: number
  senal?: AbortSignal
  /** Si el proveedor emite texto en streaming, lo entrega trozo a trozo mientras se genera. */
  alTexto?(delta: string): void
}

export interface RespuestaLLM {
  contenido: BloqueContenido[]
  /** `herramientas` = el modelo pidió ejecutar herramientas; `limite` = se cortó por maxTokens. */
  parada: 'fin' | 'herramientas' | 'limite'
  uso: Uso
}

/** Abstracción del modelo: el bucle no sabe qué API hay detrás. */
export interface ProveedorLLM {
  completar(peticion: PeticionLLM): Promise<RespuestaLLM>
}
