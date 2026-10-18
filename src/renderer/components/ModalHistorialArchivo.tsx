import { useEffect } from 'react'
import { HistorialArchivo } from './HistorialArchivo'

interface Props {
  proyectoId: string
  ruta: string
  onCerrar: () => void
  /** Se restauró algo: el editor vuelve a leer el archivo. */
  onCambio?: () => void
}

/** El historial de un archivo en una ventana, abierta desde el editor. */
export function ModalHistorialArchivo({ proyectoId, ruta, onCerrar, onCambio }: Props) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal modal-historial" role="dialog" aria-modal="true" aria-label={`Historial de ${ruta}`}>
        <div className="modal-cab">
          <h3>
            Historial · <span className="mono">{ruta}</span>
          </h3>
          <button className="icono" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <HistorialArchivo proyectoId={proyectoId} ruta={ruta} onCambio={onCambio} />
      </div>
    </div>
  )
}
