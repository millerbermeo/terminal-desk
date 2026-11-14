import { useState, type ReactNode } from 'react'
import { PRIORIDADES, type EstadoTarea, type Prioridad, type Responsable } from '@shared/tareas'
import { FILTROS_RAPIDOS, FILTRO_VACIO, contarFiltros, hayFiltros, type FiltroVista, type Vencimiento } from '@shared/tareas-vista'
import { Emergente, anclaDe, type Ancla } from './Emergente'
import { NOMBRE_PRIORIDAD } from './constantes'

const NOMBRE_VENCIMIENTO: Record<Vencimiento, string> = { vencidas: 'Vencidas', hoy: 'Vence hoy', semana: 'Esta semana', 'sin-fecha': 'Sin fecha' }
const NOMBRE_RESP: Record<Responsable | 'sin', string> = { usuario: 'Yo', ia: 'IA', sin: 'Sin asignar' }

interface Props {
  filtro: FiltroVista
  onFiltro: (f: FiltroVista) => void
  estados: EstadoTarea[]
  etiquetas: string[]
  hitos: string[]
}

const alternar = <T,>(lista: T[], v: T): T[] => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v])

/** Un chip de filtro: botón que abre una lista con casillas (o botones, si es de una sola opción). */
function ChipFiltro({ etiqueta, resumen, activo, children }: { etiqueta: string; resumen?: string; activo: boolean; children: (cerrar: () => void) => ReactNode }) {
  const [ancla, setAncla] = useState<Ancla | null>(null)
  return (
    <>
      <button className={`chip-filtro${activo ? ' activo' : ''}`} aria-haspopup="menu" aria-expanded={!!ancla} onClick={(e) => setAncla(anclaDe(e.currentTarget))}>
        {etiqueta}
        {resumen && <b>: {resumen}</b>} <span aria-hidden="true">▾</span>
      </button>
      {ancla && (
        <Emergente ancla={ancla} onCerrar={() => setAncla(null)} etiqueta={`Filtrar por ${etiqueta}`}>
          {children(() => setAncla(null))}
        </Emergente>
      )}
    </>
  )
}

function Casilla({ marcada, texto, onChange }: { marcada: boolean; texto: ReactNode; onChange: () => void }) {
  return (
    <label className="emg-item emg-check">
      <input type="checkbox" checked={marcada} onChange={onChange} /> {texto}
    </label>
  )
}

/** Filtros como chips (estilo Jira/ClickUp) con filtros rápidos guardados; reemplaza a los selectores sueltos. */
export function BarraFiltros({ filtro, onFiltro, estados, etiquetas, hitos }: Props) {
  const set = (p: Partial<FiltroVista>): void => onFiltro({ ...filtro, ...p })
  const rapidoActivo = (id: string): boolean => {
    const r = FILTROS_RAPIDOS.find((x) => x.id === id)!.filtro
    return Object.entries(r).every(([k, v]) => JSON.stringify(filtro[k as keyof FiltroVista]) === JSON.stringify(v)) && contarFiltros(filtro) === contarFiltros({ ...FILTRO_VACIO, ...r })
  }
  const activos = contarFiltros(filtro)
  return (
    <div className="barra-filtros" role="group" aria-label="Filtros">
      <div className="filtros-rapidos">
        {FILTROS_RAPIDOS.map((r) => (
          <button key={r.id} className={`chip-filtro rapido${rapidoActivo(r.id) ? ' activo' : ''}`} aria-pressed={rapidoActivo(r.id)} onClick={() => onFiltro(rapidoActivo(r.id) ? { ...FILTRO_VACIO, texto: filtro.texto } : { ...FILTRO_VACIO, texto: filtro.texto, ...r.filtro })}>
            {r.nombre}
          </button>
        ))}
      </div>
      <span className="filtros-sep" aria-hidden="true" />
      <ChipFiltro etiqueta="Prioridad" resumen={filtro.prioridades.map((p) => NOMBRE_PRIORIDAD[p]).join(', ')} activo={filtro.prioridades.length > 0}>
        {() => (
          <div className="emg-lista">
            {PRIORIDADES.map((p: Prioridad) => (
              <Casilla key={p} marcada={filtro.prioridades.includes(p)} texto={NOMBRE_PRIORIDAD[p]} onChange={() => set({ prioridades: alternar(filtro.prioridades, p) })} />
            ))}
          </div>
        )}
      </ChipFiltro>
      <ChipFiltro etiqueta="Estado" resumen={filtro.estados.map((id) => estados.find((e) => e.id === id)?.nombre ?? id).join(', ')} activo={filtro.estados.length > 0}>
        {() => (
          <div className="emg-lista">
            {estados.map((e) => (
              <Casilla key={e.id} marcada={filtro.estados.includes(e.id)} texto={e.nombre} onChange={() => set({ estados: alternar(filtro.estados, e.id) })} />
            ))}
          </div>
        )}
      </ChipFiltro>
      <ChipFiltro etiqueta="Responsable" resumen={filtro.responsables.map((r) => NOMBRE_RESP[r]).join(', ')} activo={filtro.responsables.length > 0}>
        {() => (
          <div className="emg-lista">
            {(['usuario', 'ia', 'sin'] as const).map((r) => (
              <Casilla key={r} marcada={filtro.responsables.includes(r)} texto={NOMBRE_RESP[r]} onChange={() => set({ responsables: alternar(filtro.responsables, r) })} />
            ))}
          </div>
        )}
      </ChipFiltro>
      <ChipFiltro etiqueta="Vencimiento" resumen={filtro.vencimiento ? NOMBRE_VENCIMIENTO[filtro.vencimiento] : undefined} activo={!!filtro.vencimiento}>
        {(cerrar) => (
          <div className="emg-lista">
            {(Object.keys(NOMBRE_VENCIMIENTO) as Vencimiento[]).map((v) => (
              <button key={v} className={`emg-item${filtro.vencimiento === v ? ' activo' : ''}`} onClick={() => { set({ vencimiento: filtro.vencimiento === v ? undefined : v }); cerrar() }}>
                <span className="emg-texto">{NOMBRE_VENCIMIENTO[v]}</span>
                {filtro.vencimiento === v && <span className="emg-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </ChipFiltro>
      {etiquetas.length > 0 && (
        <ChipFiltro etiqueta="Etiqueta" resumen={filtro.etiquetas.join(', ')} activo={filtro.etiquetas.length > 0}>
          {() => (
            <div className="emg-lista emg-alta">
              {etiquetas.map((e) => (
                <Casilla key={e} marcada={filtro.etiquetas.includes(e)} texto={e} onChange={() => set({ etiquetas: alternar(filtro.etiquetas, e) })} />
              ))}
            </div>
          )}
        </ChipFiltro>
      )}
      {hitos.length > 0 && (
        <ChipFiltro etiqueta="Hito" resumen={filtro.hito} activo={!!filtro.hito}>
          {(cerrar) => (
            <div className="emg-lista">
              {hitos.map((h) => (
                <button key={h} className={`emg-item${filtro.hito === h ? ' activo' : ''}`} onClick={() => { set({ hito: filtro.hito === h ? undefined : h }); cerrar() }}>
                  <span className="emg-texto">{h}</span>
                  {filtro.hito === h && <span className="emg-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </ChipFiltro>
      )}
      <label className="chip-filtro conmutador" title="Mostrar las tareas terminadas y descartadas">
        <input type="checkbox" checked={filtro.verTerminadas} onChange={(e) => set({ verTerminadas: e.target.checked })} /> Terminadas
      </label>
      <button className={`chip-filtro${filtro.bloqueadas ? ' activo' : ''}`} aria-pressed={filtro.bloqueadas} onClick={() => set({ bloqueadas: !filtro.bloqueadas })} title="Solo las que esperan a otras o están bloqueadas">
        ⛓ Bloqueadas
      </button>
      {hayFiltros(filtro) && (
        <button className="chip-filtro limpiar" onClick={() => onFiltro({ ...FILTRO_VACIO, texto: '' })} title="Quitar todos los filtros">
          ✕ Limpiar{activos > 0 ? ` (${activos})` : ''}
        </button>
      )}
    </div>
  )
}
