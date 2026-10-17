import { useEffect, useState } from 'react'
import { CATEGORIAS, MAX_ESTADOS, NOMBRE_CATEGORIA, validarEstados, type CategoriaEstado, type EstadoTarea, type Tarea } from '@shared/tareas'

interface Props {
  estados: EstadoTarea[]
  tareas: Tarea[]
  onCerrar: () => void
  intentar: (f: () => Promise<unknown>) => Promise<boolean>
}

const idDe = (nombre: string, usados: Set<string>): string => {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'estado'
  let id = base
  for (let i = 2; usados.has(id); i++) id = `${base}-${i}`
  return id
}

/** Editor de los estados del flujo de trabajo: nombre, categoría (lo que significan para las reglas) y orden. */
export function TareasEstados({ estados, tareas, onCerrar, intentar }: Props) {
  const [lista, setLista] = useState<EstadoTarea[]>(estados.map((e) => ({ ...e })))
  const [reasignar, setReasignar] = useState<Record<string, string>>({})
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  const mover = (i: number, d: -1 | 1): void =>
    setLista((l) => {
      const n = [...l]
      const j = i + d
      if (j < 0 || j >= n.length) return l
      ;[n[i], n[j]] = [n[j]!, n[i]!]
      return n
    })
  const cambiar = (i: number, parche: Partial<EstadoTarea>): void => setLista((l) => l.map((e, j) => (j === i ? { ...e, ...parche } : e)))
  const quitados = estados.filter((e) => !lista.some((x) => x.id === e.id))
  const conTareas = quitados.map((q) => ({ q, n: tareas.filter((t) => t.estado === q.id).length })).filter((x) => x.n > 0)
  const destinoPorDefecto = (q: EstadoTarea): string => (lista.find((e) => e.categoria === q.categoria) ?? lista[0])?.id ?? ''
  const error = validarEstados(lista.map((e) => ({ ...e, nombre: e.nombre.trim() })))

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Estados de las tareas">
        <div className="modal-cab">
          <h3>Estados del flujo de trabajo</h3>
          <button className="icono" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="modal-texto">
          La categoría decide las reglas: «Terminada» exige criterios cumplidos; «Bloqueada» y «Descartada» piden un motivo; reabrir una tarea terminada también.
        </p>
        <ul className="estados-lista">
          {lista.map((e, i) => (
            <li key={e.id}>
              <input value={e.nombre} maxLength={40} onChange={(ev) => cambiar(i, { nombre: ev.target.value })} aria-label="Nombre del estado" />
              <select value={e.categoria} onChange={(ev) => cambiar(i, { categoria: ev.target.value as CategoriaEstado })} aria-label="Categoría">
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {NOMBRE_CATEGORIA[c]}
                  </option>
                ))}
              </select>
              <button className="icono" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">
                ↑
              </button>
              <button className="icono" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label="Bajar">
                ↓
              </button>
              <button className="peligro" onClick={() => setLista((l) => l.filter((_, j) => j !== i))} disabled={lista.length <= 1}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <div>
          <button
            disabled={lista.length >= MAX_ESTADOS}
            onClick={() => setLista((l) => [...l, { id: idDe('Nuevo estado', new Set(l.map((x) => x.id))), nombre: 'Nuevo estado', categoria: 'pendiente' }])}
          >
            ＋ Añadir estado
          </button>
        </div>
        {conTareas.map(({ q, n }) => (
          <label key={q.id}>
            «{q.nombre}» tiene {n} tarea(s): pasan a
            <select value={reasignar[q.id] ?? destinoPorDefecto(q)} onChange={(ev) => setReasignar((r) => ({ ...r, [q.id]: ev.target.value }))}>
              {lista.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
        ))}
        {error && <p className="tareas-error-texto">{error}</p>}
        <div className="cfg-acciones">
          <button
            className="primario"
            disabled={Boolean(error)}
            onClick={() =>
              void intentar(() =>
                window.api.tareas.operar('guardarEstados', {
                  estados: lista.map((e) => ({ ...e, nombre: e.nombre.trim() })),
                  reasignar: Object.fromEntries(conTareas.map(({ q }) => [q.id, reasignar[q.id] ?? destinoPorDefecto(q)]))
                })
              ).then((ok) => ok && onCerrar())
            }
          >
            Guardar
          </button>
          <button onClick={onCerrar}>Cancelar</button>
          <button className="peligro" onClick={() => setLista(estados.map((e) => ({ ...e })))} title="Volver a lo guardado">
            Deshacer cambios
          </button>
        </div>
      </div>
    </div>
  )
}
