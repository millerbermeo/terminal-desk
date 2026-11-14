import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { responderSolicitud, useSolicitudes, type Solicitud } from '../agente/solicitudes'

interface Props {
  solicitud: Solicitud
  pendientes: number // cuántas hay en cola (incluida esta)
  onResponder: (aprobado: boolean, comentario?: string, recordar?: boolean, siempre?: boolean, respuestas?: Record<string, string>) => void
}

const TITULOS = { plan: 'Aprobar el plan', confirmacion: 'Confirmar el resultado', accion: 'Confirmar una acción', pregunta: 'El asistente te pregunta' } as const

const ERRORES_SUDO = {
  incorrecta: 'Contraseña incorrecta. Inténtalo de nuevo.',
  'no-disponible': 'Tu usuario no puede usar sudo en este equipo (o sudo no respondió).',
  expirada: 'Esta solicitud ya no está activa.'
} as const

/**
 * Permisos de administrador: el asistente quiere ejecutar un comando con `sudo`. La contraseña se verifica en main
 * (`core.sudoVerificar`), solo vive en este campo mientras se escribe y nunca viaja en la decisión ni se guarda.
 */
function PanelSudo({ solicitud: s, pendientes, onResponder }: Props) {
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [estado, setEstado] = useState<'listo' | 'verificando' | 'ok'>('listo')
  const [error, setError] = useState<string | null>(null)
  const [intentos, setIntentos] = useState(0)
  const [sacudir, setSacudir] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPassword('')
    setError(null)
    setEstado('listo')
    setIntentos(0)
    campo.current?.focus()
  }, [s.solicitudId])

  const autorizar = async (): Promise<void> => {
    if (!password || estado !== 'listo') return
    setEstado('verificando')
    setError(null)
    const r = await window.api.core.sudoVerificar(s.solicitudId, password).catch(() => ({ ok: false as const, motivo: 'no-disponible' as const }))
    if (r.ok) {
      setPassword('')
      setEstado('ok')
      setTimeout(() => onResponder(true), 380)
      return
    }
    setEstado('listo')
    setIntentos((n) => n + 1)
    setError(ERRORES_SUDO[r.motivo])
    setSacudir(true)
    if (r.motivo === 'incorrecta') {
      setPassword('')
      requestAnimationFrame(() => campo.current?.focus())
    }
  }
  const denegar = (): void => {
    setPassword('')
    onResponder(false)
  }

  return createPortal(
    <div className="sudo-fondo" onMouseDown={(e) => e.target === e.currentTarget && campo.current?.focus()}>
      <form
        className={`sudo-modal${s.destructivo ? ' destructiva' : ''}${sacudir ? ' sacudir' : ''}${estado === 'ok' ? ' concedido' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sudo-titulo"
        aria-describedby="sudo-desc"
        onSubmit={(e) => {
          e.preventDefault()
          void autorizar()
        }}
        onAnimationEnd={(e) => e.animationName === 'sudo-sacudir' && setSacudir(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') denegar()
        }}
      >
        <div className="sudo-halo" aria-hidden="true" />
        <div className={`sudo-icono${estado === 'ok' ? ' ok' : ''}`} aria-hidden="true">
          {estado === 'ok' ? (
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          )}
        </div>
        <h3 id="sudo-titulo">{estado === 'ok' ? 'Permiso concedido' : 'Se requieren permisos de administrador'}</h3>
        <p id="sudo-desc" className="sudo-sub">
          {s.destino ? <><strong>{s.destino}</strong> · </> : null}El asistente quiere ejecutar este comando con <code>sudo</code>. Escribe tu contraseña del sistema para autorizarlo.
        </p>
        {pendientes > 1 && <span className="chip sudo-cola">{pendientes} pendientes</span>}
        <pre className="sudo-comando">{s.contenido}</pre>
        {s.destructivo && s.detalle && <p className="sudo-peligro">⚠ {s.detalle.replace(/^.*ACCIÓN DESTRUCTIVA: /, 'Acción destructiva: ')}</p>}
        <label className="sudo-campo">
          <span>Contraseña de {'«'}sudo{'»'}</span>
          <div className={`sudo-entrada${error ? ' con-error' : ''}`}>
            <input
              ref={campo}
              type={ver ? 'text' : 'password'}
              value={password}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={estado !== 'listo'}
              placeholder="••••••••"
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
            />
            <button type="button" className="sudo-ver" tabIndex={-1} title={ver ? 'Ocultar' : 'Mostrar'} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVer((v) => !v)}>
              {ver ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.5 8 3 10 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </label>
        <p className="sudo-error" role="alert">{error ?? ''}{error && intentos > 1 ? ` (${intentos} intentos)` : ''}</p>
        <div className="sudo-acciones">
          <button type="button" className="sudo-denegar" onClick={denegar} disabled={estado === 'ok'}>
            Denegar
          </button>
          <button type="submit" className={s.destructivo ? 'peligro-solido' : 'primario'} disabled={!password || estado !== 'listo'}>
            {estado === 'verificando' ? <><span className="sudo-giro" aria-hidden="true" /> Verificando…</> : estado === 'ok' ? 'Autorizado' : 'Autorizar'}
          </button>
        </div>
        <p className="sudo-nota">La contraseña se usa solo para este comando: no se guarda ni se envía a la IA.</p>
      </form>
    </div>,
    document.body
  )
}

/** Confirmación humana integrada en el chat: el agente espera hasta que se responde. */
export function PanelSolicitud(props: Props) {
  return props.solicitud.sudo ? <PanelSudo {...props} /> : <PanelConfirmacion {...props} />
}

function PanelConfirmacion({ solicitud: s, pendientes, onResponder }: Props) {
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
