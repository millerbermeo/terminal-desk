import { memo, useEffect, useId, useState } from 'react'

type Mermaid = typeof import('mermaid').default

/** Mermaid pesa ~1 MB: se carga la primera vez que el chat muestra un diagrama, y una sola vez. */
let cargando: Promise<Mermaid> | null = null
function cargarMermaid(): Promise<Mermaid> {
  cargando ??= import('mermaid').then(({ default: m }) => {
    m.initialize({
      startOnLoad: false,
      // «strict»: sin HTML ni scripts en las etiquetas y sin clics que ejecuten código (el texto viene del modelo).
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: 'Inter Variable, system-ui, sans-serif',
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true
    })
    return m
  })
  return cargando
}

/** Espera tras el último cambio antes de dibujar: durante el streaming el bloque llega a trozos y casi siempre está incompleto. */
const ESPERA_MS = 350

interface Props {
  codigo: string
}

/**
 * Dibuja un bloque ```mermaid``` del Asistente como SVG. Si el diagrama no es válido (o aún se está escribiendo)
 * muestra el código tal cual; el botón alterna entre diagrama y código.
 */
export const DiagramaMermaid = memo(function DiagramaMermaid({ codigo }: Props) {
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [verCodigo, setVerCodigo] = useState(false)

  useEffect(() => {
    let vigente = true
    const t = setTimeout(() => {
      void cargarMermaid()
        .then(async (m) => {
          // `parse` primero: no deja nodos huérfanos en el DOM cuando el texto no es válido.
          if (!(await m.parse(codigo, { suppressErrors: true }))) throw new Error('Diagrama no válido')
          const { svg: dibujo } = await m.render(`mmd-${idBase}-${Date.now().toString(36)}`, codigo)
          if (!vigente) return
          setSvg(dibujo)
          setError('')
        })
        .catch((e: unknown) => {
          if (!vigente) return
          setError(e instanceof Error ? e.message : String(e))
        })
    }, ESPERA_MS)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [codigo, idBase])

  const mostrarCodigo = verCodigo || !svg
  return (
    <div className="md-mermaid">
      {svg && (
        <div className="md-mermaid-cab">
          <button type="button" onClick={() => setVerCodigo((v) => !v)}>
            {verCodigo ? 'Ver diagrama' : 'Ver código'}
          </button>
        </div>
      )}
      {mostrarCodigo ? (
        <pre className="md-bloque-codigo">
          <code>{codigo}</code>
        </pre>
      ) : (
        // SVG generado por Mermaid con securityLevel «strict» (sanea con DOMPurify).
        <div className="md-mermaid-svg" role="img" aria-label="Diagrama" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      {error && !svg && <div className="md-mermaid-error">No se pudo dibujar el diagrama: {error}</div>}
    </div>
  )
})
