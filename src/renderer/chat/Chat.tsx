import { useEffect, useMemo, useState } from 'react'
import type { ResultadoBusqueda } from '@shared/chat'
import { almacenChat, useChat } from './almacen'
import { Avatar } from './Avatar'
import { Contactos } from './Contactos'
import { Hilo } from './Hilo'

type Pestana = 'chats' | 'contactos'

const ESTADOS_CONEXION = { conectado: 'Conectado', conectando: 'Conectando…', desconectado: 'Sin conexión' } as const

const horaCorta = (iso: string): string => {
  const d = new Date(iso)
  const hoy = new Date()
  if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

/** Sección «Chat»: conversaciones y contactos a la izquierda, el hilo abierto a la derecha. */
export function Chat({ visible }: { visible: boolean }) {
  const vista = useChat()
  const [pestana, setPestana] = useState<Pestana>('chats')
  const [q, setQ] = useState('')
  const [archivadas, setArchivadas] = useState(false)
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])

  useEffect(() => almacenChat.fijarVisible(visible), [visible])
  useEffect(() => () => almacenChat.fijarVisible(false), [])

  // Búsqueda en el texto de los mensajes (el servidor), con una pequeña espera mientras se escribe.
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) return setResultados([])
    let vivo = true
    const id = window.setTimeout(() => void almacenChat.buscar(t).then((r) => vivo && setResultados(r)), 300)
    return () => {
      vivo = false
      window.clearTimeout(id)
    }
  }, [q])

  const pendientes = vista.contactos.filter((c) => c.estado === 'recibida').length
  const actual = vista.conversaciones.find((c) => c.id === vista.abierta)
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return vista.conversaciones.filter((c) => c.archivada === archivadas && (!t || c.otro.nombre.toLowerCase().includes(t) || c.otro.email.toLowerCase().includes(t)))
  }, [vista.conversaciones, q, archivadas])
  const nombreDe = (id: string): string => vista.conversaciones.find((c) => c.id === id)?.otro.nombre ?? ''
  const hayArchivadas = vista.conversaciones.some((c) => c.archivada)

  return (
    <main className="chat" style={{ display: visible ? 'flex' : 'none' }}>
      <aside className={`ch-lateral${actual ? ' con-hilo' : ''}`}>
        <header className="ch-lateral-cab">
          <h1>Chat</h1>
          <span className={`ch-conexion ${vista.conexion}`} title={ESTADOS_CONEXION[vista.conexion]}>
            <i aria-hidden /> {ESTADOS_CONEXION[vista.conexion]}
          </span>
        </header>
        <div className="ch-pestanas" role="tablist">
          <button role="tab" aria-selected={pestana === 'chats'} className={pestana === 'chats' ? 'activa' : ''} onClick={() => setPestana('chats')}>
            Chats{vista.noLeidos > 0 && <b className="ch-badge">{vista.noLeidos > 99 ? '99+' : vista.noLeidos}</b>}
          </button>
          <button role="tab" aria-selected={pestana === 'contactos'} className={pestana === 'contactos' ? 'activa' : ''} onClick={() => setPestana('contactos')}>
            Contactos{pendientes > 0 && <b className="ch-badge">{pendientes}</b>}
          </button>
        </div>

        {pestana === 'contactos' ? (
          <Contactos vista={vista} alAbrirChat={() => setPestana('chats')} />
        ) : (
          <>
            <div className="ch-buscar">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar chats y mensajes" aria-label="Buscar chats y mensajes" />
            </div>
            <ul className="ch-lista" aria-label="Conversaciones">
              {filtradas.map((c) => {
                const mio = c.ultimo?.emisorId === vista.yo?.id
                const escribe = vista.escribiendo[c.id] === c.otro.id
                return (
                  <li key={c.id}>
                    <button className={`ch-item${c.id === vista.abierta ? ' activa' : ''}`} onClick={() => void almacenChat.abrir(c.id)}>
                      <Avatar usuario={c.otro} enLinea={c.otro.enLinea} />
                      <span className="ch-item-texto">
                        <span className="ch-item-linea">
                          <strong>{c.otro.nombre}</strong>
                          {c.ultimo && <time>{horaCorta(c.ultimo.creado)}</time>}
                        </span>
                        <span className="ch-item-linea">
                          <span className={`ch-item-previa${escribe ? ' escribiendo' : ''}`}>{escribe ? 'escribiendo…' : c.ultimo ? `${mio && c.ultimo.tipo !== 'call' ? 'Tú: ' : ''}${c.ultimo.texto}` : 'Sin mensajes'}</span>
                          {c.silenciada && <span title="Silenciado" aria-label="Silenciado">🔕</span>}
                          {c.noLeidos > 0 && <b className={`ch-badge${c.silenciada ? ' mudo' : ''}`}>{c.noLeidos > 99 ? '99+' : c.noLeidos}</b>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {q.trim().length >= 2 && resultados.length > 0 && (
                <li className="ch-resultados-cab" aria-hidden>
                  Mensajes
                </li>
              )}
              {q.trim().length >= 2 &&
                resultados.map((r) => (
                  <li key={r.id}>
                    <button className="ch-item resultado" onClick={() => void almacenChat.abrir(r.conversacionId)}>
                      <span className="ch-item-texto">
                        <span className="ch-item-linea">
                          <strong>{nombreDe(r.conversacionId)}</strong>
                          <time>{horaCorta(r.creado)}</time>
                        </span>
                        <span className="ch-item-previa">{r.texto}</span>
                      </span>
                    </button>
                  </li>
                ))}
              {filtradas.length === 0 && resultados.length === 0 && (
                <li className="ch-nada">
                  {vista.cargado
                    ? q.trim()
                      ? 'Nada coincide con la búsqueda.'
                      : archivadas
                        ? 'No hay chats archivados.'
                        : 'Todavía no hay conversaciones. Ve a Contactos, invita a alguien y empiecen a chatear.'
                    : 'Cargando…'}
                </li>
              )}
            </ul>
            {(hayArchivadas || archivadas) && (
              <button className="ch-archivadas" onClick={() => setArchivadas((v) => !v)}>
                {archivadas ? '← Volver a los chats' : 'Chats archivados'}
              </button>
            )}
          </>
        )}
      </aside>

      <div className={`ch-principal${actual ? ' con-hilo' : ''}`}>
        {actual ? (
          <Hilo vista={vista} conversacion={actual} alVolver={() => void almacenChat.abrir(null)} />
        ) : (
          <div className="ch-vacio">
            <div aria-hidden>💬</div>
            <h2>Chat entre cuentas</h2>
            <p>Elige una conversación o invita a alguien desde Contactos. Podrán escribirse, enviar fotos, archivos y notas de voz, y llamarse.</p>
          </div>
        )}
      </div>

      {vista.error && (
        <div className="ch-error" role="alert">
          <span>{vista.error}</span>
          <button className="icono" onClick={almacenChat.descartarError} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      )}
    </main>
  )
}
