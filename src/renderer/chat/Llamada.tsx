import { useEffect, useRef } from 'react'
import { duracionCorta } from '@shared/chat'
import { Avatar } from './Avatar'
import { controlLlamada, useLlamada } from './llamadas'

function Flujo({ stream, silenciar, className }: { stream?: MediaStream; silenciar?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null
  }, [stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={silenciar} />
}

/** Pantalla de llamada: entrante (contestar/rechazar), saliente y en curso. Se muestra sobre toda la app, esté o no abierto el chat. */
export function Llamada() {
  const l = useLlamada()
  if (l.fase === 'inactiva' || !l.con) return null
  const { con } = l
  const conVideoRemoto = l.video && !!l.remoto
  const estado =
    l.fase === 'entrante' ? (l.video ? 'Videollamada entrante…' : 'Llamada entrante…') :
    l.fase === 'preparando' ? 'Preparando…' :
    l.fase === 'llamando' ? 'Llamando…' :
    l.fase === 'conectando' ? 'Conectando…' :
    l.fase === 'en-curso' ? duracionCorta(l.segundos) :
    l.mensaje

  return (
    <div className={`ch-llamada${conVideoRemoto ? ' con-video' : ''}`} role="dialog" aria-modal="true" aria-label={`Llamada con ${con.nombre}`}>
      {/* El audio remoto siempre suena, haya o no imagen. */}
      <Flujo stream={l.remoto} className={conVideoRemoto ? 'ch-llamada-remoto' : 'ch-llamada-oculto'} />
      {!conVideoRemoto && (
        <div className="ch-llamada-centro">
          <Avatar usuario={con} tam={96} />
          <h2>{con.nombre}</h2>
          <p aria-live="polite">{estado}</p>
        </div>
      )}
      {conVideoRemoto && (
        <div className="ch-llamada-info">
          <strong>{con.nombre}</strong>
          <span aria-live="polite">{estado}</span>
        </div>
      )}
      {l.video && l.local && !l.sinCamara && <Flujo stream={l.local} silenciar className="ch-llamada-local" />}

      <div className="ch-llamada-botones">
        {l.fase === 'entrante' ? (
          <>
            <button className="ch-btn-rojo" onClick={() => controlLlamada.rechazar()} aria-label="Rechazar llamada">
              ✕
            </button>
            <button className="ch-btn-verde" onClick={() => void controlLlamada.contestar()} aria-label="Contestar llamada" autoFocus>
              {l.video ? '🎥' : '📞'}
            </button>
          </>
        ) : l.fase === 'terminada' ? null : (
          <>
            <button className={`ch-btn${l.silenciado ? ' activo' : ''}`} onClick={() => controlLlamada.alternarSilencio()} aria-pressed={l.silenciado} aria-label={l.silenciado ? 'Activar micrófono' : 'Silenciar micrófono'} disabled={!l.local}>
              {l.silenciado ? '🔇' : '🎙'}
            </button>
            {l.video && (
              <button className={`ch-btn${l.sinCamara ? ' activo' : ''}`} onClick={() => controlLlamada.alternarCamara()} aria-pressed={l.sinCamara} aria-label={l.sinCamara ? 'Encender cámara' : 'Apagar cámara'} disabled={!l.local}>
                {l.sinCamara ? '🚫' : '📷'}
              </button>
            )}
            <button className="ch-btn-rojo" onClick={() => controlLlamada.colgar()} aria-label="Colgar">
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}
