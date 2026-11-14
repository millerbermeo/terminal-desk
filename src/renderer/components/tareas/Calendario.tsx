import { useMemo, useState } from 'react'
import { estaAbierta, type Tarea } from '@shared/tareas'
import { celdasMes, diaClave, tareasPorDia, vencimientoEnDia } from '@shared/tareas-vista'
import { useAcciones } from './contexto'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MAX_POR_CELDA = 3

/** Calendario mensual por fecha de vencimiento: arrastra una tarea a otro día para reprogramarla; clic en un día vacío crea una. */
export function Calendario({ tareas, prefijoNueva }: { tareas: Tarea[]; prefijoNueva?: { proyectoId?: string; grupoId?: string } }) {
  const a = useAcciones()
  const hoy = new Date()
  const [mes, setMes] = useState({ anio: hoy.getFullYear(), mes: hoy.getMonth() })
  const [sobre, setSobre] = useState<string | null>(null)
  const [creando, setCreando] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const celdas = useMemo(() => celdasMes(mes.anio, mes.mes), [mes])
  const porDia = useMemo(() => tareasPorDia(tareas), [tareas])
  const sinFecha = useMemo(() => tareas.filter((t) => t.vence === undefined && estaAbierta(t, a.estados)), [tareas, a.estados])
  const hoyClave = diaClave(Date.now())
  const textoMes = new Date(mes.anio, mes.mes, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })
  const nombreMes = textoMes.charAt(0).toUpperCase() + textoMes.slice(1)
  const irA = (delta: number): void => setMes((m) => { const d = new Date(m.anio, m.mes + delta, 1); return { anio: d.getFullYear(), mes: d.getMonth() } })

  const soltar = (e: React.DragEvent, clave: string): void => {
    e.preventDefault()
    setSobre(null)
    const ids = e.dataTransfer.getData('text/plain').split(',').filter(Boolean)
    for (const id of ids) {
      const t = a.todas.find((x) => x.id === id)
      if (t) void a.editar(t, { vence: vencimientoEnDia(clave) }, true)
    }
  }

  const crear = async (clave: string): Promise<void> => {
    const t = titulo.trim()
    if (!t) return
    await a.crear({ titulo: t, vence: vencimientoEnDia(clave), ...(prefijoNueva?.proyectoId ? { proyectoId: prefijoNueva.proyectoId } : {}), ...(prefijoNueva?.grupoId ? { grupoId: prefijoNueva.grupoId } : {}) })
    setTitulo('')
    setCreando(null)
  }

  return (
    <div className="calendario">
      <div className="calendario-cab">
        <button onClick={() => irA(-1)} aria-label="Mes anterior">‹</button>
        <h3>{nombreMes}</h3>
        <button onClick={() => irA(1)} aria-label="Mes siguiente">›</button>
        <button onClick={() => setMes({ anio: hoy.getFullYear(), mes: hoy.getMonth() })}>Hoy</button>
        <span className="ag-espacio" />
        <span className="tareas-suave">{tareas.filter((t) => t.vence !== undefined).length} con fecha · {sinFecha.length} sin fecha</span>
      </div>
      <div className="calendario-rejilla" role="grid" aria-label={nombreMes}>
        {DIAS.map((d) => (
          <div key={d} className="calendario-dia-nombre" role="columnheader">{d}</div>
        ))}
        {celdas.map((d) => {
          const clave = diaClave(d.getTime())
          const lista = porDia.get(clave) ?? []
          const fuera = d.getMonth() !== mes.mes
          const todas = expandido === clave
          return (
            <div
              key={clave}
              role="gridcell"
              className={`calendario-celda${fuera ? ' fuera' : ''}${clave === hoyClave ? ' hoy' : ''}${sobre === clave ? ' sobre' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setSobre(clave) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null) }}
              onDrop={(e) => soltar(e, clave)}
              onDoubleClick={(e) => { if (e.target === e.currentTarget) setCreando(clave) }}
            >
              <div className="calendario-num">
                <span>{d.getDate()}</span>
                <button className="icono calendario-mas" onClick={() => setCreando(clave)} aria-label={`Añadir tarea el ${clave}`} title="Añadir tarea este día">＋</button>
              </div>
              {(todas ? lista : lista.slice(0, MAX_POR_CELDA)).map((t) => (
                <button
                  key={t.id}
                  draggable
                  className={`calendario-tarea prioridad-${t.prioridad}${!estaAbierta(t, a.estados) ? ' hecha' : ''}${t.vence! < Date.now() && estaAbierta(t, a.estados) ? ' vencida' : ''}${t.color ? ` color-${t.color}` : ''}`}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                  onClick={() => a.abrir(t.id)}
                  onContextMenu={(e) => { e.preventDefault(); a.menu(e.clientX, e.clientY, t) }}
                  title={`#${t.numero} ${t.titulo}`}
                >
                  <span className="tarea-num">#{t.numero}</span> {t.titulo}
                </button>
              ))}
              {lista.length > MAX_POR_CELDA && (
                <button className="calendario-mas-tareas" onClick={() => setExpandido(todas ? null : clave)}>
                  {todas ? 'Ver menos' : `+${lista.length - MAX_POR_CELDA} más`}
                </button>
              )}
              {creando === clave && (
                <form onSubmit={(e) => { e.preventDefault(); void crear(clave) }}>
                  <input autoFocus value={titulo} maxLength={200} placeholder="Título y Enter" aria-label="Título de la nueva tarea" onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreando(null)} onBlur={() => !titulo.trim() && setCreando(null)} />
                </form>
              )}
            </div>
          )
        })}
      </div>
      {sinFecha.length > 0 && (
        <details className="calendario-sin-fecha">
          <summary>Sin fecha ({sinFecha.length}) — arrástralas al calendario</summary>
          <div className="calendario-sin-fecha-lista">
            {sinFecha.map((t) => (
              <button key={t.id} draggable className={`calendario-tarea prioridad-${t.prioridad}`} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }} onClick={() => a.abrir(t.id)} onContextMenu={(e) => { e.preventDefault(); a.menu(e.clientX, e.clientY, t) }}>
                <span className="tarea-num">#{t.numero}</span> {t.titulo}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
