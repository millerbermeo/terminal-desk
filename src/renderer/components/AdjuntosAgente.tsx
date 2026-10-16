import { useEffect, useState } from 'react'
import type { Adjunto } from '@shared/core/adjuntos'

const peso = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const ICONO = { imagen: '🖼', pdf: '📄', texto: '📝' } as const

const cache = new Map<string, string>()

/** Miniatura de una imagen adjunta (se pide al proceso principal una sola vez por archivo). */
function Miniatura({ a }: { a: Adjunto }) {
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
  return src ? <img className="ag-miniatura" src={src} alt={a.nombre} /> : <span className="ag-icono-adjunto" aria-hidden>{ICONO[a.tipo]}</span>
}

interface Props {
  adjuntos: readonly Adjunto[]
  /** Si se indica, cada adjunto muestra una ✕ para quitarlo. */
  onQuitar?: (a: Adjunto) => void
}

/** Fila de adjuntos (en el compositor y dentro del mensaje enviado). */
export function AdjuntosAgente({ adjuntos, onQuitar }: Props) {
  if (adjuntos.length === 0) return null
  return (
    <ul className="ag-adjuntos" aria-label="Archivos adjuntos">
      {adjuntos.map((a) => (
        <li key={a.id} className="ag-adjunto" title={`${a.nombre} · ${peso(a.bytes)}${a.paginas ? ` · ${a.paginas} páginas` : ''} · ~${a.tokens} tokens`}>
          <Miniatura a={a} />
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
  )
}
