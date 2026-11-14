import { useState } from 'react'
import { PRIORIDADES, type Prioridad, type Tarea } from '@shared/tareas'
import { Emergente, MenuLista, anclaDe, type Ancla } from './Emergente'
import { NOMBRE_PRIORIDAD } from './constantes'
import { useAcciones } from './contexto'

/** Barra flotante con acciones para varias tareas a la vez (aparece al seleccionar con las casillas, Ctrl/Shift+clic o la tecla Espacio). */
export function AccionesMasivas({ seleccionadas, onLimpiar }: { seleccionadas: Tarea[]; onLimpiar: () => void }) {
  const a = useAcciones()
  const [menu, setMenu] = useState<{ tipo: 'estado' | 'prioridad' | 'responsable' | 'proyecto'; ancla: Ancla } | null>(null)
  const abrir = (tipo: 'estado' | 'prioridad' | 'responsable' | 'proyecto') => (e: React.MouseEvent<HTMLButtonElement>) => setMenu({ tipo, ancla: anclaDe(e.currentTarget) })
  const cerrar = (): void => setMenu(null)
  const cada = async (f: (t: Tarea) => Promise<unknown>): Promise<void> => {
    for (const t of seleccionadas) await f(t)
  }

  return (
    <div className="acciones-masivas" role="toolbar" aria-label="Acciones sobre las tareas seleccionadas">
      <strong>{seleccionadas.length} seleccionada{seleccionadas.length === 1 ? '' : 's'}</strong>
      <button onClick={abrir('estado')} aria-haspopup="menu">Mover a…</button>
      <button onClick={abrir('prioridad')} aria-haspopup="menu">Prioridad</button>
      <button onClick={abrir('responsable')} aria-haspopup="menu">Responsable</button>
      <button onClick={abrir('proyecto')} aria-haspopup="menu">Proyecto</button>
      <button className="peligro" onClick={() => a.eliminar(seleccionadas)}>Eliminar</button>
      <span className="ag-espacio" />
      <button className="icono" onClick={onLimpiar} aria-label="Quitar la selección" title="Quitar la selección (Esc)">✕</button>
      {menu && (
        <Emergente ancla={menu.ancla} onCerrar={cerrar} etiqueta={menu.tipo}>
          <MenuLista
            onCerrar={cerrar}
            items={
              menu.tipo === 'estado'
                ? a.estados.map((e) => ({ id: e.id, etiqueta: e.nombre, onClick: () => void cada((t) => a.mover(t, e.id)) }))
                : menu.tipo === 'prioridad'
                  ? PRIORIDADES.map((p: Prioridad) => ({ id: p, etiqueta: NOMBRE_PRIORIDAD[p], onClick: () => void cada((t) => a.editar(t, { prioridad: p })) }))
                  : menu.tipo === 'responsable'
                    ? [
                        { id: 'usuario', etiqueta: 'Yo', onClick: () => void cada((t) => a.editar(t, { responsable: 'usuario' })) },
                        { id: 'ia', etiqueta: 'IA (Asistente)', onClick: () => void cada((t) => a.editar(t, { responsable: 'ia' })) },
                        { id: 'sin', etiqueta: 'Sin asignar', separador: true, onClick: () => void cada((t) => a.editar(t, { responsable: null })) }
                      ]
                    : [
                        ...a.datos.proyectos.map((p) => ({ id: p.id, etiqueta: p.nombre, onClick: () => void cada((t) => a.editar(t, { proyectoId: p.id })) })),
                        { id: 'sin', etiqueta: 'Sin proyecto', separador: true, onClick: () => void cada((t) => a.editar(t, { proyectoId: null })) }
                      ]
            }
          />
        </Emergente>
      )}
    </div>
  )
}
