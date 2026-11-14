import { useEffect } from 'react'
import { IconoCerrar } from '../Iconos'

export const ATAJOS: { teclas: string; accion: string }[] = [
  { teclas: 'C', accion: 'Crear una tarea' },
  { teclas: '/', accion: 'Buscar' },
  { teclas: 'J / ↓', accion: 'Tarea siguiente' },
  { teclas: 'K / ↑', accion: 'Tarea anterior' },
  { teclas: 'Enter', accion: 'Abrir la tarea marcada' },
  { teclas: 'Espacio', accion: 'Seleccionar / deseleccionar' },
  { teclas: 'E', accion: 'Cambiar el estado de la tarea marcada' },
  { teclas: '1 – 4', accion: 'Prioridad: baja, media, alta, urgente' },
  { teclas: 'D', accion: 'Duplicar la tarea marcada' },
  { teclas: 'Supr', accion: 'Eliminar las tareas marcadas o seleccionadas' },
  { teclas: 'Ctrl/⌘ + clic', accion: 'Añadir a la selección' },
  { teclas: 'Mayús + clic', accion: 'Seleccionar un rango' },
  { teclas: 'Ctrl/⌘ + Z', accion: 'Deshacer el último cambio' },
  { teclas: 'Esc', accion: 'Cerrar paneles y quitar la selección' },
  { teclas: '?', accion: 'Mostrar esta ayuda' }
]

export function AyudaAtajos({ onCerrar }: { onCerrar: () => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCerrar()
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [onCerrar])
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Atajos de teclado">
        <div className="modal-cab">
          <h3>Atajos de teclado</h3>
          <button className="icono" onClick={onCerrar} aria-label="Cerrar">
            <IconoCerrar />
          </button>
        </div>
        <dl className="atajos">
          {ATAJOS.map((a) => (
            <div key={a.teclas}>
              <dt>
                <kbd>{a.teclas}</kbd>
              </dt>
              <dd>{a.accion}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
