import type { CSSProperties, ReactNode } from 'react'

/** Sección de una pantalla de ajustes al estilo «lista agrupada»: icono, título, explicación y, debajo, la tarjeta con sus filas. */
export function SeccionAjustes({ icono, titulo, texto, resumen, children }: { icono: ReactNode; titulo: string; texto?: ReactNode; resumen?: ReactNode; children: ReactNode }) {
  return (
    <section className="prov-seccion" aria-label={titulo}>
      <header className="prov-seccion-cab">
        <span className="prov-seccion-ico" aria-hidden>
          {icono}
        </span>
        <div className="prov-seccion-titulos">
          <h3>{titulo}</h3>
          {texto && <p>{texto}</p>}
        </div>
        {resumen && <span className="prov-resumen">{resumen}</span>}
      </header>
      <div className="prov-lista">{children}</div>
    </section>
  )
}

export type TipoEstado = 'ok' | 'aviso' | 'neutro'

/** Estado de una fila: punto de color + texto (el color nunca va solo). */
export function EstadoFila({ tipo, texto, titulo }: { tipo: TipoEstado; texto: string; titulo?: string }) {
  return (
    <span className={`prov-estado ${tipo}`} title={titulo}>
      <span className="prov-punto" aria-hidden />
      {texto}
    </span>
  )
}

/** Cuadro con la inicial y un tono estable derivado del nombre (sin logotipos de marcas). */
export function Monograma({ nombre }: { nombre: string }) {
  let h = 0
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className="prov-mono" style={{ '--tono': h } as CSSProperties} aria-hidden>
      {nombre.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** `/home/ana/.config/x` → `~/.config/x` (la ruta completa queda en el `title`). */
export const rutaCorta = (ruta: string): string => ruta.replace(/^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~')
