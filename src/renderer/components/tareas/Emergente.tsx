import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface Ancla {
  x: number
  y: number
  /** Alto del elemento que lo abre: si no cabe debajo, sale por encima. */
  alto?: number
}

/** Ancla un menú a un botón (justo debajo, alineado a su borde izquierdo). */
export const anclaDe = (el: Element): Ancla => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.bottom + 4, alto: r.height + 8 }
}

/** Panel flotante (menú, selector) en la raíz del documento: no lo recorta ningún `overflow` y se cierra con Esc o un clic fuera. */
export function Emergente({ ancla, onCerrar, children, ancho, etiqueta }: { ancla: Ancla; onCerrar: () => void; children: ReactNode; ancho?: number; etiqueta?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: ancla.x, top: ancla.y, listo: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margen = 8
    const left = Math.max(margen, Math.min(ancla.x, window.innerWidth - r.width - margen))
    const caboAbajo = ancla.y + r.height + margen <= window.innerHeight
    const top = caboAbajo ? ancla.y : Math.max(margen, ancla.y - r.height - (ancla.alto ?? 0))
    setPos({ left, top, listo: true })
  }, [ancla])

  useEffect(() => {
    const fuera = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCerrar()
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCerrar()
      }
    }
    const cerrar = (): void => onCerrar()
    document.addEventListener('mousedown', fuera, true)
    window.addEventListener('keydown', tecla, true)
    window.addEventListener('blur', cerrar)
    window.addEventListener('resize', cerrar)
    return () => {
      document.removeEventListener('mousedown', fuera, true)
      window.removeEventListener('keydown', tecla, true)
      window.removeEventListener('blur', cerrar)
      window.removeEventListener('resize', cerrar)
    }
  }, [onCerrar])

  return createPortal(
    <div ref={ref} className="emg" role="menu" aria-label={etiqueta} style={{ left: pos.left, top: pos.top, ...(ancho ? { width: ancho } : {}), visibility: pos.listo ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body
  )
}

export interface ItemMenu {
  id: string
  etiqueta: string
  icono?: ReactNode
  atajo?: string
  peligro?: boolean
  activo?: boolean
  deshabilitado?: boolean
  /** Línea separadora antes de este elemento. */
  separador?: boolean
  onClick: () => void
}

/** Lista de acciones con flechas arriba/abajo y Enter. */
export function MenuLista({ items, onCerrar }: { items: ItemMenu[]; onCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [])
  const flechas = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = bs.indexOf(document.activeElement as HTMLButtonElement)
    bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus()
  }
  return (
    <div ref={ref} className="emg-lista" onKeyDown={flechas}>
      {items.map((it) => (
        <div key={it.id}>
          {it.separador && <hr className="emg-sep" />}
          <button
            role="menuitem"
            className={`emg-item${it.peligro ? ' peligro' : ''}${it.activo ? ' activo' : ''}`}
            disabled={it.deshabilitado}
            onClick={() => {
              onCerrar()
              it.onClick()
            }}
          >
            <span className="emg-icono">{it.icono}</span>
            <span className="emg-texto">{it.etiqueta}</span>
            {it.activo && <span className="emg-check">✓</span>}
            {it.atajo && <kbd>{it.atajo}</kbd>}
          </button>
        </div>
      ))}
    </div>
  )
}
