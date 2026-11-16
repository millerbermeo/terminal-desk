import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { LIMITE_TEXTO_CHAT, MAX_NOTA_VOZ_MS, duracionCorta, type MensajeChat } from '@shared/chat'
import { elegirFormato } from '@shared/voz'
import { errorDeMedios } from './llamadas'
import { IBasura, IClip, ICerrar, IEditar, IEmoji, IEnviar, IMic, IPausa, IResponder } from './Iconos'

const GRUPOS_EMOJI: { nombre: string; emojis: string[] }[] = [
  { nombre: 'Caras', emojis: ['😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🤔', '🤨', '😐', '🙄', '😅', '😬', '😴', '🤯', '😭', '😢', '😡', '🤬', '🥳', '😱', '🤗', '🤫'] },
  { nombre: 'Gestos', emojis: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '🤝', '✌️', '🤞', '👌', '🤙', '👀', '🫡', '🫶'] },
  { nombre: 'Símbolos', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '🔥', '✨', '🎉', '✅', '❌', '⚠️', '💯', '🚀', '💡', '⭐', '☕', '🍕', '🎂'] }
]
const MIN_NOTA_MS = 700

export interface NotaGrabada {
  datos: Uint8Array
  mime: string
  duracionMs: number
}

type FaseNota = 'inactiva' | 'preparando' | 'grabando' | 'pausada'

/** Barras de la onda en vivo mientras se graba (la más reciente a la derecha). */
const BARRAS_VIVO = 56
const CADA_MS = 70

/**
 * Graba una nota de voz con el micrófono: empezar, pausar/reanudar, enviar (devuelve los bytes) o cancelar. Mientras graba mide el
 * volumen real (AnalyserNode) para dibujar la onda en vivo.
 */
function useNotaDeVoz(alError: (m: string) => void, alLatido: () => void) {
  const [fase, setFase] = useState<FaseNota>('inactiva')
  const [ms, setMs] = useState(0)
  const [niveles, setNiveles] = useState<number[]>(() => Array(BARRAS_VIVO).fill(0.08))
  const grabador = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const contexto = useRef<AudioContext | null>(null)
  const analizador = useRef<AnalyserNode | null>(null)
  const trozos = useRef<Blob[]>([])
  const acumulado = useRef(0) // ms grabados antes de la última pausa
  const desde = useRef(0) // inicio del tramo actual
  const reloj = useRef<number | undefined>(undefined)
  const descartar = useRef(false)
  const alTerminar = useRef<((n: NotaGrabada | null) => void) | null>(null)
  const latido = useRef(alLatido)
  latido.current = alLatido

  const soltar = useCallback((): void => {
    window.clearInterval(reloj.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void contexto.current?.close().catch(() => undefined)
    contexto.current = null
    analizador.current = null
    grabador.current = null
    setFase('inactiva')
    setMs(0)
    setNiveles(Array(BARRAS_VIVO).fill(0.08))
  }, [])

  useEffect(() => () => {
    descartar.current = true
    if (grabador.current && grabador.current.state !== 'inactive') grabador.current.stop()
    soltar()
  }, [soltar])

  const iniciar = useCallback(async (): Promise<void> => {
    if (fase !== 'inactiva') return
    setFase('preparando')
    const transcurrido = (): number => acumulado.current + (grabador.current?.state === 'recording' ? Date.now() - desde.current : 0)
    const medir = (): number => {
      const a = analizador.current
      if (!a) return 0
      const datos = new Uint8Array(a.fftSize)
      a.getByteTimeDomainData(datos)
      let suma = 0
      for (const v of datos) suma += ((v - 128) / 128) ** 2
      return Math.min(1, Math.sqrt(suma / datos.length) * 4.2)
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      stream.current = s
      try {
        const ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        an.smoothingTimeConstant = 0.6
        ctx.createMediaStreamSource(s).connect(an)
        contexto.current = ctx
        analizador.current = an
      } catch {
        // sin análisis: la onda queda plana, la grabación sigue
      }
      const mime = elegirFormato((m) => MediaRecorder.isTypeSupported(m))
      const g = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 64_000 })
      trozos.current = []
      descartar.current = false
      acumulado.current = 0
      g.ondataavailable = (e) => e.data.size > 0 && trozos.current.push(e.data)
      g.onstop = async () => {
        const duracionMs = acumulado.current
        const tipo = g.mimeType || mime || 'audio/webm'
        const blob = new Blob(trozos.current, { type: tipo })
        const cb = alTerminar.current
        alTerminar.current = null
        soltar()
        if (descartar.current || duracionMs < MIN_NOTA_MS || blob.size === 0) return cb?.(null)
        cb?.({ datos: new Uint8Array(await blob.arrayBuffer()), mime: tipo, duracionMs })
      }
      g.start(250)
      grabador.current = g
      desde.current = Date.now()
      setFase('grabando')
      let vueltas = 0
      reloj.current = window.setInterval(() => {
        const t = transcurrido()
        setMs(t)
        if (grabador.current?.state === 'recording') {
          const nivel = medir()
          setNiveles((n) => [...n.slice(1), Math.max(0.08, nivel)])
          if (++vueltas % 40 === 0) latido.current() // ~cada 3 s: «grabando audio…» al otro
        }
        if (t >= MAX_NOTA_VOZ_MS && grabador.current?.state === 'recording') {
          acumulado.current = t
          grabador.current.stop() // al llegar al máximo se envía sola
        }
      }, CADA_MS)
      latido.current()
    } catch (err) {
      soltar()
      alError(errorDeMedios(err))
    }
  }, [fase, soltar, alError])

  const pausar = useCallback((): void => {
    const g = grabador.current
    if (!g) return
    if (g.state === 'recording') {
      acumulado.current += Date.now() - desde.current
      g.pause()
      setFase('pausada')
    } else if (g.state === 'paused') {
      desde.current = Date.now()
      g.resume()
      setFase('grabando')
    }
  }, [])

  const terminar = useCallback((): Promise<NotaGrabada | null> => {
    const g = grabador.current
    if (!g || g.state === 'inactive') return Promise.resolve(null)
    if (g.state === 'recording') acumulado.current += Date.now() - desde.current
    return new Promise((ok) => {
      alTerminar.current = ok
      g.stop()
    })
  }, [])

  const cancelar = useCallback((): void => {
    descartar.current = true
    if (grabador.current && grabador.current.state !== 'inactive') grabador.current.stop()
    else soltar()
  }, [soltar])

  return { fase, ms, niveles, iniciar, pausar, terminar, cancelar }
}

interface Props {
  conversacionId: string
  respondiendo?: MensajeChat
  editando?: MensajeChat
  /** A quién se responde («Ana», «ti mismo»). */
  autorRespondido?: string
  /** Si hay motivo, no se puede escribir y se muestra en lugar del campo. */
  bloqueo?: string
  alQuitarContexto(): void
  alEnviarTexto(texto: string): void
  alGuardarEdicion(texto: string): void
  alElegirArchivos(archivos: File[]): void
  alEnviarNota(n: NotaGrabada): void
  /** Avisa al otro de que se está escribiendo (o grabando, con `audio`). */
  alEscribir(audio?: boolean): void
  alDejarDeEscribir(): void
  alError(mensaje: string): void
}

export function Compositor({ conversacionId, respondiendo, editando, autorRespondido, bloqueo, alQuitarContexto, alEnviarTexto, alGuardarEdicion, alElegirArchivos, alEnviarNota, alEscribir, alDejarDeEscribir, alError }: Props) {
  const [texto, setTexto] = useState('')
  const [emojis, setEmojis] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const nota = useNotaDeVoz(alError, () => alEscribir(true))
  const [lanzado, setLanzado] = useState(0) // sube en cada envío: reinicia la animación del botón

  // Cada conversación empieza con su campo limpio; al editar, con el texto del mensaje.
  useEffect(() => {
    setTexto(editando?.texto ?? '')
    setEmojis(false)
  }, [conversacionId, editando?.id, editando?.texto])
  useEffect(() => {
    if (editando || respondiendo) area.current?.focus()
  }, [editando, respondiendo])
  // Altura según el contenido (hasta ~8 líneas).
  useEffect(() => {
    const a = area.current
    if (!a) return
    a.style.height = 'auto'
    a.style.height = `${Math.min(a.scrollHeight, 180)}px`
  }, [texto])

  const enviar = (): void => {
    const t = texto.trim()
    if (!t) return
    if (editando) alGuardarEdicion(t)
    else alEnviarTexto(t)
    setLanzado((n) => n + 1)
    setTexto('')
    setEmojis(false)
  }

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      enviar()
    } else if (e.key === 'Escape' && (editando || respondiendo)) {
      alQuitarContexto()
      if (editando) setTexto('')
    }
  }

  const alPegar = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const imagenes = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (imagenes.length === 0) return
    e.preventDefault()
    alElegirArchivos(imagenes.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `captura-${Date.now()}-${i}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))))
  }

  if (bloqueo) return <div className="ch-compositor bloqueado">{bloqueo}</div>

  if (nota.fase !== 'inactiva') {
    const grabando = nota.fase === 'grabando'
    return (
      <div className={`ch-compositor grabando${nota.fase === 'pausada' ? ' pausada' : ''}`} role="status">
        <button className="ch-boton-redondo ch-boton-tenue ch-grabando-borrar" onClick={() => (nota.cancelar(), alDejarDeEscribir())} aria-label="Cancelar la grabación" title="Descartar">
          <IBasura />
        </button>
        <div className="ch-grabando-cuerpo">
          <span className="ch-grabando-punto" aria-hidden />
          <span className="ch-grabando-tiempo">{nota.fase === 'preparando' ? 'Preparando el micrófono…' : duracionCorta(nota.ms / 1000)}</span>
          {nota.fase !== 'preparando' && (
            <span className="ch-onda" aria-hidden>
              {nota.niveles.map((h, i) => (
                <i key={i} style={{ transform: `scaleY(${h})` }} />
              ))}
            </span>
          )}
          <span className="ch-grabando-tope">{nota.fase === 'pausada' ? 'En pausa' : `máx. ${duracionCorta(MAX_NOTA_VOZ_MS / 1000)}`}</span>
        </div>
        {nota.fase !== 'preparando' && (
          <button className="ch-boton-redondo ch-boton-tenue ch-grabando-pausa" onClick={nota.pausar} aria-label={grabando ? 'Pausar la grabación' : 'Seguir grabando'} title={grabando ? 'Pausar' : 'Seguir grabando'}>
            {grabando ? <IPausa tam={16} /> : <IMic />}
          </button>
        )}
        <button className="ch-boton-redondo ch-boton-enviar" disabled={nota.fase === 'preparando'} onClick={() => void nota.terminar().then((n) => n && alEnviarNota(n))} aria-label="Enviar la nota de voz" title="Enviar">
          <IEnviar />
        </button>
      </div>
    )
  }

  return (
    <div className="ch-compositor">
      {(respondiendo || editando) && (
        <div className="ch-contexto">
          <span className="ch-contexto-icono">{editando ? <IEditar tam={16} /> : <IResponder tam={16} />}</span>
          <div>
            <strong>{editando ? 'Editando mensaje' : `Respondiendo a ${autorRespondido ?? ''}`}</strong>
            <span>{(editando ?? respondiendo)!.texto || 'Adjunto'}</span>
          </div>
          <button className="icono" onClick={alQuitarContexto} aria-label="Cancelar">
            <ICerrar tam={14} />
          </button>
        </div>
      )}
      {emojis && (
        <div className="ch-emojis" role="listbox" aria-label="Emojis">
          {GRUPOS_EMOJI.map((g) => (
            <div key={g.nombre} className="ch-emojis-grupo">
              <span>{g.nombre}</span>
              <div>
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      setTexto((t) => t + e)
                      area.current?.focus()
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="ch-barra-compositor">
        {lanzado > 0 && (
          <span key={lanzado} className="ch-lanzado" aria-hidden>
            <IEnviar />
          </span>
        )}
        {!editando && (
          <>
            <button className="ch-boton-redondo ch-boton-tenue" onClick={() => archivo.current?.click()} aria-label="Adjuntar archivo" title="Adjuntar archivo, imagen o video">
              <IClip />
            </button>
            <input ref={archivo} type="file" multiple hidden onChange={(e) => (alElegirArchivos([...(e.target.files ?? [])]), (e.target.value = ''))} />
          </>
        )}
        <div className="ch-campo">
          <textarea
            ref={area}
            value={texto}
            rows={1}
            maxLength={LIMITE_TEXTO_CHAT}
            placeholder={editando ? 'Edita el mensaje' : 'Escribe un mensaje'}
            aria-label="Mensaje"
            onChange={(e) => {
              setTexto(e.target.value)
              if (!editando && e.target.value) alEscribir()
              else if (!editando && texto) alDejarDeEscribir()
            }}
            onKeyDown={alTeclear}
            onPaste={alPegar}
          />
          <button className={`ch-emoji-btn${emojis ? ' activo' : ''}`} onClick={() => setEmojis((v) => !v)} aria-label="Emojis" aria-expanded={emojis} title="Emojis">
            <IEmoji />
          </button>
        </div>
        {texto.trim() || editando ? (
          <button key="enviar" className="ch-boton-redondo ch-boton-enviar" onClick={enviar} disabled={!texto.trim()} aria-label={editando ? 'Guardar cambios' : 'Enviar mensaje'} title={editando ? 'Guardar' : 'Enviar (Enter)'}>
            <IEnviar />
          </button>
        ) : (
          <button key="mic" className="ch-boton-redondo ch-boton-tenue ch-mic" onClick={() => void nota.iniciar()} aria-label="Grabar nota de voz" title="Grabar nota de voz">
            <IMic />
          </button>
        )}
      </div>
    </div>
  )
}
