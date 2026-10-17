import type { NombreOperacionApi, OperacionesApi } from '@shared/api'
import type { ServicioApi } from './servicio'

type Entrada<K extends NombreOperacionApi> = OperacionesApi[K]['entrada']
type Implementaciones = { [K in NombreOperacionApi]: (s: ServicioApi, e: Entrada<K>) => Promise<OperacionesApi[K]['salida']> }

const OPERACIONES: Implementaciones = {
  datos: (s) => s.datos(),
  enviar: (s, e) => s.enviar(e.peticion, e.envioId),
  cancelar: async (s, e) => s.cancelar(String(e.envioId)),
  curl: (s, e) => s.curl(e.peticion),
  guardarPeticion: (s, e) => s.guardarPeticion(String(e.coleccionId), e.id, e.nombre, e.peticion),
  eliminarPeticion: (s, e) => s.eliminarPeticion(String(e.coleccionId), String(e.id)),
  guardarColeccion: (s, e) => s.guardarColeccion(e.id, e.nombre),
  eliminarColeccion: (s, e) => s.eliminarColeccion(String(e.id)),
  guardarEntorno: (s, e) => s.guardarEntorno(e.id, e.nombre, e.variables),
  eliminarEntorno: (s, e) => s.eliminarEntorno(String(e.id)),
  fijarEntorno: (s, e) => s.fijarEntorno(e.id),
  limpiarHistorial: (s) => s.limpiarHistorial(),
  guardarRespuesta: (s, e) => s.guardarRespuesta(String(e.envioId))
}

export function ejecutarOperacionApi(s: ServicioApi, op: unknown, entrada: unknown): Promise<unknown> {
  if (typeof op !== 'string' || !Object.hasOwn(OPERACIONES, op)) return Promise.reject(new Error(`Operación de API desconocida: ${String(op)}`))
  const e = entrada !== null && typeof entrada === 'object' ? entrada : {}
  return (OPERACIONES[op as NombreOperacionApi] as (s: ServicioApi, e: unknown) => Promise<unknown>)(s, e)
}
