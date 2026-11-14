import { memo, useEffect, useRef, useState } from 'react'
import { partirEnlaces, textoLlamada, type MensajeChat } from '@shared/chat'
import { ArchivoChat, AudioChat, ImagenChat, VideoChat } from './Adjuntos'

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
  verImagen(url: string): void
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
        ◔
      </span>
    )
  if (m.local === 'fallido')
    return (
      <span className="ch-tick fallo" title={m.error} aria-label="No se pudo enviar">
        !
      </span>
    )
  const estado = m.seq <= leido ? 'leido' : m.seq <= entregado ? 'entregado' : 'enviado'
  const texto = { leido: 'Leído', entregado: 'Entregado', enviado: 'Enviado' }[estado]
  return (
    <span className={`ch-tick ${estado}`} title={texto} aria-label={texto}>
      {estado === 'enviado' ? '✓' : '✓✓'}
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
        Responder
      </button>
      {m.tipo === 'text' && (
        <button role="menuitem" onClick={hacer(() => void navigator.clipboard?.writeText(m.texto).catch(() => undefined))}>
          Copiar
        </button>
      )}
      {editable && (
        <button role="menuitem" onClick={hacer(() => acciones.editar(m))}>
          Editar
        </button>
      )}
      {propio && (
        <button role="menuitem" className="peligro" onClick={hacer(() => acciones.eliminar(m))}>
          Eliminar para todos
        </button>
      )}
    </div>
  )
}

function Burbuja({ m, yoId, leidoPorOtro, entregadoAlOtro, nombreOtro, agrupado, resaltado, acciones }: Props) {
  const [menu, setMenu] = useState(false)
  const propio = m.emisorId === yoId
  const hora = new Date(m.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  if (m.tipo === 'call') {
    return (
      <div className="ch-sistema" data-mensaje={m.id}>
        <span>
          {m.meta.video ? '🎥' : '📞'} {textoLlamada(m, yoId)} · {hora}
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
      {m.adjunto && m.tipo === 'image' && <ImagenChat adjunto={m.adjunto} alAbrir={acciones.verImagen} />}
      {m.adjunto && m.tipo === 'video' && <VideoChat adjunto={m.adjunto} />}
      {m.adjunto && m.tipo === 'audio' && <AudioChat adjunto={m.adjunto} propio={propio} />}
      {m.adjunto && m.tipo === 'file' && <ArchivoChat adjunto={m.adjunto} />}
      {m.texto && (
        <p className="ch-texto">
          <Texto texto={m.texto} />
        </p>
      )}
    </>
  )

  // En `reacciones` el servidor manda ids de usuario: la mía se reconoce comparando con yoId.
  const reacciones = m.reacciones.map((r) => ({ ...r, mia: r.usuarios.includes(yoId) }))

  return (
    <div className={`ch-fila${propio ? ' propio' : ''}${agrupado ? ' agrupado' : ''}`} data-mensaje={m.id}>
      <div className={`ch-burbuja${propio ? ' propio' : ''}${resaltado ? ' resaltado' : ''}${m.local === 'fallido' ? ' fallido' : ''}`}>
        {!m.eliminado && !m.local && (
          <button className="ch-mas" onClick={() => setMenu((v) => !v)} aria-label="Opciones del mensaje" aria-haspopup="menu" aria-expanded={menu}>
            ⌄
          </button>
        )}
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
