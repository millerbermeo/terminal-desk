import { useCallback, useEffect, useState } from 'react'
import { IconoAlerta, IconoBasura, IconoCheck, IconoInfo } from './Iconos'

/** peligro: acción destructiva (rojo) · aviso: acción importante o con consecuencias (ámbar) · info: conviene saberlo (acento). */
export type TonoConfirmacion = 'peligro' | 'aviso' | 'info'

export interface OpcionesConfirmar {
  titulo: string
  /** Párrafos separados por línea en blanco. */
  texto: string
  etiqueta: string
  tono?: TonoConfirmacion
  /** Texto del botón de cancelar. */
  cancelar?: string
}

interface Props extends OpcionesConfirmar {
  onConfirmar: () => void
  onCerrar: () => void
}

const ICONOS = { peligro: <IconoBasura />, aviso: <IconoAlerta />, info: <IconoInfo /> }

export function ModalConfirmar({ titulo, texto, etiqueta, tono = 'peligro', cancelar = 'Cancelar', onConfirmar, onCerrar }: Props) {
  const [cerrando, setCerrando] = useState(false)

  const salir = useCallback((despues: () => void): void => {
    setCerrando(true)
    window.setTimeout(despues, 200)
  }, [])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') salir(onCerrar)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salir, onCerrar])

  const parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && salir(onCerrar)}>
      <div className={`modal modal-chico confirmar ${tono}`} role="alertdialog" aria-modal="true" aria-label={titulo}>
        <div className="confirmar-cuerpo">
          <span className="confirmar-icono" aria-hidden="true">
            {ICONOS[tono]}
          </span>
          <div className="confirmar-texto">
            <h3>{titulo}</h3>
            {parrafos.map((p, i) => (
              <p className="modal-texto" key={i}>
                {p}
              </p>
            ))}
          </div>
        </div>
        <div className="confirmar-acciones">
          <button onClick={() => salir(onCerrar)} autoFocus={tono === 'peligro'}>
            {cancelar}
          </button>
          <button
            className={tono === 'peligro' ? 'peligro-solido' : 'primario'}
            autoFocus={tono !== 'peligro'}
            onClick={() => {
              onConfirmar()
              salir(onCerrar)
            }}
          >
            {tono === 'peligro' ? <IconoBasura /> : <IconoCheck />} {etiqueta}
          </button>
        </div>
      </div>
    </div>
  )
}
