import { useState, type ReactNode } from 'react'
import { NOMBRE_RESPONSABLE, PRIORIDADES, RESPONSABLES, categoriaDe, estaAbierta, fechaCorta, type Prioridad, type Responsable, type Tarea } from '@shared/tareas'
import { finDelDia } from '@shared/tareas-vista'
import { Emergente, MenuLista, anclaDe, type Ancla } from './Emergente'
import { ICONO_PRIORIDAD, NOMBRE_PRIORIDAD } from './constantes'
import { useAcciones } from './contexto'

const DIA_MS = 86_400_000
const fechaLocal = (ms: number): string => new Date(ms).toLocaleDateString('sv-SE')

/** Botón que abre un menú anclado a él. Detiene el clic para no abrir la tarea que lo contiene. */
function BotonMenu({ clase, titulo, hijos, menu }: { clase: string; titulo: string; hijos: ReactNode; menu: (cerrar: () => void) => ReactNode }) {
  const [ancla, setAncla] = useState<Ancla | null>(null)
  return (
    <>
      <button
        type="button"
        className={clase}
        title={titulo}
        aria-label={titulo}
        aria-haspopup="menu"
        draggable={false}
        onClick={(e) => {
          e.stopPropagation()
          setAncla(anclaDe(e.currentTarget))
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {hijos}
      </button>
      {ancla && (
        <Emergente ancla={ancla} onCerrar={() => setAncla(null)} etiqueta={titulo}>
          {menu(() => setAncla(null))}
        </Emergente>
      )}
    </>
  )
}

export function ChipPrioridad({ t, soloIcono = false }: { t: Tarea; soloIcono?: boolean }) {
  const { editar } = useAcciones()
  return (
    <BotonMenu
      clase={`chip chip-btn prio-${t.prioridad}`}
      titulo={`Prioridad: ${NOMBRE_PRIORIDAD[t.prioridad]} (clic para cambiar)`}
      hijos={
        <>
          <span aria-hidden="true">{ICONO_PRIORIDAD[t.prioridad]}</span>
          {!soloIcono && ` ${NOMBRE_PRIORIDAD[t.prioridad]}`}
        </>
      }
      menu={(cerrar) => (
        <MenuLista
          onCerrar={cerrar}
          items={PRIORIDADES.map((p: Prioridad) => ({ id: p, etiqueta: NOMBRE_PRIORIDAD[p], icono: <span className={`prio-punto prio-${p}`}>{ICONO_PRIORIDAD[p]}</span>, atajo: String(PRIORIDADES.indexOf(p) + 1), activo: t.prioridad === p, onClick: () => void editar(t, { prioridad: p }, true) }))}
        />
      )}
    />
  )
}

export function ChipEstado({ t }: { t: Tarea }) {
  const { estados, mover } = useAcciones()
  const nombre = estados.find((e) => e.id === t.estado)?.nombre ?? t.estado
  return (
    <BotonMenu
      clase={`chip chip-btn cat-${categoriaDe(estados, t.estado)}`}
      titulo={`Estado: ${nombre} (clic para cambiar)`}
      hijos={nombre}
      menu={(cerrar) => (
        <MenuLista
          onCerrar={cerrar}
          items={estados.map((e) => ({ id: e.id, etiqueta: e.nombre, icono: <span className={`punto-cat cat-${e.categoria}`} />, activo: t.estado === e.id, onClick: () => void mover(t, e.id) }))}
        />
      )}
    />
  )
}

export function Avatar({ responsable, tam = 22 }: { responsable?: Responsable; tam?: number }) {
  if (!responsable) return <span className="avatar sin" style={{ width: tam, height: tam }} aria-label="Sin asignar">＋</span>
  return (
    <span className={`avatar ${responsable}`} style={{ width: tam, height: tam }} aria-label={NOMBRE_RESPONSABLE[responsable]}>
      {responsable === 'ia' ? '✦' : 'Yo'}
    </span>
  )
}

export function ChipResponsable({ t, conNombre = false }: { t: Tarea; conNombre?: boolean }) {
  const { editar } = useAcciones()
  return (
    <BotonMenu
      clase="avatar-btn"
      titulo={`Responsable: ${t.responsable ? NOMBRE_RESPONSABLE[t.responsable] : 'sin asignar'} (clic para cambiar)`}
      hijos={
        <>
          <Avatar responsable={t.responsable} />
          {conNombre && <span>{t.responsable ? NOMBRE_RESPONSABLE[t.responsable] : 'Sin asignar'}</span>}
        </>
      }
      menu={(cerrar) => (
        <MenuLista
          onCerrar={cerrar}
          items={[
            ...RESPONSABLES.map((r) => ({ id: r, etiqueta: r === 'ia' ? 'IA (Asistente)' : 'Yo', icono: <Avatar responsable={r} tam={18} />, activo: t.responsable === r, onClick: () => void editar(t, { responsable: r }, true) })),
            { id: 'sin', etiqueta: 'Sin asignar', separador: true, activo: !t.responsable, onClick: () => void editar(t, { responsable: null }, true) }
          ]}
        />
      )}
    />
  )
}

/** Atajos de fecha que usa el selector y el menú contextual. */
export function atajosFecha(ahora = Date.now()): { id: string; etiqueta: string; ms: number }[] {
  const hoy = new Date(ahora)
  const lunes = new Date(ahora)
  lunes.setDate(hoy.getDate() + (((8 - hoy.getDay()) % 7) || 7))
  return [
    { id: 'hoy', etiqueta: 'Hoy', ms: finDelDia(ahora) },
    { id: 'manana', etiqueta: 'Mañana', ms: finDelDia(ahora + DIA_MS) },
    { id: 'lunes', etiqueta: 'Próximo lunes', ms: finDelDia(lunes.getTime()) },
    { id: 'semana', etiqueta: 'En una semana', ms: finDelDia(ahora + 7 * DIA_MS) }
  ]
}

export function ChipFecha({ t }: { t: Tarea }) {
  const { editar, estados } = useAcciones()
  const vencida = t.vence !== undefined && t.vence < Date.now() && estaAbierta(t, estados)
  return (
    <BotonMenu
      clase={`chip chip-btn${vencida ? ' vencida' : ''}${t.vence === undefined ? ' vacio' : ''}`}
      titulo={t.vence !== undefined ? `Vence ${fechaCorta(t.vence)} (clic para cambiar)` : 'Poner fecha de vencimiento'}
      hijos={t.vence !== undefined ? fechaCorta(t.vence) : '＋ Fecha'}
      menu={(cerrar) => (
        <div className="emg-fecha">
          <MenuLista onCerrar={cerrar} items={[...atajosFecha().map((a) => ({ id: a.id, etiqueta: a.etiqueta, atajo: fechaCorta(a.ms).slice(5), onClick: () => void editar(t, { vence: a.ms }, true) })), ...(t.vence !== undefined ? [{ id: 'quitar', etiqueta: 'Quitar fecha', separador: true, peligro: true, onClick: () => void editar(t, { vence: null }, true) }] : [])]} />
          <input
            type="date"
            className="emg-fecha-input"
            value={t.vence !== undefined ? fechaLocal(t.vence) : ''}
            aria-label="Elegir fecha"
            onChange={(e) => {
              if (!e.target.value) return
              void editar(t, { vence: new Date(`${e.target.value}T23:59:59`).getTime() }, true)
              cerrar()
            }}
          />
        </div>
      )}
    />
  )
}
