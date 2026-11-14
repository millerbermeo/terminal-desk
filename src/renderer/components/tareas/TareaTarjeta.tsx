import { memo } from 'react'
import { dependenciasAbiertas, estaAbierta, categoriaDe, type Tarea } from '@shared/tareas'
import { progresoTarea } from '@shared/tareas-vista'
import { useAcciones } from './contexto'
import { Avatar, ChipFecha, ChipPrioridad } from './Selectores'

export type Densidad = 'comoda' | 'compacta'

interface Props {
  t: Tarea
  densidad: Densidad
  arrastrable?: boolean
  /** No repetir el nombre del proyecto cuando el tablero ya está agrupado por proyecto. */
  ocultarProyecto?: boolean
}

function TarjetaBase({ t, densidad, arrastrable = true, ocultarProyecto = false }: Props) {
  const a = useAcciones()
  const abierta = estaAbierta(t, a.estados)
  const espera = dependenciasAbiertas(t, a.todas, a.estados)
  const progreso = progresoTarea(t)
  const seleccionada = a.seleccion.has(t.id)
  const bloqueada = categoriaDe(a.estados, t.estado) === 'bloqueada'
  const hecha = categoriaDe(a.estados, t.estado) === 'hecha'
  const proyecto = t.proyectoId ? (a.nombreProyecto.get(t.proyectoId) ?? 'proyecto eliminado') : undefined

  return (
    <div
      className={`tarea-tarjeta prioridad-${t.prioridad}${t.color ? ` color-${t.color}` : ''}${seleccionada ? ' seleccionada' : ''}${a.enfocada === t.id ? ' enfocada' : ''}${hecha ? ' hecha' : ''}${densidad === 'compacta' ? ' compacta' : ''}`}
      data-tarea={t.id}
      role="button"
      tabIndex={0}
      draggable={arrastrable}
      aria-pressed={seleccionada}
      onDragStart={(e) => {
        const ids = seleccionada && a.seleccion.size > 1 ? [...a.seleccion] : [t.id]
        e.dataTransfer.setData('text/plain', ids.join(','))
        e.dataTransfer.effectAllowed = 'move'
        e.currentTarget.classList.add('arrastrando')
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('arrastrando')}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) a.alternarSeleccion(t.id, e.shiftKey)
        else a.abrir(t.id)
      }}
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
      <label className="tarjeta-marca" onClick={(e) => e.stopPropagation()} title="Seleccionar">
        <input type="checkbox" checked={seleccionada} onChange={() => a.alternarSeleccion(t.id, false)} aria-label={`Seleccionar #${t.numero}`} />
      </label>
      <div className="tarea-tit">
        <span className="tarea-num">#{t.numero}</span> {t.titulo}
      </div>
      <button
        type="button"
        className="tarjeta-mas"
        aria-label={`Más acciones de #${t.numero}`}
        title="Más acciones"
        draggable={false}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          a.menu(r.left, r.bottom + 4, t)
        }}
      >
        ⋯
      </button>
      {densidad === 'comoda' && t.descripcion && <p className="tarjeta-desc">{t.descripcion}</p>}
      {progreso.total > 0 && densidad === 'comoda' && (
        <div className="tarjeta-progreso" title={`${progreso.hechos} de ${progreso.total} subtareas y criterios`}>
          <span className="barra-prog"><span style={{ width: `${progreso.pct}%` }} className={progreso.pct === 100 ? 'completa' : ''} /></span>
          <small>{progreso.hechos}/{progreso.total}</small>
        </div>
      )}
      <div className="tarea-meta">
        <ChipPrioridad t={t} soloIcono={densidad === 'compacta'} />
        {(t.vence !== undefined || densidad === 'comoda') && abierta && <ChipFecha t={t} />}
        {t.vence !== undefined && !abierta && <span className="chip">{new Date(t.vence).toLocaleDateString('sv-SE')}</span>}
        {proyecto && !ocultarProyecto && <span className="chip chip-proyecto" title={proyecto}>{proyecto}</span>}
        {t.hito && <span className="chip chip-hito" title={`Hito: ${t.hito}`}>⚑ {t.hito}</span>}
        {t.estimacion !== undefined && <span className="chip" title="Estimación en puntos">{t.estimacion} pt</span>}
        {espera.length > 0 && (
          <span className="chip chip-aviso" title={`Espera a ${espera.map((d) => `#${d.numero}`).join(', ')}`}>
            ⛓ {espera.map((d) => `#${d.numero}`).join(' ')}
          </span>
        )}
        {bloqueada && <span className="chip chip-aviso" title="En un estado «bloqueada»">bloqueada</span>}
        {densidad === 'comoda' && t.etiquetas.slice(0, 3).map((e) => (
          <span key={e} className="chip etiqueta">{e}</span>
        ))}
        {densidad === 'comoda' && t.etiquetas.length > 3 && <span className="chip etiqueta" title={t.etiquetas.slice(3).join(', ')}>+{t.etiquetas.length - 3}</span>}
        <span className="ag-espacio" />
        {t.comentarios.length > 0 && <span className="chip" title="Comentarios">✉ {t.comentarios.length}</span>}
        <span className="tarjeta-avatar" title={t.responsable ? undefined : 'Sin asignar'}><Avatar responsable={t.responsable} tam={20} /></span>
      </div>
    </div>
  )
}

export const TareaTarjeta = memo(TarjetaBase)
