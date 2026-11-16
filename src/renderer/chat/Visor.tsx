import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdjuntoChat } from '@shared/chat'
import { useArchivo } from './Adjuntos'
import { ICerrar, IDescargar, IPlay, IVolver } from './Iconos'

export interface MedioVisor {
  adjunto: AdjuntoChat
  tipo: 'image' | 'video'
  autor: string
  creado: string
  texto: string
}

const fecha = (iso: string): string => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Miniatura({ m, activa, alElegir }: { m: MedioVisor; activa: boolean; alElegir: () => void }) {
  const { url } = useArchivo(m.adjunto, m.tipo === 'image')
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (activa) ref.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activa])
  return (
    <button ref={ref} className={`ch-visor-mini${activa ? ' activa' : ''}`} onClick={alElegir} aria-label={m.adjunto.nombre} aria-current={activa}>
      {url ? <img src={url} alt="" /> : <span className="ch-visor-mini-video">{m.tipo === 'video' ? <IPlay tam={14} /> : null}</span>}
    </button>
  )
}

/** Imagen con zoom (rueda, doble clic o los botones) y arrastre cuando está ampliada. */
function ImagenAmpliable({ url, nombre }: { url: string; nombre: string }) {
  const [zoom, setZoom] = useState(1)
  const [desp, setDesp] = useState({ x: 0, y: 0 })
  const arrastre = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)
  useEffect(() => {
    setZoom(1)
    setDesp({ x: 0, y: 0 })
  }, [url])
  const fijar = (z: number): void => {
    const n = Math.min(5, Math.max(1, z))
    setZoom(n)
    if (n === 1) setDesp({ x: 0, y: 0 })
  }
  return (
    <div
      className={`ch-visor-lienzo${zoom > 1 ? ' ampliada' : ''}`}
      onWheel={(e) => fijar(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
      onDoubleClick={() => fijar(zoom > 1 ? 1 : 2.5)}
      onPointerDown={(e) => {
        if (zoom === 1) return
        arrastre.current = { x: e.clientX, y: e.clientY, dx: desp.x, dy: desp.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const a = arrastre.current
        if (a) setDesp({ x: a.dx + (e.clientX - a.x) / zoom, y: a.dy + (e.clientY - a.y) / zoom })
      }}
      onPointerUp={() => (arrastre.current = null)}
    >
      <img key={url} src={url} alt={nombre} draggable={false} style={{ transform: `scale(${zoom}) translate(${desp.x}px, ${desp.y}px)` }} />
      <div className="ch-visor-zoom" onDoubleClick={(e) => e.stopPropagation()}>
        <button onClick={() => fijar(zoom / 1.4)} disabled={zoom <= 1} aria-label="Alejar">
          −
        </button>
        <span>{Math.round(zoom * 100)} %</span>
        <button onClick={() => fijar(zoom * 1.4)} disabled={zoom >= 5} aria-label="Acercar">
          +
        </button>
      </div>
    </div>
  )
}

/**
 * Visor a pantalla completa de las fotos y videos de la conversación: flechas (o ← →) para pasar de uno a otro, tira de miniaturas,
 * zoom en las imágenes, descargar y pantalla completa real del sistema. Esc cierra.
 */
export function Visor({ medios, inicial, alCerrar }: { medios: MedioVisor[]; inicial: number; alCerrar: () => void }) {
  const [i, setI] = useState(inicial)
  const [direccion, setDireccion] = useState<'izq' | 'der' | ''>('')
  const actual = medios[i]
  const { url, error, cargando } = useArchivo(actual?.adjunto ?? { id: '', nombre: '', mime: '', tamano: 0, duracionMs: null }, !!actual)
  const raiz = useRef<HTMLDivElement>(null)

  const ir = useCallback(
    (paso: number) => {
      setI((x) => {
        const n = x + paso
        if (n < 0 || n >= medios.length) return x
        setDireccion(paso > 0 ? 'der' : 'izq')
        return n
      })
    },
    [medios.length]
  )

  useEffect(() => {
    raiz.current?.focus()
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
        else alCerrar()
      } else if (e.key === 'ArrowRight') ir(1)
      else if (e.key === 'ArrowLeft') ir(-1)
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [ir, alCerrar])

  useEffect(() => () => void (document.fullscreenElement && document.exitFullscreen().catch(() => undefined)), [])

  if (!actual) return null
  const pantallaCompleta = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void raiz.current?.requestFullscreen().catch(() => undefined)
  }
  return (
    <div className="ch-visor" role="dialog" aria-modal="true" aria-label={`${actual.tipo === 'video' ? 'Video' : 'Imagen'} ${i + 1} de ${medios.length}`} tabIndex={-1} ref={raiz}>
      <header className="ch-visor-cab">
        <div className="ch-visor-quien">
          <strong>{actual.autor}</strong>
          <span>
            {fecha(actual.creado)} · {i + 1} de {medios.length}
          </span>
        </div>
        <div className="ch-visor-barra">
          <button className="ch-boton-visor" onClick={pantallaCompleta} aria-label="Pantalla completa" title="Pantalla completa">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
          <button
            className="ch-boton-visor"
            onClick={() => void window.api.chat.operar('guardarComo', { adjuntoId: actual.adjunto.id, nombre: actual.adjunto.nombre }).catch(() => undefined)}
            disabled={actual.adjunto.id.startsWith('local-')}
            aria-label="Descargar"
            title="Guardar en tu equipo"
          >
            <IDescargar />
          </button>
          <button className="ch-boton-visor" onClick={alCerrar} aria-label="Cerrar" title="Cerrar (Esc)">
            <ICerrar />
          </button>
        </div>
      </header>

      <div className="ch-visor-escena" onClick={(e) => e.target === e.currentTarget && alCerrar()}>
        {i > 0 && (
          <button className="ch-visor-flecha izq" onClick={() => ir(-1)} aria-label="Anterior">
            <IVolver />
          </button>
        )}
        <div key={actual.adjunto.id} className={`ch-visor-medio ${direccion}`}>
          {error ? (
            <p className="ch-visor-error">No se pudo cargar {actual.tipo === 'video' ? 'el video' : 'la imagen'}.</p>
          ) : !url || cargando ? (
            <span className="ch-giro ch-giro-grande" aria-label="Cargando" />
          ) : actual.tipo === 'video' ? (
            <video src={url} controls autoPlay playsInline />
          ) : (
            <ImagenAmpliable url={url} nombre={actual.adjunto.nombre} />
          )}
        </div>
        {i < medios.length - 1 && (
          <button className="ch-visor-flecha der" onClick={() => ir(1)} aria-label="Siguiente">
            <IVolver />
          </button>
        )}
      </div>

      {actual.texto && <p className="ch-visor-pie">{actual.texto}</p>}
      {medios.length > 1 && (
        <div className="ch-visor-tira" role="listbox" aria-label="Fotos y videos">
          {medios.map((m, n) => (
            <Miniatura key={m.adjunto.id} m={m} activa={n === i} alElegir={() => (setDireccion(n > i ? 'der' : 'izq'), setI(n))} />
          ))}
        </div>
      )}
    </div>
  )
}
