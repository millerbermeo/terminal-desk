import { useCallback, useEffect, useState } from 'react'
import type { ResumenSesion } from '@shared/core/sesion'
import { EstadoVacio } from './EstadoVacio'
import { IconoReloj } from './Iconos'

interface Props {
  proyectoId?: string // sin proyecto: conversaciones de todos
  activaId?: string
  deshabilitado: boolean // hay una ejecución en marcha
  onAbrir: (id: string) => void
  onBorrar: (id: string) => void
  onCerrar: () => void
}

const cuando = (iso: string): string => {
  const d = new Date(iso)
  return d.toLocaleDateString() === new Date().toLocaleDateString() ? `hoy ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

/** Conversaciones guardadas: se pueden retomar (el modelo continúa con su contexto) o eliminar. */
export function HistorialAgente({ proyectoId, activaId, deshabilitado, onAbrir, onBorrar, onCerrar }: Props) {
  const [lista, setLista] = useState<ResumenSesion[] | null>(null)

  const cargar = useCallback(() => void window.api.core.sesionesListar(proyectoId).then(setLista).catch(() => setLista([])), [proyectoId])
  useEffect(cargar, [cargar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  return (
    <div className="ag-historial" role="dialog" aria-label="Historial de conversaciones">
      <div className="ag-historial-cab">
        <strong>Historial{proyectoId ? ' de este proyecto' : ''}</strong>
        <button className="icono" onClick={onCerrar} title="Cerrar (Esc)">✕</button>
      </div>
      {lista === null && <p className="cfg-vacio">Cargando…</p>}
      {lista?.length === 0 && <EstadoVacio variante="compacto" icono={<IconoReloj />} titulo="Aún no hay conversaciones" texto="Se guardan solas al terminar cada respuesta." />}
      <ul>
        {lista?.map((s) => (
          <li key={s.id} className={s.id === activaId ? 'activa' : ''}>
            <button className="ag-historial-abrir" disabled={deshabilitado || s.id === activaId} onClick={() => { onAbrir(s.id); onCerrar() }} title={deshabilitado ? 'Espera a que termine la ejecución en curso' : 'Retomar esta conversación'}>
              <span className="ag-historial-titulo">{s.titulo}</span>
              <span className="ag-historial-meta">
                {cuando(s.actualizada)} · {s.turnos} {s.turnos === 1 ? 'turno' : 'turnos'} · {s.tokens} tokens{s.id === activaId ? ' · actual' : ''}
              </span>
            </button>
            <button
              className="peligro"
              style={{ opacity: 1 }}
              title="Eliminar del historial"
              disabled={deshabilitado && s.id === activaId}
              onClick={() => {
                if (!window.confirm(`¿Eliminar la conversación «${s.titulo}»? No se puede deshacer.`)) return
                onBorrar(s.id)
                setLista((l) => l?.filter((x) => x.id !== s.id) ?? null)
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
