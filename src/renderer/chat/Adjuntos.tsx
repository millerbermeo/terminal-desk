import { useCallback, useEffect, useRef, useState } from 'react'
import { duracionCorta, tamanoLegible, type AdjuntoChat } from '@shared/chat'

/** Descarga un adjunto (por main, con la sesión) y lo expone como URL local para <img>, <audio> y <video>. Se libera al desmontar. */
export function useArchivo(adjunto: AdjuntoChat, activo = true): { url?: string; error?: string; cargando: boolean } {
  const [estado, setEstado] = useState<{ url?: string; error?: string }>({})
  const local = adjunto.id.startsWith('local-')
  useEffect(() => {
    if (!activo || local) return
    let vivo = true
    let url: string | undefined
    setEstado({})
    window.api.chat
      .operar('descargar', { adjuntoId: adjunto.id })
      .then((a) => {
        url = URL.createObjectURL(new Blob([a.datos as BlobPart], { type: a.mime }))
        if (vivo) setEstado({ url })
        else URL.revokeObjectURL(url)
      })
      .catch((e: Error) => vivo && setEstado({ error: e.message }))
    return () => {
      vivo = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [adjunto.id, activo, local])
  return { ...estado, cargando: !local && activo && !estado.url && !estado.error }
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

export function ImagenChat({ adjunto, alAbrir }: { adjunto: AdjuntoChat; alAbrir: (url: string) => void }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const { url, error, cargando } = useArchivo(adjunto, visible)
  return (
    <div ref={ref} className="ch-imagen" aria-busy={cargando}>
      {url ? (
        <button className="ch-imagen-btn" onClick={() => alAbrir(url)} aria-label={`Ver imagen ${adjunto.nombre}`}>
          <img src={url} alt={adjunto.nombre} />
        </button>
      ) : (
        <div className="ch-imagen-hueco">{error ? 'No se pudo cargar la imagen' : cargando ? 'Cargando…' : adjunto.nombre}</div>
      )}
    </div>
  )
}

export function VideoChat({ adjunto }: { adjunto: AdjuntoChat }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const { url, error, cargando } = useArchivo(adjunto, visible)
  return (
    <div ref={ref} className="ch-video">
      {url ? <video src={url} controls preload="metadata" /> : <div className="ch-imagen-hueco">{error ? 'No se pudo cargar el video' : cargando ? 'Cargando…' : adjunto.nombre}</div>}
    </div>
  )
}

const VELOCIDADES = [1, 1.5, 2]

/** Nota de voz: reproducir/pausar, barra para avanzar y velocidad 1× · 1,5× · 2×. */
export function AudioChat({ adjunto, propio }: { adjunto: AdjuntoChat; propio: boolean }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [pedido, setPedido] = useState(false)
  const { url, error, cargando } = useArchivo(adjunto, visible && pedido)
  const audio = useRef<HTMLAudioElement>(null)
  const [suena, setSuena] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState((adjunto.duracionMs ?? 0) / 1000)
  const [vel, setVel] = useState(0)
  const quiereSonar = useRef(false)

  const alternar = useCallback(() => {
    const a = audio.current
    if (!url) {
      quiereSonar.current = true
      return setPedido(true)
    }
    if (!a) return
    if (a.paused) void a.play().catch(() => undefined)
    else a.pause()
  }, [url])

  // La primera vez se descarga al pulsar «reproducir» y suena en cuanto llega.
  useEffect(() => {
    if (url && quiereSonar.current) {
      quiereSonar.current = false
      void audio.current?.play().catch(() => undefined)
    }
  }, [url])

  const local = adjunto.id.startsWith('local-')
  return (
    <div ref={ref} className={`ch-audio${propio ? ' propio' : ''}`}>
      <button className="ch-audio-play" onClick={alternar} disabled={local || (cargando && pedido)} aria-label={suena ? 'Pausar' : 'Reproducir nota de voz'}>
        {suena ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <input
        className="ch-audio-barra"
        type="range"
        min={0}
        max={dur || 1}
        step={0.05}
        value={Math.min(t, dur || 1)}
        disabled={!url}
        aria-label="Posición de la nota de voz"
        onChange={(e) => {
          const v = Number(e.target.value)
          if (audio.current) audio.current.currentTime = v
          setT(v)
        }}
      />
      <span className="ch-audio-tiempo">{error ? 'Error' : duracionCorta(suena || t > 0 ? t : dur)}</span>
      <button
        className="ch-audio-vel"
        disabled={!url}
        onClick={() => {
          const n = (vel + 1) % VELOCIDADES.length
          setVel(n)
          if (audio.current) audio.current.playbackRate = VELOCIDADES[n]
        }}
        aria-label={`Velocidad ${VELOCIDADES[vel]}×`}
      >
        {String(VELOCIDADES[vel]).replace('.', ',')}×
      </button>
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
          }}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDur(e.currentTarget.duration)}
        />
      )}
    </div>
  )
}

export function ArchivoChat({ adjunto }: { adjunto: AdjuntoChat }) {
  const [estado, setEstado] = useState<'' | 'guardando' | 'guardado' | 'error'>('')
  const local = adjunto.id.startsWith('local-')
  return (
    <button
      className="ch-archivo"
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
      <span className="ch-archivo-icono" aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      </span>
      <span className="ch-archivo-datos">
        <span className="ch-archivo-nombre">{adjunto.nombre}</span>
        <span className="ch-archivo-peso">{estado === 'error' ? 'No se pudo guardar' : estado === 'guardado' ? 'Guardado' : estado === 'guardando' ? 'Guardando…' : tamanoLegible(adjunto.tamano)}</span>
      </span>
    </button>
  )
}
