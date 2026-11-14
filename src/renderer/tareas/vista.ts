import { useCallback, useState } from 'react'
import { FILTRO_VACIO, type AgruparPor, type CampoOrden, type DireccionOrden, type FiltroVista } from '@shared/tareas-vista'
import type { Densidad } from '../components/tareas/TareaTarjeta'

export type Pestana = 'tablero' | 'lista' | 'calendario' | 'cronograma' | 'hoy' | 'resumen' | 'actividad'
export const COLUMNAS_LISTA = ['estado', 'prioridad', 'responsable', 'proyecto', 'vence', 'estimacion', 'progreso', 'etiquetas', 'actualizada'] as const
export type ColumnaLista = (typeof COLUMNAS_LISTA)[number]
export const NOMBRE_COLUMNA: Record<ColumnaLista, string> = {
  estado: 'Estado',
  prioridad: 'Prioridad',
  responsable: 'Responsable',
  proyecto: 'Proyecto',
  vence: 'Vence',
  estimacion: 'Estim.',
  progreso: 'Progreso',
  etiquetas: 'Etiquetas',
  actualizada: 'Actualizada'
}

export interface PrefsVista {
  pestana: Pestana
  densidad: Densidad
  agrupar: AgruparPor
  orden: { campo: CampoOrden; dir: DireccionOrden } | null
  columnas: ColumnaLista[]
  /** Ids de estado cuya columna del tablero está plegada. */
  colapsadas: string[]
  /** Límite de trabajo en curso por columna (id de estado → máximo). */
  limites: Record<string, number>
  filtro: FiltroVista
}

const CLAVE = 'odesk.tareas.vista.v1'
const POR_DEFECTO: PrefsVista = {
  pestana: 'tablero',
  densidad: 'comoda',
  agrupar: 'ninguno',
  orden: null,
  columnas: ['estado', 'prioridad', 'responsable', 'proyecto', 'vence', 'progreso'],
  colapsadas: [],
  limites: {},
  filtro: FILTRO_VACIO
}

function leer(): PrefsVista {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Partial<PrefsVista> | null
    if (!crudo || typeof crudo !== 'object') return POR_DEFECTO
    return { ...POR_DEFECTO, ...crudo, filtro: { ...FILTRO_VACIO, ...(crudo.filtro ?? {}) } }
  } catch {
    return POR_DEFECTO
  }
}

/** Preferencias de la vista de Tareas (pestaña, densidad, filtros, columnas…) que se recuerdan entre sesiones, por equipo. */
export function usePrefsVista(): [PrefsVista, (p: Partial<PrefsVista>) => void] {
  const [prefs, setPrefs] = useState<PrefsVista>(leer)
  const cambiar = useCallback((p: Partial<PrefsVista>): void => {
    setPrefs((actual) => {
      const nueva = { ...actual, ...p }
      try {
        localStorage.setItem(CLAVE, JSON.stringify(nueva))
      } catch {
        /* sin almacenamiento: la vista sigue funcionando, solo no se recuerda */
      }
      return nueva
    })
  }, [])
  return [prefs, cambiar]
}
