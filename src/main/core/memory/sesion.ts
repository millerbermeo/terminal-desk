import type { Mensaje, Uso } from '@shared/core/agente'
import { AlmacenJson } from './almacen'

/** Memoria de corto plazo: estado de una conversación activa. */
export interface Sesion {
  id: string
  proyectoId?: string
  mensajes: Mensaje[]
  uso: Uso // acumulado de toda la sesión
  actualizada: string // ISO
}

export class MemoriaCortoPlazo {
  private readonly almacen: AlmacenJson<Sesion>

  constructor(dir: string) {
    this.almacen = new AlmacenJson<Sesion>(dir)
  }

  obtener(id: string): Promise<Sesion | undefined> {
    return this.almacen.leer(id)
  }

  async guardar(id: string, mensajes: Mensaje[], uso: Uso, proyectoId?: string): Promise<void> {
    await this.almacen.actualizar(id, (previa) => ({
      id,
      ...(proyectoId ?? previa?.proyectoId ? { proyectoId: (proyectoId ?? previa?.proyectoId)! } : {}),
      mensajes,
      uso: {
        tokensEntrada: (previa?.uso.tokensEntrada ?? 0) + uso.tokensEntrada,
        tokensSalida: (previa?.uso.tokensSalida ?? 0) + uso.tokensSalida
      },
      actualizada: new Date().toISOString()
    }))
  }

  async borrar(id: string): Promise<void> {
    await this.almacen.actualizar(id, () => undefined)
  }
}
