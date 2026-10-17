import { useEffect, useRef } from 'react'
import type { EntradaArchivo, MarcaGit } from '@shared/archivos'
import { insigniaDe } from './lenguajes'

export interface CreandoEn {
  padre: string
  tipo: 'archivo' | 'carpeta'
}

interface Props {
  hijos: Record<string, EntradaArchivo[]>
  expandidas: ReadonlySet<string>
  marcas: Record<string, MarcaGit>
  conCambios: ReadonlySet<string> // carpetas que contienen archivos con cambios
  activa: string | null
  creando: CreandoEn | null
  renombrando: string | null
  error: string
  onAlternar: (ruta: string) => void
  onAbrir: (ruta: string) => void
  onMenu: (x: number, y: number, entrada: EntradaArchivo | null) => void
  onNombre: (texto: string) => void
  onCancelarNombre: () => void
}

const COLOR_MARCA: Record<MarcaGit, string> = { M: '#fbbf24', A: '#34d399', D: '#f87171', R: '#67e8f9', U: '#34d399', C: '#f87171' }
const TITULO_MARCA: Record<MarcaGit, string> = { M: 'Modificado', A: 'Añadido', D: 'Borrado', R: 'Renombrado', U: 'Sin seguimiento', C: 'Conflicto' }

function Nombre({ inicial, sangria, onNombre, onCancelar }: { inicial: string; sangria: number; onNombre: (t: string) => void; onCancelar: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <li className="ed-fila ed-nueva" style={{ paddingLeft: 8 + sangria * 14 }}>
      <input
        ref={ref}
        defaultValue={inicial}
        spellCheck={false}
        aria-label="Nombre"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onNombre(e.currentTarget.value.trim())
          if (e.key === 'Escape') onCancelar()
        }}
        onBlur={(e) => (e.currentTarget.value.trim() && e.currentTarget.value !== inicial ? onNombre(e.currentTarget.value.trim()) : onCancelar())}
      />
    </li>
  )
}

/** Árbol de archivos al estilo de VS Code: carpetas que se cargan al desplegarlas, marcas de git y menú contextual. */
export function ArbolArchivos(p: Props) {
  const nivel = (padre: string, sangria: number) => (
    <>
      {p.creando?.padre === padre && <Nombre inicial="" sangria={sangria} onNombre={p.onNombre} onCancelar={p.onCancelarNombre} />}
      {(p.hijos[padre] ?? []).map((e) => {
        const abierta = p.expandidas.has(e.ruta)
        if (p.renombrando === e.ruta) return <Nombre key={e.ruta} inicial={e.nombre} sangria={sangria} onNombre={p.onNombre} onCancelar={p.onCancelarNombre} />
        const marca = p.marcas[e.ruta]
        const ins = insigniaDe(e.nombre)
        return (
          <li key={e.ruta}>
            <div
              className={`ed-fila${p.activa === e.ruta ? ' sel' : ''}`}
              style={{ paddingLeft: 8 + sangria * 14 }}
              role="treeitem"
              aria-expanded={e.tipo === 'carpeta' ? abierta : undefined}
              onClick={() => (e.tipo === 'carpeta' ? p.onAlternar(e.ruta) : e.tipo === 'archivo' ? p.onAbrir(e.ruta) : undefined)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                p.onMenu(ev.clientX, ev.clientY, e)
              }}
              title={e.tipo === 'enlace' ? `${e.ruta} (enlace simbólico)` : e.ruta}
            >
              {e.tipo === 'carpeta' ? <span className="ed-chev">{abierta ? '▾' : '▸'}</span> : <span className="ed-chev" />}
              {e.tipo === 'carpeta' ? <span className="ed-ico">{abierta ? '📂' : '📁'}</span> : <span className="ed-ico ed-ins" style={{ color: ins.color }}>{ins.txt}</span>}
              <span className={`ed-nombre${marca ? ' con-marca' : ''}`} style={marca ? { color: COLOR_MARCA[marca] } : undefined}>
                {e.nombre}
              </span>
              {marca && <span className="ed-marca" style={{ color: COLOR_MARCA[marca] }} title={TITULO_MARCA[marca]}>{marca}</span>}
              {!marca && e.tipo === 'carpeta' && p.conCambios.has(e.ruta) && <span className="ed-marca" style={{ color: '#fbbf24' }} title="Contiene cambios">●</span>}
            </div>
            {e.tipo === 'carpeta' && abierta && <ul role="group">{nivel(e.ruta, sangria + 1)}</ul>}
          </li>
        )
      })}
    </>
  )
  return (
    <ul className="ed-arbol-lista" role="tree" onContextMenu={(ev) => (ev.preventDefault(), p.onMenu(ev.clientX, ev.clientY, null))}>
      {p.error && <li className="cfg-error ed-error">{p.error}</li>}
      {nivel('', 0)}
      {(p.hijos[''] ?? []).length === 0 && !p.creando && !p.error && <li className="cfg-vacio">Carpeta vacía</li>}
    </ul>
  )
}
