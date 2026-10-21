import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Adjunto } from '@shared/core/adjuntos'

const peso = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const ICONO = { imagen: '🖼', pdf: '📄', texto: '📝' } as const

const cache = new Map<string, string>()

/** La imagen adjunta como URL de datos (se pide al proceso principal una sola vez por archivo). */
function useImagen(a: Adjunto): string | undefined {
  const [src, setSrc] = useState<string | undefined>(cache.get(a.id))
  useEffect(() => {
    if (a.tipo !== 'imagen' || cache.has(a.id)) return
    let vivo = true
    void window.api.core.adjuntoLeer(a.id).then((d) => {
      if (!d) return
      const url = `data:${d.mime};base64,${d.base64}`
      cache.set(a.id, url)
      if (vivo) setSrc(url)
    })
    return () => {
      vivo = false
    }
  }, [a.id, a.tipo])
  return src
}

/** Miniatura de una imagen adjunta; al pulsarla se ve en grande. */
function Miniatura({ a, onAbrir }: { a: Adjunto; onAbrir: () => void }) {
  const src = useImagen(a)
  return src ? (
    <button type="button" className="ag-miniatura-boton" aria-label={`Ver ${a.nombre} en grande`} title="Ver en grande" onClick={onAbrir}>
      <img className="ag-miniatura" src={src} alt={a.nombre} />
    </button>
  ) : (
    <span className="ag-icono-adjunto" aria-hidden>{ICONO[a.tipo]}</span>
  )
}

/** Imagen a tamaño grande sobre la pantalla: se cierra con ✕, Esc o pulsando fuera; «Quitar» la saca del mensaje si aún no se envió. */
function VisorImagen({ a, onCerrar, onQuitar }: { a: Adjunto; onCerrar: () => void; onQuitar?: () => void }) {
  const src = useImagen(a)
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCerrar()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [onCerrar])
  return createPortal(
    <div className="ag-visor" role="dialog" aria-modal="true" aria-label={a.nombre} onMouseDown={onCerrar}>
      <div className="ag-visor-barra" onMouseDown={(e) => e.stopPropagation()}>
        <span className="ag-visor-nombre" title={a.nombre}>{a.nombre} · {peso(a.bytes)}</span>
        {onQuitar && (
          <button className="peligro" onClick={onQuitar}>
            Quitar
          </button>
        )}
        <button autoFocus aria-label="Cerrar" title="Cerrar (Esc)" onClick={onCerrar}>
          ✕
        </button>
      </div>
      {src ? <img className="ag-visor-img" src={src} alt={a.nombre} onMouseDown={(e) => e.stopPropagation()} /> : <span className="ag-visor-nombre">Cargando…</span>}
    </div>,
    document.body
  )
}

interface Props {
  adjuntos: readonly Adjunto[]
  /** Si se indica, cada adjunto muestra una ✕ para quitarlo. */
  onQuitar?: (a: Adjunto) => void
}

/** Fila de adjuntos (en el compositor y dentro del mensaje enviado). */
export function AdjuntosAgente({ adjuntos, onQuitar }: Props) {
  const [viendo, setViendo] = useState<string | null>(null)
  if (adjuntos.length === 0) return null
  const grande = adjuntos.find((a) => a.id === viendo)
  return (
    <>
    <ul className="ag-adjuntos" aria-label="Archivos adjuntos">
      {adjuntos.map((a) => (
        <li key={a.id} className="ag-adjunto" title={`${a.nombre} · ${peso(a.bytes)}${a.paginas ? ` · ${a.paginas} páginas` : ''} · ~${a.tokens} tokens`}>
          <Miniatura a={a} onAbrir={() => setViendo(a.id)} />
          <span className="ag-adjunto-nombre">{a.nombre}</span>
          <small>{peso(a.bytes)}</small>
          {onQuitar && (
            <button className="icono" aria-label={`Quitar ${a.nombre}`} onClick={() => onQuitar(a)}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
      {grande && (
        <VisorImagen
          a={grande}
          onCerrar={() => setViendo(null)}
          {...(onQuitar ? { onQuitar: () => (setViendo(null), onQuitar(grande)) } : {})}
        />
      )}
    </>
  )
}
