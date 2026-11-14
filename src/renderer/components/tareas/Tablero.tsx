import { useMemo, useRef, useState } from 'react'
import { categoriaDe, type EstadoTarea, type Tarea } from '@shared/tareas'
import { agruparTareas, superaLimite, totalEstimacion, type AgruparPor, type GrupoTareas } from '@shared/tareas-vista'
import type { PrefsVista } from '../../tareas/vista'
import { EstadoVacio } from '../EstadoVacio'
import { IconoMas, IconoTareas } from '../Iconos'
import { Emergente, MenuLista, anclaDe, type Ancla } from './Emergente'
import { useAcciones } from './contexto'
import { TareaTarjeta } from './TareaTarjeta'

interface Props {
  tareas: Tarea[]
  agrupar: AgruparPor
  prefs: PrefsVista
  onPrefs: (p: Partial<PrefsVista>) => void
}

interface Destino {
  estado: string
  antesDe?: string
}

/** Qué cambia al soltar una tarea en un carril (además del estado), según cómo esté agrupado el tablero. */
function parcheDeCarril(por: AgruparPor, clave: string): Parameters<ReturnType<typeof useAcciones>['editar']>[1] | undefined {
  switch (por) {
    case 'prioridad':
      return { prioridad: clave as 'baja' }
    case 'responsable':
      return { responsable: clave === '' ? null : (clave as 'ia') }
    case 'hito':
      return { hito: clave === '' ? null : clave }
    case 'proyecto':
      return { proyectoId: clave === '' ? null : clave }
    default:
      return undefined
  }
}

function Columna({ est, tareas, carril, agrupar, prefs, onPrefs, sobre, setSobre, soltar }: { est: EstadoTarea; tareas: Tarea[]; carril: GrupoTareas; agrupar: AgruparPor; prefs: PrefsVista; onPrefs: (p: Partial<PrefsVista>) => void; sobre: string | null; setSobre: (k: string | null) => void; soltar: (e: React.DragEvent, d: Destino, carril: GrupoTareas) => void }) {
  const a = useAcciones()
  const clave = `${carril.clave}|${est.id}`
  const plegada = prefs.colapsadas.includes(est.id)
  const limite = prefs.limites[est.id]
  const excede = superaLimite(tareas.length, limite)
  const puntos = totalEstimacion(tareas)
  const [anadiendo, setAnadiendo] = useState(false)
  const [nueva, setNueva] = useState('')
  const [menu, setMenu] = useState<Ancla | null>(null)
  const [indicador, setIndicador] = useState<{ id: string; despues: boolean } | null>(null)
  const orden = useMemo(() => [...tareas].sort((x, y) => x.orden - y.orden), [tareas])

  const crear = async (): Promise<void> => {
    const titulo = nueva.trim()
    if (!titulo) return
    const patch = parcheDeCarril(agrupar, carril.clave)
    const t = await a.crear({ titulo, estado: est.id })
    if (t && patch) await a.editar(t, patch)
    setNueva('')
  }

  const [editandoLimite, setEditandoLimite] = useState<Ancla | null>(null)
  const guardarLimite = (v: string): void => {
    const n = Math.floor(Number(v))
    const limites = { ...prefs.limites }
    if (!v.trim() || !Number.isFinite(n) || n <= 0) delete limites[est.id]
    else limites[est.id] = Math.min(n, 99)
    onPrefs({ limites })
    setEditandoLimite(null)
  }

  if (plegada) {
    return (
      <section className={`columna plegada cat-${est.categoria}`} aria-label={`${est.nombre} (plegada)`}>
        <button className="columna-desplegar" onClick={() => onPrefs({ colapsadas: prefs.colapsadas.filter((x) => x !== est.id) })} title={`Mostrar «${est.nombre}»`}>
          <span className="columna-vertical">{est.nombre}</span>
          <span className="chip">{tareas.length}</span>
        </button>
      </section>
    )
  }

  return (
    <section
      className={`columna cat-${est.categoria}${sobre === clave ? ' sobre' : ''}${excede ? ' excede' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setSobre(clave)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setSobre(null)
          setIndicador(null)
        }
      }}
      onDrop={(e) => {
        setIndicador(null)
        soltar(e, { estado: est.id }, carril)
      }}
      aria-label={est.nombre}
    >
      <header className="columna-cab">
        <h4>{est.nombre}</h4>
        <span className={`chip${excede ? ' chip-error' : ''}`} title={excede ? `Supera el límite de ${limite}` : limite ? `Límite ${limite}` : undefined}>
          {tareas.length}
          {limite ? `/${limite}` : ''}
        </span>
        {puntos > 0 && <span className="chip" title="Puntos estimados">{puntos} pt</span>}
        <span className="ag-espacio" />
        <button className="icono columna-boton" onClick={() => setAnadiendo(true)} title={`Añadir tarea a «${est.nombre}»`} aria-label={`Añadir tarea a ${est.nombre}`}>
          <IconoMas />
        </button>
        <button className="icono columna-boton" onClick={(e) => setMenu(anclaDe(e.currentTarget))} title="Opciones de la columna" aria-label={`Opciones de ${est.nombre}`} aria-haspopup="menu">
          ⋯
        </button>
        {menu && (
          <Emergente ancla={menu} onCerrar={() => setMenu(null)}>
            <MenuLista
              onCerrar={() => setMenu(null)}
              items={[
                { id: 'anadir', etiqueta: 'Añadir tarea', onClick: () => setAnadiendo(true) },
                { id: 'plegar', etiqueta: 'Plegar columna', onClick: () => onPrefs({ colapsadas: [...prefs.colapsadas, est.id] }) },
                { id: 'limite', etiqueta: limite ? `Cambiar límite (${limite})` : 'Fijar límite de tareas…', onClick: () => setEditandoLimite(menu) },
                ...(limite ? [{ id: 'sinlimite', etiqueta: 'Quitar límite', onClick: () => { const l = { ...prefs.limites }; delete l[est.id]; onPrefs({ limites: l }) } }] : [])
              ]}
            />
          </Emergente>
        )}
        {editandoLimite && (
          <Emergente ancla={editandoLimite} onCerrar={() => setEditandoLimite(null)} etiqueta="Límite de la columna">
            <form
              className="emg-form"
              onSubmit={(e) => {
                e.preventDefault()
                guardarLimite(String(new FormData(e.currentTarget).get('limite') ?? ''))
              }}
            >
              <label>
                Máximo de tareas en «{est.nombre}»
                <input name="limite" type="number" min={1} max={99} defaultValue={limite ?? ''} placeholder="Sin límite" autoFocus />
              </label>
              <button className="primario" type="submit">Guardar</button>
            </form>
          </Emergente>
        )}
      </header>
      <div className="columna-tareas">
        {orden.map((t, i) => (
          <div
            key={t.id}
            className={`tarjeta-hueco${indicador?.id === t.id ? (indicador.despues ? ' ind-despues' : ' ind-antes') : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSobre(clave)
              const r = e.currentTarget.getBoundingClientRect()
              const despues = e.clientY > r.top + r.height / 2
              setIndicador((x) => (x?.id === t.id && x.despues === despues ? x : { id: t.id, despues }))
            }}
            onDrop={(e) => {
              e.stopPropagation()
              const despues = indicador?.id === t.id && indicador.despues
              setIndicador(null)
              soltar(e, { estado: est.id, ...(despues ? (orden[i + 1] ? { antesDe: orden[i + 1]!.id } : {}) : { antesDe: t.id }) }, carril)
            }}
          >
            <TareaTarjeta t={t} densidad={prefs.densidad} ocultarProyecto={agrupar === 'proyecto'} />
          </div>
        ))}
        {orden.length === 0 && !anadiendo && <EstadoVacio variante="minimo" icono={<IconoTareas />} titulo="Suelta una tarea aquí" />}
      </div>
      {anadiendo ? (
        <form
          className="columna-nueva"
          onSubmit={(e) => {
            e.preventDefault()
            void crear()
          }}
        >
          <input
            autoFocus
            value={nueva}
            maxLength={200}
            placeholder="Título y Enter… (Esc cierra)"
            aria-label={`Nueva tarea en ${est.nombre}`}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAnadiendo(false)
                setNueva('')
              }
            }}
            onBlur={() => !nueva.trim() && setAnadiendo(false)}
          />
        </form>
      ) : (
        categoriaDe(a.estados, est.id) !== 'cancelada' && (
          <button className="columna-anadir" onClick={() => setAnadiendo(true)}>
            <IconoMas /> Añadir tarea
          </button>
        )
      )}
    </section>
  )
}

/** Tablero por columnas, con carriles opcionales («Agrupar por»), columnas plegables, límite de trabajo y arrastre con indicador de posición. */
export function Tablero({ tareas, agrupar, prefs, onPrefs }: Props) {
  const a = useAcciones()
  const [sobre, setSobre] = useState<string | null>(null)
  const [carrilesPlegados, setCarrilesPlegados] = useState<Set<string>>(new Set())
  const cuerpo = useRef<HTMLDivElement>(null)
  const carriles = useMemo(() => agruparTareas(tareas, agrupar === 'estado' ? 'ninguno' : agrupar, { estados: a.estados, nombreProyecto: a.nombreProyecto }), [tareas, agrupar, a.estados, a.nombreProyecto])

  const soltar = (e: React.DragEvent, d: Destino, carril: GrupoTareas): void => {
    e.preventDefault()
    e.stopPropagation()
    setSobre(null)
    const ids = e.dataTransfer.getData('text/plain').split(',').filter(Boolean)
    const patch = parcheDeCarril(agrupar, carril.clave)
    void (async () => {
      for (const id of ids) {
        const t = a.todas.find((x) => x.id === id)
        if (!t || t.id === d.antesDe) continue
        if (patch) await a.editar(t, patch)
        await a.mover(t, d.estado, d.antesDe)
      }
    })()
  }

  // Auto-scroll mientras se arrastra cerca de los bordes (horizontal y vertical).
  const autoScroll = (e: React.DragEvent): void => {
    const el = cuerpo.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margen = 70
    const paso = 22
    if (e.clientX < r.left + margen) el.scrollLeft -= paso
    else if (e.clientX > r.right - margen) el.scrollLeft += paso
    const padre = el.closest('.tareas-cuerpo') as HTMLElement | null
    if (padre) {
      const rp = padre.getBoundingClientRect()
      if (e.clientY < rp.top + margen) padre.scrollTop -= paso
      else if (e.clientY > rp.bottom - margen) padre.scrollTop += paso
    }
  }

  return (
    <div className="tablero-cuerpo" ref={cuerpo} onDragOver={autoScroll}>
      {carriles.map((c) => {
        const plegado = carrilesPlegados.has(c.clave)
        return (
          <div className="carril" key={c.clave}>
            {agrupar !== 'ninguno' && agrupar !== 'estado' && (
              <button
                className="carril-cab"
                aria-expanded={!plegado}
                onClick={() =>
                  setCarrilesPlegados((s) => {
                    const n = new Set(s)
                    if (!n.delete(c.clave)) n.add(c.clave)
                    return n
                  })
                }
              >
                <span className="chevron" aria-hidden="true">{plegado ? '▸' : '▾'}</span>
                <strong>{c.nombre}</strong>
                <span className="chip">{c.tareas.length}</span>
              </button>
            )}
            {!plegado && (
              <div className="tablero">
                {a.estados.map((est) => (
                  <Columna key={est.id} est={est} tareas={c.tareas.filter((t) => t.estado === est.id)} carril={c} agrupar={agrupar} prefs={prefs} onPrefs={onPrefs} sobre={sobre} setSobre={setSobre} soltar={soltar} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
