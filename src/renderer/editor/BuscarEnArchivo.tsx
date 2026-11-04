import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search'
import { IconoCerrar, IconoChevron } from '../components/Iconos'
import { coincidenciaDesde, consultaDe, contarCoincidencias, MAX_COINCIDENCIAS, type OpcionesBusqueda } from './busquedaArchivo'

interface Props {
  vista: EditorView
  /** Cambia con cada transacción del editor mientras el buscador está abierto (para recalcular el contador). */
  version: number
  /** Cambia cada vez que se pide abrir (Ctrl+F / Ctrl+H): vuelve a enfocar y seleccionar el campo. */
  pedido: number
  conReemplazo: boolean
  /** Texto seleccionado al abrir, si lo había. */
  semilla?: string
  onCerrar: () => void
}

/** Buscador dentro del archivo, flotante arriba a la derecha como el de VS Code. Las coincidencias las resalta CodeMirror. */
export function BuscarEnArchivo({ vista, version, pedido, conReemplazo, semilla, onCerrar }: Props) {
  const inicial = getSearchQuery(vista.state)
  const [o, setO] = useState<OpcionesBusqueda>(() => ({
    texto: semilla ?? inicial.search,
    reemplazo: inicial.replace,
    mayusculas: inicial.caseSensitive,
    palabra: inicial.wholeWord,
    regex: inicial.regexp
  }))
  const [reemplazar, setReemplazar] = useState(conReemplazo)
  const campo = useRef<HTMLInputElement>(null)
  const campoReemplazo = useRef<HTMLInputElement>(null)
  /** Dónde estaba el cursor al abrir: al escribir se salta a la primera coincidencia desde aquí. */
  const origen = useRef(vista.state.selection.main.from)

  useEffect(() => {
    if (semilla !== undefined) setO((p) => ({ ...p, texto: semilla }))
    if (conReemplazo) setReemplazar(true)
    origen.current = vista.state.selection.main.from
    const c = conReemplazo && semilla === undefined && o.texto ? campoReemplazo.current : campo.current
    c?.focus()
    c?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  // La consulta vive en el estado de CodeMirror (resaltado, F3, Enter); aquí solo se edita.
  useLayoutEffect(() => {
    const q = consultaDe(o)
    if (!q.eq(getSearchQuery(vista.state))) vista.dispatch({ effects: setSearchQuery.of(q) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o])

  const cambiarTexto = (texto: string): void => {
    setO((p) => ({ ...p, texto }))
    const m = coincidenciaDesde(vista.state, consultaDe({ ...o, texto }), origen.current)
    if (m) vista.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true })
  }
  const alternar = (k: 'mayusculas' | 'palabra' | 'regex'): void => setO((p) => ({ ...p, [k]: !p[k] }))

  const { total, actual, valida, tope } = contarCoincidencias(vista.state, consultaDe(o))
  void version // solo fuerza el recálculo de arriba
  const resumen = !o.texto ? 'Sin resultados' : !valida ? 'Expresión no válida' : total === 0 ? 'Sin resultados' : `${actual || '?'} de ${tope ? `${MAX_COINCIDENCIAS}+` : total}`

  const cerrar = (): void => {
    closeSearchPanel(vista)
    onCerrar()
    vista.focus()
  }

  const teclas = (e: React.KeyboardEvent, enReemplazo: boolean): void => {
    if (e.key === 'Escape') return (e.preventDefault(), cerrar())
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase()
      if (k === 'c' || k === 'w' || k === 'r') {
        e.preventDefault()
        return alternar(k === 'c' ? 'mayusculas' : k === 'w' ? 'palabra' : 'regex')
      }
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (enReemplazo) return void ((e.ctrlKey || e.metaKey) && e.altKey ? replaceAll(vista) : replaceNext(vista))
    void (e.shiftKey ? findPrevious(vista) : findNext(vista))
  }

  const sinCoincidencias = !!o.texto && (total === 0 || !valida)

  return (
    <div className="ed-buscar" role="search" onMouseDown={(e) => e.stopPropagation()}>
      <button
        className={`icono ed-buscar-plegar${reemplazar ? ' abierto' : ''}`}
        title={reemplazar ? 'Ocultar reemplazar' : 'Reemplazar (Ctrl+H)'}
        aria-label="Mostrar u ocultar reemplazar"
        aria-expanded={reemplazar}
        onClick={() => setReemplazar((r) => !r)}
      >
        <IconoChevron />
      </button>
      <div className="ed-buscar-filas">
        <div className="ed-buscar-fila">
          <div className={`ed-buscar-campo${sinCoincidencias ? ' sin' : ''}`}>
            <input
              ref={campo}
              value={o.texto}
              placeholder="Buscar"
              aria-label="Buscar en el archivo"
              spellCheck={false}
              onChange={(e) => cambiarTexto(e.target.value)}
              onKeyDown={(e) => teclas(e, false)}
            />
            <button className={`ed-buscar-op${o.mayusculas ? ' on' : ''}`} title="Coincidir mayúsculas y minúsculas (Alt+C)" aria-pressed={o.mayusculas} onClick={() => alternar('mayusculas')}>Aa</button>
            <button className={`ed-buscar-op${o.palabra ? ' on' : ''}`} title="Solo palabras completas (Alt+W)" aria-pressed={o.palabra} onClick={() => alternar('palabra')}><u>ab</u></button>
            <button className={`ed-buscar-op${o.regex ? ' on' : ''}`} title="Expresión regular (Alt+R)" aria-pressed={o.regex} onClick={() => alternar('regex')}>.*</button>
          </div>
          <span className={`ed-buscar-total${sinCoincidencias ? ' sin' : ''}`} aria-live="polite">{resumen}</span>
          <button className="icono ed-buscar-ant" title="Anterior (Shift+Enter)" aria-label="Coincidencia anterior" disabled={total === 0} onClick={() => findPrevious(vista)}><IconoChevron /></button>
          <button className="icono ed-buscar-sig" title="Siguiente (Enter)" aria-label="Coincidencia siguiente" disabled={total === 0} onClick={() => findNext(vista)}><IconoChevron /></button>
          <button className="icono" title="Cerrar (Escape)" aria-label="Cerrar el buscador" onClick={cerrar}><IconoCerrar /></button>
        </div>
        {reemplazar && (
          <div className="ed-buscar-fila">
            <div className="ed-buscar-campo">
              <input
                ref={campoReemplazo}
                value={o.reemplazo}
                placeholder="Reemplazar"
                aria-label="Reemplazar por"
                spellCheck={false}
                onChange={(e) => setO((p) => ({ ...p, reemplazo: e.target.value }))}
                onKeyDown={(e) => teclas(e, true)}
              />
            </div>
            <button className="ed-buscar-accion" title="Reemplazar (Enter)" disabled={total === 0} onClick={() => replaceNext(vista)}>Reemplazar</button>
            <button className="ed-buscar-accion" title="Reemplazar todo (Ctrl+Alt+Enter)" disabled={total === 0} onClick={() => replaceAll(vista)}>Todo</button>
          </div>
        )}
      </div>
    </div>
  )
}
