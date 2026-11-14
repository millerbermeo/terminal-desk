import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { LIMITE_TEXTO_CHAT, MAX_NOTA_VOZ_MS, duracionCorta, type MensajeChat } from '@shared/chat'
import { elegirFormato } from '@shared/voz'
import { errorDeMedios } from './llamadas'

const EMOJIS = ['😀', '😂', '😊', '😍', '🥰', '😎', '🤔', '😅', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🔥', '🎉', '❤️', '💔', '✅', '❌', '⚠️', '👀', '🚀', '💡', '☕', '🍕', '🎂', '👋', '🤝']
const MIN_NOTA_MS = 700

export interface NotaGrabada {
  datos: Uint8Array
  mime: string
  duracionMs: number
}

type FaseNota = 'inactiva' | 'preparando' | 'grabando'

/** Graba una nota de voz con el micrófono: empezar, enviar (devuelve los bytes) o cancelar. */
function useNotaDeVoz(alError: (m: string) => void) {
  const [fase, setFase] = useState<FaseNota>('inactiva')
  const [ms, setMs] = useState(0)
  const grabador = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const trozos = useRef<Blob[]>([])
  const inicio = useRef(0)
  const reloj = useRef<number | undefined>(undefined)
  const descartar = useRef(false)
  const alTerminar = useRef<((n: NotaGrabada | null) => void) | null>(null)

  const soltar = useCallback((): void => {
    window.clearInterval(reloj.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    grabador.current = null
    setFase('inactiva')
    setMs(0)
  }, [])

  useEffect(() => () => {
    descartar.current = true
    if (grabador.current?.state === 'recording') grabador.current.stop()
    soltar()
  }, [soltar])

  const iniciar = useCallback(async (): Promise<void> => {
    if (fase !== 'inactiva') return
    setFase('preparando')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = s
      const mime = elegirFormato((m) => MediaRecorder.isTypeSupported(m))
      const g = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 64_000 })
      trozos.current = []
      descartar.current = false
      g.ondataavailable = (e) => e.data.size > 0 && trozos.current.push(e.data)
      g.onstop = async () => {
        const duracionMs = Date.now() - inicio.current
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
      inicio.current = Date.now()
      setFase('grabando')
      reloj.current = window.setInterval(() => {
        const t = Date.now() - inicio.current
        setMs(t)
        if (t >= MAX_NOTA_VOZ_MS) grabador.current?.stop() // al llegar al máximo se envía sola
      }, 200)
    } catch (err) {
      soltar()
      alError(errorDeMedios(err))
    }
  }, [fase, soltar, alError])

  const terminar = useCallback((): Promise<NotaGrabada | null> => {
    const g = grabador.current
    if (!g || g.state !== 'recording') return Promise.resolve(null)
    return new Promise((ok) => {
      alTerminar.current = ok
      g.stop()
    })
  }, [])

  const cancelar = useCallback((): void => {
    descartar.current = true
    if (grabador.current?.state === 'recording') grabador.current.stop()
    else soltar()
  }, [soltar])

  return { fase, ms, iniciar, terminar, cancelar }
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
  alEscribir(): void
  alError(mensaje: string): void
}

export function Compositor({ conversacionId, respondiendo, editando, autorRespondido, bloqueo, alQuitarContexto, alEnviarTexto, alGuardarEdicion, alElegirArchivos, alEnviarNota, alEscribir, alError }: Props) {
  const [texto, setTexto] = useState('')
  const [emojis, setEmojis] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const nota = useNotaDeVoz(alError)

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
    return (
      <div className="ch-compositor grabando" role="status">
        <button className="icono" onClick={nota.cancelar} aria-label="Cancelar la grabación" title="Cancelar">
          🗑
        </button>
        <span className="ch-grabando-punto" aria-hidden />
        <span className="ch-grabando-tiempo">{nota.fase === 'preparando' ? 'Preparando el micrófono…' : duracionCorta(nota.ms / 1000)}</span>
        <span className="ch-grabando-tope">máx. {duracionCorta(MAX_NOTA_VOZ_MS / 1000)}</span>
        <button
          className="primario"
          disabled={nota.fase !== 'grabando'}
          onClick={() => void nota.terminar().then((n) => n && alEnviarNota(n))}
          aria-label="Enviar la nota de voz"
        >
          Enviar
        </button>
      </div>
    )
  }

  return (
    <div className="ch-compositor">
      {(respondiendo || editando) && (
        <div className="ch-contexto">
          <div>
            <strong>{editando ? 'Editando mensaje' : `Respondiendo a ${autorRespondido ?? ''}`}</strong>
            <span>{(editando ?? respondiendo)!.texto || 'Adjunto'}</span>
          </div>
          <button className="icono" onClick={alQuitarContexto} aria-label="Cancelar">
            ✕
          </button>
        </div>
      )}
      {emojis && (
        <div className="ch-emojis" role="listbox" aria-label="Emojis">
          {EMOJIS.map((e) => (
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
      )}
      <div className="ch-campo">
        {!editando && (
          <>
            <button className="icono" onClick={() => archivo.current?.click()} aria-label="Adjuntar archivo" title="Adjuntar archivo, imagen o video">
              📎
            </button>
            <input ref={archivo} type="file" multiple hidden onChange={(e) => (alElegirArchivos([...(e.target.files ?? [])]), (e.target.value = ''))} />
          </>
        )}
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
          }}
          onKeyDown={alTeclear}
          onPaste={alPegar}
        />
        <button className="icono" onClick={() => setEmojis((v) => !v)} aria-label="Emojis" aria-expanded={emojis} title="Emojis">
          🙂
        </button>
        {texto.trim() || editando ? (
          <button className="primario ch-enviar" onClick={enviar} disabled={!texto.trim()} aria-label={editando ? 'Guardar cambios' : 'Enviar mensaje'}>
            {editando ? 'Guardar' : 'Enviar'}
          </button>
        ) : (
          <button className="icono ch-mic" onClick={() => void nota.iniciar()} aria-label="Grabar nota de voz" title="Grabar nota de voz">
            🎤
          </button>
        )}
      </div>
    </div>
  )
}
