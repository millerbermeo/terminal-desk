import { ID_PROYECTO_ARRANQUE, type NombreOperacionArranque, type OperacionesArranque, type Resolucion } from '@shared/arranque'
import type { ServicioArranque } from './servicio'

function proyectoId(v: unknown): string {
  if (typeof v !== 'string' || !ID_PROYECTO_ARRANQUE.test(v)) throw new Error('Arranque: proyecto no válido')
  return v
}

function ids(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) throw new Error('Arranque: lista de comandos no válida')
  return v.filter((x): x is string => typeof x === 'string').slice(0, 100)
}

function resoluciones(v: unknown): Record<string, Resolucion> {
  const out: Record<string, Resolucion> = {}
  if (v && typeof v === 'object') for (const [k, r] of Object.entries(v)) if (r === 'omitir' || r === 'liberar') out[k] = r
  return out
}

/** Despacha una operación del canal `arranque:operar`; valida lo que llega del renderer. */
export async function ejecutarOperacionArranque<K extends NombreOperacionArranque>(servicio: ServicioArranque, op: K, entrada: OperacionesArranque[K]['entrada']): Promise<OperacionesArranque[K]['salida']> {
  const e = (entrada ?? {}) as Record<string, unknown>
  const r = await (async (): Promise<unknown> => {
    switch (op as NombreOperacionArranque) {
      case 'listar':
        return servicio.listar(proyectoId(e.proyectoId))
      case 'estados':
        return servicio.estadosDe(e.proyectoId === undefined ? undefined : proyectoId(e.proyectoId))
      case 'guardar':
        return servicio.guardar(proyectoId(e.proyectoId), e.comando as never)
      case 'eliminar':
        return servicio.eliminar(proyectoId(e.proyectoId), String(e.id ?? ''))
      case 'mover':
        return servicio.mover(proyectoId(e.proyectoId), String(e.id ?? ''), Number(e.indice))
      case 'revisar':
        return servicio.revisar(proyectoId(e.proyectoId), ids(e.ids))
      case 'arrancar':
        return servicio.arrancar(proyectoId(e.proyectoId), { ids: ids(e.ids), resoluciones: resoluciones(e.resoluciones), continuarSiFalla: e.continuarSiFalla === true })
      case 'detener':
        return servicio.detener(proyectoId(e.proyectoId), ids(e.ids))
      case 'autoarrancar':
        return servicio.autoarrancar(proyectoId(e.proyectoId))
      default:
        throw new Error(`Arranque: operación desconocida «${String(op)}»`)
    }
  })()
  return r as OperacionesArranque[K]['salida']
}
