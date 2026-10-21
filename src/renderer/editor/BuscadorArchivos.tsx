import { useEffect, useRef } from 'react'
import type { MarcaGit } from '@shared/archivos'
import type { Coincidencia } from './busqueda'
import { insigniaDe } from './lenguajes'

interface Props {
  consulta: string
  /** `null` mientras se pide la lista de archivos del proyecto. */
  resultados: Coincidencia[] | null
  error: string
  sel: number
  marcas: Record<string, MarcaGit>
  onSel: (i: number) => void
  onAbrir: (ruta: string) => void
}

const base = (ruta: string): string => ruta.split('/').pop() ?? ruta

/** Marca las letras de `texto` (que empieza en la posición `desde` de la ruta completa) que coinciden con lo escrito. */
function Resaltado({ texto, desde, posiciones }: { texto: string; desde: number; posiciones: ReadonlySet<number> }) {
  return <>{[...texto].map((ch, i) => (posiciones.has(desde + i) ? <mark key={i}>{ch}</mark> : ch))}</>
}

/** Resultados de buscar archivos por nombre en todo el proyecto (como «Ir al archivo» de VS Code). */
export function BuscadorArchivos({ consulta, resultados, error, sel, marcas, onSel, onAbrir }: Props) {
  const lista = useRef<HTMLUListElement>(null)
  useEffect(() => {
    lista.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (error) return <div className="ed-error error">{error}</div>
  if (!resultados) return <div className="ed-busq-vacio">Buscando…</div>
  if (resultados.length === 0) return <div className="ed-busq-vacio">Ningún archivo coincide con «{consulta.trim()}»</div>
  return (
    <ul className="ed-busq" ref={lista} role="listbox" aria-label="Resultados de la búsqueda">
      {resultados.map((c, i) => {
        const nombre = base(c.ruta)
        const inicio = c.ruta.length - nombre.length
        const dir = inicio > 0 ? c.ruta.slice(0, inicio - 1) : ''
        const pos = new Set(c.posiciones)
        const ins = insigniaDe(nombre)
        const marca = marcas[c.ruta]
        return (
          <li key={c.ruta} role="option" aria-selected={i === sel} className={`ed-fila ed-res${i === sel ? ' sel' : ''}`} title={c.ruta} onMouseEnter={() => onSel(i)} onClick={() => onAbrir(c.ruta)}>
            <span className="ed-ico ed-ins" style={{ color: ins.color }}>{ins.txt}</span>
            <span className="ed-nombre">
              <Resaltado texto={nombre} desde={inicio} posiciones={pos} />
              {dir && (
                <small className="ed-busq-dir">
                  {' '}
                  <Resaltado texto={dir} desde={0} posiciones={pos} />
                </small>
              )}
            </span>
            {marca && <span className="ed-marca">{marca}</span>}
          </li>
        )
      })}
    </ul>
  )
}
