import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { LIMITE_TEXTO_CHAT, MAX_NOTA_VOZ_MS, duracionCorta, type MensajeChat } from '@shared/chat'
import { GrabadorNota, type DependenciasNota, type FaseNota, type FlujoNota, type GrabadorNotaNativo, type NotaGrabada } from './nota-voz'
import { errorDeMedios } from './llamadas'
import { IBasura, IClip, ICerrar, IEditar, IEmoji, IEnviar, IMic, IPausa, IResponder } from './Iconos'

const GRUPOS_EMOJI: { nombre: string; emojis: string[] }[] = [
  { nombre: 'Caras', emojis: ['😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🤔', '🤨', '😐', '🙄', '😅', '😬', '😴', '🤯', '😭', '😢', '😡', '🤬', '🥳', '😱', '🤗', '🤫'] },
  { nombre: 'Gestos', emojis: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '🤝', '✌️', '🤞', '👌', '🤙', '👀', '🫡', '🫶'] },
  { nombre: 'Símbolos', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '🔥', '✨', '🎉', '✅', '❌', '⚠️', '💯', '🚀', '💡', '⭐', '☕', '🍕', '🎂'] }
]
/** Barras de la onda en vivo mientras se graba (la más reciente a la derecha). */
const BARRAS_VIVO = 56
const CADA_MS = 70
const ONDA_VACIA = (): number[] => Array(BARRAS_VIVO).fill(0.08)

/** Micrófono, `MediaRecorder` y medidor de volumen reales para `GrabadorNota`. */
const dependenciasNavegador = (): DependenciasNota => ({
  abrir: async () => (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })) as unknown as FlujoNota,
  grabador: (flujo, mime) =>
    new MediaRecorder(flujo as MediaStream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 64_000 }) as unknown as GrabadorNotaNativo,
  admite: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  medidor: (flujo) => {
    try {
      const ctx = new AudioContext()
      void ctx.resume().catch(() => undefined) // un contexto suspendido no mide nada y la onda quedaría plana
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      an.smoothingTimeConstant = 0.6
      ctx.createMediaStreamSource(flujo as MediaStream).connect(an)
      const datos = new Uint8Array(an.fftSize)
      return {
        nivel: () => {
          an.getByteTimeDomainData(datos)
          let suma = 0
          for (const v of datos) suma += ((v - 128) / 128) ** 2
          return Math.min(1, Math.sqrt(suma / datos.length) * 4.2)
        },
        cerrar: () => void ctx.close().catch(() => undefined)
      }
    } catch {
      return null // sin análisis: la onda queda plana, la grabación sigue
    }
  },
  esperar: (ms) => new Promise((ok) => window.setTimeout(ok, ms)),
  ahora: () => Date.now(),
  explicar: errorDeMedios
})

/**
 * Nota de voz con el micrófono: empezar, pausar/reanudar, enviar (devuelve los bytes) o cancelar. La lógica está en `GrabadorNota`;
 * aquí solo se repinta el tiempo y la onda en vivo, y se avisa al otro de «grabando audio…».
 */
function useNotaDeVoz(alError: (m: string) => void, alLatido: () => void, alAutomatica: (n: NotaGrabada) => void) {
  const [fase, setFase] = useState<FaseNota>('inactiva')
  const [ms, setMs] = useState(0)
  const [niveles, setNiveles] = useState<number[]>(ONDA_VACIA)
  const avisos = useRef({ alError, alLatido, alAutomatica })
  avisos.current = { alError, alLatido, alAutomatica }
  const [g] = useState(
    () =>
      new GrabadorNota(dependenciasNavegador(), {
        fase: setFase,
        error: (m) => avisos.current.alError(m),
        automatica: (n) => avisos.current.alAutomatica(n)
      })
  )
  useEffect(() => () => g.cancelar(), [g])

  useEffect(() => {
    if (fase === 'inactiva') {
      setMs(0)
      setNiveles(ONDA_VACIA())
      return
    }
    setMs(g.transcurrido())
    if (fase !== 'grabando') return
    avisos.current.alLatido()
    let vueltas = 0
    const reloj = window.setInterval(() => {
      const nivel = g.revisar()
      setMs(g.transcurrido())
      setNiveles((n) => [...n.slice(1), Math.max(0.08, nivel)])
      if (++vueltas % 40 === 0) avisos.current.alLatido() // ~cada 3 s: «grabando audio…» al otro
    }, CADA_MS)
    return () => window.clearInterval(reloj)
  }, [fase, g])

  return {
    fase,
    ms,
    niveles,
    iniciar: useCallback(() => g.iniciar(), [g]),
    pausar: useCallback(() => g.pausar(), [g]),
    terminar: useCallback(() => g.terminar(), [g]),
    cancelar: useCallback(() => g.cancelar(), [g])
  }
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
  const nota = useNotaDeVoz(alError, () => alEscribir(true), (n) => (alEnviarNota(n), alDejarDeEscribir()))
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
        <button className="ch-boton-redondo ch-boton-tenue ch-grabando-borrar" disabled={nota.fase === 'cerrando'} onClick={() => (nota.cancelar(), alDejarDeEscribir())} aria-label="Cancelar la grabación" title="Descartar">
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
        {(nota.fase === 'grabando' || nota.fase === 'pausada') && (
          <button className="ch-boton-redondo ch-boton-tenue ch-grabando-pausa" onClick={nota.pausar} aria-label={grabando ? 'Pausar la grabación' : 'Seguir grabando'} title={grabando ? 'Pausar' : 'Seguir grabando'}>
            {grabando ? <IPausa tam={16} /> : <IMic />}
          </button>
        )}
        <button
          className="ch-boton-redondo ch-boton-enviar"
          disabled={nota.fase === 'preparando' || nota.fase === 'cerrando'}
          onClick={() =>
            void nota.terminar().then((n) => {
              alDejarDeEscribir()
              if (n) alEnviarNota(n)
              else alError('La nota era demasiado corta: mantén la grabación al menos un segundo.')
            })
          }
          aria-label="Enviar la nota de voz"
          title="Enviar"
        >
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
