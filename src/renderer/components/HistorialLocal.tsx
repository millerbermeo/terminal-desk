import { useCallback, useEffect, useState } from 'react'
import { ETIQUETA_ORIGEN, type ArchivoHistorial, type EstadoHistorial, type OrigenVersion } from '@shared/historial'
import { fechaRelativa } from '@shared/versiones'
import { confirmar } from '../confirmar'
import { mensajeDe } from '../tareas/useTareas'
import { EstadoVacio } from './EstadoVacio'
import { HistorialArchivo } from './HistorialArchivo'
import { IconoArchivo, IconoReiniciar } from './Iconos'

const api = window.api.historial.operar

const PERIODOS: { id: string; nombre: string; ms?: number }[] = [
  { id: 'todo', nombre: 'Todo el historial' },
  { id: 'hoy', nombre: 'Hoy', ms: 24 * 3_600_000 },
  { id: 'semana', nombre: 'Últimos 7 días', ms: 7 * 24 * 3_600_000 },
  { id: 'mes', nombre: 'Últimos 30 días', ms: 30 * 24 * 3_600_000 }
]

const mb = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`)

const VIGILANCIA: Record<EstadoHistorial['vigilancia'], { texto: string; clase: string; ayuda: string }> = {
  completa: { texto: 'Vigilando todo el proyecto', clase: 'chip-ok', ayuda: 'Cada cambio, hecho donde sea (editor, IA, otro programa, git), se guarda solo.' },
  limitada: { texto: 'Vigilancia parcial', clase: 'chip-aviso', ayuda: 'El proyecto tiene tantas carpetas que solo se vigilan las más cercanas a la raíz. Lo que hagas en el editor o la IA siempre se guarda.' },
  apagada: { texto: 'Apagado', clase: '', ayuda: 'No se guardan versiones nuevas. Lo ya guardado se conserva.' }
}

/**
 * Historial local de versiones del proyecto, independiente de git: cada cambio en los archivos (a mano, de la IA, de otro programa o de git)
 * queda guardado en este equipo con fecha, origen y autor, sin commits. Aquí se consulta, se compara y se restaura.
 */
export function HistorialLocal({ proyectoId, tick = 0, avisar }: { proyectoId: string; tick?: number; avisar: (texto: string) => void }) {
  const [estado, setEstado] = useState<EstadoHistorial | null>(null)
  const [archivos, setArchivos] = useState<ArchivoHistorial[] | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState('')
  const [origen, setOrigen] = useState<OrigenVersion | ''>('')
  const [periodo, setPeriodo] = useState('todo')
  const [ruta, setRuta] = useState<string | null>(null)
  const [refresco, setRefresco] = useState(0)

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const p = PERIODOS.find((x) => x.id === periodo)
      const [e, l] = await Promise.all([
        api('estado', { proyectoId }),
        api('archivos', { proyectoId, filtro: { ...(texto.trim() ? { texto: texto.trim() } : {}), ...(origen ? { origen } : {}), ...(p?.ms ? { desde: new Date(Date.now() - p.ms).toISOString() } : {}) } })
      ])
      setEstado(e)
      setArchivos(l.archivos)
      setHayMas(l.hayMas)
      setError('')
    } catch (err) {
      setError(mensajeDe(err))
    }
  }, [proyectoId, texto, origen, periodo])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), texto ? 250 : 0) // al escribir, se espera un instante
    return () => clearTimeout(t)
  }, [cargar, tick, refresco, texto])
  // El historial crece mientras se trabaja: se vuelve a leer cada pocos segundos.
  useEffect(() => {
    const t = setInterval(() => void cargar(), 5000)
    return () => clearInterval(t)
  }, [cargar])
  useEffect(() => setRuta(null), [proyectoId])
  useEffect(() => {
    if (archivos && ruta && !archivos.some((a) => a.ruta === ruta) && !texto && !origen && periodo === 'todo') setRuta(null)
  }, [archivos, ruta, texto, origen, periodo])

  const ajustar = async (activo: boolean): Promise<void> => {
    try {
      setEstado(await api('ajustar', { proyectoId, activo }))
      avisar(activo ? 'Se guardarán los cambios de este proyecto.' : 'Se dejó de guardar versiones nuevas (lo anterior se conserva).')
    } catch (err) {
      setError(mensajeDe(err))
    }
  }

  const olvidar = async (): Promise<void> => {
    const ok = await confirmar({
      titulo: '¿Borrar todo el historial de este proyecto?',
      etiqueta: 'Borrar historial',
      tono: 'peligro',
      texto: 'Se eliminan las versiones guardadas de todos los archivos de este proyecto en este equipo.\n\nLos archivos del proyecto no se tocan, y el historial vuelve a empezar desde cero.'
    })
    if (!ok) return
    try {
      setEstado(await api('olvidar', { proyectoId }))
      setRuta(null)
      setRefresco((n) => n + 1)
      avisar('Historial borrado.')
    } catch (err) {
      setError(mensajeDe(err))
    }
  }

  if (!estado) return error ? <p className="vc-nota error" style={{ padding: 24 }}>{error}</p> : <p className="tareas-vacio">Cargando…</p>
  const v = VIGILANCIA[estado.vigilancia]
  const uso = Math.min(100, Math.round((estado.bytes / estado.limiteBytes) * 100))

  return (
    <div className="hl">
      <div className="hl-estado">
        <label className="hl-interruptor" title="Guardar una copia cada vez que cambie un archivo de este proyecto">
          <span className="interruptor">
            <input type="checkbox" checked={estado.activo} onChange={(e) => void ajustar(e.target.checked)} />
            <span />
          </span>
          <strong>Registrar los cambios de este proyecto</strong>
        </label>
        <span className={`chip ${v.clase}`} title={v.ayuda}>
          {v.texto}
        </span>
        <span className="hl-cifras">
          {estado.archivos} archivo{estado.archivos === 1 ? '' : 's'} · {estado.versiones} versión{estado.versiones === 1 ? '' : 'es'} · {mb(estado.bytes)}
        </span>
        <span className="ag-espacio" />
        <div className="hl-uso" title={`${mb(estado.bytes)} de ${mb(estado.limiteBytes)} (al llenarse se descarta lo más antiguo). Se conserva todo ${estado.diasCompletos} días; después, una versión por día y luego por semana.`}>
          <i style={{ width: `${uso}%` }} />
        </div>
        <button className="icono" onClick={() => setRefresco((n) => n + 1)} title="Actualizar" aria-label="Actualizar">
          <IconoReiniciar />
        </button>
        <button className="peligro" onClick={() => void olvidar()} disabled={estado.versiones === 0}>
          Borrar historial
        </button>
      </div>
      {error && <p className="vc-nota error">{error}</p>}

      <div className="hl-cuerpo">
        <aside className="hl-archivos" aria-label="Archivos con historial">
          <div className="hl-buscar">
            <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar archivo…" aria-label="Buscar archivo" spellCheck={false} />
            <div className="hl-filtros">
              <select value={origen} onChange={(e) => setOrigen(e.target.value as OrigenVersion | '')} aria-label="Filtrar por origen">
                <option value="">Todo origen</option>
                {(Object.keys(ETIQUETA_ORIGEN) as OrigenVersion[]).map((o) => (
                  <option key={o} value={o}>
                    {ETIQUETA_ORIGEN[o]}
                  </option>
                ))}
              </select>
              <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Filtrar por fecha">
                {PERIODOS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!archivos ? (
            <p className="tareas-vacio">Cargando…</p>
          ) : archivos.length === 0 ? (
            <EstadoVacio
              variante="compacto"
              icono={<IconoArchivo />}
              titulo={texto || origen || periodo !== 'todo' ? 'Nada coincide' : estado.activo ? 'Aún no hay cambios' : 'El registro está apagado'}
              texto={texto || origen || periodo !== 'todo' ? 'Prueba con otro filtro.' : estado.activo ? 'Cuando un archivo cambie (a mano, por la IA o por otro programa) aparecerá aquí con todas sus versiones.' : 'Enciéndelo arriba para empezar a guardar versiones.'}
            />
          ) : (
            <ul className="hl-lista">
              {archivos.map((a) => (
                <li key={a.ruta}>
                  <button className={`hl-archivo${a.ruta === ruta ? ' sel' : ''}${a.eliminado ? ' borrado' : ''}`} onClick={() => setRuta(a.ruta)} title={a.ruta} aria-pressed={a.ruta === ruta}>
                    <span className="hl-nombre">
                      <b>{a.ruta.split('/').at(-1)}</b>
                      {a.ruta.includes('/') && <small>{a.ruta.slice(0, a.ruta.lastIndexOf('/'))}</small>}
                    </span>
                    <span className="hl-meta">
                      {a.eliminado && <span className="chip api-estado-servidor">borrado</span>}
                      <span className={`chip hv-origen hv-${a.ultima.origen}`}>{ETIQUETA_ORIGEN[a.ultima.origen]}</span>
                      <small>
                        {a.versiones} · {fechaRelativa(a.ultima.fecha)}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
              {hayMas && <li className="vc-nota" style={{ padding: 8 }}>Hay más archivos: afina la búsqueda.</li>}
            </ul>
          )}
        </aside>
        <section className="hl-detalle">
          {ruta ? (
            <>
              <h3 className="hl-titulo mono" title={ruta}>
                {ruta}
              </h3>
              <HistorialArchivo proyectoId={proyectoId} ruta={ruta} tick={tick + refresco} avisar={avisar} onCambio={() => setRefresco((n) => n + 1)} />
            </>
          ) : (
            <EstadoVacio variante="compacto" icono={<IconoArchivo />} titulo="Elige un archivo" texto="Verás todas sus versiones, qué líneas se agregaron, quitaron o modificaron, y podrás restaurar la que quieras." />
          )}
        </section>
      </div>
    </div>
  )
}
