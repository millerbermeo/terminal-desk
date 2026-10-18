import { ORIGENES, type FiltroHistorial, type NombreOperacionHistorial, type OperacionesHistorial, type OrigenVersion } from '@shared/historial'
import type { ServicioHistorial } from './servicio'

type Entrada<K extends NombreOperacionHistorial> = OperacionesHistorial[K]['entrada']
type Implementaciones = { [K in NombreOperacionHistorial]: (s: ServicioHistorial, e: Entrada<K>) => Promise<OperacionesHistorial[K]['salida']> }

const texto = (v: unknown, campo: string, max = 1000): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /\0/.test(v)) throw new Error(`Falta ${campo} o no es válido.`)
  return v
}
const origen = (v: unknown): OrigenVersion | undefined => (typeof v === 'string' && (ORIGENES as readonly string[]).includes(v) ? (v as OrigenVersion) : undefined)
const opcional = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

function filtroDe(f: unknown): FiltroHistorial {
  const o = f !== null && typeof f === 'object' ? (f as Record<string, unknown>) : {}
  const desde = opcional(o.desde, 40)
  return {
    ...(opcional(o.texto) ? { texto: opcional(o.texto) } : {}),
    ...(origen(o.origen) ? { origen: origen(o.origen) } : {}),
    ...(opcional(o.autor) ? { autor: opcional(o.autor) } : {}),
    ...(desde && Number.isFinite(Date.parse(desde)) ? { desde } : {})
  }
}

const OPERACIONES: Implementaciones = {
  estado: (s, e) => s.estado(texto(e.proyectoId, 'el proyecto', 80)),
  ajustar: (s, e) => s.ajustar(texto(e.proyectoId, 'el proyecto', 80), e.activo === true),
  archivos: (s, e) => s.archivos(texto(e.proyectoId, 'el proyecto', 80), filtroDe(e.filtro), typeof e.limite === 'number' ? e.limite : undefined),
  versiones: (s, e) => s.versiones(texto(e.proyectoId, 'el proyecto', 80), texto(e.ruta, 'el archivo'), filtroDe(e.filtro)),
  leer: (s, e) => s.leer(texto(e.proyectoId, 'el proyecto', 80), texto(e.ruta, 'el archivo'), texto(e.version, 'la versión', 80)),
  comparar: (s, e) => s.comparar(texto(e.proyectoId, 'el proyecto', 80), texto(e.ruta, 'el archivo'), texto(e.desde, 'la versión de origen', 80), texto(e.hasta, 'la versión de destino', 80)),
  restaurar: async (s, e) => ({
    version: await s.restaurar(
      texto(e.proyectoId, 'el proyecto', 80),
      texto(e.ruta, 'el archivo'),
      texto(e.version, 'la versión', 80),
      Array.isArray(e.bloques) ? e.bloques.filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0, 5000) : undefined
    )
  }),
  olvidar: (s, e) => s.olvidar(texto(e.proyectoId, 'el proyecto', 80), opcional(e.ruta, 1000))
}

/** Operaciones del historial de la interfaz. El renderer manda el id del proyecto y rutas relativas; nunca rutas del sistema. */
export function ejecutarOperacionHistorial(s: ServicioHistorial, op: unknown, entrada: unknown): Promise<unknown> {
  if (typeof op !== 'string' || !Object.hasOwn(OPERACIONES, op)) return Promise.reject(new Error(`Operación de historial desconocida: ${String(op)}`))
  const e = entrada !== null && typeof entrada === 'object' ? entrada : {}
  return (async () => (OPERACIONES[op as NombreOperacionHistorial] as (s: ServicioHistorial, e: unknown) => Promise<unknown>)(s, e))()
}
