import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { ConversacionChat, MensajeChat } from '@shared/chat'
import { etiquetaDia, textoPresencia } from '@shared/chat-estado'
import { almacenChat, type VistaChat } from './almacen'
import { Avatar } from './Avatar'
import Burbuja, { type AccionesMensaje } from './Burbuja'
import { Compositor, type NotaGrabada } from './Compositor'
import { controlLlamada } from './llamadas'

interface Props {
  vista: VistaChat
  conversacion: ConversacionChat
  alVolver(): void
}

const CERCA_DEL_FINAL_PX = 140

/** Una conversación: encabezado, mensajes con separadores por día, y el campo para escribir. */
export function Hilo({ vista, conversacion, alVolver }: Props) {
  const yoId = vista.yo?.id ?? ''
  const hilo = vista.hilos[conversacion.id]
  const mensajes = hilo?.mensajes ?? []
  const otro = conversacion.otro
  const esContacto = vista.contactos.some((c) => c.estado === 'aceptado' && c.usuario.id === otro.id)
  const lista = useRef<HTMLDivElement>(null)
  const alFinal = useRef(true)
  const alturaPrevia = useRef(0)
  const [respondiendo, setRespondiendo] = useState<MensajeChat | undefined>()
  const [editando, setEditando] = useState<MensajeChat | undefined>()
  const [nuevos, setNuevos] = useState(0)
  const [resaltado, setResaltado] = useState('')
  const [imagen, setImagen] = useState('')
  const [arrastrando, setArrastrando] = useState(false)
  const [menu, setMenu] = useState(false)
  const [confirmar, setConfirmar] = useState<'vaciar' | 'bloquear' | ''>('')
  const escribe = vista.escribiendo[conversacion.id] === otro.id

  // Al cambiar de conversación: se descarta lo que se estaba respondiendo o editando.
  useEffect(() => {
    setRespondiendo(undefined)
    setEditando(undefined)
    setNuevos(0)
    setMenu(false)
    setConfirmar('')
    alFinal.current = true
  }, [conversacion.id])

  const bajar = useCallback((suave = false): void => {
    const el = lista.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
    setNuevos(0)
  }, [])

  // Mantiene la posición: al final si se estaba al final; si se cargaron mensajes antiguos, sin saltar.
  const ultimoId = mensajes.at(-1)?.id
  const primeroId = mensajes[0]?.id
  const primeroPrevio = useRef(primeroId)
  useLayoutEffect(() => {
    const el = lista.current
    if (!el) return
    if (primeroPrevio.current !== primeroId && alturaPrevia.current && !alFinal.current) {
      el.scrollTop += el.scrollHeight - alturaPrevia.current
    } else if (alFinal.current) {
      bajar()
    }
    primeroPrevio.current = primeroId
    alturaPrevia.current = el.scrollHeight
  }, [ultimoId, primeroId, mensajes.length, bajar])
  useEffect(() => {
    const el = lista.current
    if (!el || alFinal.current) return
    const ultimo = mensajes.at(-1)
    if (ultimo && ultimo.emisorId !== yoId) setNuevos((n) => n + 1)
    else if (ultimo) bajar(true) // lo que yo envío siempre se ve
  }, [ultimoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const alDesplazar = (): void => {
    const el = lista.current
    if (!el) return
    alFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < CERCA_DEL_FINAL_PX
    if (alFinal.current) setNuevos(0)
    if (el.scrollTop < 80 && hilo?.hayMas) {
      alturaPrevia.current = el.scrollHeight
      void almacenChat.cargarAnteriores(conversacion.id)
    }
  }

  const irA = useCallback((id: string): void => {
    const el = lista.current?.querySelector(`[data-mensaje="${CSS.escape(id)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setResaltado(id)
    window.setTimeout(() => setResaltado(''), 1600)
  }, [])

  const acciones: AccionesMensaje = useMemo(
    () => ({
      responder: (m) => (setEditando(undefined), setRespondiendo(m)),
      editar: (m) => (setRespondiendo(undefined), setEditando(m)),
      eliminar: (m) => void almacenChat.eliminar(m),
      reaccionar: (m, e) => void almacenChat.reaccionar(m, e),
      reintentar: (m) => void almacenChat.reintentar(m),
      descartar: (m) => almacenChat.descartarLocal(m),
      irA,
      verImagen: setImagen
    }),
    [irA]
  )

  const enviarArchivos = async (archivos: File[]): Promise<void> => {
    for (const f of archivos) {
      const datos = new Uint8Array(await f.arrayBuffer())
      await almacenChat.enviarArchivo(conversacion.id, { nombre: f.name || 'archivo', mime: f.type || 'application/octet-stream', datos }, respondiendo)
      setRespondiendo(undefined)
    }
  }
  const enviarNota = (n: NotaGrabada): void => {
    void almacenChat.enviarArchivo(conversacion.id, { nombre: `nota-de-voz.${n.mime.includes('ogg') ? 'ogg' : n.mime.includes('mp4') ? 'm4a' : 'webm'}`, mime: n.mime, datos: n.datos, duracionMs: n.duracionMs }, respondiendo)
    setRespondiendo(undefined)
  }

  const soltar = (e: DragEvent): void => {
    e.preventDefault()
    setArrastrando(false)
    if (esContacto) void enviarArchivos([...e.dataTransfer.files])
  }

  // Los mensajes con su separador de día y si van «agrupados» (mismo autor, pocos minutos).
  const filas = useMemo(() => {
    const out: ({ clave: string; dia: string } | { clave: string; m: MensajeChat; agrupado: boolean })[] = []
    let diaPrevio = ''
    let previo: MensajeChat | undefined
    for (const m of mensajes) {
      const dia = etiquetaDia(m.creado)
      if (dia !== diaPrevio) {
        out.push({ clave: `dia-${m.creado.slice(0, 10)}`, dia })
        diaPrevio = dia
        previo = undefined
      }
      const agrupado = !!previo && previo.emisorId === m.emisorId && previo.tipo !== 'call' && m.tipo !== 'call' && new Date(m.creado).getTime() - new Date(previo.creado).getTime() < 5 * 60_000
      out.push({ clave: m.id, m, agrupado })
      previo = m
    }
    return out
  }, [mensajes])

  const subtitulo = escribe ? 'escribiendo…' : textoPresencia(otro)
  const llamar = (video: boolean): void => void controlLlamada.llamar(otro, video)
  const autorRespondido = respondiendo ? (respondiendo.emisorId === yoId ? 'ti mismo' : otro.nombre) : undefined

  return (
    <section className="ch-hilo" onDragOver={(e) => (e.preventDefault(), esContacto && setArrastrando(true))} onDragLeave={(e) => e.currentTarget === e.target && setArrastrando(false)} onDrop={soltar} aria-label={`Conversación con ${otro.nombre}`}>
      <header className="ch-hilo-cab">
        <button className="icono ch-volver" onClick={alVolver} aria-label="Volver a la lista">
          ←
        </button>
        <Avatar usuario={otro} enLinea={otro.enLinea} />
        <div className="ch-hilo-quien">
          <strong>{otro.nombre}</strong>
          <span className={escribe ? 'escribiendo' : ''} aria-live="polite">
            {subtitulo || otro.email}
          </span>
        </div>
        <button className="icono" onClick={() => llamar(false)} disabled={!esContacto || vista.conexion !== 'conectado'} aria-label="Llamada de voz" title="Llamada de voz">
          📞
        </button>
        <button className="icono" onClick={() => llamar(true)} disabled={!esContacto || vista.conexion !== 'conectado'} aria-label="Videollamada" title="Videollamada">
          🎥
        </button>
        <div className="ch-hilo-mas">
          <button className="icono" onClick={() => setMenu((v) => !v)} aria-label="Más opciones" aria-haspopup="menu" aria-expanded={menu}>
            ⋯
          </button>
          {menu && (
            <div className="ch-menu ch-menu-cab" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => (setMenu(false), void almacenChat.ajustes(conversacion.id, { silenciada: !conversacion.silenciada }))}>
                {conversacion.silenciada ? 'Activar avisos' : 'Silenciar avisos'}
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), void almacenChat.ajustes(conversacion.id, { archivada: !conversacion.archivada }))}>
                {conversacion.archivada ? 'Desarchivar' : 'Archivar chat'}
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), setConfirmar('vaciar'))}>
                Vaciar chat
              </button>
              <button role="menuitem" className="peligro" onClick={() => (setMenu(false), setConfirmar('bloquear'))}>
                Bloquear a {otro.nombre}
              </button>
            </div>
          )}
        </div>
      </header>

      {confirmar && (
        <div className="ch-confirmar" role="alertdialog" aria-label="Confirmar">
          <span>
            {confirmar === 'vaciar'
              ? 'Se borran los mensajes de este chat solo para ti. La otra persona los conserva.'
              : `${otro.nombre} dejará de ser tu contacto y no podrá escribirte ni llamarte. No se le avisa.`}
          </span>
          <button onClick={() => setConfirmar('')}>Cancelar</button>
          <button
            className="primario"
            onClick={() => {
              const que = confirmar
              setConfirmar('')
              if (que === 'vaciar') void almacenChat.vaciar(conversacion.id)
              else void almacenChat.bloquear(otro.id, true)
            }}
          >
            {confirmar === 'vaciar' ? 'Vaciar' : 'Bloquear'}
          </button>
        </div>
      )}

      <div className="ch-mensajes" ref={lista} onScroll={alDesplazar} role="log" aria-live="polite" aria-label="Mensajes">
        {hilo?.hayMas && <div className="ch-cargando">Cargando mensajes anteriores…</div>}
        {!hilo && <div className="ch-vacio-hilo">Cargando…</div>}
        {hilo && mensajes.length === 0 && <div className="ch-vacio-hilo">Aún no hay mensajes. Escribe el primero 👋</div>}
        {filas.map((f) =>
          'dia' in f ? (
            <div key={f.clave} className="ch-dia">
              <span>{f.dia}</span>
            </div>
          ) : (
            <Burbuja
              key={f.clave}
              m={f.m}
              yoId={yoId}
              leidoPorOtro={conversacion.leidoPorOtro}
              entregadoAlOtro={conversacion.entregadoAlOtro}
              nombreOtro={otro.nombre}
              agrupado={f.agrupado}
              resaltado={resaltado === f.m.id}
              acciones={acciones}
            />
          )
        )}
        {escribe && (
          <div className="ch-escribiendo" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {nuevos > 0 && (
        <button className="ch-nuevos" onClick={() => bajar(true)}>
          ↓ {nuevos} mensaje{nuevos === 1 ? '' : 's'} nuevo{nuevos === 1 ? '' : 's'}
        </button>
      )}
      {arrastrando && <div className="ch-soltar">Suelta los archivos para enviarlos a {otro.nombre}</div>}
      {vista.conexion !== 'conectado' && (
        <div className="ch-sin-conexion" role="status">
          {vista.conexion === 'conectando' ? 'Conectando…' : 'Sin conexión: los mensajes nuevos llegarán al reconectar.'}
        </div>
      )}

      <Compositor
        conversacionId={conversacion.id}
        respondiendo={respondiendo}
        editando={editando}
        autorRespondido={autorRespondido}
        bloqueo={esContacto ? undefined : 'Ya no puedes enviar mensajes a esta persona: no es tu contacto.'}
        alQuitarContexto={() => (setRespondiendo(undefined), setEditando(undefined))}
        alEnviarTexto={(t) => {
          void almacenChat.enviarTexto(conversacion.id, t, respondiendo)
          setRespondiendo(undefined)
          alFinal.current = true
        }}
        alGuardarEdicion={(t) => {
          if (editando && t !== editando.texto) void almacenChat.editar(editando, t)
          setEditando(undefined)
        }}
        alElegirArchivos={(f) => void enviarArchivos(f)}
        alEnviarNota={enviarNota}
        alEscribir={() => almacenChat.escribiendo(conversacion.id)}
        alError={(m) => almacenChat.fijarError(m)}
      />

      {imagen && (
        <div className="ch-visor" role="dialog" aria-modal="true" aria-label="Imagen" onClick={() => setImagen('')} onKeyDown={(e) => e.key === 'Escape' && setImagen('')} tabIndex={-1} ref={(el) => el?.focus()}>
          <img src={imagen} alt="" />
          <button className="icono" onClick={() => setImagen('')} aria-label="Cerrar">
            ✕
          </button>
        </div>
      )}
    </section>
  )
}
