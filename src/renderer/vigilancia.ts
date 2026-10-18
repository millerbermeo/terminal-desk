const CLAVE_RECARGAS = 'odesk:recargas-vista-vacia'
const MAX_RECARGAS = 2 // en 10 minutos

const enviar = (kind: string, message: string, stack?: string, context?: Record<string, unknown>): void => {
  try {
    window.api.registro.enviar({ kind, message, ...(stack ? { stack } : {}), ...(context ? { context } : {}) })
  } catch {
    // sin puente (p. ej. se está cerrando): no hay a dónde anotarlo
  }
}

/** Errores que nadie capturó: se anotan (la interfaz sigue como estaba). */
export function capturarErroresGlobales(): void {
  window.addEventListener('error', (e) => {
    if (e.message === 'ResizeObserver loop completed with undelivered notifications.') return // aviso inofensivo del navegador
    enviar('window-error', e.message || 'Error sin mensaje', e.error instanceof Error ? e.error.stack : undefined, { archivo: (e.filename ?? '').split('/').pop() ?? '', linea: e.lineno ?? 0 })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    enviar('unhandledrejection', r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined)
  })
}

/**
 * La pantalla en blanco: si la raíz se queda sin nada dos comprobaciones seguidas, se anota y se recarga la ventana (con tope: no más de
 * dos recargas en 10 minutos, para no entrar en bucle).
 */
export function vigilarVistaVacia(raiz: HTMLElement = document.getElementById('root')!, cadaMs = 4000): () => void {
  let vacias = 0
  const t = window.setInterval(() => {
    if (document.hidden) return
    vacias = raiz.childElementCount === 0 ? vacias + 1 : 0
    if (vacias < 2) return
    vacias = 0
    enviar('vista-vacia', 'La interfaz se quedó en blanco', undefined, { hijos: raiz.childElementCount })
    try {
      const ahora = Date.now()
      const previas = (JSON.parse(sessionStorage.getItem(CLAVE_RECARGAS) ?? '[]') as number[]).filter((m) => ahora - m < 600_000)
      if (previas.length >= MAX_RECARGAS) return
      sessionStorage.setItem(CLAVE_RECARGAS, JSON.stringify([...previas, ahora]))
      location.reload()
    } catch {
      location.reload()
    }
  }, cadaMs)
  return () => clearInterval(t)
}
