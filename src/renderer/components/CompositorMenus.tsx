import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as KeyboardEventReact, type ReactNode } from 'react'

/**
 * Menús del compositor del Asistente: un desplegable genérico que se abre hacia arriba
 * (con animación de entrada y de salida), sus filas y una pista segmentada con un indicador
 * que se desliza. Sustituyen a la fila de selects y botones sueltos de antes.
 */

type Estado = 'cerrado' | 'abierto' | 'cerrando'
const SALIDA_MS = 150
const ITEMS = '[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled),[role="menuitemcheckbox"]:not(:disabled),.cmp-panel select:not(:disabled)'

export function Desplegable({
  boton,
  etiqueta,
  titulo,
  clase = '',
  claseBoton = '',
  lado = 'izquierda',
  ancho,
  children,
}: {
  boton: ReactNode
  etiqueta: string
  titulo?: string
  clase?: string
  claseBoton?: string
  lado?: 'izquierda' | 'derecha'
  ancho?: number
  children: (cerrar: () => void) => ReactNode
}) {
  const [estado, setEstado] = useState<Estado>('cerrado')
  const raiz = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  const cerrar = useCallback((devolverFoco = false) => {
    setEstado((e) => (e === 'abierto' ? 'cerrando' : e))
    if (devolverFoco) disparador.current?.focus()
  }, [])

  useEffect(() => {
    if (estado !== 'cerrando') return
    const t = setTimeout(() => setEstado('cerrado'), SALIDA_MS)
    return () => clearTimeout(t)
  }, [estado])

  useEffect(() => {
    if (estado !== 'abierto') return
    const fuera = (e: MouseEvent): void => {
      if (!raiz.current?.contains(e.target as Node)) cerrar()
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cerrar(true)
      }
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla, true)
    const r = requestAnimationFrame(() => {
      const items = panel.current?.querySelectorAll<HTMLElement>(ITEMS)
      const marcado = panel.current?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)')
      ;(marcado ?? items?.[0])?.focus({ preventScroll: true })
    })
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla, true)
      cancelAnimationFrame(r)
    }
  }, [estado, cerrar])

  const navegar = (e: KeyboardEventReact<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    if ((e.target as HTMLElement).tagName === 'SELECT') return
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const siguiente = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[siguiente]?.focus()
  }

  const visible = estado !== 'cerrado'
  return (
    <div className={`cmp-desplegable ${clase}`} ref={raiz}>
      <button
        ref={disparador}
        type="button"
        className={`cmp-disparador ${claseBoton}${estado === 'abierto' ? ' abierto' : ''}`}
        aria-haspopup="menu"
        aria-expanded={estado === 'abierto'}
        aria-controls={visible ? id : undefined}
        aria-label={etiqueta}
        title={titulo ?? etiqueta}
        onClick={() => (estado === 'abierto' ? cerrar() : setEstado('abierto'))}
      >
        {boton}
      </button>
      {visible && (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={etiqueta}
          className={`cmp-panel ${lado}${estado === 'cerrando' ? ' saliendo' : ''}`}
          style={ancho ? ({ '--cmp-ancho': `${ancho}px` } as CSSProperties) : undefined}
          onKeyDown={navegar}
        >
          {children(() => cerrar(true))}
        </div>
      )}
    </div>
  )
}

/** Fila de un menú: icono, texto, detalle y atajo opcional. */
export function ItemMenu({
  icono,
  texto,
  detalle,
  atajo,
  onClick,
  disabled,
  activo,
  interruptor,
  peligro,
  indice = 0,
}: {
  icono?: ReactNode
  texto: string
  detalle?: string
  atajo?: string
  onClick: () => void
  disabled?: boolean
  activo?: boolean
  /** Si es un interruptor, se pinta un switch y el rol es menuitemcheckbox. */
  interruptor?: boolean
  peligro?: boolean
  indice?: number
}) {
  return (
    <button
      type="button"
      role={interruptor ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={interruptor ? Boolean(activo) : undefined}
      className={`cmp-item${peligro ? ' peligro' : ''}`}
      style={{ '--i': indice } as CSSProperties}
      disabled={disabled}
      onClick={onClick}
      title={detalle}
    >
      <span className="cmp-item-icono" aria-hidden="true">{icono}</span>
      <span className="cmp-item-texto">
        <strong>{texto}</strong>
        {detalle && <small>{detalle}</small>}
      </span>
      {atajo && <kbd className="cmp-atajo">{atajo}</kbd>}
      {interruptor && <span className={`cmp-switch${activo ? ' on' : ''}`} aria-hidden="true"><i /></span>}
    </button>
  )
}

/** Opción de radio de un menú (con marca a la derecha). */
export function OpcionMenu({ texto, detalle, marcada, onClick, disabled, indice = 0, punto }: { texto: string; detalle?: string; marcada: boolean; onClick: () => void; disabled?: boolean; indice?: number; punto?: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={marcada}
      className={`cmp-opcion${marcada ? ' marcada' : ''}`}
      style={{ '--i': indice } as CSSProperties}
      disabled={disabled}
      onClick={onClick}
    >
      {punto && <span className={`cmp-punto ${punto}`} aria-hidden="true" />}
      <span className="cmp-item-texto">
        <strong>{texto}</strong>
        {detalle && <small>{detalle}</small>}
      </span>
      <span className="cmp-marca" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </span>
    </button>
  )
}

/** Pista segmentada con indicador deslizante (Chat/Flujo, nivel de esfuerzo…). */
export function Pista<T extends string>({ opciones, valor, onCambiar, etiqueta, clase = '', enMenu = false }: { opciones: { valor: T; texto: string; titulo?: string; disabled?: boolean }[]; valor: T; onCambiar: (v: T) => void; etiqueta: string; clase?: string; /** Dentro de un menú: cada botón es un menuitemradio navegable con flechas. */ enMenu?: boolean }) {
  const i = Math.max(0, opciones.findIndex((o) => o.valor === valor))
  return (
    <div className={`cmp-pista ${clase}`} role="group" aria-label={etiqueta} style={{ '--n': opciones.length, '--pos': i } as CSSProperties}>
      <span className="cmp-pista-indicador" aria-hidden="true" />
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role={enMenu ? 'menuitemradio' : undefined}
          aria-checked={enMenu ? o.valor === valor : undefined}
          aria-pressed={enMenu ? undefined : o.valor === valor}
          className={o.valor === valor ? 'on' : ''}
          disabled={o.disabled}
          title={o.titulo}
          onClick={() => onCambiar(o.valor)}
        >
          {o.texto}
        </button>
      ))}
    </div>
  )
}

export function SeccionMenu({ titulo, children, nota }: { titulo: string; children: ReactNode; nota?: string }) {
  return (
    <div className="cmp-seccion">
      <div className="cmp-seccion-titulo">
        <span>{titulo}</span>
        {nota && <small>{nota}</small>}
      </div>
      {children}
    </div>
  )
}

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
export const IconoPuntos = () => svg(<><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>)
export const IconoAjustes = () => svg(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>)
export const IconoEnviar = () => svg(<path d="M12 19V5m-6 6 6-6 6 6" strokeWidth="2.2" />)
export const IconoCola = () => svg(<><path d="M4 7h11M4 12h11M4 17h7" /><path d="m17 14 3 3-3 3" /></>)
export const IconoDescargar = () => svg(<><path d="M12 4v11m-5-5 5 5 5-5" /><path d="M5 20h14" /></>)
export const IconoLupa = () => svg(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>)
export const IconoNuevaConv = () => svg(<><path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6" /><path d="M18 15v6m-3-3h6" /></>)
export const IconoRayito = () => svg(<path d="M13 3 5 14h6l-1 7 8-11h-6z" />)
