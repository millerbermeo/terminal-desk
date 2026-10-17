import { useEffect, useRef, useState } from 'react'
import type { AccionNavegador, EstadoNavegador } from '@shared/navegador'
import { IconoReiniciar } from './components/Iconos'
import { mensajeDe } from './tareas/useTareas'

/**
 * Barra de direcciones de una ventana de navegador. La página va debajo, en una vista web aislada que gestiona el proceso principal:
 * esta interfaz solo le manda órdenes (ir, atrás, recargar, herramientas de desarrollo…) y recibe su estado.
 */
export function VentanaNavegador({ id }: { id: number }) {
  const [estado, setEstado] = useState<EstadoNavegador | null>(null)
  const [texto, setTexto] = useState('')
  const [editando, setEditando] = useState(false)
  const [error, setError] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'Navegador'
    void window.api.navegador.obtener(id).then(setEstado).catch((e) => setError(mensajeDe(e)))
    return window.api.navegador.onEstado(setEstado)
  }, [id])
  // Mientras no estés escribiendo, la barra muestra siempre la dirección real de la página.
  useEffect(() => {
    if (!editando && estado) setTexto(estado.url)
  }, [estado, editando])
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'l') (e.preventDefault(), entrada.current?.focus(), entrada.current?.select())
      else if (mod && e.key.toLowerCase() === 'r') (e.preventDefault(), void accion({ tipo: 'recargar' }))
      else if (e.key === 'F5') (e.preventDefault(), void accion({ tipo: 'recargar' }))
      else if (e.key === 'F12') (e.preventDefault(), void accion({ tipo: 'devtools' }))
      else if (e.altKey && e.key === 'ArrowLeft') void accion({ tipo: 'atras' })
      else if (e.altKey && e.key === 'ArrowRight') void accion({ tipo: 'adelante' })
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  const accion = async (a: AccionNavegador): Promise<void> => {
    try {
      await window.api.navegador.accion(id, a)
      setError('')
    } catch (e) {
      setError(mensajeDe(e))
    }
  }

  return (
    <div className="nav-barra" role="toolbar" aria-label="Navegador">
      <button className="icono" onClick={() => void accion({ tipo: 'atras' })} disabled={!estado?.puedeAtras} title="Atrás (Alt+←)" aria-label="Atrás">
        ←
      </button>
      <button className="icono" onClick={() => void accion({ tipo: 'adelante' })} disabled={!estado?.puedeAdelante} title="Adelante (Alt+→)" aria-label="Adelante">
        →
      </button>
      {estado?.cargando ? (
        <button className="icono" onClick={() => void accion({ tipo: 'detener' })} title="Detener" aria-label="Detener">
          ✕
        </button>
      ) : (
        <button className="icono" onClick={() => void accion({ tipo: 'recargar' })} title="Recargar (F5)" aria-label="Recargar">
          <IconoReiniciar />
        </button>
      )}
      <form
        className="nav-direccion"
        onSubmit={(e) => {
          e.preventDefault()
          setEditando(false)
          entrada.current?.blur()
          void accion({ tipo: 'ir', url: texto })
        }}
      >
        <input
          ref={entrada}
          value={texto}
          spellCheck={false}
          placeholder="Escribe una dirección: localhost:3000, 5173, ejemplo.com…"
          onChange={(e) => setTexto(e.target.value)}
          onFocus={(e) => (setEditando(true), e.target.select())}
          onBlur={() => setEditando(false)}
          aria-label="Dirección"
        />
      </form>
      {(error || estado?.error) && (
        <span className="chip chip-aviso nav-error" title={error || estado?.error}>
          {error || estado?.error}
        </span>
      )}
      <button className="icono" onClick={() => void accion({ tipo: 'devtools' })} title="Herramientas de desarrollo (F12)" aria-label="Herramientas de desarrollo">
        {'</>'}
      </button>
      <button className="icono" onClick={() => void accion({ tipo: 'externo' })} title="Abrir en el navegador del sistema" aria-label="Abrir en el navegador del sistema">
        ↗
      </button>
      {estado?.cargando && <div className="nav-progreso" aria-hidden="true" />}
    </div>
  )
}
