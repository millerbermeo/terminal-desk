import { useEffect, useState } from 'react'
import type { InfoModelo } from '@shared/core/uso'
import type { ModoAutonomia } from '@shared/core/permisos'
import { describirFrecuencia, type Frecuencia, type NuevaTareaProgramada, type TareaProgramada } from '@shared/programadas'
import { confirmar } from '../confirmar'
import { IconoCerrar, IconoReloj } from './Iconos'

interface Props {
  proyectos: { id: string; nombre: string }[]
  proyectoInicial?: string
  modelos: InfoModelo[]
  onAbrirSesion: (sesionId: string) => void
  onCerrar: () => void
}

const DIAS = [
  { d: 1, t: 'L' },
  { d: 2, t: 'M' },
  { d: 3, t: 'X' },
  { d: 4, t: 'J' },
  { d: 5, t: 'V' },
  { d: 6, t: 'S' },
  { d: 0, t: 'D' }
]

const AUTONOMIAS: { valor: ModoAutonomia; texto: string; detalle: string }[] = [
  { valor: 'preguntar', texto: 'Solo lectura', detalle: 'Lee, busca y ejecuta comandos de consulta. Lo que pediría permiso se deniega solo.' },
  { valor: 'ediciones', texto: 'Puede editar archivos', detalle: 'Edita archivos sin preguntar; los comandos que piden permiso se deniegan.' },
  { valor: 'autonomo', texto: 'Autónomo', detalle: 'Edita y ejecuta sin confirmaciones (salvo lo catastrófico). Úsalo con cuidado: no hay nadie mirando.' }
]

const EJEMPLOS: { nombre: string; prompt: string; frecuencia: Frecuencia }[] = [
  { nombre: 'PRs pendientes', prompt: 'Revisa los pull requests abiertos de este repositorio y los que esperan mi revisión. Resume en una lista qué hay que mirar primero y por qué.', frecuencia: { tipo: 'diaria', hora: '09:00', dias: [1, 2, 3, 4, 5] } },
  { nombre: 'Tests', prompt: 'Ejecuta la batería de tests del proyecto. Si algo falla, explica la causa probable de cada fallo con el archivo y la línea. No cambies código.', frecuencia: { tipo: 'intervalo', horas: 6 } },
  { nombre: 'Resumen del día', prompt: 'Resume los commits de hoy en todas las ramas: qué cambió, quién, y si hay algo que parezca a medias o arriesgado.', frecuencia: { tipo: 'diaria', hora: '18:00', dias: [1, 2, 3, 4, 5] } }
]

const relativo = (iso?: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  const ms = d.getTime() - Date.now()
  const abs = Math.abs(ms)
  const txt = abs < 60_000 ? 'un momento' : abs < 3_600_000 ? `${Math.round(abs / 60_000)} min` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)} h` : `${Math.round(abs / 86_400_000)} d`
  return ms >= 0 ? `en ${txt}` : `hace ${txt}`
}
const fecha = (iso?: string): string => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const limpiarError = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Borrador = NuevaTareaProgramada

function Editor({ inicial, proyectos, modelos, onGuardado, onCancelar }: { inicial: Borrador; proyectos: Props['proyectos']; modelos: InfoModelo[]; onGuardado: () => void; onCancelar: () => void }) {
  const [b, setB] = useState<Borrador>(inicial)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const f = b.frecuencia
  const cambiar = (p: Partial<Borrador>): void => setB((x) => ({ ...x, ...p }))

  const guardar = async (): Promise<void> => {
    setError('')
    setGuardando(true)
    try {
      await window.api.core.programadas({ op: 'guardar', tarea: b })
      onGuardado()
    } catch (e) {
      setError(limpiarError(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form
      className="pg-editor"
      onSubmit={(e) => {
        e.preventDefault()
        void guardar()
      }}
    >
      <label className="pg-campo">
        <span>Nombre</span>
        <input autoFocus value={b.nombre} maxLength={80} placeholder="p. ej. PRs pendientes" onChange={(e) => cambiar({ nombre: e.target.value })} />
      </label>
      {proyectos.length > 1 && (
        <label className="pg-campo">
          <span>Proyecto</span>
          <select value={b.proyectoId} onChange={(e) => cambiar({ proyectoId: e.target.value })}>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="pg-campo">
        <span>Qué tiene que hacer</span>
        <textarea rows={5} value={b.prompt} maxLength={8000} placeholder="Escribe la instrucción como se la darías al Asistente. Termina pidiendo un resumen claro." onChange={(e) => cambiar({ prompt: e.target.value })} />
      </label>

      <fieldset className="pg-campo">
        <legend>Cuándo</legend>
        <div className="segmentado" role="radiogroup" aria-label="Tipo de repetición">
          <button type="button" role="radio" aria-checked={f.tipo === 'diaria'} className={f.tipo === 'diaria' ? 'on' : ''} onClick={() => f.tipo !== 'diaria' && cambiar({ frecuencia: { tipo: 'diaria', hora: '09:00', dias: [1, 2, 3, 4, 5] } })}>
            A una hora
          </button>
          <button type="button" role="radio" aria-checked={f.tipo === 'intervalo'} className={f.tipo === 'intervalo' ? 'on' : ''} onClick={() => f.tipo !== 'intervalo' && cambiar({ frecuencia: { tipo: 'intervalo', horas: 6 } })}>
            Cada cierto tiempo
          </button>
        </div>
        {f.tipo === 'diaria' ? (
          <div className="pg-cuando">
            <input type="time" value={f.hora} onChange={(e) => cambiar({ frecuencia: { ...f, hora: e.target.value } })} aria-label="Hora" />
            <div className="pg-dias" role="group" aria-label="Días">
              {DIAS.map(({ d, t }) => {
                const on = f.dias.includes(d)
                return (
                  <button key={d} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => cambiar({ frecuencia: { ...f, dias: on ? f.dias.filter((x) => x !== d) : [...f.dias, d] } })}>
                    {t}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="pg-cuando">
            <span>Cada</span>
            <input type="number" min={1} max={168} value={f.horas} onChange={(e) => cambiar({ frecuencia: { tipo: 'intervalo', horas: Number(e.target.value) } })} aria-label="Horas" />
            <span>horas</span>
          </div>
        )}
      </fieldset>

      <fieldset className="pg-campo">
        <legend>Permisos</legend>
        <div className="pg-opciones">
          {AUTONOMIAS.map((a) => (
            <label key={a.valor} className={`pg-opcion${b.autonomia === a.valor ? ' on' : ''}${a.valor === 'autonomo' ? ' riesgo' : ''}`}>
              <input type="radio" name="autonomia" checked={b.autonomia === a.valor} onChange={() => cambiar({ autonomia: a.valor })} />
              <span>
                <strong>{a.texto}</strong>
                <small>{a.detalle}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="pg-fila">
        <label className="pg-campo">
          <span>Modelo</span>
          <select value={b.modelo ?? ''} onChange={(e) => setB(({ modelo: _m, ...x }) => (e.target.value ? { ...x, modelo: e.target.value } : x))}>
            <option value="">Automático</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="pg-interruptor">
          <input type="checkbox" checked={b.activa} onChange={(e) => cambiar({ activa: e.target.checked })} />
          Activa
        </label>
      </div>

      {error && (
        <div className="pg-error" role="alert">
          {error}
        </div>
      )}
      <div className="pg-pie">
        <span className="pg-nota">Se ejecuta solo con Odesk abierto. Si estaba cerrado a la hora prevista, se ejecuta una vez al abrirlo.</span>
        <button type="button" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="submit" className="primario" disabled={guardando || !b.nombre.trim() || !b.prompt.trim()}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

/** Tareas que el Asistente ejecuta solo, a una hora o cada cierto tiempo, y cuyo resultado queda como conversación en el historial. */
export function Programadas({ proyectos, proyectoInicial, modelos, onAbrirSesion, onCerrar }: Props) {
  const [lista, setLista] = useState<TareaProgramada[] | null>(null)
  const [editando, setEditando] = useState<Borrador | null>(null)
  const [error, setError] = useState('')
  const filtro = proyectos.length === 1 ? proyectos[0]!.id : undefined
  const nombreDe = (id: string): string => proyectos.find((p) => p.id === id)?.nombre ?? 'proyecto'

  const cargar = (): void =>
    void window.api.core
      .programadas({ op: 'listar', ...(filtro ? { proyectoId: filtro } : {}) })
      .then((r) => setLista(r as TareaProgramada[]))
      .catch((e) => setError(limpiarError(e)))

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 8000)
    return () => clearInterval(t)
  }, [filtro])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (editando) setEditando(null)
        else onCerrar()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [editando, onCerrar])

  const nueva = (base?: Partial<Borrador>): void =>
    setEditando({ nombre: '', prompt: '', proyectoId: proyectoInicial ?? proyectos[0]?.id ?? '', frecuencia: { tipo: 'diaria', hora: '09:00', dias: [1, 2, 3, 4, 5] }, autonomia: 'preguntar', activa: true, ...base })

  const op = async (f: () => Promise<unknown>): Promise<void> => {
    setError('')
    try {
      await f()
      cargar()
    } catch (e) {
      setError(limpiarError(e))
    }
  }

  const eliminar = async (t: TareaProgramada): Promise<void> => {
    if (await confirmar({ titulo: `Eliminar «${t.nombre}»`, etiqueta: 'Eliminar', texto: 'Deja de ejecutarse. Las conversaciones que ya generó siguen en el historial.' })) await op(() => window.api.core.programadas({ op: 'eliminar', id: t.id }))
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal pg" role="dialog" aria-modal="true" aria-label="Tareas programadas">
        <div className="modal-cab">
          <h3>{editando ? (editando.id ? 'Editar tarea programada' : 'Nueva tarea programada') : 'Tareas programadas'}</h3>
          <button className="icono" onClick={onCerrar} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>

        {editando ? (
          <Editor
            inicial={editando}
            proyectos={proyectos}
            modelos={modelos}
            onCancelar={() => setEditando(null)}
            onGuardado={() => {
              setEditando(null)
              cargar()
            }}
          />
        ) : (
          <div className="pg-cuerpo">
            <p className="pg-intro">El Asistente las ejecuta solo y te avisa al terminar. Cada ejecución queda como una conversación en el historial del proyecto.</p>
            {error && (
              <div className="pg-error" role="alert">
                {error}
              </div>
            )}
            {lista === null && !error && <div className="pg-vacio">Cargando…</div>}
            {lista?.length === 0 && (
              <div className="pg-vacio">
                <IconoReloj />
                <strong>Aún no hay tareas programadas</strong>
                <span>Empieza con una de estas o crea la tuya:</span>
                <div className="pg-ejemplos">
                  {EJEMPLOS.map((x) => (
                    <button key={x.nombre} onClick={() => nueva({ nombre: x.nombre, prompt: x.prompt, frecuencia: x.frecuencia })}>
                      <strong>{x.nombre}</strong>
                      <small>{describirFrecuencia(x.frecuencia)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!!lista?.length && (
              <ul className="pg-lista">
                {lista.map((t) => (
                  <li key={t.id} className={`pg-tarea${t.activa ? '' : ' pausada'}`}>
                    <div className="pg-tarea-cab">
                      <div className="pg-tarea-titulo">
                        <strong>{t.nombre}</strong>
                        <span>
                          {describirFrecuencia(t.frecuencia)}
                          {!filtro && ` · ${nombreDe(t.proyectoId)}`} · {AUTONOMIAS.find((a) => a.valor === t.autonomia)?.texto}
                        </span>
                      </div>
                      <label className="pg-interruptor" title={t.activa ? 'Pausar' : 'Reanudar'}>
                        <input type="checkbox" checked={t.activa} onChange={(e) => void op(() => window.api.core.programadas({ op: 'guardar', tarea: { ...t, activa: e.target.checked } }))} />
                        <span className="sr">{t.activa ? 'Activa' : 'Pausada'}</span>
                      </label>
                    </div>
                    <div className="pg-tarea-estado">
                      {t.ejecutando ? (
                        <span className="pg-chip vivo">
                          <span className="pg-giro" aria-hidden /> Ejecutándose…
                        </span>
                      ) : t.activa ? (
                        <span className="pg-chip" title={fecha(t.proxima)}>
                          Próxima {relativo(t.proxima)}
                        </span>
                      ) : (
                        <span className="pg-chip">Pausada</span>
                      )}
                      {t.ultima && (
                        <span className={`pg-chip ${t.ultima.estado === 'completado' ? 'ok' : 'mal'}`} title={fecha(t.ultima.inicio)}>
                          {t.ultima.estado === 'completado' ? '✓' : '⚠'} Última {relativo(t.ultima.inicio)}
                        </span>
                      )}
                    </div>
                    {t.ultima?.resumen && <p className="pg-resumen">{t.ultima.resumen}</p>}
                    <div className="pg-acciones">
                      {t.ultima?.sesionId && (
                        <button
                          onClick={() => {
                            onAbrirSesion(t.ultima!.sesionId!)
                            onCerrar()
                          }}
                        >
                          Ver resultado
                        </button>
                      )}
                      <button disabled={t.ejecutando} onClick={() => void op(() => window.api.core.programadas({ op: 'ejecutar', id: t.id }))}>
                        Ejecutar ahora
                      </button>
                      <button onClick={() => setEditando({ ...t })}>Editar</button>
                      <button className="peligro" onClick={() => void eliminar(t)}>
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="pg-pie">
              <span className="pg-nota">Solo se ejecutan con Odesk abierto.</span>
              <button className="primario" disabled={!proyectos.length} onClick={() => nueva()} title={proyectos.length ? undefined : 'Elige un proyecto primero'}>
                Nueva tarea
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
