import { useCallback, useEffect, useRef, useState } from 'react'
import type { EstadoGit, Identidad } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'

export const git = window.api.git.operar

/** Lo que reciben las pestañas de una vista de control de versiones. */
export interface ContextoGit {
  proyectoId: string
  estado: EstadoGit
  /** Ejecuta una operación mostrando «ocupado» y el error si falla; devuelve su resultado o `undefined`. */
  run: <T>(etiqueta: string, f: () => Promise<T>) => Promise<T | undefined>
  ocupado: string
  /** Cambia el estado con el que devolvió una operación y refresca las listas. */
  aplicar: (e: EstadoGit) => void
  /** Cambia cada vez que algo cambia: las pestañas vuelven a leer sus listas. */
  tick: number
  recargar: () => Promise<void>
  avisar: (texto: string) => void
  /** Muestra un error en el banner de la vista. */
  mostrarError: (texto: string) => void
  /** Texto de un conflicto o resultado que merece un aviso destacado. */
  avisarConflictos: (mensaje: string) => void
  ocupadoGlobal: boolean
}

/**
 * Estado de git del proyecto, siempre al día: se vuelve a leer al volver a la ventana y después de cada operación.
 * Solo trabaja mientras la vista está visible.
 */
export function useGit(proyectoId: string, activo: boolean) {
  const [estado, setEstado] = useState<EstadoGit | null>(null)
  const [identidad, setIdentidad] = useState<Identidad | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [cargando, setCargando] = useState(false)
  const [tick, setTick] = useState(0)
  const solicitud = useRef(0)

  const recargar = useCallback(async (): Promise<void> => {
    if (!proyectoId) return
    const mia = ++solicitud.current
    setCargando(true)
    try {
      const e = await git('estado', { proyectoId })
      if (mia !== solicitud.current) return
      setEstado(e)
      setError('')
      if (e.repo) git('identidad', { proyectoId }).then((i) => mia === solicitud.current && setIdentidad(i)).catch(() => undefined)
    } catch (err) {
      if (mia !== solicitud.current) return
      setEstado(null)
      setError(mensajeDe(err))
    } finally {
      if (mia === solicitud.current) {
        setCargando(false)
        setTick((t) => t + 1)
      }
    }
  }, [proyectoId])

  useEffect(() => {
    setEstado(null)
    setIdentidad(null)
    setError('')
    if (activo) void recargar()
  }, [proyectoId, activo, recargar])

  useEffect(() => {
    if (!activo) return
    const alEnfocar = (): void => void recargar()
    window.addEventListener('focus', alEnfocar)
    return () => window.removeEventListener('focus', alEnfocar)
  }, [activo, recargar])

  const run = useCallback(async <T,>(etiqueta: string, f: () => Promise<T>): Promise<T | undefined> => {
    setOcupado(etiqueta)
    try {
      const r = await f()
      setError('')
      return r
    } catch (err) {
      setError(mensajeDe(err))
      return undefined
    } finally {
      setOcupado('')
    }
  }, [])

  const aplicar = useCallback((e: EstadoGit): void => {
    setEstado(e)
    setTick((t) => t + 1)
  }, [])

  return { estado, identidad, setIdentidad, error, setError, ocupado, cargando, tick, recargar, run, aplicar }
}
