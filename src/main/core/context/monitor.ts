import type { Mensaje } from '@shared/core/agente'
import type { HerramientaDef } from '@shared/core/herramientas'
import { estimarTokens, tokensHerramientas, tokensMensajes } from './tokens'

export interface EstadoContexto {
  tokens: number // estimados: sistema + herramientas + mensajes
  ventana: number
  porcentaje: number // 0..1 de la ventana útil
  sobreUmbral: boolean
}

export interface OpcionesMonitor {
  ventana?: number // tokens de la ventana del modelo
  umbral?: number // fracción a partir de la cual conviene comprimir
  reservaSalida?: number // tokens que se dejan libres para la respuesta
}

/** Mide cuánto de la ventana de contexto ocupa lo que se va a enviar. */
export class MonitorContexto {
  readonly ventana: number
  readonly umbral: number
  private readonly util: number

  constructor(o: OpcionesMonitor = {}) {
    this.ventana = o.ventana ?? 200_000
    this.umbral = o.umbral ?? 0.7
    this.util = Math.max(1, this.ventana - (o.reservaSalida ?? 4096))
  }

  medir(sistema: string | undefined, mensajes: readonly Mensaje[], herramientas: readonly HerramientaDef[]): EstadoContexto {
    const tokens = (sistema ? estimarTokens(sistema) : 0) + tokensHerramientas(herramientas) + tokensMensajes(mensajes)
    const porcentaje = tokens / this.util
    return { tokens, ventana: this.ventana, porcentaje, sobreUmbral: porcentaje >= this.umbral }
  }
}
