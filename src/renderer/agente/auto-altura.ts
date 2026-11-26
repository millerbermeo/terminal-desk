import { useLayoutEffect, type RefObject } from 'react'

/**
 * Altura que necesita un `<textarea>` para mostrar todo su texto, entre `min` y `max` (px). Puro: se prueba sin DOM.
 * `desborda` = el texto no cabe ni en `max` (entonces el área se desplaza por dentro).
 */
export function alturaNecesaria(contenido: number, min: number, max: number): { alto: number; desborda: boolean } {
  const tope = Math.max(min, max)
  return { alto: Math.min(Math.max(contenido, min), tope), desborda: contenido > tope }
}

/** Tope por defecto: la mitad de la ventana (o lo que diga `max-height` en CSS, si es menor). */
const FRACCION_MAX = 0.5

/**
 * Hace crecer un `<textarea>` con su contenido, línea a línea, mientras se escribe (y al pegar, dictar o recuperar un prompt),
 * para que siempre se vea todo lo escrito; al pasar del tope se desplaza por dentro. También se reajusta si cambia el ancho
 * (una línea larga pasa a ocupar dos). Respeta `min-height`/`max-height` del CSS.
 */
export function useAutoAltura(ref: RefObject<HTMLTextAreaElement | null>, valor: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ajustar = (): void => {
      const estilo = getComputedStyle(el)
      const min = parseFloat(estilo.minHeight) || 0
      const maxCss = parseFloat(estilo.maxHeight)
      const max = Math.min(Number.isFinite(maxCss) ? maxCss : Infinity, Math.round(window.innerHeight * FRACCION_MAX))
      const bordes = estilo.boxSizing === 'border-box' ? parseFloat(estilo.borderTopWidth) + parseFloat(estilo.borderBottomWidth) : 0
      const previo = el.style.height
      el.style.height = 'auto' // para medir también al borrar (scrollHeight no baja con una altura fija)
      const { alto, desborda } = alturaNecesaria(el.scrollHeight + bordes, min, max)
      el.style.height = `${alto}px`
      el.style.overflowY = desborda ? 'auto' : 'hidden'
      if (previo !== el.style.height && el === document.activeElement && el.selectionEnd === el.value.length) el.scrollTop = el.scrollHeight // escribiendo al final: el cursor a la vista
    }
    ajustar()
    let ancho = el.clientWidth
    const obs = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (el.clientWidth === ancho) return // solo el ancho cambia el número de líneas (la altura la ponemos nosotros)
      ancho = el.clientWidth
      ajustar()
    })
    obs?.observe(el)
    window.addEventListener('resize', ajustar)
    return () => {
      obs?.disconnect()
      window.removeEventListener('resize', ajustar)
    }
  }, [ref, valor])
}
