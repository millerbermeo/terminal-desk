/**
 * `setInterval` que no trabaja con la ventana oculta (minimizada o tapada del todo): ahí nadie ve el resultado y cada vuelta cuesta
 * IPC, disco o red. Si se saltó alguna vuelta, al volver a estar visible se ejecuta una vez enseguida para no mostrar datos viejos.
 * Devuelve la función que lo detiene.
 */
export function cadaVisible(fn: () => void, ms: number): () => void {
  let pendiente = false
  const t = window.setInterval(() => {
    if (document.hidden) {
      pendiente = true
      return
    }
    fn()
  }, ms)
  const alCambiar = (): void => {
    if (document.hidden || !pendiente) return
    pendiente = false
    fn()
  }
  document.addEventListener('visibilitychange', alCambiar)
  return () => {
    window.clearInterval(t)
    document.removeEventListener('visibilitychange', alCambiar)
  }
}
