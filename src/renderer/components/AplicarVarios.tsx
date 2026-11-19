import { useMemo, useState } from 'react'
import type { BibliotecaAgentes, DatosProyectos, Recurso } from '@shared/modelos'
import { activosDe } from '@shared/agentes'

interface Props {
  datos: DatosProyectos
  biblioteca: BibliotecaAgentes
  destino: { tipo: 'grupo' | 'proyecto'; id: string }
  onBiblioteca: (b: BibliotecaAgentes) => void
  onCerrar: () => void
}

/**
 * Lo contrario de «Copiar de otro proyecto»: toma lo que este proyecto (o grupo) tiene activado y lo activa en los proyectos que se
 * marquen. Solo suma: nunca desactiva nada. Los que ya lo tienen (propio o por su grupo) se saltan.
 */
export function AplicarVarios({ datos, biblioteca, destino, onBiblioteca, onCerrar }: Props) {
  const nombre = destino.tipo === 'grupo' ? datos.grupos.find((g) => g.id === destino.id)?.nombre : datos.proyectos.find((p) => p.id === destino.id)?.nombre
  const propios: Recurso[] = useMemo(() => {
    const ids = new Set((destino.tipo === 'grupo' ? biblioteca.activaciones.grupos[destino.id] : biblioteca.activaciones.proyectos[destino.id]) ?? [])
    return biblioteca.recursos.filter((r) => r.ambito === 'compartido' && ids.has(r.id))
  }, [biblioteca, destino])
  // Los proyectos del propio grupo destino ya lo reciben por el grupo: no se ofrecen
  const candidatos = datos.proyectos.filter((p) => !(destino.tipo === 'proyecto' ? p.id === destino.id : p.grupo === destino.id))
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [trabajando, setTrabajando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  const pendientes = (pid: string): Recurso[] => {
    const p = datos.proyectos.find((x) => x.id === pid)
    if (!p) return []
    const tiene = new Set(activosDe(biblioteca, p).map((a) => a.recurso.id))
    return propios.filter((r) => !tiene.has(r.id))
  }
  const total = [...marcados].reduce((s, id) => s + pendientes(id).length, 0)
  const alternar = (id: string): void => setMarcados((m) => { const n = new Set(m); if (!n.delete(id)) n.add(id); return n })

  const aplicar = async (): Promise<void> => {
    setTrabajando(true)
    try {
      let ultima: BibliotecaAgentes | undefined
      for (const pid of marcados) for (const r of pendientes(pid)) ultima = await window.api.agentes.activar({ tipo: 'proyecto', id: pid }, r.id, true)
      if (ultima) onBiblioteca(ultima)
      setResultado(`${total} activaciones en ${marcados.size} ${marcados.size === 1 ? 'proyecto' : 'proyectos'}`)
    } catch (err) {
      setResultado(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !trabajando && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Aplicar a otros proyectos">
        <div className="modal-cab">
          <h3>Aplicar lo de «{nombre}» a otros proyectos</h3>
        </div>
        <div className="modal-cuerpo">
          {propios.length === 0 ? (
            <p className="modal-texto">Aquí no hay nada activado a nivel propio. Activa primero agentes o skills.</p>
          ) : candidatos.length === 0 ? (
            <p className="modal-texto">No hay otros proyectos.</p>
          ) : (
            <>
              <p className="modal-texto mono" style={{ maxHeight: 90, overflow: 'auto' }}>
                {propios.map((r) => r.nombre).join(', ')}
              </p>
              <div className="ak-filas" style={{ maxHeight: 260, overflow: 'auto' }}>
                {candidatos.map((p) => {
                  const n = pendientes(p.id).length
                  return (
                    <label key={p.id} className="ak-fila" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={marcados.has(p.id)} disabled={trabajando || !!resultado} onChange={() => alternar(p.id)} />
                      <span className="ak-fila-txt">
                        <strong>{p.nombre}</strong>
                        <span>{n ? `${n} por activar` : 'Ya tiene todo'}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              {resultado && <p className="modal-texto">{resultado}</p>}
            </>
          )}
        </div>
        <div className="modal-acciones">
          <button onClick={onCerrar} disabled={trabajando}>
            {resultado ? 'Cerrar' : 'Cancelar'}
          </button>
          {!resultado && (
            <button className="primario" disabled={trabajando || total === 0} onClick={() => void aplicar()}>
              {trabajando ? 'Aplicando…' : `Aplicar (${total})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
