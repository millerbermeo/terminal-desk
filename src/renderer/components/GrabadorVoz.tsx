import { esErrorConfiguracion, formatoTiempo } from '@shared/voz'
import type { ControlGrabadora } from '../agente/grabadora'

/** Botón 🎤 de la barra del chat: empieza a grabar o, si ya graba, termina. */
export function BotonMicrofono({ voz, desactivado }: { voz: ControlGrabadora; desactivado?: boolean }) {
  const { fase } = voz.estado
  const grabando = fase === 'grabando'
  const ocupado = fase === 'preparando' || fase === 'procesando'
  return (
    <button
      className={`ag-icono ag-mic${grabando ? ' grabando' : ''}`}
      onClick={() => (grabando ? voz.terminar() : voz.iniciar())}
      disabled={desactivado || ocupado}
      aria-pressed={grabando}
      aria-label={grabando ? 'Terminar el dictado' : 'Dictar por voz'}
      title={grabando ? 'Terminar y transcribir' : 'Dictar por voz: se graba, se transcribe a texto y queda en el campo para que lo edites (no se envía solo)'}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  )
}

/** Barra encima del campo de texto mientras se graba, se procesa o hubo un error. Sin nada de eso no pinta nada. */
export function BarraGrabacion({ voz }: { voz: ControlGrabadora }) {
  const { fase, ms, maxMs, error, nivel, sinSonido } = voz.estado
  if (fase === 'inactivo') return null
  if (fase === 'error' && error) {
    const config = esErrorConfiguracion(error.codigo)
    return (
      <div className={`ag-voz ag-voz-error${config ? ' config' : ''}`} role="alert">
        <div className="ag-voz-texto">
          <strong>{config ? 'Dictado por voz no configurado' : 'No se pudo dictar'}</strong>
          <span>{error.mensaje}</span>
        </div>
        <button onClick={voz.descartarError}>Entendido</button>
      </div>
    )
  }
  if (fase === 'preparando') {
    return (
      <div className="ag-voz" role="status">
        <span className="ag-voz-giro" aria-hidden />
        <span className="ag-voz-texto">Preparando el micrófono…</span>
        <button onClick={voz.cancelar}>Cancelar</button>
      </div>
    )
  }
  if (fase === 'procesando') {
    return (
      <div className="ag-voz" role="status">
        <span className="ag-voz-giro" aria-hidden />
        <span className="ag-voz-texto">Transcribiendo…</span>
        <button onClick={voz.cancelar}>Cancelar</button>
      </div>
    )
  }
  const queda = maxMs - ms
  return (
    <div className="ag-voz grabando" role="status" aria-live="off">
      <span className="ag-voz-punto" aria-hidden />
      <span className="ag-voz-texto">Grabando</span>
      <span className={`ag-voz-nivel${sinSonido ? ' mudo' : ''}`} role="img" aria-label={sinSonido ? 'No se detecta sonido' : 'Nivel del micrófono'} title={sinSonido ? 'No se oye nada: revisa que el micrófono correcto esté activo y habla más cerca' : 'Nivel del micrófono'}>
        {[0.04, 0.12, 0.25, 0.4, 0.6].map((u, i) => (
          <i key={i} className={nivel >= u ? 'on' : ''} />
        ))}
      </span>
      {sinSonido && <span className="ag-voz-aviso">No se detecta sonido: revisa el micrófono</span>}
      <span className={`ag-voz-tiempo${queda < 15_000 ? ' aviso' : ''}`} aria-label={`Grabado ${formatoTiempo(ms)} de ${formatoTiempo(maxMs)}`}>
        {formatoTiempo(ms)} / {formatoTiempo(maxMs)}
      </span>
      <div className="ag-voz-progreso" aria-hidden>
        <i style={{ width: `${Math.min(100, (ms / maxMs) * 100)}%` }} />
      </div>
      <button onClick={voz.cancelar}>Cancelar</button>
      <button className="primario" onClick={voz.terminar}>
        Terminar
      </button>
    </div>
  )
}
