import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConversacionChat, ResultadoBusqueda } from '@shared/chat'
import { almacenChat, useChat } from './almacen'
import { Avatar } from './Avatar'
import { ConfigurarCifrado } from './Cifrado'
import { Contactos } from './Contactos'
import { Hilo } from './Hilo'
import { IArchivar, IArchivo, IBurbujas, IBuscar, ICamara, ICampanaNo, ICerrar, IMic, IPersonaMas, ITelefono, ITicks, IVideo, IVolver } from './Iconos'

type Pestana = 'chats' | 'contactos'
type Filtro = 'todos' | 'no-leidos'

const ESTADOS_CONEXION = { conectado: 'Conectado', conectando: 'Conectando…', desconectado: 'Sin conexión' } as const

const horaCorta = (iso: string): string => {
  const d = new Date(iso)
  const hoy = new Date()
  if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const ayer = new Date(hoy)
  ayer.setDate(hoy.getDate() - 1)
  if (d.toDateString() === ayer.toDateString()) return 'Ayer'
  if (hoy.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('es', { weekday: 'short' })
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Resalta en `texto` lo que coincide con la búsqueda. */
function Resaltar({ texto, q }: { texto: string; q: string }) {
  const t = norm(q.trim())
  if (t.length < 2) return <>{texto}</>
  const i = norm(texto).indexOf(t)
  if (i < 0) return <>{texto}</>
  return (
    <>
      {texto.slice(0, i)}
      <mark>{texto.slice(i, i + t.length)}</mark>
      {texto.slice(i + t.length)}
    </>
  )
}

/** Icono delante de la vista previa según lo que fue el último mensaje (en vez del emoji). */
function IconoPrevia({ tipo }: { tipo: NonNullable<ConversacionChat['ultimo']>['tipo'] }): ReactNode {
  if (tipo === 'image') return <ICamara tam={14} />
  if (tipo === 'audio') return <IMic tam={14} />
  if (tipo === 'video') return <IVideo tam={14} />
  if (tipo === 'file') return <IArchivo tam={14} />
  if (tipo === 'call') return <ITelefono tam={14} />
  return null
}

/** Sección «Chat»: conversaciones y contactos a la izquierda, el hilo abierto a la derecha. */
export function Chat({ visible }: { visible: boolean }) {
  const vista = useChat()
  const [pestana, setPestana] = useState<Pestana>('chats')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [q, setQ] = useState('')
  const [archivadas, setArchivadas] = useState(false)
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => almacenChat.fijarVisible(visible), [visible])
  useEffect(() => () => almacenChat.fijarVisible(false), [])

  // Ctrl/⌘+K enfoca el buscador mientras la sección está a la vista.
  useEffect(() => {
    if (!visible) return
    const tecla = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPestana('chats')
        window.setTimeout(() => campo.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [visible])

  // Búsqueda en el texto de los mensajes (el servidor), con una pequeña espera mientras se escribe.
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) {
      setBuscando(false)
      return setResultados([])
    }
    let vivo = true
    setBuscando(true)
    const id = window.setTimeout(
      () =>
        void almacenChat.buscar(t).then((r) => {
          if (!vivo) return
          setResultados(r)
          setBuscando(false)
        }),
      300
    )
    return () => {
      vivo = false
      window.clearTimeout(id)
    }
  }, [q])

  const pendientes = vista.contactos.filter((c) => c.estado === 'recibida').length
  const actual = vista.conversaciones.find((c) => c.id === vista.abierta)
  const filtradas = useMemo(() => {
    const t = norm(q.trim())
    return vista.conversaciones.filter(
      (c) => c.archivada === archivadas && (filtro === 'todos' || c.noLeidos > 0) && (!t || norm(c.otro.nombre).includes(t) || norm(c.otro.email).includes(t))
    )
  }, [vista.conversaciones, q, archivadas, filtro])
  const nombreDe = (id: string): string => vista.conversaciones.find((c) => c.id === id)?.otro.nombre ?? ''
  const otroDe = (id: string) => vista.conversaciones.find((c) => c.id === id)?.otro
  const nArchivadas = vista.conversaciones.filter((c) => c.archivada).length
  const hayBusqueda = q.trim().length >= 2

  // Sin claves abiertas en este equipo no se muestra nada del chat: primero crear o abrir el cifrado.
  if (vista.cifrado && vista.cifrado.estado !== 'listo') {
    return (
      <main className="chat" style={{ display: visible ? 'flex' : 'none' }}>
        <ConfigurarCifrado estado={vista.cifrado} />
        {vista.error && (
          <div className="ch-error" role="alert">
            <span>{vista.error}</span>
            <button className="icono" onClick={almacenChat.descartarError} aria-label="Cerrar aviso">
              <ICerrar tam={14} />
            </button>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="chat" style={{ display: visible ? 'flex' : 'none' }}>
      <aside className={`ch-lateral${actual ? ' con-hilo' : ''}`}>
        <header className="ch-lateral-cab">
          <h1>{archivadas ? 'Archivados' : 'Chat'}</h1>
          <span className={`ch-conexion ${vista.conexion}`} title={ESTADOS_CONEXION[vista.conexion]}>
            <i aria-hidden /> {ESTADOS_CONEXION[vista.conexion]}
          </span>
        </header>
        <div className={`ch-pestanas ${pestana}`} role="tablist">
          <span className="ch-pestanas-indicador" aria-hidden />
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
              <label className="ch-buscar-campo">
                <IBuscar tam={15} />
                <input
                  ref={campo}
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.currentTarget.blur())}
                  placeholder="Buscar chats y mensajes"
                  aria-label="Buscar chats y mensajes"
                />
                {buscando && <span className="ch-buscar-giro" aria-label="Buscando" />}
                {q && !buscando && (
                  <button type="button" className="ch-buscar-limpiar" onClick={() => (setQ(''), campo.current?.focus())} aria-label="Borrar la búsqueda">
                    <ICerrar tam={11} />
                  </button>
                )}
                {!q && <kbd className="ch-buscar-atajo">Ctrl K</kbd>}
              </label>
              {!archivadas && (
                <div className="ch-filtros" role="group" aria-label="Filtrar">
                  <button className={filtro === 'todos' ? 'activo' : ''} aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>
                    Todos
                  </button>
                  <button className={filtro === 'no-leidos' ? 'activo' : ''} aria-pressed={filtro === 'no-leidos'} onClick={() => setFiltro('no-leidos')}>
                    No leídos{vista.noLeidos > 0 ? ` · ${vista.noLeidos > 99 ? '99+' : vista.noLeidos}` : ''}
                  </button>
                </div>
              )}
            </div>

            <ul className="ch-lista" aria-label="Conversaciones">
              {archivadas ? (
                <li>
                  <button className="ch-fila-especial" onClick={() => setArchivadas(false)}>
                    <span className="ch-fila-especial-icono">
                      <IVolver tam={16} />
                    </span>
                    Volver a los chats
                  </button>
                </li>
              ) : (
                nArchivadas > 0 &&
                !hayBusqueda && (
                  <li>
                    <button className="ch-fila-especial" onClick={() => setArchivadas(true)}>
                      <span className="ch-fila-especial-icono">
                        <IArchivar tam={16} />
                      </span>
                      Archivados
                      <span className="ch-fila-especial-n">{nArchivadas}</span>
                    </button>
                  </li>
                )
              )}
              {hayBusqueda && filtradas.length > 0 && (
                <li className="ch-resultados-cab" aria-hidden>
                  Chats
                </li>
              )}
              {filtradas.map((c, i) => {
                const mio = c.ultimo?.emisorId === vista.yo?.id
                const escribe = vista.escribiendo[c.id] === c.otro.id
                const graba = escribe && !!vista.grabando[c.id]
                const previa = c.ultimo ? (c.ultimo.tipo === 'text' ? c.ultimo.texto : c.ultimo.texto.replace(/^\S+\s/, '')) : 'Sin mensajes'
                const leido = c.ultimo && mio && c.ultimo.seq <= c.leidoPorOtro
                const entregado = c.ultimo && mio && c.ultimo.seq <= c.entregadoAlOtro
                return (
                  <li key={c.id} style={{ ['--i' as string]: Math.min(i, 12) }}>
                    <button className={`ch-item${c.id === vista.abierta ? ' activa' : ''}${c.noLeidos > 0 ? ' sin-leer' : ''}`} onClick={() => void almacenChat.abrir(c.id)}>
                      <Avatar usuario={c.otro} enLinea={c.otro.enLinea} tam={46} />
                      <span className="ch-item-texto">
                        <span className="ch-item-linea">
                          <strong>
                            <Resaltar texto={c.otro.nombre} q={q} />
                          </strong>
                          {c.ultimo && <time>{horaCorta(c.ultimo.creado)}</time>}
                        </span>
                        <span className="ch-item-linea">
                          <span className={`ch-item-previa${escribe ? ' escribiendo' : ''}`}>
                            {graba ? (
                              <>
                                <IMic tam={14} />
                                grabando audio…
                              </>
                            ) : escribe ? (
                              <>
                                <span className="ch-puntos" aria-hidden>
                                  <i />
                                  <i />
                                  <i />
                                </span>
                                escribiendo…
                              </>
                            ) : (
                              <>
                                {mio && c.ultimo && c.ultimo.tipo !== 'call' && (
                                  <span className={`ch-item-tick${leido ? ' leido' : ''}`}>
                                    <ITicks doble={!!entregado} />
                                  </span>
                                )}
                                {c.ultimo && <IconoPrevia tipo={c.ultimo.tipo} />}
                                <span className="ch-item-previa-texto">{mio && c.ultimo && c.ultimo.tipo !== 'call' ? `Tú: ${previa}` : previa}</span>
                              </>
                            )}
                          </span>
                          {c.silenciada && (
                            <span className="ch-item-mudo" title="Silenciado" aria-label="Silenciado">
                              <ICampanaNo tam={13} />
                            </span>
                          )}
                          {c.noLeidos > 0 && <b className={`ch-badge${c.silenciada ? ' mudo' : ''}`}>{c.noLeidos > 99 ? '99+' : c.noLeidos}</b>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {hayBusqueda && resultados.length > 0 && (
                <li className="ch-resultados-cab" aria-hidden>
                  Mensajes · {resultados.length}
                </li>
              )}
              {hayBusqueda &&
                resultados.map((r) => {
                  const otro = otroDe(r.conversacionId)
                  return (
                    <li key={r.id}>
                      <button className="ch-item resultado" onClick={() => void almacenChat.abrir(r.conversacionId)}>
                        {otro && <Avatar usuario={otro} tam={34} />}
                        <span className="ch-item-texto">
                          <span className="ch-item-linea">
                            <strong>{nombreDe(r.conversacionId)}</strong>
                            <time>{horaCorta(r.creado)}</time>
                          </span>
                          <span className="ch-item-previa">
                            <span className="ch-item-previa-texto">
                              <Resaltar texto={r.texto} q={q} />
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              {filtradas.length === 0 && resultados.length === 0 && !buscando && (
                <li className="ch-nada">
                  {vista.cargado ? (
                    q.trim() ? (
                      <>
                        <IBuscar tam={28} />
                        <span>Nada coincide con «{q.trim()}».</span>
                      </>
                    ) : archivadas ? (
                      <>
                        <IArchivar tam={28} />
                        <span>No hay chats archivados.</span>
                      </>
                    ) : filtro === 'no-leidos' ? (
                      <>
                        <ITicks doble />
                        <span>Estás al día: no hay mensajes sin leer.</span>
                      </>
                    ) : (
                      <>
                        <IBurbujas tam={28} />
                        <span>Todavía no hay conversaciones. Ve a Contactos, invita a alguien y empiecen a chatear.</span>
                        <button className="primario" onClick={() => setPestana('contactos')}>
                          <IPersonaMas tam={15} /> Invitar a alguien
                        </button>
                      </>
                    )
                  ) : (
                    <span className="ch-esqueleto" aria-label="Cargando…">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </li>
              )}
            </ul>
          </>
        )}
      </aside>

      <div className={`ch-principal${actual ? ' con-hilo' : ''}`}>
        {actual ? (
          <Hilo key={actual.id} vista={vista} conversacion={actual} alVolver={() => void almacenChat.abrir(null)} />
        ) : (
          <div className="ch-vacio">
            <div className="ch-vacio-icono" aria-hidden>
              <IBurbujas tam={44} />
            </div>
            <h2>Chat entre cuentas</h2>
            <p>Elige una conversación o invita a alguien desde Contactos. Podrán escribirse, enviar fotos, archivos y notas de voz, y llamarse.</p>
            <div className="ch-vacio-acciones">
              <span>
                <ITelefono tam={15} /> Llamadas
              </span>
              <span>
                <IVideo tam={15} /> Videollamadas
              </span>
              <span>
                <IMic tam={15} /> Notas de voz
              </span>
            </div>
          </div>
        )}
      </div>

      {vista.error && (
        <div className="ch-error" role="alert">
          <span>{vista.error}</span>
          <button className="icono" onClick={almacenChat.descartarError} aria-label="Cerrar aviso">
            <ICerrar tam={14} />
          </button>
        </div>
      )}
    </main>
  )
}
