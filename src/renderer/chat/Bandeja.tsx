import { useEffect, useRef, useState } from 'react'
import { LIMITE_ARCHIVO_CHAT, tamanoLegible, tipoPorMime } from '@shared/chat'
import { claseExtension, extensionDe } from './Adjuntos'
import { ICerrar, IEnviar } from './Iconos'

export interface ElementoBandeja {
  id: string
  archivo: File
  /** URL local (imágenes, videos y audios) para la vista previa; la burbuja la reutiliza mientras se sube. */
  url?: string
  texto: string
}

let n = 0
/** Convierte lo elegido, pegado o soltado en elementos de la bandeja (con su URL de vista previa). */
export function aElementos(archivos: File[]): ElementoBandeja[] {
  return archivos.map((f) => {
    const tipo = tipoPorMime(f.type || '')
    return { id: `b${++n}`, archivo: f, texto: '', ...(tipo !== 'file' ? { url: URL.createObjectURL(f) } : {}) }
  })
}

const MAX = 10

/**
 * Vista previa antes de enviar (como WhatsApp): el archivo grande, una tira con todos (quitar, añadir más), un pie de foto para cada
 * uno y «Enviar». Enter envía; Esc cancela.
 */
export function Bandeja({ elementos, destinatario, alCambiar, alEnviar, alCancelar }: { elementos: ElementoBandeja[]; destinatario: string; alCambiar: (e: ElementoBandeja[]) => void; alEnviar: () => void; alCancelar: () => void }) {
  const [activo, setActivo] = useState(elementos[0]?.id ?? '')
  const entrada = useRef<HTMLInputElement>(null)
  const mas = useRef<HTMLInputElement>(null)
  const actual = elementos.find((e) => e.id === activo) ?? elementos[0]
  useEffect(() => {
    if (!elementos.some((e) => e.id === activo) && elementos[0]) setActivo(elementos[0].id)
  }, [elementos, activo])
  useEffect(() => entrada.current?.focus(), [activo])
  if (!actual) return null
  const grandes = elementos.filter((e) => e.archivo.size > LIMITE_ARCHIVO_CHAT)
  const tipo = tipoPorMime(actual.archivo.type || '')
  const ext = extensionDe(actual.archivo.name)
  const quitar = (id: string): void => {
    const e = elementos.find((x) => x.id === id)
    if (e?.url) URL.revokeObjectURL(e.url)
    alCambiar(elementos.filter((x) => x.id !== id))
  }
  return (
    <div className="ch-bandeja" role="dialog" aria-label="Enviar archivos" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), alCancelar())}>
      <header className="ch-bandeja-cab">
        <button className="ch-boton-cab" onClick={alCancelar} aria-label="Cancelar" title="Cancelar (Esc)">
          <ICerrar />
        </button>
        <div>
          <strong>{actual.archivo.name || 'archivo'}</strong>
          <span>
            {tamanoLegible(actual.archivo.size)} · para {destinatario}
          </span>
        </div>
      </header>

      <div className="ch-bandeja-escena">
        <div key={actual.id} className="ch-bandeja-medio">
          {tipo === 'image' && actual.url ? (
            <img src={actual.url} alt={actual.archivo.name} />
          ) : tipo === 'video' && actual.url ? (
            <video src={actual.url} controls playsInline />
          ) : tipo === 'audio' && actual.url ? (
            <div className="ch-bandeja-archivo">
              <span className="ch-archivo-icono ext-otro">{ext || 'AUD'}</span>
              <audio src={actual.url} controls />
            </div>
          ) : (
            <div className="ch-bandeja-archivo">
              <span className={`ch-archivo-icono grande ext-${claseExtension(ext)}`}>{ext.slice(0, 4) || 'ARCH'}</span>
              <strong>{actual.archivo.name}</strong>
              <span>{tamanoLegible(actual.archivo.size)} · No hay vista previa</span>
            </div>
          )}
        </div>
        {actual.archivo.size > LIMITE_ARCHIVO_CHAT && <p className="ch-bandeja-aviso">Pasa de {Math.round(LIMITE_ARCHIVO_CHAT / 1024 / 1024)} MB: no se puede enviar.</p>}
      </div>

      <div className="ch-bandeja-pie">
        <input
          ref={entrada}
          className="ch-bandeja-texto"
          value={actual.texto}
          maxLength={1000}
          placeholder="Añade un comentario…"
          aria-label="Comentario del archivo"
          onChange={(e) => alCambiar(elementos.map((x) => (x.id === actual.id ? { ...x, texto: e.target.value } : x)))}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && grandes.length === 0 && (e.preventDefault(), alEnviar())}
        />
        <div className="ch-bandeja-tira">
          {elementos.map((e, i) => {
            const t = tipoPorMime(e.archivo.type || '')
            return (
              <div key={e.id} className={`ch-bandeja-mini${e.id === actual.id ? ' activa' : ''}${e.archivo.size > LIMITE_ARCHIVO_CHAT ? ' grande' : ''}`} style={{ ['--i' as string]: i }}>
                <button onClick={() => setActivo(e.id)} aria-label={e.archivo.name}>
                  {t === 'image' && e.url ? <img src={e.url} alt="" /> : t === 'video' && e.url ? <video src={e.url} muted preload="metadata" /> : <span className={`ext-${claseExtension(extensionDe(e.archivo.name))}`}>{extensionDe(e.archivo.name).slice(0, 4) || '•'}</span>}
                </button>
                <button className="ch-bandeja-quitar" onClick={() => quitar(e.id)} aria-label={`Quitar ${e.archivo.name}`}>
                  <ICerrar tam={10} />
                </button>
              </div>
            )
          })}
          {elementos.length < MAX && (
            <>
              <button className="ch-bandeja-mas" onClick={() => mas.current?.click()} aria-label="Añadir más archivos" title="Añadir más">
                +
              </button>
              <input ref={mas} type="file" multiple hidden onChange={(e) => (alCambiar([...elementos, ...aElementos([...(e.target.files ?? [])]).slice(0, MAX - elementos.length)]), (e.target.value = ''))} />
            </>
          )}
          <button className="ch-boton-redondo ch-boton-enviar ch-bandeja-enviar" onClick={alEnviar} disabled={grandes.length > 0} aria-label={`Enviar ${elementos.length} archivo${elementos.length === 1 ? '' : 's'}`} title="Enviar (Enter)">
            <IEnviar />
            {elementos.length > 1 && <b>{elementos.length}</b>}
          </button>
        </div>
      </div>
    </div>
  )
}
