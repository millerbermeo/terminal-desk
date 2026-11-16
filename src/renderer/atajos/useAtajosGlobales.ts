import { useEffect, useRef } from 'react'
import { atajoGlobal } from '@shared/atajos'

/**
 * Atajos de toda la app. Escucha en la fase de captura de `window`, antes que xterm o los campos de texto, y si la pulsación es de un atajo
 * global la consume (así la terminal no la recibe como bytes). `acciones` se lee siempre fresco: no hace falta memoizarlo.
 */
export function useAtajosGlobales(acciones: Record<string, () => void>): void {
  const ref = useRef(acciones)
  ref.current = acciones
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.isComposing || e.repeat) return
      const id = atajoGlobal(e)
      if (!id) return
      const accion = ref.current[id]
      if (!accion) return
      e.preventDefault()
      e.stopPropagation()
      accion()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])
}
