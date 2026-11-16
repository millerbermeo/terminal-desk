import { useEffect, useRef, useState } from 'react'
import { duracionCorta } from '@shared/chat'
import { Avatar, colorDe } from './Avatar'
import { ElegirPantalla } from './ElegirPantalla'
import { ICarpeta, ICerrar, IColgar, IDetener, IGrabar, IMic, IMicNo, IOjo, IOjoNo, IPantalla, IPantallaNo, ITelefono, IVideo, IVideoNo } from './Iconos'
import { controlLlamada, useLlamada } from './llamadas'

function Flujo({ stream, silenciar, className }: { stream?: MediaStream; silenciar?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null
  }, [stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={silenciar} />
}

/** Botón redondo con su etiqueta debajo (como en la app Teléfono). */
function Control({ etiqueta, clase = '', activo, onClick, disabled, autoFocus, titulo, children }: { etiqueta: string; clase?: string; activo?: boolean; onClick: () => void; disabled?: boolean; autoFocus?: boolean; titulo?: string; children: React.ReactNode }) {
  return (
    <div className="ch-control">
      <button className={`${clase}${activo ? ' activo' : ''}`} onClick={onClick} disabled={disabled} aria-label={etiqueta} aria-pressed={activo} autoFocus={autoFocus} title={titulo ?? etiqueta}>
        {children}
      </button>
      <span aria-hidden>{etiqueta}</span>
    </div>
  )
}

/** «Grabación guardada» con «Mostrar en carpeta»; sigue visible un rato después de colgar. */
function AvisoGrabacion({ nombre, enLlamada }: { nombre: string; enLlamada: boolean }) {
  useEffect(() => {
    const t = window.setTimeout(() => controlLlamada.cerrarAvisoGrabacion(), 20_000)
    return () => window.clearTimeout(t)
  }, [nombre])
  return (
    <div className={`ch-grabacion-guardada${enLlamada ? ' en-llamada' : ''}`} role="status">
      <span className="ch-grabacion-guardada-icono" aria-hidden>
        <IGrabar tam={16} />
      </span>
      <div>
        <strong>Grabación guardada</strong>
        <span title={nombre}>{nombre}</span>
      </div>
      <button onClick={() => controlLlamada.mostrarGrabacion()}>
        <ICarpeta tam={15} /> Mostrar en carpeta
      </button>
      <button className="ch-grabacion-cerrar" onClick={() => controlLlamada.cerrarAvisoGrabacion()} aria-label="Cerrar">
        <ICerrar tam={14} />
      </button>
    </div>
  )
}

/** Pantalla de llamada: entrante (contestar/rechazar), saliente y en curso. Se muestra sobre toda la app, esté o no abierto el chat. */
export function Llamada() {
  const l = useLlamada()
  const [eligiendo, setEligiendo] = useState(false)
  const enCurso = l.fase === 'en-curso'
  useEffect(() => {
    if (!enCurso) setEligiendo(false)
  }, [enCurso])

  const sinLlamada = l.fase === 'inactiva' || !l.con
  const guardada = l.grabacionGuardada ? <AvisoGrabacion nombre={l.grabacionGuardada.nombre} enLlamada={!sinLlamada} /> : null
  if (sinLlamada || !l.con) return guardada
  const { con } = l
  // Solo se muestra la imagen del otro si la manda: sin cámara (o apagada) se ve su avatar y el audio sigue sonando igual.
  const camaraRemota = !!l.remoto && l.camaraRemota && l.remoto.getVideoTracks().length > 0
  const pantallaRemota = l.pantallaRemotaActiva && !!l.pantallaRemota
  const conVideoRemoto = pantallaRemota || (l.video && camaraRemota)
  const miCamara = l.video && !l.sinCamara && !!l.local?.getVideoTracks().some((t) => t.readyState === 'live')
  const sonando = l.fase === 'entrante' || l.fase === 'llamando'
  const estado =
    l.fase === 'entrante' ? (l.video ? 'Videollamada entrante…' : 'Llamada entrante…') :
    l.fase === 'preparando' ? 'Preparando…' :
    l.fase === 'llamando' ? 'Llamando…' :
    l.fase === 'conectando' ? 'Conectando…' :
    enCurso ? duracionCorta(l.segundos) :
    l.mensaje

  return (
    <>
      <div
        className={`ch-llamada${conVideoRemoto ? ' con-video' : ''}${pantallaRemota ? ' con-pantalla' : ''} fase-${l.fase}`}
        style={{ ['--color-llamada' as string]: colorDe(con.id) }}
        role="dialog"
        aria-modal="true"
        aria-label={`Llamada con ${con.nombre}`}
      >
        {/* El audio del otro suena siempre por aquí; las imágenes visibles van silenciadas. */}
        <Flujo stream={l.remoto} className="ch-llamada-oculto" />
        {pantallaRemota ? (
          <Flujo stream={l.pantallaRemota} silenciar className="ch-llamada-remoto ch-llamada-pantalla" />
        ) : (
          l.video && camaraRemota && <Flujo stream={l.remoto} silenciar className="ch-llamada-remoto" />
        )}

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
            {l.video && enCurso && !l.camaraRemota && (
              <span className="ch-llamada-etiqueta">
                <IVideoNo tam={13} /> {con.nombre} tiene la cámara apagada
              </span>
            )}
          </div>
        )}

        <div className="ch-llamada-arriba">
          {conVideoRemoto && (
            <div className="ch-llamada-info">
              <strong>{pantallaRemota ? `Pantalla de ${con.nombre}` : con.nombre}</strong>
              <span aria-live="polite">{estado}</span>
            </div>
          )}
          {l.grabando && (
            <span className="ch-llamada-rec" role="status">
              <i aria-hidden /> Grabando · {duracionCorta(l.grabacionSegundos)}
            </span>
          )}
          {l.grabandoRemoto && (
            <span className="ch-llamada-rec remoto" role="status">
              <i aria-hidden /> {con.nombre} está grabando la llamada
            </span>
          )}
        </div>

        <div className="ch-llamada-avisos">
          {l.compartiendo && (
            <div className="ch-llamada-presentando" role="status">
              <IPantalla tam={16} /> Estás compartiendo tu pantalla
              <button onClick={() => void controlLlamada.dejarDeCompartir()}>Dejar de compartir</button>
            </div>
          )}
          {(l.aviso || l.avisoCamara) && (
            <div className="ch-llamada-aviso" role="status">
              {l.aviso ? <IPantalla tam={15} /> : <IVideoNo tam={15} />} {l.aviso ?? l.avisoCamara}
            </div>
          )}
        </div>

        <div className="ch-llamada-lateral">
          {pantallaRemota && camaraRemota && (
            <div className="ch-llamada-mosaico">
              <Flujo stream={l.remoto} silenciar className="ch-llamada-local sin-espejo" />
              <span>{con.nombre}</span>
            </div>
          )}
          {l.compartiendo && l.pantallaLocal && (
            <div className="ch-llamada-mosaico pantalla">
              <Flujo stream={l.pantallaLocal} silenciar className="ch-llamada-local sin-espejo" />
              <span>Tu pantalla</span>
            </div>
          )}
          {miCamara && !l.ocultarPropia && (
            <div className="ch-llamada-propia">
              <Flujo stream={l.local} silenciar className="ch-llamada-local" />
              <button className="ch-llamada-ocultar" onClick={() => controlLlamada.alternarVistaPropia()} aria-label="Ocultar mi imagen" title="Ocultar mi imagen (el otro te sigue viendo)">
                <IOjoNo tam={15} />
              </button>
            </div>
          )}
          {miCamara && l.ocultarPropia && (
            <button className="ch-llamada-mostrar" onClick={() => controlLlamada.alternarVistaPropia()} title="Mostrar mi imagen">
              <IOjo tam={15} /> Mostrar mi imagen
            </button>
          )}
        </div>

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
                <Control etiqueta={l.sinCamara ? (l.camaraDisponible ? 'Encender cámara' : 'Probar cámara') : 'Apagar cámara'} activo={l.sinCamara} onClick={() => void controlLlamada.alternarCamara()} disabled={!l.local}>
                  {l.sinCamara ? <IVideoNo tam={24} /> : <IVideo tam={24} />}
                </Control>
              )}
              {enCurso && (
                <Control
                  etiqueta={l.compartiendo ? 'Dejar de compartir' : 'Compartir'}
                  clase={l.compartiendo ? 'ch-btn-azul' : ''}
                  onClick={() => (l.compartiendo ? void controlLlamada.dejarDeCompartir() : setEligiendo(true))}
                  disabled={!l.puedeCompartir}
                  titulo={l.puedeCompartir ? (l.compartiendo ? 'Dejar de compartir la pantalla' : 'Compartir una pantalla o ventana') : `${con.nombre} necesita actualizar Odesk Code para ver tu pantalla`}
                >
                  {l.compartiendo ? <IPantallaNo tam={24} /> : <IPantalla tam={24} />}
                </Control>
              )}
              {enCurso && (
                <Control
                  etiqueta={l.grabando ? 'Detener' : 'Grabar'}
                  clase={l.grabando ? 'ch-btn-grabando' : ''}
                  onClick={() => void controlLlamada.alternarGrabacion()}
                  titulo={l.grabando ? 'Detener y guardar la grabación' : `Grabar la llamada (${con.nombre} verá que estás grabando)`}
                >
                  {l.grabando ? <IDetener tam={20} /> : <IGrabar tam={24} />}
                </Control>
              )}
              <Control etiqueta="Colgar" clase="ch-btn-rojo" onClick={() => controlLlamada.colgar()}>
                <IColgar tam={28} />
              </Control>
            </>
          )}
        </div>
        {eligiendo && <ElegirPantalla alCerrar={() => setEligiendo(false)} />}
      </div>
      {guardada}
    </>
  )
}
