/**
 * Estados de carga de toda la app (estilos en diseno/sistema.css):
 * - `Cargando`: indicador giratorio con texto; `pantalla` ocupa el área entera, `enLinea` va dentro de una frase o un botón.
 * - `Esqueletos`: siluetas de lo que va a aparecer (filas de una lista, tarjetas o líneas de texto).
 * Ambos se anuncian a los lectores de pantalla y aparecen con un pequeño retardo para no parpadear en cargas instantáneas.
 */
interface PropsCargando {
  texto?: string
  variante?: 'bloque' | 'pantalla' | 'enLinea'
}

export function Cargando({ texto = 'Cargando…', variante = 'bloque' }: PropsCargando) {
  const clase = variante === 'pantalla' ? ' pantalla' : variante === 'enLinea' ? ' en-linea' : ''
  return (
    <div className={`cargando${clase}`} role="status" aria-live="polite">
      <span className="giro" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  )
}

interface PropsEsqueletos {
  /** Qué se está esperando: da la forma de las siluetas. */
  forma?: 'lineas' | 'filas' | 'tarjetas'
  cuantos?: number
  /** Texto para lectores de pantalla. */
  texto?: string
}

export function Esqueletos({ forma = 'filas', cuantos = 5, texto = 'Cargando…' }: PropsEsqueletos) {
  const clase = forma === 'filas' ? ' fila' : forma === 'tarjetas' ? ' tarjeta' : ''
  return (
    <div className="esqueletos" role="status" aria-live="polite" aria-label={texto}>
      {Array.from({ length: cuantos }, (_, i) => (
        <span key={i} className={`esqueleto${clase}`} aria-hidden="true" />
      ))}
    </div>
  )
}
