import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Qué parte de la interfaz protege (aparece en el registro): `ventana`, `terminal`, `asistente`, `archivos`… */
  zona: string
  /** Fallback pequeño para una celda; sin él se ocupa todo el espacio. */
  compacto?: boolean
  children: ReactNode
}

interface Estado {
  error: Error | null
}

/**
 * Si algo falla al dibujar, solo cae esta parte (no toda la ventana): se anota el error y se ofrece reintentar o recargar. Sin esto,
 * una excepción de React desmonta toda la interfaz y se queda la pantalla en blanco.
 */
export class LimiteErrores extends Component<Props, Estado> {
  state: Estado = { error: null }

  static getDerivedStateFromError(error: Error): Estado {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      window.api.registro.enviar({
        kind: 'react',
        message: error.message || String(error),
        stack: `${error.stack ?? ''}\n--- componentes ---${info.componentStack ?? ''}`,
        context: { zona: this.props.zona }
      })
    } catch {
      // el registro nunca debe causar otro error
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const { zona, compacto } = this.props
    return (
      <div className={`limite-errores${compacto ? ' compacto' : ''}`} role="alert">
        <strong>Algo falló al mostrar esta parte{zona ? ` (${zona})` : ''}.</strong>
        <span>El error quedó anotado. El resto de la aplicación sigue funcionando.</span>
        <span className="limite-acciones">
          <button type="button" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
          <button type="button" onClick={() => location.reload()} title="Recarga la ventana (las terminales de esta ventana se cerrarán)">
            Recargar ventana
          </button>
        </span>
      </div>
    )
  }
}
