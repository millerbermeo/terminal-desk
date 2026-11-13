import { useCallback, useEffect, useState } from 'react'
import type { DatosProyectos, Grupo } from '@shared/modelos'
import { IconoBasura, IconoCerrar } from './Iconos'

interface Props {
  grupo: Grupo
  proyectos: number
  onEliminado: (d: DatosProyectos) => void
  onCerrar: () => void
}

export function ModalEliminarGrupo({ grupo, proyectos, onEliminado, onCerrar }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  const salir = useCallback((): void => {
    setCerrando(true)
    window.setTimeout(onCerrar, 200)
  }, [onCerrar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') salir()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salir])

  const confirmar = async (): Promise<void> => {
    setVerificando(true)
    setError(null)
    try {
      const datos = await window.api.proyectos.eliminarGrupo(grupo.id)
      onEliminado(datos)
      salir()
    } catch {
      setError('No se pudo eliminar el grupo')
    } finally {
      setVerificando(false)
    }
  }

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && !verificando && salir()}>
      <form
        className="modal modal-chico"
        role="alertdialog"
        aria-modal="true"
        aria-label="Eliminar grupo"
        onSubmit={(e) => {
          e.preventDefault()
          if (!verificando) void confirmar()
        }}
      >
        <div className="modal-cab">
          <h3>Eliminar grupo «{grupo.nombre}»</h3>
          <button type="button" className="icono" onClick={salir} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>
        <p className="modal-texto">
          {proyectos > 0
            ? `Sus ${proyectos} proyecto${proyectos === 1 ? '' : 's'} pasarán a «Sin grupo». `
            : 'El grupo está vacío. '}
          ¿Seguro que quieres eliminarlo?
        </p>
        {error && (
          <div className="cfg-error">
            <IconoCerrar /> {error}
          </div>
        )}
        <div className="cfg-acciones">
          <button type="submit" className="peligro-solido" disabled={verificando}>
            {verificando ? <span className="spinner" /> : <IconoBasura />} Eliminar grupo
          </button>
          <button type="button" onClick={salir} disabled={verificando}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
