import { useMemo } from 'react'
import { estaAbierta, type Tarea } from '@shared/tareas'
import { aplicarFiltroVista, FILTRO_VACIO, finDelDia, inicioDelDia, inicioDeSemana, ordenDeTrabajo } from '@shared/tareas-vista'
import { EstadoVacio } from '../EstadoVacio'
import { IconoTareas } from '../Iconos'
import { useAcciones } from './contexto'
import { TareaTarjeta } from './TareaTarjeta'

/** «Mis tareas»: lo mío (y lo de la IA) ordenado por urgencia: vencidas, hoy, esta semana, más adelante y sin fecha. */
export function VistaHoy({ tareas }: { tareas: Tarea[] }) {
  const a = useAcciones()
  const secciones = useMemo(() => {
    const ahora = Date.now()
    const mias = aplicarFiltroVista(tareas, a.todas, a.estados, { ...FILTRO_VACIO, verTerminadas: false, responsables: ['usuario', 'ia'] }, ahora).filter((t) => estaAbierta(t, a.estados))
    const finHoy = finDelDia(ahora)
    const finSemana = finDelDia(inicioDeSemana(ahora) + 6 * 86_400_000)
    const grupos: { id: string; nombre: string; ts: Tarea[] }[] = [
      { id: 'vencidas', nombre: 'Vencidas', ts: mias.filter((t) => t.vence !== undefined && t.vence < inicioDelDia(ahora)) },
      { id: 'hoy', nombre: 'Hoy', ts: mias.filter((t) => t.vence !== undefined && t.vence >= inicioDelDia(ahora) && t.vence <= finHoy) },
      { id: 'semana', nombre: 'Esta semana', ts: mias.filter((t) => t.vence !== undefined && t.vence > finHoy && t.vence <= finSemana) },
      { id: 'despues', nombre: 'Más adelante', ts: mias.filter((t) => t.vence !== undefined && t.vence > finSemana) },
      { id: 'sin', nombre: 'Sin fecha', ts: mias.filter((t) => t.vence === undefined) }
    ]
    return grupos.map((g) => ({ ...g, ts: ordenDeTrabajo(g.ts, a.estados) })).filter((g) => g.ts.length > 0)
  }, [tareas, a.todas, a.estados])

  if (secciones.length === 0) {
    return <EstadoVacio icono={<IconoTareas />} titulo="Nada pendiente para ti" texto="Asigna tareas a «Yo» o a la IA (clic en el círculo de una tarjeta) y aparecerán aquí ordenadas por urgencia." />
  }
  return (
    <div className="hoy">
      {secciones.map((g) => (
        <section key={g.id} className={`hoy-seccion ${g.id}`}>
          <h4>
            {g.nombre} <span className="chip">{g.ts.length}</span>
          </h4>
          <div className="hoy-rejilla">
            {g.ts.map((t) => (
              <TareaTarjeta key={t.id} t={t} densidad="comoda" arrastrable={false} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
