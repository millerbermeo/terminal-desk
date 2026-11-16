import { useEffect, useRef } from 'react'
import { duracionCorta } from '@shared/chat'
import { Avatar, colorDe } from './Avatar'
import { IColgar, IMic, IMicNo, ITelefono, IVideo, IVideoNo } from './Iconos'
import { controlLlamada, useLlamada } from './llamadas'

function Flujo({ stream, silenciar, className }: { stream?: MediaStream; silenciar?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null
  }, [stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={silenciar} />
}

/** Botón redondo con su etiqueta debajo (como en la app Teléfono). */
function Control({ etiqueta, clase = '', activo, onClick, disabled, autoFocus, children }: { etiqueta: string; clase?: string; activo?: boolean; onClick: () => void; disabled?: boolean; autoFocus?: boolean; children: React.ReactNode }) {
  return (
    <div className="ch-control">
      <button className={`${clase}${activo ? ' activo' : ''}`} onClick={onClick} disabled={disabled} aria-label={etiqueta} aria-pressed={activo} autoFocus={autoFocus}>
        {children}
      </button>
      <span aria-hidden>{etiqueta}</span>
    </div>
  )
}

/** Pantalla de llamada: entrante (contestar/rechazar), saliente y en curso. Se muestra sobre toda la app, esté o no abierto el chat. */
export function Llamada() {
  const l = useLlamada()
  if (l.fase === 'inactiva' || !l.con) return null
  const { con } = l
  const conVideoRemoto = l.video && !!l.remoto
  const sonando = l.fase === 'entrante' || l.fase === 'llamando'
  const estado =
    l.fase === 'entrante' ? (l.video ? 'Videollamada entrante…' : 'Llamada entrante…') :
    l.fase === 'preparando' ? 'Preparando…' :
    l.fase === 'llamando' ? 'Llamando…' :
    l.fase === 'conectando' ? 'Conectando…' :
    l.fase === 'en-curso' ? duracionCorta(l.segundos) :
    l.mensaje

  return (
    <div
      className={`ch-llamada${conVideoRemoto ? ' con-video' : ''} fase-${l.fase}`}
      style={{ ['--color-llamada' as string]: colorDe(con.id) }}
      role="dialog"
      aria-modal="true"
      aria-label={`Llamada con ${con.nombre}`}
    >
      {/* El audio remoto siempre suena, haya o no imagen. */}
      <Flujo stream={l.remoto} className={conVideoRemoto ? 'ch-llamada-remoto' : 'ch-llamada-oculto'} />
      {!conVideoRemoto && (
        <div className="ch-llamada-centro">
          <span className="ch-llamada-tipo">
            {l.video ? <IVideo tam={14} /> : <ITelefono tam={14} />} {l.video ? 'Videollamada de Odesk' : 'Llamada de voz de Odesk'}
          </span>
          <div className={`ch-llamada-avatar${sonando ? ' sonando' : ''}`}>
            <i aria-hidden />
            <i aria-hidden />
            <Avatar usuario={con} tam={112} />
          </div>
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
            <Control etiqueta="Rechazar" clase="ch-btn-rojo" onClick={() => controlLlamada.rechazar()}>
              <IColgar tam={28} />
            </Control>
            <Control etiqueta="Contestar" clase="ch-btn-verde" onClick={() => void controlLlamada.contestar()} autoFocus>
              {l.video ? <IVideo tam={26} /> : <ITelefono tam={26} />}
            </Control>
          </>
        ) : l.fase === 'terminada' ? null : (
          <>
            <Control etiqueta={l.silenciado ? 'Activar micro' : 'Silenciar'} activo={l.silenciado} onClick={() => controlLlamada.alternarSilencio()} disabled={!l.local}>
              {l.silenciado ? <IMicNo tam={24} /> : <IMic tam={24} />}
            </Control>
            {l.video && (
              <Control etiqueta={l.sinCamara ? 'Encender cámara' : 'Cámara'} activo={l.sinCamara} onClick={() => controlLlamada.alternarCamara()} disabled={!l.local}>
                {l.sinCamara ? <IVideoNo tam={24} /> : <IVideo tam={24} />}
              </Control>
            )}
            <Control etiqueta="Colgar" clase="ch-btn-rojo" onClick={() => controlLlamada.colgar()}>
              <IColgar tam={28} />
            </Control>
          </>
        )}
      </div>
    </div>
  )
}
