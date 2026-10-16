import { useCallback, useEffect, useState } from 'react'
import { IconoBasura, IconoCerrar } from './Iconos'

interface Props {
  titulo: string
  texto: string
  etiqueta: string
  onConfirmar: () => void
  onCerrar: () => void
}

export function ModalConfirmar({ titulo, texto, etiqueta, onConfirmar, onCerrar }: Props) {
  const [cerrando, setCerrando] = useState(false)

  const salir = useCallback(
    (despues: () => void): void => {
      setCerrando(true)
      window.setTimeout(despues, 200)
    },
    []
  )

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') salir(onCerrar)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salir, onCerrar])

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && salir(onCerrar)}>
      <div className="modal modal-chico" role="alertdialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab">
          <h3>{titulo}</h3>
          <button className="icono" onClick={() => salir(onCerrar)} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>
        <p className="modal-texto">{texto}</p>
        <div className="cfg-acciones">
          <button
            className="peligro-solido"
            autoFocus
            onClick={() => {
              onConfirmar()
              salir(onCerrar)
            }}
          >
            <IconoBasura /> {etiqueta}
          </button>
          <button onClick={() => salir(onCerrar)}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
