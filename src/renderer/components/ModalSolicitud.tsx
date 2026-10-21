import { useEffect, useState } from 'react'
import { responderSolicitud, useSolicitudes, type Solicitud } from '../agente/solicitudes'

interface Props {
  solicitud: Solicitud
  pendientes: number // cuántas hay en cola (incluida esta)
  onResponder: (aprobado: boolean, comentario?: string, recordar?: boolean, siempre?: boolean, respuestas?: Record<string, string>) => void
}

const TITULOS = { plan: 'Aprobar el plan', confirmacion: 'Confirmar el resultado', accion: 'Confirmar una acción', pregunta: 'El asistente te pregunta' } as const

/** Confirmación humana integrada en el chat: el agente espera hasta que se responde. */
export function PanelSolicitud({ solicitud: s, pendientes, onResponder }: Props) {
  const [comentario, setComentario] = useState('')
  const [recordar, setRecordar] = useState(false)
  const [siempre, setSiempre] = useState(false)

  // Clase `pregunta`: por pregunta, las opciones marcadas y el texto libre («Otra»).
  const [elegidas, setElegidas] = useState<Record<string, string[]>>({})
  const [libres, setLibres] = useState<Record<string, string>>({})
  const respuestas = Object.fromEntries(
    (s.preguntas ?? []).map((q) => [q.pregunta, [...(elegidas[q.pregunta] ?? []), ...(libres[q.pregunta]?.trim() ? [libres[q.pregunta]!.trim()] : [])].join(', ')])
  )
  const completa = (s.preguntas ?? []).every((q) => respuestas[q.pregunta])
  const marcar = (pregunta: string, etiqueta: string, multiple: boolean): void =>
    setElegidas((m) => {
      const actual = m[pregunta] ?? []
      if (!multiple) return { ...m, [pregunta]: [etiqueta] }
      return { ...m, [pregunta]: actual.includes(etiqueta) ? actual.filter((x) => x !== etiqueta) : [...actual, etiqueta] }
    })

  useEffect(() => {
    setElegidas({})
    setLibres({})
    setComentario('')
    setRecordar(false)
    setSiempre(false)
  }, [s.solicitudId])

  return (
    <div className="ag-solicitud-fondo">
      <div
        className={`ag-solicitud${s.destructivo ? ' destructiva' : ''}`}
        role="alertdialog"
        aria-label={TITULOS[s.clase]}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onResponder(false, comentario || undefined)
        }}
      >
        <div className="ag-solicitud-cab">
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
        {s.clase === 'pregunta' ? (
          (s.preguntas ?? []).map((q) => (
            <fieldset key={q.pregunta} className="ag-pregunta">
              <legend>
                {q.encabezado && <span className="chip">{q.encabezado}</span>} {q.pregunta}
              </legend>
              {q.opciones.map((o) => (
                <label key={o.etiqueta} className="ag-recordar" title={o.descripcion}>
                  <input
                    type={q.multiple ? 'checkbox' : 'radio'}
                    name={q.pregunta}
                    checked={(elegidas[q.pregunta] ?? []).includes(o.etiqueta)}
                    onChange={() => {
                      marcar(q.pregunta, o.etiqueta, q.multiple === true)
                      if (!q.multiple) setLibres((m) => ({ ...m, [q.pregunta]: '' }))
                    }}
                  />
                  <strong>{o.etiqueta}</strong>
                  {o.descripcion && <span> — {o.descripcion}</span>}
                </label>
              ))}
              <input
                type="text"
                className="ag-comentario"
                placeholder="Otra respuesta…"
                value={libres[q.pregunta] ?? ''}
                onChange={(e) => {
                  setLibres((m) => ({ ...m, [q.pregunta]: e.target.value }))
                  if (!q.multiple && e.target.value) setElegidas((m) => ({ ...m, [q.pregunta]: [] }))
                }}
              />
            </fieldset>
          ))
        ) : (
          <pre className="ag-contenido">{s.contenido || '(vacío)'}</pre>
        )}
        {s.clase !== 'pregunta' && <textarea
          className="ag-comentario"
          rows={2}
          placeholder={s.clase === 'accion' ? 'Comentario para el agente (opcional)' : 'Si lo rechazas, explica qué cambiar (se lo pasa al agente)'}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />}
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
          <button
            className={s.destructivo ? 'peligro-solido' : 'primario'}
            autoFocus={!s.destructivo && s.clase !== 'pregunta'}
            disabled={s.clase === 'pregunta' && !completa}
            onClick={() => (s.clase === 'pregunta' ? onResponder(true, undefined, false, false, respuestas) : onResponder(true, comentario || undefined, recordar, siempre))}
          >
            {s.clase === 'pregunta' ? 'Responder' : s.clase === 'plan' ? 'Aprobar plan' : s.clase === 'confirmacion' ? 'Aceptar resultado' : s.destructivo ? 'Permitir (destructiva)' : 'Permitir'}
          </button>
          <button autoFocus={s.destructivo} onClick={() => onResponder(false, comentario || undefined)}>
            Rechazar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Atiende, dentro del chat, la primera confirmación pendiente de las ejecuciones de ese chat. */
export function SolicitudesChat({ ejecuciones }: { ejecuciones: (string | undefined)[] }) {
  const propias = useSolicitudes().filter((x) => ejecuciones.includes(x.ejecucionId))
  const s = propias[0]
  if (!s) return null
  return (
    <PanelSolicitud
      solicitud={s}
      pendientes={propias.length}
      onResponder={(aprobado, comentario, recordar, siempre, respuestas) =>
        responderSolicitud(s, { aprobado, ...(comentario ? { comentario } : {}), ...(recordar ? { recordar: true } : {}), ...(siempre ? { siempre: true } : {}), ...(respuestas ? { respuestas } : {}) })
      }
    />
  )
}
