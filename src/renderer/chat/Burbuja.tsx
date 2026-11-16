import { memo, useEffect, useRef, useState } from 'react'
import { partirEnlaces, textoLlamada, type MensajeChat } from '@shared/chat'
import { ArchivoChat, AudioChat, ImagenChat, VideoChat } from './Adjuntos'
import { IAlerta, IBasura, ICopiar, IEditar, IEnlace, IMas, IReaccion, IReloj, IResponder, ITelefono, ITicks, IVideo } from './Iconos'

const REACCIONES = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const EDITABLE_MS = 15 * 60_000

export interface AccionesMensaje {
  responder(m: MensajeChat): void
  editar(m: MensajeChat): void
  eliminar(m: MensajeChat): void
  reaccionar(m: MensajeChat, emoji: string | null): void
  reintentar(m: MensajeChat): void
  descartar(m: MensajeChat): void
  irA(id: string): void
  /** Abre el visor a pantalla completa en esta foto o video. */
  verMedio(adjuntoId: string): void
}

interface Props {
  m: MensajeChat
  yoId: string
  /** Hasta qué mensaje leyó / recibió el otro (para ✓ y ✓✓). */
  leidoPorOtro: number
  entregadoAlOtro: number
  nombreOtro: string
  agrupado: boolean
  resaltado: boolean
  acciones: AccionesMensaje
}

function Ticks({ m, leido, entregado }: { m: MensajeChat; leido: number; entregado: number }) {
  if (m.local === 'enviando')
    return (
      <span className="ch-tick pendiente" title="Enviando…" aria-label="Enviando">
        <IReloj tam={12} />
      </span>
    )
  if (m.local === 'fallido')
    return (
      <span className="ch-tick fallo" title={m.error} aria-label="No se pudo enviar">
        <IAlerta tam={13} />
      </span>
    )
  const estado = m.seq <= leido ? 'leido' : m.seq <= entregado ? 'entregado' : 'enviado'
  const texto = { leido: 'Leído', entregado: 'Entregado', enviado: 'Enviado' }[estado]
  return (
    <span key={estado} className={`ch-tick ${estado}`} title={texto} aria-label={texto}>
      <ITicks doble={estado !== 'enviado'} />
    </span>
  )
}

function Texto({ texto }: { texto: string }) {
  return (
    <>
      {partirEnlaces(texto).map((p, i) =>
        p.enlace ? (
          <a
            key={i}
            href={p.enlace}
            onClick={(e) => {
              e.preventDefault()
              void window.api.navegador.externo(p.enlace!)
            }}
          >
            {p.texto}
          </a>
        ) : (
          <span key={i}>{p.texto}</span>
        )
      )}
    </>
  )
}

/** Tarjeta con el primer enlace del mensaje (dominio y ruta): sin pedir nada a esa web. */
function TarjetaEnlace({ texto }: { texto: string }) {
  const enlace = partirEnlaces(texto).find((p) => p.enlace)?.enlace
  if (!enlace) return null
  let u: URL
  try {
    u = new URL(enlace)
  } catch {
    return null
  }
  const ruta = (u.pathname + u.search).replace(/\/$/, '')
  return (
    <button className="ch-enlace" onClick={() => void window.api.navegador.externo(enlace)} title={enlace}>
      <span className="ch-enlace-icono">
        <IEnlace tam={16} />
      </span>
      <span className="ch-enlace-datos">
        <strong>{u.hostname.replace(/^www\./, '')}</strong>
        {ruta && <span>{ruta}</span>}
      </span>
    </button>
  )
}

function Menu({ m, yoId, propio, acciones, cerrar }: { m: MensajeChat; yoId: string; propio: boolean; acciones: AccionesMensaje; cerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fuera = (e: MouseEvent): void => void (ref.current && !ref.current.contains(e.target as Node) && cerrar())
    const tecla = (e: KeyboardEvent): void => void (e.key === 'Escape' && cerrar())
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [cerrar])
  const editable = propio && m.tipo === 'text' && Date.now() - new Date(m.creado).getTime() < EDITABLE_MS
  const hacer = (f: () => void) => () => {
    cerrar()
    f()
  }
  return (
    <div className="ch-menu" ref={ref} role="menu">
      <div className="ch-menu-reacciones">
        {REACCIONES.map((e) => (
          <button key={e} role="menuitem" className={m.reacciones.some((r) => r.emoji === e && r.usuarios.includes(yoId)) ? 'activa' : ''} onClick={hacer(() => acciones.reaccionar(m, e))} aria-label={`Reaccionar con ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <button role="menuitem" onClick={hacer(() => acciones.responder(m))}>
        <IResponder />
        Responder
      </button>
      {m.tipo === 'text' && (
        <button role="menuitem" onClick={hacer(() => void navigator.clipboard?.writeText(m.texto).catch(() => undefined))}>
          <ICopiar />
          Copiar
        </button>
      )}
      {editable && (
        <button role="menuitem" onClick={hacer(() => acciones.editar(m))}>
          <IEditar />
          Editar
        </button>
      )}
      {propio && (
        <>
          <div className="ch-menu-sep" role="separator" />
          <button role="menuitem" className="peligro" onClick={hacer(() => acciones.eliminar(m))}>
            <IBasura />
            Eliminar para todos
          </button>
        </>
      )}
    </div>
  )
}

/** Un mensaje de 1 a 3 emojis solos se muestra grande, como en las apps de mensajería. */
const soloEmoji = (t: string): boolean => /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s){1,12}$/u.test(t.trim()) && [...t.trim().replace(/\s/g, '')].length <= 8 && !/\d/.test(t)

function Burbuja({ m, yoId, leidoPorOtro, entregadoAlOtro, nombreOtro, agrupado, resaltado, acciones }: Props) {
  const [menu, setMenu] = useState(false)
  const propio = m.emisorId === yoId
  const hora = new Date(m.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  if (m.tipo === 'call') {
    const perdida = m.meta.estado !== 'completada'
    return (
      <div className={`ch-sistema ch-llamada-msg${perdida ? ' perdida' : ''}`} data-mensaje={m.id}>
        <span className="ch-llamada-msg-icono">{m.meta.video ? <IVideo tam={14} /> : <ITelefono tam={14} />}</span>
        <span>
          {textoLlamada(m, yoId)} · {hora}
        </span>
      </div>
    )
  }

  const contenido = m.eliminado ? (
    <p className="ch-eliminado">🚫 {propio ? 'Eliminaste este mensaje' : 'Este mensaje fue eliminado'}</p>
  ) : (
    <>
      {m.respondeA && (
        <button className="ch-cita" onClick={() => acciones.irA(m.respondeA!.id)} aria-label="Ir al mensaje citado">
          <strong>{m.respondeA.emisorId === yoId ? 'Tú' : nombreOtro}</strong>
          <span>{m.respondeA.texto}</span>
        </button>
      )}
      {m.adjunto && m.tipo === 'image' && <ImagenChat adjunto={m.adjunto} alAbrir={() => acciones.verMedio(m.adjunto!.id)} />}
      {m.adjunto && m.tipo === 'video' && <VideoChat adjunto={m.adjunto} alAbrir={() => acciones.verMedio(m.adjunto!.id)} />}
      {m.adjunto && m.tipo === 'audio' && <AudioChat adjunto={m.adjunto} propio={propio} />}
      {m.adjunto && m.tipo === 'file' && <ArchivoChat adjunto={m.adjunto} />}
      {m.texto && (
        <p className={`ch-texto${soloEmoji(m.texto) ? ' grande' : ''}`}>
          <Texto texto={m.texto} />
        </p>
      )}
      {m.tipo === 'text' && <TarjetaEnlace texto={m.texto} />}
    </>
  )

  const soloMedio = !m.eliminado && !m.texto && (m.tipo === 'image' || m.tipo === 'video')

  // En `reacciones` el servidor manda ids de usuario: la mía se reconoce comparando con yoId.
  const reacciones = m.reacciones.map((r) => ({ ...r, mia: r.usuarios.includes(yoId) }))

  return (
    <div className={`ch-fila${propio ? ' propio' : ''}${agrupado ? ' agrupado' : ''}${menu ? ' con-menu' : ''}`} data-mensaje={m.id}>
      <div className="ch-fila-cuerpo">
        {!m.eliminado && !m.local && (
          <div className="ch-acciones" role="toolbar" aria-label="Acciones del mensaje">
            <button onClick={() => acciones.reaccionar(m, m.reacciones.some((r) => r.emoji === '👍' && r.usuarios.includes(yoId)) ? null : '👍')} aria-label="Me gusta" title="Me gusta">
              <IReaccion tam={15} />
            </button>
            <button onClick={() => acciones.responder(m)} aria-label="Responder" title="Responder">
              <IResponder tam={15} />
            </button>
            <button className="ch-mas" onClick={() => setMenu((v) => !v)} aria-label="Opciones del mensaje" aria-haspopup="menu" aria-expanded={menu} title="Más">
              <IMas tam={15} />
            </button>
          </div>
        )}
        <div
          className={`ch-burbuja${propio ? ' propio' : ''}${resaltado ? ' resaltado' : ''}${m.local === 'fallido' ? ' fallido' : ''}${m.local === 'enviando' ? ' enviando' : ''}${soloMedio ? ' medio' : ''}${agrupado ? '' : ' cola'}`}
          onDoubleClick={() => !m.eliminado && !m.local && acciones.responder(m)}
        >
          {menu && <Menu m={m} yoId={yoId} propio={propio} acciones={acciones} cerrar={() => setMenu(false)} />}
          {contenido}
          <span className="ch-meta">
            {m.editado && !m.eliminado && <em>editado</em>}
            <time dateTime={m.creado}>{hora}</time>
            {propio && !m.eliminado && <Ticks m={m} leido={leidoPorOtro} entregado={entregadoAlOtro} />}
          </span>
          {m.local === 'fallido' && (
            <span className="ch-reintento" role="alert">
              No se envió{m.error ? `: ${m.error}` : ''}.{' '}
              {m.tipo === 'text' && <button onClick={() => acciones.reintentar(m)}>Reintentar</button>}
              <button onClick={() => acciones.descartar(m)}>Descartar</button>
            </span>
          )}
        </div>
      </div>
      {reacciones.length > 0 && (
        <div className="ch-reacciones">
          {reacciones.map((r) => (
            <button key={r.emoji} className={r.mia ? 'mia' : ''} onClick={() => acciones.reaccionar(m, r.mia ? null : r.emoji)} aria-label={`${r.emoji} ${r.usuarios.length}`}>
              {r.emoji} {r.usuarios.length > 1 ? r.usuarios.length : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(Burbuja)
