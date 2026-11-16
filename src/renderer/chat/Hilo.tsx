import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { ConversacionChat, MensajeChat } from '@shared/chat'
import { etiquetaDia, textoPresencia } from '@shared/chat-estado'
import { almacenChat, type VistaChat } from './almacen'
import { Avatar } from './Avatar'
import Burbuja, { type AccionesMensaje } from './Burbuja'
import { Bandeja, aElementos, type ElementoBandeja } from './Bandeja'
import { Compositor } from './Compositor'
import type { NotaGrabada } from './nota-voz'
import { Visor, type MedioVisor } from './Visor'
import { controlLlamada } from './llamadas'
import { IAbajo, IArchivar, IBloquear, ICampana, ICampanaNo, ICandado, IDescargar, IEscoba, IEscudo, IMas, IMic, ITelefono, IVideo, IVolver } from './Iconos'
import { AvisoCifrado, PanelSeguridad, useCifradoContacto } from './Cifrado'

interface Props {
  vista: VistaChat
  conversacion: ConversacionChat
  alVolver(): void
}

const CERCA_DEL_FINAL_PX = 140

/** Menú desplegable de la cabecera: se cierra con Esc o con un clic fuera. */
function MenuCabecera({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fuera = (e: MouseEvent): void => void (ref.current && !ref.current.parentElement?.contains(e.target as Node) && cerrar())
    const tecla = (e: KeyboardEvent): void => void (e.key === 'Escape' && cerrar())
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [cerrar])
  return (
    <div className="ch-menu ch-menu-cab" role="menu" ref={ref}>
      {children}
    </div>
  )
}

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
  const [lejos, setLejos] = useState(false) // botón «ir al final» cuando se subió bastante
  const [resaltado, setResaltado] = useState('')
  const [visor, setVisor] = useState('') // id del adjunto abierto a pantalla completa
  const [bandeja, setBandeja] = useState<ElementoBandeja[]>([])
  const [arrastrando, setArrastrando] = useState(false)
  const capasArrastre = useRef(0) // dragenter/dragleave llegan por cada hijo: se cuentan para saber cuándo se sale de verdad
  const [menu, setMenu] = useState(false)
  const [confirmar, setConfirmar] = useState<'vaciar' | 'bloquear' | ''>('')
  const [seguridad, setSeguridad] = useState(false)
  const [cifrado, setCifrado] = useCifradoContacto(otro.id, vista.versionClaves, vista.cifrado?.claveId)
  // Sin una clave aceptada del contacto no se puede escribir ni llamar con seguridad (main lo impide igualmente).
  const seguro = cifrado?.estado === 'confiable' || cifrado?.estado === 'verificada'
  const escribe = vista.escribiendo[conversacion.id] === otro.id
  const grabaAudio = escribe && !!vista.grabando[conversacion.id]

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
    setLejos(el.scrollHeight - el.scrollTop - el.clientHeight > 480)
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
      verMedio: setVisor
    }),
    [irA]
  )

  /** Lo elegido, pegado o soltado va primero a la bandeja de vista previa; desde ahí se envía. */
  const agregarABandeja = (archivos: File[]): void => {
    if (archivos.length === 0 || !esContacto) return
    setBandeja((b) => [...b, ...aElementos(archivos)].slice(0, 10))
  }
  const cancelarBandeja = (): void => {
    bandeja.forEach((e) => e.url && URL.revokeObjectURL(e.url))
    setBandeja([])
  }
  const enviarBandeja = async (): Promise<void> => {
    const lista = bandeja
    setBandeja([])
    alFinal.current = true
    const cita = respondiendo
    setRespondiendo(undefined)
    // Se ponen todos en el hilo a la vez (cada uno con su vista previa) y se suben en paralelo.
    await Promise.all(
      lista.map(async (e, i) => {
        const datos = new Uint8Array(await e.archivo.arrayBuffer())
        await almacenChat.enviarArchivo(
          conversacion.id,
          { nombre: e.archivo.name || 'archivo', mime: e.archivo.type || 'application/octet-stream', datos, ...(e.texto.trim() ? { texto: e.texto.trim() } : {}), ...(e.url ? { previa: e.url } : {}) },
          i === 0 ? cita : undefined
        )
      })
    )
  }
  const enviarNota = (n: NotaGrabada): void => {
    void almacenChat.enviarArchivo(conversacion.id, { nombre: `nota-de-voz.${n.mime.includes('ogg') ? 'ogg' : n.mime.includes('mp4') ? 'm4a' : 'webm'}`, mime: n.mime, datos: n.datos, duracionMs: n.duracionMs }, respondiendo)
    setRespondiendo(undefined)
  }

  const conArchivos = (e: DragEvent): boolean => [...e.dataTransfer.types].includes('Files')
  const soltar = (e: DragEvent): void => {
    if (!conArchivos(e)) return
    e.preventDefault()
    capasArrastre.current = 0
    setArrastrando(false)
    agregarABandeja([...e.dataTransfer.files])
  }

  // Fotos y videos de la conversación, en orden, para el visor.
  const medios = useMemo<MedioVisor[]>(
    () =>
      mensajes
        .filter((m) => !m.eliminado && m.adjunto && (m.tipo === 'image' || m.tipo === 'video'))
        .map((m) => ({ adjunto: m.adjunto!, tipo: m.tipo as 'image' | 'video', autor: m.emisorId === yoId ? 'Tú' : otro.nombre, creado: m.creado, texto: m.texto })),
    [mensajes, yoId, otro.nombre]
  )

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

  const subtitulo = grabaAudio ? 'grabando audio…' : escribe ? 'escribiendo…' : textoPresencia(otro)
  const llamar = (video: boolean): void => void controlLlamada.llamar(otro, video)
  const autorRespondido = respondiendo ? (respondiendo.emisorId === yoId ? 'ti mismo' : otro.nombre) : undefined

  return (
    <section
      className="ch-hilo"
      onDragEnter={(e) => {
        if (!conArchivos(e)) return
        e.preventDefault()
        capasArrastre.current++
        if (esContacto) setArrastrando(true)
      }}
      onDragOver={(e) => {
        if (!conArchivos(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = esContacto ? 'copy' : 'none'
      }}
      onDragLeave={(e) => {
        if (!conArchivos(e)) return
        capasArrastre.current = Math.max(0, capasArrastre.current - 1)
        if (capasArrastre.current === 0) setArrastrando(false)
      }}
      onDrop={soltar}
      aria-label={`Conversación con ${otro.nombre}`}
    >
      <header className="ch-hilo-cab">
        <button className="icono ch-volver" onClick={alVolver} aria-label="Volver a la lista">
          <IVolver />
        </button>
        <Avatar usuario={otro} enLinea={otro.enLinea} tam={40} />
        <div className="ch-hilo-quien">
          <strong>{otro.nombre}</strong>
          <span className={escribe ? 'escribiendo' : otro.enLinea ? 'en-linea' : ''} aria-live="polite">
            {subtitulo || otro.email}
          </span>
        </div>
        <div className="ch-hilo-acciones">
          <button
            className={`ch-boton-cab ch-boton-cifrado ${cifrado?.estado ?? ''}`}
            onClick={() => setSeguridad((v) => !v)}
            aria-label="Cifrado de extremo a extremo"
            title={cifrado?.estado === 'verificada' ? 'Cifrado de extremo a extremo · verificado' : cifrado?.estado === 'confiable' ? 'Cifrado de extremo a extremo' : 'Revisa el cifrado de este chat'}
            aria-expanded={seguridad}
          >
            {cifrado?.estado === 'verificada' ? <IEscudo /> : <ICandado />}
          </button>
          <button className="ch-boton-cab" onClick={() => llamar(false)} disabled={!esContacto || !seguro || vista.conexion !== 'conectado'} aria-label="Llamada de voz" title="Llamada de voz">
            <ITelefono />
          </button>
          <button className="ch-boton-cab" onClick={() => llamar(true)} disabled={!esContacto || !seguro || vista.conexion !== 'conectado'} aria-label="Videollamada" title="Videollamada">
            <IVideo />
          </button>
          <div className="ch-hilo-mas">
            <button className="ch-boton-cab" onClick={() => setMenu((v) => !v)} aria-label="Más opciones" aria-haspopup="menu" aria-expanded={menu}>
              <IMas />
            </button>
            {menu && (
              <MenuCabecera cerrar={() => setMenu(false)}>
                <button role="menuitem" onClick={() => (setMenu(false), void almacenChat.ajustes(conversacion.id, { silenciada: !conversacion.silenciada }))}>
                  {conversacion.silenciada ? <ICampana /> : <ICampanaNo />}
                  {conversacion.silenciada ? 'Activar avisos' : 'Silenciar avisos'}
                </button>
                <button role="menuitem" onClick={() => (setMenu(false), void almacenChat.ajustes(conversacion.id, { archivada: !conversacion.archivada }))}>
                  <IArchivar />
                  {conversacion.archivada ? 'Desarchivar' : 'Archivar chat'}
                </button>
                <div className="ch-menu-sep" role="separator" />
                <button role="menuitem" onClick={() => (setMenu(false), setConfirmar('vaciar'))}>
                  <IEscoba />
                  Vaciar chat
                </button>
                <button role="menuitem" className="peligro" onClick={() => (setMenu(false), setConfirmar('bloquear'))}>
                  <IBloquear />
                  Bloquear a {otro.nombre}
                </button>
              </MenuCabecera>
            )}
          </div>
        </div>
      </header>

      {seguridad && <PanelSeguridad otro={otro} estado={cifrado} cambiar={setCifrado} cerrar={() => setSeguridad(false)} />}
      {!seguridad && <AvisoCifrado otro={otro} estado={cifrado} alRevisar={() => setSeguridad(true)} />}

      {confirmar && (
        <div className={`ch-confirmar ${confirmar}`} role="alertdialog" aria-label="Confirmar">
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
        {hilo?.hayMas && (
          <div className="ch-cargando">
            <span className="ch-giro" aria-hidden /> Cargando mensajes anteriores…
          </div>
        )}
        {!hilo && (
          <div className="ch-vacio-hilo">
            <span className="ch-giro" aria-hidden /> Cargando…
          </div>
        )}
        {hilo && mensajes.length === 0 && (
          <div className="ch-vacio-hilo ch-saludo">
            <Avatar usuario={otro} tam={72} />
            <strong>{otro.nombre}</strong>
            <span>{otro.email}</span>
            <p>Aún no hay mensajes. Escribe el primero 👋</p>
          </div>
        )}
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
          <div className={`ch-escribiendo${grabaAudio ? ' audio' : ''}`} aria-hidden>
            {grabaAudio ? (
              <>
                <IMic tam={15} />
                <span className="ch-escribiendo-onda">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </>
            ) : (
              <>
                <span />
                <span />
                <span />
              </>
            )}
          </div>
        )}
      </div>

      {nuevos > 0 ? (
        <button className="ch-nuevos" onClick={() => bajar(true)}>
          <IAbajo tam={15} /> {nuevos} mensaje{nuevos === 1 ? '' : 's'} nuevo{nuevos === 1 ? '' : 's'}
        </button>
      ) : (
        lejos && (
          <button className="ch-al-final" onClick={() => bajar(true)} aria-label="Ir al último mensaje" title="Ir al último mensaje">
            <IAbajo />
          </button>
        )
      )}
      {arrastrando && (
        <div className="ch-soltar">
          <div>
            <span className="ch-soltar-icono">
              <IDescargar tam={30} />
            </span>
            <strong>Suelta los archivos aquí</strong>
            <span>Podrás revisarlos y añadir un comentario antes de enviarlos a {otro.nombre}</span>
          </div>
        </div>
      )}
      {bandeja.length > 0 && <Bandeja elementos={bandeja} destinatario={otro.nombre} alCambiar={setBandeja} alEnviar={() => void enviarBandeja()} alCancelar={cancelarBandeja} />}
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
        alElegirArchivos={agregarABandeja}
        alEnviarNota={enviarNota}
        alEscribir={(audio) => almacenChat.escribiendo(conversacion.id, audio)}
        alDejarDeEscribir={() => almacenChat.dejarDeEscribir(conversacion.id)}
        alError={(m) => almacenChat.fijarError(m)}
      />

      {visor && medios.some((m) => m.adjunto.id === visor) && <Visor medios={medios} inicial={medios.findIndex((m) => m.adjunto.id === visor)} alCerrar={() => setVisor('')} />}
    </section>
  )
}
