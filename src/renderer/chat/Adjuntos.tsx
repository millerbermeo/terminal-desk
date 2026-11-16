import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as EventoPuntero } from 'react'
import { duracionCorta, tamanoLegible, type AdjuntoChat } from '@shared/chat'
import { previasLocales } from './almacen'
import { IDescargar, IMic, IPausa, IPlay } from './Iconos'

// ---------------------------------------------------------------------------------------------------------------- descargas

interface Descargado {
  url: string
  datos?: Uint8Array
  mime: string
}

/** Descargas ya hechas (o en curso) por id de adjunto: la burbuja, el visor y la onda de una nota de voz comparten una sola. */
const cache = new Map<string, Promise<Descargado>>()
const MAX_CACHE = 80

function descargar(adjunto: AdjuntoChat): Promise<Descargado> {
  const local = previasLocales.get(adjunto.id)
  if (local) return Promise.resolve({ url: local, mime: adjunto.mime })
  let p = cache.get(adjunto.id)
  if (!p) {
    p = window.api.chat.operar('descargar', { adjuntoId: adjunto.id }).then((a) => ({ url: URL.createObjectURL(new Blob([a.datos as BlobPart], { type: a.mime })), datos: a.datos, mime: a.mime }))
    p.catch(() => cache.delete(adjunto.id))
    cache.set(adjunto.id, p)
    // Se liberan las más antiguas (sus URL dejan de valer: una burbuja que vuelva a la vista la descarga otra vez).
    while (cache.size > MAX_CACHE) {
      const [id, viejo] = cache.entries().next().value as [string, Promise<Descargado>]
      cache.delete(id)
      void viejo.then((d) => URL.revokeObjectURL(d.url)).catch(() => undefined)
    }
  }
  return p
}

/** Descarga un adjunto (por main, con la sesión) y lo expone como URL local para <img>, <audio> y <video>. */
export function useArchivo(adjunto: AdjuntoChat, activo = true): { url?: string; datos?: Uint8Array; error?: string; cargando: boolean } {
  const previa = previasLocales.get(adjunto.id)
  const [estado, setEstado] = useState<{ url?: string; datos?: Uint8Array; error?: string; de?: string }>({})
  const pendiente = adjunto.id.startsWith('local-') && !previa
  useEffect(() => {
    if (!activo || pendiente || previa) return
    let vivo = true
    descargar(adjunto)
      .then((d) => vivo && setEstado({ url: d.url, ...(d.datos ? { datos: d.datos } : {}), de: adjunto.id }))
      .catch((e: Error) => vivo && setEstado({ error: e.message, de: adjunto.id }))
    return () => {
      vivo = false
    }
  }, [adjunto, activo, pendiente, previa])
  if (previa) return { url: previa, cargando: false }
  const vale = estado.de === adjunto.id ? estado : {}
  return { ...vale, cargando: !pendiente && activo && !vale.url && !vale.error }
}

/** Solo descarga cuando el elemento está (casi) a la vista: un chat largo no baja cien imágenes a la vez. */
function useVisible<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    if (typeof IntersectionObserver === 'undefined') return setVisible(true)
    const o = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '200px' })
    o.observe(el)
    return () => o.disconnect()
  }, [visible])
  return [ref, visible]
}

/** Velo con un anillo que gira mientras el archivo se sube. */
function Subiendo({ tamano }: { tamano: number }) {
  return (
    <span className="ch-subiendo" role="status" aria-label="Subiendo">
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden>
        <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle className="ch-subiendo-arco" cx="22" cy="22" r="18" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <small>{tamanoLegible(tamano)}</small>
    </span>
  )
}

// ---------------------------------------------------------------------------------------------------------------- imagen y video

export function ImagenChat({ adjunto, alAbrir }: { adjunto: AdjuntoChat; alAbrir: () => void }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const { url, error, cargando } = useArchivo(adjunto, visible)
  const subiendo = adjunto.id.startsWith('local-')
  return (
    <div ref={ref} className={`ch-imagen${subiendo ? ' subiendo' : ''}`} aria-busy={cargando || subiendo}>
      {url ? (
        <button className="ch-imagen-btn" onClick={alAbrir} disabled={subiendo} aria-label={`Ver imagen ${adjunto.nombre}`}>
          <img src={url} alt={adjunto.nombre} />
          {subiendo && <Subiendo tamano={adjunto.tamano} />}
        </button>
      ) : (
        <div className={`ch-imagen-hueco${cargando || subiendo ? ' cargando' : ''}`}>{error ? 'No se pudo cargar la imagen' : cargando ? '' : adjunto.nombre}</div>
      )}
    </div>
  )
}

/** Video: miniatura con su duración y un botón de reproducir; al pulsar se abre en el visor a pantalla completa. */
export function VideoChat({ adjunto, alAbrir }: { adjunto: AdjuntoChat; alAbrir: () => void }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const { url, error, cargando } = useArchivo(adjunto, visible)
  const [dur, setDur] = useState(0)
  const subiendo = adjunto.id.startsWith('local-')
  return (
    <div ref={ref} className={`ch-video${subiendo ? ' subiendo' : ''}`}>
      {url ? (
        <button className="ch-video-btn" onClick={alAbrir} disabled={subiendo} aria-label={`Ver video ${adjunto.nombre}`}>
          <video src={url} muted playsInline preload="metadata" onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)} />
          {subiendo ? (
            <Subiendo tamano={adjunto.tamano} />
          ) : (
            <span className="ch-video-play" aria-hidden>
              <IPlay tam={22} />
            </span>
          )}
          {dur > 0 && <span className="ch-video-dur">{duracionCorta(dur)}</span>}
        </button>
      ) : (
        <div className={`ch-imagen-hueco${cargando || subiendo ? ' cargando' : ''}`}>{error ? 'No se pudo cargar el video' : cargando ? '' : adjunto.nombre}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------- nota de voz

const VELOCIDADES = [1, 1.5, 2]
const BARRAS_ONDA = 42

/** Onda de reserva (mientras se decodifica, o si no se puede): pseudoaleatoria pero estable para cada nota. */
function ondaFalsa(id: string): number[] {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return Array.from({ length: BARRAS_ONDA }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    return 0.25 + 0.55 * Math.abs(Math.sin(i * 0.55)) * ((h % 1000) / 1000)
  })
}

const ondas = new Map<string, number[]>()
let contextoAudio: AudioContext | undefined

/** Picos de la nota (0–1, `BARRAS_ONDA` barras) a partir del audio decodificado. */
async function calcularOnda(id: string, datos: Uint8Array): Promise<number[]> {
  const hecha = ondas.get(id)
  if (hecha) return hecha
  contextoAudio ??= new AudioContext()
  const buf = await contextoAudio.decodeAudioData(datos.slice().buffer)
  const canal = buf.getChannelData(0)
  const paso = Math.max(1, Math.floor(canal.length / BARRAS_ONDA))
  const picos: number[] = []
  for (let b = 0; b < BARRAS_ONDA; b++) {
    let suma = 0
    const fin = Math.min(canal.length, (b + 1) * paso)
    for (let i = b * paso; i < fin; i++) suma += canal[i]! * canal[i]!
    picos.push(Math.sqrt(suma / Math.max(1, fin - b * paso)))
  }
  const max = Math.max(...picos, 0.0001)
  const onda = picos.map((p) => 0.12 + 0.88 * Math.pow(p / max, 0.8))
  ondas.set(id, onda)
  return onda
}

/** Solo suena una nota a la vez: al empezar otra, la anterior se pausa. */
let sonando: HTMLAudioElement | null = null

/** Nota de voz al estilo WhatsApp: reproducir/pausar, onda que se colorea al avanzar (y se puede pulsar o arrastrar) y velocidad 1× · 1,5× · 2×. */
export function AudioChat({ adjunto, propio }: { adjunto: AdjuntoChat; propio: boolean }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const local = adjunto.id.startsWith('local-')
  const { url, datos, error, cargando } = useArchivo(adjunto, visible)
  const audio = useRef<HTMLAudioElement>(null)
  const [suena, setSuena] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState((adjunto.duracionMs ?? 0) / 1000)
  const [vel, setVel] = useState(0)
  const [onda, setOnda] = useState<number[]>(() => ondas.get(adjunto.id) ?? ondaFalsa(adjunto.id))
  const quiereSonar = useRef(false)
  const arrastrando = useRef(false)

  useEffect(() => {
    if (!datos) return
    let vivo = true
    calcularOnda(adjunto.id, datos)
      .then((o) => vivo && setOnda(o))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [adjunto.id, datos])

  const alternar = useCallback(() => {
    const a = audio.current
    if (!a) {
      quiereSonar.current = true
      return
    }
    if (a.paused) {
      if (sonando && sonando !== a) sonando.pause()
      sonando = a
      a.playbackRate = VELOCIDADES[vel]!
      void a.play().catch(() => undefined)
    } else a.pause()
  }, [vel])

  // Si se pulsó «reproducir» antes de que llegara el audio, suena en cuanto llega.
  useEffect(() => {
    if (url && quiereSonar.current && audio.current) {
      quiereSonar.current = false
      alternar()
    }
  }, [url, alternar])

  const progreso = dur > 0 ? Math.min(1, t / dur) : 0
  const buscar = (e: EventoPuntero<HTMLDivElement>): void => {
    const a = audio.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    const v = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur
    a.currentTime = v
    setT(v)
  }

  const barras = useMemo(() => onda, [onda])
  const pendiente = local || (cargando && quiereSonar.current)
  return (
    <div ref={ref} className={`ch-audio${propio ? ' propio' : ''}${suena ? ' sonando' : ''}`}>
      <button className="ch-audio-play" onClick={alternar} disabled={local || !!error} aria-label={suena ? 'Pausar' : 'Reproducir nota de voz'}>
        {pendiente ? <span className="ch-giro" aria-hidden /> : suena ? <IPausa tam={15} /> : <IPlay tam={15} />}
      </button>
      <div className="ch-audio-cuerpo">
        <div
          className="ch-onda-nota"
          role="slider"
          tabIndex={url ? 0 : -1}
          aria-label="Posición de la nota de voz"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          style={{ ['--avance' as string]: progreso }}
          onPointerDown={(e) => {
            if (!url) return
            arrastrando.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            buscar(e)
          }}
          onPointerMove={(e) => arrastrando.current && buscar(e)}
          onPointerUp={() => (arrastrando.current = false)}
          onKeyDown={(e) => {
            const a = audio.current
            if (!a || !dur) return
            if (e.key === 'ArrowRight') a.currentTime = Math.min(dur, a.currentTime + 5)
            else if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 5)
            else if (e.key === ' ' || e.key === 'Enter') (e.preventDefault(), alternar())
          }}
        >
          {barras.map((h, i) => (
            <i key={i} className={i / barras.length < progreso ? 'oida' : ''} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
          <span className="ch-onda-cursor" aria-hidden />
        </div>
        <div className="ch-audio-pie">
          <span className="ch-audio-tiempo">{error ? 'Error' : duracionCorta(suena || t > 0 ? t : dur)}</span>
          {(suena || t > 0) && (
            <button
              className="ch-audio-vel"
              onClick={() => {
                const n = (vel + 1) % VELOCIDADES.length
                setVel(n)
                if (audio.current) audio.current.playbackRate = VELOCIDADES[n]!
              }}
              aria-label={`Velocidad ${VELOCIDADES[vel]}×`}
              title="Cambiar velocidad"
            >
              {String(VELOCIDADES[vel]).replace('.', ',')}×
            </button>
          )}
        </div>
      </div>
      {!suena && t === 0 && (
        <span className="ch-audio-mic" aria-hidden>
          <IMic tam={14} />
        </span>
      )}
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setSuena(true)}
          onPause={() => setSuena(false)}
          onEnded={() => {
            setSuena(false)
            setT(0)
            if (sonando === audio.current) sonando = null
          }}
          onTimeUpdate={(e) => !arrastrando.current && setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDur(e.currentTarget.duration)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------- otros archivos

/** Familia de la extensión para colorear la etiqueta del archivo. */
export function claseExtension(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(e)) return 'doc'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return 'hoja'
  if (['ppt', 'pptx', 'key', 'odp'].includes(e)) return 'presentacion'
  if (['zip', 'rar', '7z', 'gz', 'tar', 'tgz'].includes(e)) return 'comprimido'
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'sql', 'html', 'css', 'yml', 'yaml'].includes(e)) return 'codigo'
  return 'otro'
}

export const extensionDe = (nombre: string): string => /\.([a-z0-9]{1,8})$/i.exec(nombre)?.[1]?.toUpperCase() ?? ''

export function ArchivoChat({ adjunto }: { adjunto: AdjuntoChat }) {
  const [estado, setEstado] = useState<'' | 'guardando' | 'guardado' | 'error'>('')
  const ext = extensionDe(adjunto.nombre)
  const local = adjunto.id.startsWith('local-')
  return (
    <button
      className={`ch-archivo${local ? ' subiendo' : ''}`}
      disabled={local || estado === 'guardando'}
      onClick={() => {
        setEstado('guardando')
        window.api.chat
          .operar('guardarComo', { adjuntoId: adjunto.id, nombre: adjunto.nombre })
          .then((ok) => setEstado(ok ? 'guardado' : ''))
          .catch(() => setEstado('error'))
      }}
      title="Guardar en tu equipo"
    >
      <span className={`ch-archivo-icono ext-${claseExtension(ext)}`} aria-hidden>
        {ext.slice(0, 4) || 'ARCH'}
      </span>
      <span className="ch-archivo-datos">
        <span className="ch-archivo-nombre">{adjunto.nombre}</span>
        <span className="ch-archivo-peso">
          {local ? 'Subiendo…' : estado === 'error' ? 'No se pudo guardar' : estado === 'guardado' ? 'Guardado ✓' : estado === 'guardando' ? 'Guardando…' : `${tamanoLegible(adjunto.tamano)}${ext ? ` · ${ext}` : ''}`}
        </span>
        {local && <span className="ch-barra-indeterminada" aria-hidden />}
      </span>
      <span className="ch-archivo-bajar" aria-hidden>
        {local || estado === 'guardando' ? <span className="ch-giro" /> : <IDescargar tam={16} />}
      </span>
    </button>
  )
}
