import { useCallback, useEffect, useRef, useState } from 'react'
import type { EstadoTarea, FiltroTareas, Tarea } from '@shared/tareas'

export const mensajeDe = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')

/** Ámbito de la vista: todas, sin proyecto, un grupo o un proyecto (se escribe como «p:<id>» / «g:<id>» en el selector). */
export type Ambito = '' | '__sin__' | `p:${string}` | `g:${string}`

export const filtroDeAmbito = (a: Ambito): FiltroTareas => (a === '__sin__' ? { sinProyecto: true } : a.startsWith('p:') ? { proyectoId: a.slice(2) } : a.startsWith('g:') ? { grupoId: a.slice(2) } : {})

/**
 * Tareas y estados, siempre al día: el proceso principal avisa de cada cambio (también los de la IA por MCP o herramientas),
 * así que la vista se refresca sola.
 */
export function useTareas() {
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [estados, setEstados] = useState<EstadoTarea[]>([])
  const [cargado, setCargado] = useState(false)
  const [error, setError] = useState('')
  const version = useRef(0)

  const recargar = useCallback(async (): Promise<void> => {
    const mia = ++version.current
    try {
      const [t, e] = await Promise.all([window.api.tareas.operar('listar', {}), window.api.tareas.operar('estados', {})])
      if (mia !== version.current) return // llegó una lectura más reciente
      setTareas(t)
      setEstados(e)
      setCargado(true)
    } catch (err) {
      setError(mensajeDe(err))
    }
  }, [])

  useEffect(() => {
    void recargar()
    return window.api.tareas.onCambio(() => void recargar())
  }, [recargar])

  /** Ejecuta una operación y muestra su error (las reglas de negocio vuelven como texto legible). Devuelve si salió bien. */
  const intentar = useCallback(async (f: () => Promise<unknown>): Promise<boolean> => {
    try {
      await f()
      setError('')
      return true
    } catch (err) {
      setError(mensajeDe(err))
      return false
    }
  }, [])

  return { tareas, estados, cargado, error, setError, recargar, intentar }
}
