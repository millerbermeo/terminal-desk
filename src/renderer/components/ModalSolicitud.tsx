import { useEffect, useState } from 'react'
import { responderSolicitud, useSolicitudes, type Solicitud } from '../agente/solicitudes'

interface Props {
  solicitud: Solicitud
  pendientes: number // cuántas hay en cola (incluida esta)
  onResponder: (aprobado: boolean, comentario?: string, recordar?: boolean, siempre?: boolean) => void
}

const TITULOS = { plan: 'Aprobar el plan', confirmacion: 'Confirmar el resultado', accion: 'Confirmar una acción' } as const

/** Confirmación humana: bloquea hasta que se responde (el agente espera). */
export function ModalSolicitud({ solicitud: s, pendientes, onResponder }: Props) {
  const [comentario, setComentario] = useState('')
  const [recordar, setRecordar] = useState(false)
  const [siempre, setSiempre] = useState(false)

  useEffect(() => {
    setComentario('')
    setRecordar(false)
    setSiempre(false)
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
          <span className="ag-chips">
            {s.destino && <span className="chip" title="Proyecto que lo solicita">{s.destino}</span>}
            {pendientes > 1 && <span className="chip">{pendientes} pendientes</span>}
          </span>
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
        {s.puedeSiempre && (
          <label className="ag-recordar">
            <input type="checkbox" checked={siempre} onChange={(e) => setSiempre(e.target.checked)} />
            Permitir siempre en este proyecto (guarda una regla; puedes quitarla en Permisos)
          </label>
        )}
        <div className="cfg-acciones">
          <button className={s.destructivo ? 'peligro-solido' : 'primario'} autoFocus={!s.destructivo} onClick={() => onResponder(true, comentario || undefined, recordar, siempre)}>
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

/** Modal único para todas las celdas y pantallas: atiende la primera confirmación pendiente. */
export function ModalSolicitudGlobal() {
  const solicitudes = useSolicitudes()
  const s = solicitudes[0]
  if (!s) return null
  return (
    <ModalSolicitud
      solicitud={s}
      pendientes={solicitudes.length}
      onResponder={(aprobado, comentario, recordar, siempre) =>
        responderSolicitud(s, { aprobado, ...(comentario ? { comentario } : {}), ...(recordar ? { recordar: true } : {}), ...(siempre ? { siempre: true } : {}) })
      }
    />
  )
}
