import { nuevoId, peticionVacia, type PeticionApi, type RespuestaApi } from '@shared/api'

/** Una pestaña del cliente API: la petición que se está editando y lo último que respondió. */
export interface Borrador {
  id: string
  peticion: PeticionApi
  /** Nombre con el que está guardada (si lo está). */
  nombre: string
  guardada?: { coleccionId: string; peticionId: string }
  respuesta?: RespuestaApi
  error?: string
  /** Identificador del envío en curso (permite cancelarlo). */
  envioId?: string
  /** Hay cambios sin guardar. */
  sucio: boolean
}

export const borradorNuevo = (peticion: PeticionApi = peticionVacia(), nombre = '', guardada?: Borrador['guardada']): Borrador => ({
  id: nuevoId(),
  peticion,
  nombre,
  ...(guardada ? { guardada } : {}),
  sucio: false
})

/** Título corto de la pestaña: el nombre guardado o `MÉTODO /ruta`. */
export function tituloDe(b: Borrador): string {
  if (b.nombre) return b.nombre
  const u = b.peticion.url.trim()
  if (!u) return 'Petición nueva'
  try {
    const x = new URL(/^[a-z]+:\/\//i.test(u) ? u : `http://${u}`)
    return `${b.peticion.metodo} ${x.pathname === '/' ? x.host : x.pathname}`
  } catch {
    return `${b.peticion.metodo} ${u.slice(0, 30)}`
  }
}
