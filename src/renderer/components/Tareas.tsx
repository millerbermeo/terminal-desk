import { useEffect, useMemo, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { PRIORIDADES, categoriaDe, dependenciasAbiertas, estaAbierta, fechaCorta, filtrarTareas, type Actividad, type Prioridad, type ResumenTareas, type Tarea } from '@shared/tareas'
import { filtroDeAmbito, useTareas, mensajeDe, type Ambito } from '../tareas/useTareas'
import { TareaDetalle } from './TareaDetalle'
import { TareasEstados } from './TareasEstados'
import { IconoMas } from './Iconos'

type Pestana = 'tablero' | 'lista' | 'resumen' | 'actividad'
const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'tablero', nombre: 'Tablero' },
  { id: 'lista', nombre: 'Lista' },
  { id: 'resumen', nombre: 'Resumen' },
  { id: 'actividad', nombre: 'Actividad' }
]
export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' }

interface Props {
  datos: DatosProyectos
  visible: boolean
}

interface PeticionMotivo {
  tarea: Tarea
  estado: string
  antesDe?: string
  pregunta: string
}

/** Tareas por grupos y proyectos: tablero, lista, resumen y actividad. La IA las lee y las cambia con las mismas reglas que el usuario. */
export function Tareas({ datos, visible }: Props) {
  const { tareas, estados, cargado, error, setError, intentar } = useTareas()
  const [pestana, setPestana] = useState<Pestana>('tablero')
  const [ambito, setAmbito] = useState<Ambito>('')
  const [texto, setTexto] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad | ''>('')
  const [verTerminadas, setVerTerminadas] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [motivo, setMotivo] = useState<PeticionMotivo | null>(null)
  const [verEstados, setVerEstados] = useState(false)
  const [nueva, setNueva] = useState('')

  const nombreProyecto = useMemo(() => new Map(datos.proyectos.map((p) => [p.id, p.nombre])), [datos.proyectos])
  const visibles = useMemo(
    () => filtrarTareas(tareas, estados, { ...filtroDeAmbito(ambito), ...(texto.trim() ? { texto } : {}), ...(prioridad ? { prioridad } : {}), ...(verTerminadas ? {} : { abiertas: true }) }),
    [tareas, estados, ambito, texto, prioridad, verTerminadas]
  )

  // La tarea abierta puede haber sido eliminada (por ti o desde otra ventana).
  useEffect(() => {
    if (abierta && cargado && !tareas.some((t) => t.id === abierta)) setAbierta(null)
  }, [abierta, cargado, tareas])

  /** Cambia el estado; si la regla pide un motivo (bloquear, descartar, reabrir) lo pregunta y reintenta. */
  const cambiarEstado = async (t: Tarea, estado: string, antesDe?: string, razon?: string): Promise<void> => {
    try {
      await window.api.tareas.operar('mover', { tarea: t.id, estado, ...(antesDe ? { antesDe } : {}), ...(razon ? { motivo: razon } : {}) })
      setError('')
      setMotivo(null)
    } catch (err) {
      const m = mensajeDe(err)
      if (/^Indica por qué/.test(m)) setMotivo({ tarea: t, estado, ...(antesDe ? { antesDe } : {}), pregunta: m })
      else setError(m)
    }
  }

  const crearRapida = async (): Promise<void> => {
    const titulo = nueva.trim()
    if (!titulo) return
    const proyectoId = ambito.startsWith('p:') ? ambito.slice(2) : undefined
    const grupoId = ambito.startsWith('g:') ? ambito.slice(2) : undefined
    if (await intentar(() => window.api.tareas.operar('crear', { titulo, ...(proyectoId ? { proyectoId } : {}), ...(grupoId ? { grupoId } : {}) }))) setNueva('')
  }

  return (
    <main className="tareas" style={{ display: visible ? 'flex' : 'none' }}>
      <header className="tareas-barra">
        <select value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)} aria-label="Ámbito">
          <option value="">Todas las tareas</option>
          <option value="__sin__">Sin proyecto</option>
          {datos.grupos.length > 0 && (
            <optgroup label="Grupos">
              {datos.grupos.map((g) => (
                <option key={g.id} value={`g:${g.id}`}>
                  {g.nombre}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Proyectos">
            {datos.proyectos.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.nombre}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="segmentado" role="tablist">
          {PESTANAS.map((p) => (
            <button key={p.id} role="tab" aria-selected={pestana === p.id} className={pestana === p.id ? 'on' : ''} onClick={() => setPestana(p.id)}>
              {p.nombre}
            </button>
          ))}
        </div>
        <input className="tareas-buscar" type="search" value={texto} placeholder="Buscar…" onChange={(e) => setTexto(e.target.value)} aria-label="Buscar tareas" />
        <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad | '')} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          {PRIORIDADES.map((p) => (
            <option key={p} value={p}>
              {NOMBRE_PRIORIDAD[p]}
            </option>
          ))}
        </select>
        <label className="tareas-check">
          <input type="checkbox" checked={verTerminadas} onChange={(e) => setVerTerminadas(e.target.checked)} /> Terminadas
        </label>
        <span className="ag-espacio" />
        <button onClick={() => setVerEstados(true)} title="Editar los estados del flujo de trabajo">
          Estados
        </button>
      </header>
      <form
        className="tareas-rapida"
        onSubmit={(e) => {
          e.preventDefault()
          void crearRapida()
        }}
      >
        <IconoMas />
        <input value={nueva} maxLength={200} placeholder={ambito.startsWith('p:') || ambito.startsWith('g:') ? 'Nueva tarea aquí… (Enter)' : 'Nueva tarea (sin proyecto: vincúlala después)… (Enter)'} onChange={(e) => setNueva(e.target.value)} aria-label="Nueva tarea" />
      </form>
      {error && (
        <div className="tareas-error" role="alert">
          {error}
          <button className="icono" onClick={() => setError('')} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      )}
      <div className="tareas-cuerpo">
        {!cargado ? (
          <p className="tareas-vacio">Cargando…</p>
        ) : pestana === 'tablero' ? (
          <Tablero tareas={visibles} todas={tareas} estados={estados} nombreProyecto={nombreProyecto} onAbrir={setAbierta} onMover={cambiarEstado} />
        ) : pestana === 'lista' ? (
          <Lista tareas={visibles} todas={tareas} estados={estados} nombreProyecto={nombreProyecto} onAbrir={setAbierta} />
        ) : pestana === 'resumen' ? (
          <Resumen ambito={ambito} onAbrir={setAbierta} tareas={tareas} />
        ) : (
          <ActividadTareas ambito={ambito} onAbrir={setAbierta} tareas={tareas} />
        )}
      </div>
      {abierta && <TareaDetalle id={abierta} datos={datos} todas={tareas} estados={estados} onCerrar={() => setAbierta(null)} onEstado={cambiarEstado} onAbrir={setAbierta} intentar={intentar} />}
      {verEstados && <TareasEstados estados={estados} tareas={tareas} onCerrar={() => setVerEstados(false)} intentar={intentar} />}
      {motivo && <ModalMotivo peticion={motivo} onCancelar={() => setMotivo(null)} onConfirmar={(r) => void cambiarEstado(motivo.tarea, motivo.estado, motivo.antesDe, r)} />}
    </main>
  )
}

// ------------------------------------------------------------------ pedazos compartidos

const claseVence = (t: Tarea, abierta: boolean): string => (abierta && t.vence !== undefined && t.vence < Date.now() ? ' vencida' : '')

function Tarjeta({ t, todas, estados, nombreProyecto, onAbrir, arrastrable }: { t: Tarea; todas: Tarea[]; estados: ReturnType<typeof useTareas>['estados']; nombreProyecto: Map<string, string>; onAbrir: (id: string) => void; arrastrable?: boolean }) {
  const espera = dependenciasAbiertas(t, todas, estados)
  const abierta = estaAbierta(t, estados)
  return (
    <div
      className={`tarea-tarjeta prioridad-${t.prioridad}`}
      role="button"
      tabIndex={0}
      draggable={arrastrable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onAbrir(t.id)}
      onKeyDown={(e) => e.key === 'Enter' && onAbrir(t.id)}
    >
      <div className="tarea-tit">
        <span className="tarea-num">#{t.numero}</span> {t.titulo}
      </div>
      <div className="tarea-meta">
        {t.proyectoId && <span className="chip">{nombreProyecto.get(t.proyectoId) ?? 'proyecto eliminado'}</span>}
        <span className={`chip prio-${t.prioridad}`}>{NOMBRE_PRIORIDAD[t.prioridad]}</span>
        {t.vence !== undefined && <span className={`chip${claseVence(t, abierta)}`}>{fechaCorta(t.vence)}</span>}
        {t.criterios.length > 0 && (
          <span className="chip" title="Criterios de aceptación cumplidos">
            ✓ {t.criterios.filter((c) => c.hecho).length}/{t.criterios.length}
          </span>
        )}
        {t.checklist.length > 0 && (
          <span className="chip" title="Subtareas terminadas">
            ☰ {t.checklist.filter((c) => c.hecho).length}/{t.checklist.length}
          </span>
        )}
        {espera.length > 0 && (
          <span className="chip chip-aviso" title={`Espera a ${espera.map((d) => `#${d.numero}`).join(', ')}`}>
            ⛓ {espera.map((d) => `#${d.numero}`).join(' ')}
          </span>
        )}
        {t.etiquetas.slice(0, 3).map((e) => (
          <span key={e} className="chip etiqueta">
            {e}
          </span>
        ))}
      </div>
    </div>
  )
}

function Tablero({ tareas, todas, estados, nombreProyecto, onAbrir, onMover }: { tareas: Tarea[]; todas: Tarea[]; estados: ReturnType<typeof useTareas>['estados']; nombreProyecto: Map<string, string>; onAbrir: (id: string) => void; onMover: (t: Tarea, estado: string, antesDe?: string) => Promise<void> }) {
  const [sobre, setSobre] = useState<string | null>(null)
  const soltar = (e: React.DragEvent, estado: string, antesDe?: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setSobre(null)
    const t = todas.find((x) => x.id === e.dataTransfer.getData('text/plain'))
    if (t && t.id !== antesDe) void onMover(t, estado, antesDe)
  }
  return (
    <div className="tablero">
      {estados.map((est) => {
        const columna = tareas.filter((t) => t.estado === est.id).sort((a, b) => a.orden - b.orden)
        return (
          <section
            key={est.id}
            className={`columna cat-${est.categoria}${sobre === est.id ? ' sobre' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setSobre(est.id)
            }}
            onDragLeave={(e) => e.currentTarget === e.target && setSobre(null)}
            onDrop={(e) => soltar(e, est.id)}
            aria-label={est.nombre}
          >
            <h4>
              {est.nombre} <span className="chip">{columna.length}</span>
            </h4>
            <div className="columna-tareas">
              {columna.map((t) => (
                <div key={t.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => soltar(e, est.id, t.id)}>
                  <Tarjeta t={t} todas={todas} estados={estados} nombreProyecto={nombreProyecto} onAbrir={onAbrir} arrastrable />
                </div>
              ))}
              {columna.length === 0 && <p className="tareas-vacio">Sin tareas</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Lista({ tareas, todas, estados, nombreProyecto, onAbrir }: { tareas: Tarea[]; todas: Tarea[]; estados: ReturnType<typeof useTareas>['estados']; nombreProyecto: Map<string, string>; onAbrir: (id: string) => void }) {
  if (tareas.length === 0) return <p className="tareas-vacio">No hay tareas con estos filtros.</p>
  return (
    <table className="tareas-tabla">
      <thead>
        <tr>
          <th>#</th>
          <th>Título</th>
          <th>Estado</th>
          <th>Prioridad</th>
          <th>Proyecto</th>
          <th>Vence</th>
          <th>Criterios</th>
        </tr>
      </thead>
      <tbody>
        {tareas.map((t) => {
          const espera = dependenciasAbiertas(t, todas, estados)
          return (
            <tr key={t.id} tabIndex={0} onClick={() => onAbrir(t.id)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(t.id)}>
              <td className="tarea-num">#{t.numero}</td>
              <td>
                {t.titulo} {espera.length > 0 && <span className="chip chip-aviso">⛓ {espera.map((d) => `#${d.numero}`).join(' ')}</span>}
              </td>
              <td>
                <span className={`chip cat-${categoriaDe(estados, t.estado)}`}>{estados.find((e) => e.id === t.estado)?.nombre ?? t.estado}</span>
              </td>
              <td>
                <span className={`chip prio-${t.prioridad}`}>{NOMBRE_PRIORIDAD[t.prioridad]}</span>
              </td>
              <td>{t.proyectoId ? (nombreProyecto.get(t.proyectoId) ?? '—') : '—'}</td>
              <td className={claseVence(t, estaAbierta(t, estados)).trim()}>{t.vence !== undefined ? fechaCorta(t.vence) : ''}</td>
              <td>{t.criterios.length ? `${t.criterios.filter((c) => c.hecho).length}/${t.criterios.length}` : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Resumen({ ambito, onAbrir, tareas }: { ambito: Ambito; onAbrir: (id: string) => void; tareas: Tarea[] }) {
  const [r, setR] = useState<ResumenTareas | null>(null)
  const [fallo, setFallo] = useState('')
  const entrada = ambito.startsWith('p:') ? { proyectoId: ambito.slice(2) } : ambito.startsWith('g:') ? { grupoId: ambito.slice(2) } : {}
  const clave = JSON.stringify(entrada)
  // Se vuelve a pedir cuando cambia el ámbito o cualquier tarea (la lista cambia en cada modificación).
  useEffect(() => {
    let vigente = true
    window.api.tareas
      .operar('resumen', entrada)
      .then((x) => vigente && (setR(x), setFallo('')))
      .catch((e) => vigente && setFallo(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [clave, tareas])
  if (fallo) return <p className="tareas-vacio">{fallo}</p>
  if (!r) return <p className="tareas-vacio">Cargando…</p>
  const enlace = (x: { id: string; numero: number; titulo: string }, extra?: string): React.ReactNode => (
    <li key={x.id}>
      <button className="enlace" onClick={() => onAbrir(x.id)}>
        #{x.numero} {x.titulo}
      </button>
      {extra && <span className="tareas-suave"> · {extra}</span>}
    </li>
  )
  return (
    <div className="resumen">
      <div className="resumen-cab">
        <div className="progreso" role="progressbar" aria-valuenow={r.progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
          <i style={{ width: `${r.progreso}%` }} />
        </div>
        <strong>{r.progreso} %</strong>
        <span className="tareas-suave">
          {r.hechas} terminadas · {r.abiertas} abiertas · {r.total} en total
        </span>
      </div>
      <div className="resumen-estados">
        {r.porEstado.map((e) => (
          <span key={e.estado} className={`chip cat-${e.categoria}`}>
            {e.nombre}: {e.cantidad}
          </span>
        ))}
      </div>
      {r.siguiente && (
        <section>
          <h4>Siguiente recomendada</h4>
          <ul>{enlace(r.siguiente, NOMBRE_PRIORIDAD[r.siguiente.prioridad])}</ul>
        </section>
      )}
      <section>
        <h4>Bloqueadas ({r.bloqueadas.length})</h4>
        {r.bloqueadas.length ? <ul>{r.bloqueadas.map((b) => enlace(b, b.motivo))}</ul> : <p className="tareas-suave">Ninguna.</p>}
      </section>
      <section>
        <h4>Vencidas ({r.vencidas.length})</h4>
        {r.vencidas.length ? <ul>{r.vencidas.map((v) => enlace(v, fechaCorta(v.vence)))}</ul> : <p className="tareas-suave">Ninguna.</p>}
      </section>
      <section>
        <h4>Sin criterios de aceptación ({r.sinCriterios.length})</h4>
        {r.sinCriterios.length ? <ul>{r.sinCriterios.slice(0, 20).map((x) => enlace(x))}</ul> : <p className="tareas-suave">Todas tienen criterios.</p>}
      </section>
    </div>
  )
}

function ActividadTareas({ ambito, onAbrir, tareas }: { ambito: Ambito; onAbrir: (id: string) => void; tareas: Tarea[] }) {
  const [filas, setFilas] = useState<Actividad[] | null>(null)
  const proyectoId = ambito.startsWith('p:') ? ambito.slice(2) : undefined
  useEffect(() => {
    let vigente = true
    window.api.tareas
      .operar('actividad', { ...(proyectoId ? { proyectoId } : {}), limite: 200 })
      .then((x) => vigente && setFilas(x))
      .catch(() => vigente && setFilas([]))
    return () => {
      vigente = false
    }
  }, [proyectoId, tareas])
  if (!filas) return <p className="tareas-vacio">Cargando…</p>
  if (filas.length === 0) return <p className="tareas-vacio">Aún no hay actividad.</p>
  return (
    <ul className="actividad">
      {filas.map((a) => (
        <li key={a.id}>
          <span className={`chip ${a.autor === 'ia' ? 'chip-ok' : ''}`} title={a.autor === 'ia' ? 'Lo hizo la IA' : 'Lo hiciste tú'}>
            {a.autor === 'ia' ? '✦ IA' : 'Tú'}
          </span>
          <span className="actividad-texto">
            {a.tareaId && tareas.some((t) => t.id === a.tareaId) ? (
              <button className="enlace" onClick={() => onAbrir(a.tareaId!)}>
                {a.detalle}
              </button>
            ) : (
              a.detalle
            )}
            {a.motivo && <em className="tareas-suave"> — {a.motivo}</em>}
          </span>
          <time className="tareas-suave">{new Date(a.fecha).toLocaleString()}</time>
        </li>
      ))}
    </ul>
  )
}

function ModalMotivo({ peticion, onCancelar, onConfirmar }: { peticion: PeticionMotivo; onCancelar: () => void; onConfirmar: (motivo: string) => void }) {
  const [texto, setTexto] = useState('')
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancelar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCancelar])
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <form
        className="modal modal-chico"
        role="dialog"
        aria-modal="true"
        aria-label="Motivo del cambio"
        onSubmit={(e) => {
          e.preventDefault()
          if (texto.trim()) onConfirmar(texto.trim())
        }}
      >
        <div className="modal-cab">
          <h3>
            #{peticion.tarea.numero} {peticion.tarea.titulo}
          </h3>
        </div>
        <p className="modal-texto">{peticion.pregunta}</p>
        <input autoFocus value={texto} maxLength={500} onChange={(e) => setTexto(e.target.value)} placeholder="Motivo (queda en el historial)" aria-label="Motivo" style={{ maxWidth: 'none' }} />
        <div className="cfg-acciones">
          <button className="primario" type="submit" disabled={!texto.trim()}>
            Cambiar estado
          </button>
          <button type="button" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
