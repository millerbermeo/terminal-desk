import { useEffect, useState } from 'react'
import type { Solicitud } from '../agente/useAgente'

interface Props {
  solicitud: Solicitud
  pendientes: number // cuántas hay en cola (incluida esta)
  onResponder: (aprobado: boolean, comentario?: string, recordar?: boolean) => void
}

const TITULOS = { plan: 'Aprobar el plan', confirmacion: 'Confirmar el resultado', accion: 'Confirmar una acción' } as const

/** Confirmación humana: bloquea hasta que se responde (el agente espera). */
export function ModalSolicitud({ solicitud: s, pendientes, onResponder }: Props) {
  const [comentario, setComentario] = useState('')
  const [recordar, setRecordar] = useState(false)

  useEffect(() => {
    setComentario('')
    setRecordar(false)
  }, [s.solicitudId])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onResponder(false, comentario || undefined)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onResponder, comentario])

  return (
    <div className="modal-fondo" role="presentation">
      <div className={`modal ag-solicitud${s.destructivo ? ' destructiva' : ''}`} role="alertdialog" aria-modal="true" aria-label={TITULOS[s.clase]}>
        <div className="modal-cab">
          <h3>
            {s.destructivo ? '⚠ ' : ''}
            {TITULOS[s.clase]}
          </h3>
          {pendientes > 1 && <span className="chip">{pendientes} pendientes</span>}
        </div>
        {s.detalle && <p className={`ag-detalle${s.destructivo ? ' peligro' : ''}`}>{s.detalle}</p>}
        <pre className="ag-contenido">{s.contenido || '(vacío)'}</pre>
        <textarea
          className="ag-comentario"
          rows={2}
          placeholder={s.clase === 'accion' ? 'Comentario para el agente (opcional)' : 'Si lo rechazas, explica qué cambiar (se lo pasa al agente)'}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
        {s.clase === 'accion' && !s.destructivo && (
          <label className="ag-recordar">
            <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
            No volver a preguntar por «{s.herramienta}» en esta ejecución
          </label>
        )}
        <div className="cfg-acciones">
          <button className={s.destructivo ? 'peligro-solido' : 'primario'} autoFocus={!s.destructivo} onClick={() => onResponder(true, comentario || undefined, recordar)}>
            {s.clase === 'plan' ? 'Aprobar plan' : s.clase === 'confirmacion' ? 'Aceptar resultado' : s.destructivo ? 'Permitir (destructiva)' : 'Permitir'}
          </button>
          <button autoFocus={s.destructivo} onClick={() => onResponder(false, comentario || undefined)}>
            Rechazar
          </button>
        </div>
      </div>
    </div>
  )
}
