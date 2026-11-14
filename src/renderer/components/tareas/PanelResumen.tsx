import { useEffect, useState } from 'react'
import { NOMBRE_RESPONSABLE, categoriaDe, estaAbierta, fechaCorta, type Actividad, type ResumenTareas, type Tarea } from '@shared/tareas'
import { totalEstimacion } from '@shared/tareas-vista'
import { filtroDeAmbito, mensajeDe, type Ambito } from '../../tareas/useTareas'
import { Esqueletos } from '../Cargando'
import { EstadoVacio } from '../EstadoVacio'
import { IconoActividad } from '../Iconos'
import { NOMBRE_PRIORIDAD } from './constantes'
import { useAcciones } from './contexto'

/** Resumen del ámbito: avance, reparto por estado, carga por responsable y lo que requiere atención. */
export function Resumen({ ambito, tareas }: { ambito: Ambito; tareas: Tarea[] }) {
  const a = useAcciones()
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
  }, [clave, a.todas])
  if (fallo) return <p className="tareas-vacio">{fallo}</p>
  if (!r) return <Esqueletos cuantos={6} />

  const enAmbito = tareas.filter((t) => {
    const f = filtroDeAmbito(ambito)
    if (f.proyectoId !== undefined && t.proyectoId !== f.proyectoId) return false
    if (f.grupoId !== undefined && t.grupoId !== f.grupoId) return false
    if (f.sinProyecto && t.proyectoId) return false
    return true
  })
  const abiertas = enAmbito.filter((t) => estaAbierta(t, a.estados))
  const carga = (['usuario', 'ia', undefined] as const).map((resp) => {
    const ts = abiertas.filter((t) => t.responsable === resp)
    return { clave: resp ?? 'sin', nombre: resp ? NOMBRE_RESPONSABLE[resp] : 'Sin asignar', n: ts.length, puntos: totalEstimacion(ts) }
  })
  const maxCarga = Math.max(1, ...carga.map((c) => c.n))
  const maxEstado = Math.max(1, ...r.porEstado.map((e) => e.cantidad))
  const enlace = (x: { id: string; numero: number; titulo: string }, extra?: string): React.ReactNode => (
    <li key={x.id}>
      <button className="enlace" onClick={() => a.abrir(x.id)}>
        #{x.numero} {x.titulo}
      </button>
      {extra && <span className="tareas-suave"> · {extra}</span>}
    </li>
  )
  return (
    <div className="resumen">
      <div className="resumen-kpis">
        <div className="kpi"><strong>{r.progreso}%</strong><span>Progreso</span></div>
        <div className="kpi"><strong>{r.abiertas}</strong><span>Abiertas</span></div>
        <div className="kpi"><strong>{r.hechas}</strong><span>Terminadas</span></div>
        <div className={`kpi${r.vencidas.length ? ' alerta' : ''}`}><strong>{r.vencidas.length}</strong><span>Vencidas</span></div>
        <div className={`kpi${r.bloqueadas.length ? ' aviso' : ''}`}><strong>{r.bloqueadas.length}</strong><span>Bloqueadas</span></div>
        <div className="kpi"><strong>{totalEstimacion(abiertas)}</strong><span>Puntos abiertos</span></div>
      </div>
      <div className="resumen-cab">
        <div className="progreso" role="progressbar" aria-valuenow={r.progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
          <i style={{ width: `${r.progreso}%` }} />
        </div>
        <span className="tareas-suave">{r.hechas} de {r.total - r.porEstado.filter((e) => e.categoria === 'cancelada').reduce((s, e) => s + e.cantidad, 0)} terminadas</span>
      </div>
      <div className="resumen-columnas">
        <section>
          <h4>Por estado</h4>
          <ul className="barras">
            {r.porEstado.map((e) => (
              <li key={e.estado}>
                <span className="barras-nombre">{e.nombre}</span>
                <span className="barras-pista"><span className={`barras-valor cat-${e.categoria}`} style={{ width: `${(e.cantidad / maxEstado) * 100}%` }} /></span>
                <span className="barras-n">{e.cantidad}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Carga de trabajo (abiertas)</h4>
          <ul className="barras">
            {carga.map((c) => (
              <li key={c.clave}>
                <span className="barras-nombre">{c.nombre}</span>
                <span className="barras-pista"><span className="barras-valor" style={{ width: `${(c.n / maxCarga) * 100}%` }} /></span>
                <span className="barras-n">{c.n}{c.puntos ? ` · ${c.puntos} pt` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
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

export function ActividadTareas({ ambito, tareas }: { ambito: Ambito; tareas: Tarea[] }) {
  const a = useAcciones()
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
  if (!filas) return <Esqueletos cuantos={6} />
  if (filas.length === 0) return <EstadoVacio icono={<IconoActividad />} titulo="Aún no hay actividad" texto="Aquí verás quién hizo cada cambio: tú o la IA." />
  return (
    <ul className="actividad">
      {filas.map((x) => (
        <li key={x.id}>
          <span className={`chip ${x.autor === 'ia' ? 'chip-ok' : ''}`} title={x.autor === 'ia' ? 'Lo hizo la IA' : 'Lo hiciste tú'}>
            {x.autor === 'ia' ? '✦ IA' : 'Tú'}
          </span>
          <span className="actividad-texto">
            {x.tareaId && tareas.some((t) => t.id === x.tareaId) ? (
              <button className="enlace" onClick={() => a.abrir(x.tareaId!)}>
                {x.detalle}
              </button>
            ) : (
              x.detalle
            )}
            {x.motivo && <em className="tareas-suave"> — {x.motivo}</em>}
          </span>
          <time className="tareas-suave">{new Date(x.fecha).toLocaleString()}</time>
        </li>
      ))}
    </ul>
  )
}

/** Marca de «categoría» para colorear (se reexporta para las vistas que la necesitan). */
export const categoriaClase = (t: Tarea, estados: Parameters<typeof categoriaDe>[0]): string => `cat-${categoriaDe(estados, t.estado)}`
