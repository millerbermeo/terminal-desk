import { useEffect, useRef, useState } from 'react'
import type { EstadoZoom } from '@shared/zoom'

const VISIBLE_MS = 2200

/** Porcentaje de zoom en una esquina mientras se usa Ctrl + / Ctrl − / Ctrl 0; se esconde solo a los pocos segundos. */
export function IndicadorZoom() {
  const [zoom, setZoom] = useState<EstadoZoom | null>(null)
  const temporizador = useRef<number | undefined>(undefined)

  useEffect(() => {
    const baja = window.api.zoom.onCambio((e) => {
      setZoom(e)
      window.clearTimeout(temporizador.current)
      temporizador.current = window.setTimeout(() => setZoom(null), VISIBLE_MS)
    })
    return () => {
      baja()
      window.clearTimeout(temporizador.current)
    }
  }, [])

  if (!zoom) return null
  return (
    // `zoom` en CSS compensa el de la ventana: el indicador mantiene siempre el mismo tamaño en pantalla.
    <div className="zoom-indicador" role="status" aria-live="polite" style={{ zoom: 100 / zoom.porcentaje }}>
      <span className="zoom-lupa" aria-hidden="true">🔍</span>
      <strong>{zoom.porcentaje}%</strong>
      {zoom.porcentaje === 100 && <small>tamaño original</small>}
    </div>
  )
}
