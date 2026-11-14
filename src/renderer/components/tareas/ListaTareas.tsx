import { Fragment, useMemo, useState } from 'react'
import { categoriaDe, dependenciasAbiertas, estaAbierta, fechaCorta, type Tarea } from '@shared/tareas'
import { agruparTareas, ordenarTareas, progresoTarea, totalEstimacion, type AgruparPor, type CampoOrden } from '@shared/tareas-vista'
import { COLUMNAS_LISTA, NOMBRE_COLUMNA, type ColumnaLista, type PrefsVista } from '../../tareas/vista'
import { EstadoVacio } from '../EstadoVacio'
import { IconoBuscar } from '../Iconos'
import { Emergente, anclaDe, type Ancla } from './Emergente'
import { useAcciones } from './contexto'
import { ChipEstado, ChipFecha, ChipPrioridad, ChipResponsable } from './Selectores'

const CAMPO_DE: Partial<Record<ColumnaLista | 'titulo' | 'numero', CampoOrden>> = {
  numero: 'numero',
  titulo: 'titulo',
  estado: 'estado',
  prioridad: 'prioridad',
  responsable: 'responsable',
  proyecto: 'proyecto',
  vence: 'vence',
  estimacion: 'estimacion',
  actualizada: 'actualizada'
}

interface Props {
  tareas: Tarea[]
  agrupar: AgruparPor
  prefs: PrefsVista
  onPrefs: (p: Partial<PrefsVista>) => void
}

/** Título que se edita con doble clic (Enter guarda, Esc cancela). */
function TituloEditable({ t }: { t: Tarea }) {
  const { editar, abrir } = useAcciones()
  const [editando, setEditando] = useState(false)
  const [v, setV] = useState(t.titulo)
  if (!editando) {
    return (
      <span
        className="lista-titulo"
        title="Doble clic para renombrar"
        onDoubleClick={(e) => {
          e.stopPropagation()
          setV(t.titulo)
          setEditando(true)
        }}
        onClick={() => abrir(t.id)}
      >
        {t.titulo}
      </span>
    )
  }
  const guardar = (): void => {
    setEditando(false)
    if (v.trim() && v.trim() !== t.titulo) void editar(t, { titulo: v.trim() }, true)
  }
  return (
    <input
      className="lista-titulo-edicion"
      autoFocus
      value={v}
      maxLength={200}
      aria-label="Título"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') guardar()
        if (e.key === 'Escape') setEditando(false)
      }}
    />
  )
}

function Estimacion({ t }: { t: Tarea }) {
  const { editar } = useAcciones()
  const [editando, setEditando] = useState(false)
  if (!editando) {
    return (
      <button className="chip chip-btn" onClick={(e) => { e.stopPropagation(); setEditando(true) }} title="Estimación en puntos (clic para cambiar)">
        {t.estimacion !== undefined ? `${t.estimacion} pt` : '—'}
      </button>
    )
  }
  const guardar = (valor: string): void => {
    setEditando(false)
    const n = valor.trim() === '' ? null : Number(valor)
    if (n !== null && !Number.isFinite(n)) return
    if ((n ?? undefined) !== t.estimacion) void editar(t, { estimacion: n }, true)
  }
  return (
    <input
      className="lista-num"
      type="number"
      min={0}
      max={999}
      step="0.5"
      autoFocus
      defaultValue={t.estimacion ?? ''}
      aria-label="Estimación"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => guardar(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') guardar((e.target as HTMLInputElement).value)
        if (e.key === 'Escape') setEditando(false)
      }}
    />
  )
}

/** Tabla con celdas editables en línea, orden por columna, grupos plegables, selección múltiple y columnas a elegir. */
export function ListaTareas({ tareas, agrupar, prefs, onPrefs }: Props) {
  const a = useAcciones()
  const [plegados, setPlegados] = useState<Set<string>>(new Set())
  const [menuColumnas, setMenuColumnas] = useState<Ancla | null>(null)
  const columnas = prefs.columnas
  const ctx = useMemo(() => ({ estados: a.estados, nombreProyecto: a.nombreProyecto }), [a.estados, a.nombreProyecto])
  const ordenadas = useMemo(() => (prefs.orden ? ordenarTareas(tareas, prefs.orden.campo, prefs.orden.dir, ctx) : tareas), [tareas, prefs.orden, ctx])
  const grupos = useMemo(() => agruparTareas(ordenadas, agrupar, ctx), [ordenadas, agrupar, ctx])
  const idsVisibles = useMemo(() => grupos.filter((g) => !plegados.has(g.clave)).flatMap((g) => g.tareas.map((t) => t.id)), [grupos, plegados])
  const todasMarcadas = idsVisibles.length > 0 && idsVisibles.every((id) => a.seleccion.has(id))

  if (tareas.length === 0) return <EstadoVacio icono={<IconoBuscar />} titulo="Sin resultados" texto="Ninguna tarea coincide con los filtros. Prueba con otro ámbito, quita filtros o muestra las terminadas." />

  const ordenarPor = (campo: CampoOrden | undefined): void => {
    if (!campo) return
    const o = prefs.orden
    if (!o || o.campo !== campo) onPrefs({ orden: { campo, dir: 'asc' } })
    else if (o.dir === 'asc') onPrefs({ orden: { campo, dir: 'desc' } })
    else onPrefs({ orden: null })
  }
  const Th = ({ id, texto, clase }: { id: ColumnaLista | 'titulo' | 'numero'; texto: string; clase?: string }) => {
    const campo = CAMPO_DE[id]
    const activo = !!campo && prefs.orden?.campo === campo
    return (
      <th className={clase} aria-sort={activo ? (prefs.orden!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button className="lista-th" onClick={() => ordenarPor(campo)} disabled={!campo} title={campo ? 'Ordenar' : undefined}>
          {texto} {activo && <span aria-hidden="true">{prefs.orden!.dir === 'asc' ? '↑' : '↓'}</span>}
        </button>
      </th>
    )
  }

  const celda = (c: ColumnaLista, t: Tarea) => {
    switch (c) {
      case 'estado':
        return <ChipEstado t={t} />
      case 'prioridad':
        return <ChipPrioridad t={t} />
      case 'responsable':
        return <ChipResponsable t={t} conNombre />
      case 'proyecto':
        return <span className="tareas-suave">{t.proyectoId ? (a.nombreProyecto.get(t.proyectoId) ?? '—') : '—'}</span>
      case 'vence':
        return estaAbierta(t, a.estados) ? <ChipFecha t={t} /> : <span className="tareas-suave">{t.vence !== undefined ? fechaCorta(t.vence) : ''}</span>
      case 'estimacion':
        return <Estimacion t={t} />
      case 'progreso': {
        const p = progresoTarea(t)
        return p.total ? (
          <span className="tarjeta-progreso" title={`${p.hechos} de ${p.total}`}>
            <span className="barra-prog"><span style={{ width: `${p.pct}%` }} className={p.pct === 100 ? 'completa' : ''} /></span>
            <small>{p.hechos}/{p.total}</small>
          </span>
        ) : (
          ''
        )
      }
      case 'etiquetas':
        return t.etiquetas.slice(0, 3).map((e) => <span key={e} className="chip etiqueta">{e}</span>)
      case 'actualizada':
        return <span className="tareas-suave">{new Date(t.actualizada).toLocaleDateString('sv-SE')}</span>
    }
  }

  return (
    <div className="lista-envoltorio">
      <table className="tareas-tabla lista-edicion">
        <thead>
          <tr>
            <th className="lista-marca">
              <input type="checkbox" checked={todasMarcadas} onChange={() => a.seleccionar(todasMarcadas ? [] : idsVisibles)} aria-label="Seleccionar todas" />
            </th>
            <Th id="numero" texto="#" />
            <Th id="titulo" texto="Título" />
            {columnas.map((c) => (
              <Th key={c} id={c} texto={NOMBRE_COLUMNA[c]} />
            ))}
            <th className="lista-cols">
              <button className="icono" title="Elegir columnas" aria-label="Elegir columnas" aria-haspopup="menu" onClick={(e) => setMenuColumnas(anclaDe(e.currentTarget))}>
                ⚙
              </button>
              {menuColumnas && (
                <Emergente ancla={menuColumnas} onCerrar={() => setMenuColumnas(null)} etiqueta="Columnas visibles">
                  <div className="emg-lista">
                    {COLUMNAS_LISTA.map((c) => (
                      <label key={c} className="emg-item emg-check">
                        <input type="checkbox" checked={columnas.includes(c)} onChange={(e) => onPrefs({ columnas: COLUMNAS_LISTA.filter((x) => (x === c ? e.target.checked : columnas.includes(x))) })} />
                        {NOMBRE_COLUMNA[c]}
                      </label>
                    ))}
                  </div>
                </Emergente>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <Fragment key={g.clave}>
              {agrupar !== 'ninguno' && (
                <tr className="lista-grupo">
                  <td colSpan={columnas.length + 4}>
                    <button
                      className="lista-grupo-btn"
                      aria-expanded={!plegados.has(g.clave)}
                      onClick={() =>
                        setPlegados((s) => {
                          const n = new Set(s)
                          if (!n.delete(g.clave)) n.add(g.clave)
                          return n
                        })
                      }
                    >
                      <span aria-hidden="true">{plegados.has(g.clave) ? '▸' : '▾'}</span> <strong>{g.nombre}</strong> <span className="chip">{g.tareas.length}</span>
                      {totalEstimacion(g.tareas) > 0 && <span className="chip">{totalEstimacion(g.tareas)} pt</span>}
                    </button>
                  </td>
                </tr>
              )}
              {!plegados.has(g.clave) &&
                g.tareas.map((t) => {
                  const espera = dependenciasAbiertas(t, a.todas, a.estados)
                  const sel = a.seleccion.has(t.id)
                  return (
                    <tr
                      key={`${g.clave}-${t.id}`}
                      data-tarea={t.id}
                      tabIndex={0}
                      className={`${sel ? 'seleccionada' : ''}${a.enfocada === t.id ? ' enfocada' : ''}${categoriaDe(a.estados, t.estado) === 'hecha' ? ' hecha' : ''}`}
                      onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey ? a.alternarSeleccion(t.id, e.shiftKey) : a.abrir(t.id))}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        a.menu(e.clientX, e.clientY, t)
                      }}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter') a.abrir(t.id)
                        if (e.key === ' ') {
                          e.preventDefault()
                          a.alternarSeleccion(t.id, false)
                        }
                      }}
                    >
                      <td className="lista-marca" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel} onChange={() => a.alternarSeleccion(t.id, false)} aria-label={`Seleccionar #${t.numero}`} />
                      </td>
                      <td className="tarea-num">#{t.numero}</td>
                      <td>
                        <div className="lista-celda-titulo">
                          <TituloEditable t={t} />
                          {espera.length > 0 && <span className="chip chip-aviso" title={`Espera a ${espera.map((d) => `#${d.numero}`).join(', ')}`}>⛓ {espera.map((d) => `#${d.numero}`).join(' ')}</span>}
                          {t.hito && <span className="chip chip-hito">⚑ {t.hito}</span>}
                        </div>
                      </td>
                      {columnas.map((c) => (
                        <td key={c} onClick={c === 'proyecto' || c === 'progreso' || c === 'etiquetas' || c === 'actualizada' ? undefined : (e) => e.stopPropagation()}>
                          {celda(c, t)}
                        </td>
                      ))}
                      <td className="lista-cols">
                        <button className="icono lista-mas" aria-label={`Más acciones de #${t.numero}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); a.menu(r.left, r.bottom + 4, t) }}>
                          ⋯
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
