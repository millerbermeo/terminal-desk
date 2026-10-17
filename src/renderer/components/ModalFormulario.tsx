import { useEffect, useState, type ReactNode } from 'react'

export interface CampoFormulario {
  id: string
  etiqueta: string
  valor?: string
  placeholder?: string
  multilinea?: boolean
  obligatorio?: boolean
  ayuda?: string
}

interface Props {
  titulo: string
  descripcion?: ReactNode
  campos: CampoFormulario[]
  /** Casilla opcional (p. ej. «Cambiar a la rama nueva»). */
  casilla?: { etiqueta: string; valor: boolean }
  etiquetaBoton: string
  onEnviar: (valores: Record<string, string>, casilla: boolean) => Promise<boolean> | boolean
  onCerrar: () => void
}

/** Formulario breve en un modal: nombre de una rama, mensaje de una versión… Se cierra solo si `onEnviar` devuelve `true`. */
export function ModalFormulario({ titulo, descripcion, campos, casilla, etiquetaBoton, onEnviar, onCerrar }: Props) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => [c.id, c.valor ?? ''])))
  const [marca, setMarca] = useState(casilla?.valor ?? false)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !enviando) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, enviando])

  const completo = campos.every((c) => !c.obligatorio || (valores[c.id] ?? '').trim())
  const enviar = async (): Promise<void> => {
    if (!completo || enviando) return
    setEnviando(true)
    try {
      if (await onEnviar(valores, marca)) onCerrar()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !enviando && onCerrar()}>
      <form
        className="modal modal-chico"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onSubmit={(e) => {
          e.preventDefault()
          void enviar()
        }}
      >
        <div className="modal-cab">
          <h3>{titulo}</h3>
          <button type="button" className="icono" onClick={onCerrar} aria-label="Cerrar" disabled={enviando}>
            ✕
          </button>
        </div>
        {descripcion && <p className="modal-texto">{descripcion}</p>}
        {campos.map((c, i) => (
          <label key={c.id} style={{ maxWidth: 'none' }}>
            {c.etiqueta}
            {c.multilinea ? (
              <textarea rows={3} autoFocus={i === 0} value={valores[c.id]} placeholder={c.placeholder} onChange={(e) => setValores({ ...valores, [c.id]: e.target.value })} />
            ) : (
              <input autoFocus={i === 0} value={valores[c.id]} placeholder={c.placeholder} onChange={(e) => setValores({ ...valores, [c.id]: e.target.value })} />
            )}
            {c.ayuda && <span className="ayuda">{c.ayuda}</span>}
          </label>
        ))}
        {casilla && (
          <label className="vc-casilla" style={{ maxWidth: 'none' }}>
            <input type="checkbox" checked={marca} onChange={(e) => setMarca(e.target.checked)} /> {casilla.etiqueta}
          </label>
        )}
        <div className="cfg-acciones">
          <button className="primario" type="submit" disabled={!completo || enviando}>
            {enviando ? 'Trabajando…' : etiquetaBoton}
          </button>
          <button type="button" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
