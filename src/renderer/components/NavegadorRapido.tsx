import { useEffect, useMemo, useRef, useState } from 'react'

export interface ItemRapido {
  clave: string
  titulo: string
  /** Pestaña / grupo o carpeta a la que pertenece. */
  detalle: string
  tipo: 'terminal' | 'asistente' | 'archivos' | 'servicio' | 'proyecto'
  /** Atajo directo (p. ej. «Alt + 2») si lo tiene. */
  atajo?: string
  activa?: boolean
  ir: () => void
}

const ETIQUETA: Record<ItemRapido['tipo'], string> = { terminal: 'Terminal', asistente: 'Asistente', archivos: 'Archivos', servicio: 'Servicio', proyecto: 'Abrir proyecto' }

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Todas las palabras de la búsqueda tienen que aparecer (en cualquier orden) en el título, el detalle o el tipo. */
export function filtrarRapido(items: ItemRapido[], consulta: string): ItemRapido[] {
  const palabras = norm(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return items
  return items.filter((i) => {
    const t = norm(`${i.titulo} ${i.detalle} ${ETIQUETA[i.tipo]}`)
    return palabras.every((p) => t.includes(p))
  })
}

/** Navegador rápido (Ctrl+Mayús+P): salta a cualquier terminal, asistente o archivos abiertos, o abre un proyecto, escribiendo unas letras. */
export function NavegadorRapido({ items, onCerrar }: { items: ItemRapido[]; onCerrar: () => void }) {
  const [consulta, setConsulta] = useState('')
  const [sel, setSel] = useState(0)
  const lista = useRef<HTMLDivElement>(null)
  const visibles = useMemo(() => filtrarRapido(items, consulta), [items, consulta])
  const marcado = Math.min(sel, Math.max(0, visibles.length - 1))

  useEffect(() => {
    lista.current?.querySelector('.nr-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [marcado, visibles])

  const elegir = (i: ItemRapido | undefined): void => {
    if (!i) return
    onCerrar()
    i.ir()
  }
  return (
    <div className="modal-fondo nr-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        className="modal nr"
        role="dialog"
        aria-modal="true"
        aria-label="Navegador rápido"
        onKeyDown={(e) => {
          if (e.key === 'Escape') return (e.preventDefault(), onCerrar())
          if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) return (e.preventDefault(), setSel((marcado + 1) % Math.max(1, visibles.length)))
          if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) return (e.preventDefault(), setSel((marcado + visibles.length - 1) % Math.max(1, visibles.length)))
          if (e.key === 'Enter') return (e.preventDefault(), elegir(visibles[marcado]))
        }}
      >
        <input
          autoFocus
          className="nr-campo"
          value={consulta}
          placeholder="Ir a una terminal, asistente o proyecto…"
          aria-label="Buscar terminal, asistente o proyecto"
          onChange={(e) => (setConsulta(e.target.value), setSel(0))}
        />
        <div className="nr-lista" ref={lista} role="listbox">
          {visibles.length === 0 && <p className="nr-vacio">Nada coincide con «{consulta}».</p>}
          {visibles.map((i, n) => (
            <div key={i.clave} role="option" aria-selected={n === marcado} className={`nr-item${n === marcado ? ' sel' : ''}`} onMouseMove={() => setSel(n)} onClick={() => elegir(i)}>
              <span className={`nr-tipo nr-${i.tipo}`}>{ETIQUETA[i.tipo]}</span>
              <span className="nr-titulo">
                {i.titulo}
                {i.activa && <small> · activa</small>}
              </span>
              <span className="nr-detalle">{i.detalle}</span>
              {i.atajo && <kbd>{i.atajo}</kbd>}
            </div>
          ))}
        </div>
        <div className="nr-pie">
          <span><kbd>↑</kbd> <kbd>↓</kbd> moverse</span>
          <span><kbd>Enter</kbd> ir</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  )
}
