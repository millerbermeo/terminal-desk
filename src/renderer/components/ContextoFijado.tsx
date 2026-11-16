import { useEffect, useRef, useState } from 'react'
import { fijadoVacio, MAX_ARCHIVOS_FIJADOS, MAX_NOTA_FIJADA, normalizarFijado, type ContextoFijado } from '../agente/fijado'

const IconoChincheta = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
  </svg>
)

/**
 * Contexto fijado de la conversación: chips encima del campo de texto (quitar uno con ×) y un editor para añadir rutas y una nota.
 * El modelo lo recibe con el siguiente mensaje y ya no se reenvía mientras no cambie.
 */
export function ContextoFijadoBarra({ fijado, abierto, onCambiar, onAbrir, onCerrar }: { fijado: ContextoFijado; abierto: boolean; onCambiar: (f: ContextoFijado) => void; onAbrir: () => void; onCerrar: () => void }) {
  const [archivos, setArchivos] = useState('')
  const [nota, setNota] = useState('')
  const primero = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!abierto) return
    setArchivos(fijado.archivos.join('\n'))
    setNota(fijado.nota)
    requestAnimationFrame(() => primero.current?.focus())
  }, [abierto])

  if (!abierto && fijadoVacio(fijado)) return null

  if (abierto)
    return (
      <form
        className="fj-editor"
        onSubmit={(e) => {
          e.preventDefault()
          onCambiar(normalizarFijado(archivos, nota))
          onCerrar()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCerrar()
          }
        }}
      >
        <div className="fj-editor-cab">
          <IconoChincheta />
          <strong>Contexto fijado</strong>
          <span>El Asistente lo tiene presente en toda la conversación. Solo se reenvía cuando cambia.</span>
        </div>
        <label>
          <span>Archivos y carpetas clave · uno por línea (máx. {MAX_ARCHIVOS_FIJADOS})</span>
          <textarea ref={primero} rows={3} value={archivos} placeholder={'src/chat/\ndocs/arquitectura.md'} onChange={(e) => setArchivos(e.target.value)} spellCheck={false} />
        </label>
        <label>
          <span>Nota</span>
          <textarea rows={2} value={nota} maxLength={MAX_NOTA_FIJADA} placeholder="p. ej. Usa pnpm, no npm. No toques la API pública de src/shared." onChange={(e) => setNota(e.target.value)} />
        </label>
        <div className="fj-editor-pie">
          {!fijadoVacio(fijado) && (
            <button
              type="button"
              className="peligro"
              onClick={() => {
                onCambiar({ archivos: [], nota: '' })
                onCerrar()
              }}
            >
              Quitar todo
            </button>
          )}
          <span className="fj-espacio" />
          <button type="button" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="primario">
            Fijar
          </button>
        </div>
      </form>
    )

  return (
    <div className="fj-barra" role="group" aria-label="Contexto fijado">
      <span className="fj-etiqueta" title="El Asistente lo tiene presente en toda la conversación">
        <IconoChincheta /> Fijado
      </span>
      {fijado.archivos.map((a) => (
        <span key={a} className="fj-chip" title={a}>
          <code>{a}</code>
          <button type="button" aria-label={`Quitar ${a}`} onClick={() => onCambiar({ ...fijado, archivos: fijado.archivos.filter((x) => x !== a) })}>
            ×
          </button>
        </span>
      ))}
      {fijado.nota.trim() && (
        <span className="fj-chip nota" title={fijado.nota}>
          <span>{fijado.nota.length > 48 ? `${fijado.nota.slice(0, 48)}…` : fijado.nota}</span>
          <button type="button" aria-label="Quitar la nota" onClick={() => onCambiar({ ...fijado, nota: '' })}>
            ×
          </button>
        </span>
      )}
      <button type="button" className="fj-editar" onClick={onAbrir}>
        Editar
      </button>
    </div>
  )
}
