import { useEffect, useState } from 'react'
import { ComandosAgente } from './ComandosAgente'
import { PermisosAgente } from './PermisosAgente'

interface Props {
  proyectoId?: string
  nombre?: string
  inicial: 'permisos' | 'comandos'
  onCerrar: () => void
}

/** Ventana con los permisos y los comandos `/` de un proyecto (se abre con /permisos y /comandos). */
export function GestionProyecto({ proyectoId, nombre, inicial, onCerrar }: Props) {
  const [pestana, setPestana] = useState(inicial)
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal gestion" role="dialog" aria-modal="true" aria-label="Permisos y comandos">
        <div className="modal-cab">
          <h3>{nombre ?? 'Todos los proyectos'}</h3>
          <button className="icono" onClick={onCerrar} title="Cerrar (Esc)">✕</button>
        </div>
        <div className="segmentado" role="tablist" style={{ alignSelf: 'flex-start' }}>
          <button className={pestana === 'permisos' ? 'on' : ''} onClick={() => setPestana('permisos')}>Permisos</button>
          <button className={pestana === 'comandos' ? 'on' : ''} onClick={() => setPestana('comandos')}>Comandos /</button>
        </div>
        <div className="gestion-cuerpo">
          {pestana === 'permisos' ? <PermisosAgente {...(proyectoId ? { proyectoId } : {})} /> : <ComandosAgente {...(proyectoId ? { proyectoId } : {})} />}
        </div>
      </div>
    </div>
  )
}
