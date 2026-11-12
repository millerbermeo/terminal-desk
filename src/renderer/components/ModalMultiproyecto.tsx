import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DatosProyectos, Proyecto } from '@shared/modelos'
import { IconoCerrar } from './Iconos'

interface Props {
  datos: DatosProyectos
  onCerrar: () => void
  /** Abre una pestaña nueva con una terminal por proyecto elegido (mínimo 2). */
  onAbrir: (nombre: string, proyectos: Proyecto[]) => void
}

const MINIMO = 2

/** Elige 2 o más proyectos (de cualquier grupo) para abrirlos juntos en una pestaña propia. */
export function ModalMultiproyecto({ datos, onCerrar, onAbrir }: Props) {
  const [elegidos, setElegidos] = useState<string[]>([])
  const [nombre, setNombre] = useState('')
  const [filtro, setFiltro] = useState('')
  const [cerrando, setCerrando] = useState(false)

  const salir = useCallback((): void => {
    setCerrando(true)
    window.setTimeout(onCerrar, 200)
  }, [onCerrar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') salir()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salir])

  const secciones = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    const coincide = (p: Proyecto): boolean => !f || p.nombre.toLowerCase().includes(f)
    const lista = datos.grupos.map((g) => ({ id: g.id, nombre: g.nombre, proyectos: datos.proyectos.filter((p) => p.grupo === g.id && coincide(p)) }))
    const sueltos = datos.proyectos.filter((p) => !datos.grupos.some((g) => g.id === p.grupo) && coincide(p))
    if (sueltos.length > 0) lista.push({ id: '__sin-grupo__', nombre: 'Sin grupo', proyectos: sueltos })
    return lista.filter((s) => s.proyectos.length > 0)
  }, [datos, filtro])

  const alternar = (id: string): void => setElegidos((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))
  const valido = elegidos.length >= MINIMO

  const abrir = (): void => {
    if (!valido) return
    // Se conserva el orden en que se fueron marcando.
    const proyectos = elegidos.map((id) => datos.proyectos.find((p) => p.id === id)).filter((p): p is Proyecto => !!p)
    const porDefecto = proyectos.map((p) => p.nombre).join(' + ')
    onAbrir(nombre.trim() || porDefecto, proyectos)
    salir()
  }

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && salir()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Terminal multiproyecto"
        onSubmit={(e) => {
          e.preventDefault()
          abrir()
        }}
      >
        <div className="modal-cab">
          <h3>Terminal multiproyecto</h3>
          <button type="button" className="icono" onClick={salir} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>
        <label>
          Nombre de la pestaña (opcional)
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Panel + API" />
        </label>
        <label>
          Proyectos (elige al menos {MINIMO})
          <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar proyectos…" autoFocus />
        </label>
        <div className="modal-filas" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {secciones.length === 0 && <div className="cfg-nota">No hay proyectos que coincidan.</div>}
          {secciones.map((s) => (
            <div key={s.id}>
              <div className="cfg-nota">{s.nombre}</div>
              {s.proyectos.map((p) => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <input type="checkbox" checked={elegidos.includes(p.id)} onChange={() => alternar(p.id)} />
                  <span>{p.nombre}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="cfg-acciones">
          <button type="submit" className="primario" disabled={!valido}>
            Abrir {elegidos.length > 0 ? `(${elegidos.length})` : ''}
          </button>
          <button type="button" onClick={salir}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
