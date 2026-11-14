import { useMemo, useRef, useState } from 'react'
import { estaAbierta, type Tarea } from '@shared/tareas'
import { barraCronograma, diasDeDesplazamiento, finDelDia, inicioDelDia, rangoCronograma, tramoTarea } from '@shared/tareas-vista'
import { useAcciones } from './contexto'

const DIA_PX = 34
const FILA_PX = 34
const DIA_MS = 86_400_000

type Modo = 'mover' | 'inicio' | 'fin'
interface Arrastre {
  id: string
  modo: Modo
  x0: number
  dx: number
}

/** Cronograma tipo Gantt: barras de inicio a vencimiento, dependencias con flechas, arrastre para mover o cambiar la duración. */
export function Cronograma({ tareas }: { tareas: Tarea[] }) {
  const a = useAcciones()
  const [arr, setArr] = useState<Arrastre | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const conFechas = useMemo(
    () => tareas.filter((t) => tramoTarea(t)).sort((x, y) => (tramoTarea(x)!.desde - tramoTarea(y)!.desde) || x.numero - y.numero),
    [tareas]
  )
  const sinFechas = useMemo(() => tareas.filter((t) => !tramoTarea(t) && estaAbierta(t, a.estados)), [tareas, a.estados])
  const rango = useMemo(() => rangoCronograma(conFechas), [conFechas])
  const ancho = rango.dias * DIA_PX
  const dias = useMemo(() => Array.from({ length: rango.dias }, (_, i) => new Date(rango.inicio + i * DIA_MS + 12 * 3_600_000)), [rango])
  const hoyX = ((Date.now() - rango.inicio) / (rango.fin - rango.inicio)) * ancho
  const fila = new Map(conFechas.map((t, i) => [t.id, i]))

  const posicion = (t: Tarea): { izq: number; ancho: number } => {
    const b = barraCronograma(t, rango)!
    let izq = (b.izq / 100) * ancho
    let w = (b.ancho / 100) * ancho
    if (arr?.id === t.id) {
      const d = Math.round(arr.dx / DIA_PX) * DIA_PX
      if (arr.modo === 'mover') izq += d
      else if (arr.modo === 'inicio') {
        izq += d
        w -= d
      } else w += d
    }
    return { izq, ancho: Math.max(w, DIA_PX * 0.6) }
  }

  const empezar = (e: React.PointerEvent, t: Tarea, modo: Modo): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setArr({ id: t.id, modo, x0: e.clientX, dx: 0 })
  }
  const terminar = (t: Tarea): void => {
    if (!arr) return
    const dias = diasDeDesplazamiento(arr.dx, ancho, rango)
    setArr(null)
    if (dias === 0) return a.abrir(t.id)
    const tr = tramoTarea(t)!
    if (arr.modo === 'mover') {
      const nuevo = { inicio: (t.inicio ?? tr.desde) + dias * DIA_MS, vence: (t.vence ?? tr.hasta) + dias * DIA_MS }
      void a.editar(t, { ...(t.inicio !== undefined || t.vence !== undefined ? { inicio: nuevo.inicio } : {}), vence: nuevo.vence }, true)
    } else if (arr.modo === 'inicio') {
      const inicio = Math.min((t.inicio ?? tr.desde) + dias * DIA_MS, tr.hasta)
      void a.editar(t, { inicio: inicioDelDia(inicio) }, true)
    } else {
      const vence = Math.max((t.vence ?? tr.hasta) + dias * DIA_MS, tr.desde)
      void a.editar(t, { vence: finDelDia(vence) }, true)
    }
  }

  const programar = (t: Tarea): void => void a.editar(t, { inicio: inicioDelDia(Date.now()), vence: finDelDia(Date.now() + 2 * DIA_MS) }, true)

  if (conFechas.length === 0 && sinFechas.length === 0) return <p className="tareas-vacio">No hay tareas para mostrar en el cronograma.</p>

  // Flechas de dependencia: del final de la tarea previa al inicio de la que espera.
  const flechas = conFechas.flatMap((t) =>
    t.dependeDe.flatMap((d) => {
      const dep = conFechas.find((x) => x.id === d)
      if (!dep) return []
      const p1 = posicion(dep)
      const p2 = posicion(t)
      const x1 = p1.izq + p1.ancho
      const y1 = fila.get(dep.id)! * FILA_PX + FILA_PX / 2
      const x2 = p2.izq
      const y2 = fila.get(t.id)! * FILA_PX + FILA_PX / 2
      const medio = Math.max(x1 + 10, Math.min(x2 - 10, (x1 + x2) / 2))
      return [{ clave: `${d}>${t.id}`, d: `M${x1},${y1} H${medio} V${y2} H${x2}`, x2, y2, malo: x2 < x1 }]
    })
  )

  return (
    <div className="cronograma">
      <div className="cronograma-cuerpo">
        <div className="cronograma-nombres" style={{ ['--fila' as string]: `${FILA_PX}px` }}>
          <div className="cronograma-cab-nombre">Tarea</div>
          {conFechas.map((t) => (
            <button key={t.id} className={`cronograma-nombre${!estaAbierta(t, a.estados) ? ' hecha' : ''}`} onClick={() => a.abrir(t.id)} onContextMenu={(e) => { e.preventDefault(); a.menu(e.clientX, e.clientY, t) }} title={`#${t.numero} ${t.titulo}`}>
              <span className="tarea-num">#{t.numero}</span> {t.titulo}
            </button>
          ))}
        </div>
        <div className="cronograma-area" ref={area}>
          <div className="cronograma-lienzo" style={{ width: ancho, ['--dia' as string]: `${DIA_PX}px`, ['--fila' as string]: `${FILA_PX}px` }}>
            <div className="cronograma-dias" style={{ width: ancho }}>
              {dias.map((d, i) => (
                <div key={i} className={`cronograma-dia${d.getDay() === 0 || d.getDay() === 6 ? ' finde' : ''}${d.getDate() === 1 ? ' mes' : ''}`}>
                  {d.getDate() === 1 || i === 0 ? <span className="cronograma-mes">{d.toLocaleDateString('es', { month: 'short' })}</span> : null}
                  <span>{d.getDate()}</span>
                </div>
              ))}
            </div>
            <div className="cronograma-filas" style={{ height: conFechas.length * FILA_PX, width: ancho }}>
              <div className="cronograma-hoy" style={{ left: hoyX }} title="Hoy" />
              <svg className="cronograma-flechas" width={ancho} height={conFechas.length * FILA_PX} aria-hidden="true">
                <defs>
                  <marker id="punta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" className="cronograma-punta" />
                  </marker>
                </defs>
                {flechas.map((f) => (
                  <path key={f.clave} d={f.d} className={`cronograma-flecha${f.malo ? ' malo' : ''}`} markerEnd="url(#punta)" fill="none" />
                ))}
              </svg>
              {conFechas.map((t, i) => {
                const p = posicion(t)
                const vencida = t.vence !== undefined && t.vence < Date.now() && estaAbierta(t, a.estados)
                return (
                  <div
                    key={t.id}
                    className={`cronograma-barra prioridad-${t.prioridad}${t.color ? ` color-${t.color}` : ''}${!estaAbierta(t, a.estados) ? ' hecha' : ''}${vencida ? ' vencida' : ''}${arr?.id === t.id ? ' moviendo' : ''}`}
                    style={{ left: p.izq, width: p.ancho, top: i * FILA_PX + 6 }}
                    role="button"
                    tabIndex={0}
                    title={`#${t.numero} ${t.titulo}\nArrastra para mover; los bordes cambian la duración`}
                    onPointerDown={(e) => empezar(e, t, 'mover')}
                    onPointerMove={(e) => arr?.id === t.id && setArr({ ...arr, dx: e.clientX - arr.x0 })}
                    onPointerUp={() => terminar(t)}
                    onKeyDown={(e) => e.key === 'Enter' && a.abrir(t.id)}
                    onContextMenu={(e) => { e.preventDefault(); a.menu(e.clientX, e.clientY, t) }}
                  >
                    <span className="cronograma-asa izq" onPointerDown={(e) => empezar(e, t, 'inicio')} />
                    <span className="cronograma-texto">{t.titulo}</span>
                    <span className="cronograma-asa der" onPointerDown={(e) => empezar(e, t, 'fin')} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      {sinFechas.length > 0 && (
        <details className="cronograma-sin-fechas" open={conFechas.length === 0}>
          <summary>Sin fechas ({sinFechas.length})</summary>
          <ul>
            {sinFechas.map((t) => (
              <li key={t.id}>
                <button className="enlace" onClick={() => a.abrir(t.id)}><span className="tarea-num">#{t.numero}</span> {t.titulo}</button>
                <button onClick={() => programar(t)}>Programar (hoy → +2 días)</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
