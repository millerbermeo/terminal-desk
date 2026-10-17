import type { ReactNode } from 'react'

interface Props {
  icono: ReactNode
  titulo: string
  texto?: ReactNode
  /** Botón o botones de la acción principal. */
  accion?: ReactNode
  /** Atajos o ejemplos que orientan al usuario. */
  pistas?: string[]
  /** `compacto` para listas y paneles; `minimo` para huecos pequeños (p. ej. una columna del tablero). */
  variante?: 'normal' | 'compacto' | 'minimo'
}

/** Estado vacío: un icono, qué pasa y qué hacer ahora. Mejor orientar que dejar un hueco en blanco. */
export function EstadoVacio({ icono, titulo, texto, accion, pistas, variante = 'normal' }: Props) {
  return (
    <div className={`estado-vacio${variante === 'normal' ? '' : ` ${variante}`}`} role="status">
      <div className="estado-vacio-icono" aria-hidden="true">
        {icono}
      </div>
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      {pistas && pistas.length > 0 && (
        <div className="estado-vacio-pistas">
          {pistas.map((p) => (
            <span key={p} className="chip">
              {p}
            </span>
          ))}
        </div>
      )}
      {accion && <div className="estado-vacio-accion">{accion}</div>}
    </div>
  )
}
