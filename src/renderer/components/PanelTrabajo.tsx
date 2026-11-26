import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as EventoTeclado } from 'react'
import { createPortal } from 'react-dom'
import type { Turno } from '../agente/useAgente'
import { RAIZ, construirTrabajo, duracion, enOrdenDeArbol, type ActividadTrabajo, type EstadoNodo, type NodoTrabajo, type PasoTrabajo, type SkillUso, type Trabajo } from '../agente/trabajo'
import { IconoCategoria } from './ActividadAgente'
import { DiffEdicion } from './DiffEdicion'
import { AvisoPermiso } from './AvisoPermiso'
import { explicarDenegacion } from '../agente/permisos-denegados'
import { IconoCerrar } from './Iconos'

/**
 * «Ver trabajo»: panel lateral (no tapa el chat) con lo que hacen el asistente y sus subagentes en tiempo real.
 * Tres vistas sobre el mismo modelo puro (`agente/trabajo.ts`): árbol de agentes, línea de tiempo y registro de actividad.
 */

type Vista = 'arbol' | 'skills' | 'tiempo' | 'actividad'
const VISTAS: { id: Vista; texto: string }[] = [
  { id: 'arbol', texto: 'Árbol' },
  { id: 'skills', texto: 'Skills' },
  { id: 'tiempo', texto: 'Línea de tiempo' },
  { id: 'actividad', texto: 'Actividad' }
]

const ESTADO: Record<EstadoNodo, string> = {
  trabajando: 'Trabajando',
  esperando: 'Esperando tu respuesta',
  completado: 'Terminado',
  error: 'Con error',
  cancelado: 'Cancelado'
}

const EDITAN = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Color estable por agente (las barras, los chips y las tarjetas del mismo agente comparten tono). */
const TONOS = 6
function tonoDe(agente: string): number {
  let h = 0
  for (const c of agente) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % TONOS
}

const marca = (tr: Trabajo, t: number): string => (tr.relativo ? `#${t + 1}` : `+${duracion(t - tr.desde)}`)
const transcurrido = (tr: Trabajo, n: NodoTrabajo): number => (n.fin ?? tr.hasta) - n.inicio

/** Reloj de 1 s solo mientras hay trabajo en curso (las barras y las duraciones avanzan sin eventos nuevos). */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    if (!activo) return
    const id = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [activo])
  return ahora
}

export function PanelTrabajo({ turno, onCerrar }: { turno: Turno; onCerrar: () => void }) {
  const [vista, setVista] = useState<Vista>('arbol')
  const [amplio, setAmplio] = useState(false)
  // Sale por el mismo camino por el que entró (hacia la derecha) y solo entonces se desmonta.
  const [saliendo, setSaliendo] = useState(false)
  const cerrar = useCallback((): void => setSaliendo(true), [])
  useEffect(() => {
    if (!saliendo) return
    const respaldo = window.setTimeout(onCerrar, 450) // por si la animación no llega a dispararse
    return () => window.clearTimeout(respaldo)
  }, [saliendo, onCerrar])
  const enCurso = turno.estado === 'en_curso'
  const ahora = useAhora(enCurso)
  // Los eventos llegan en ráfagas: la vista se recalcula con prioridad baja para no frenar el chat.
  const eventos = useDeferredValue(turno.eventos)
  const tiempos = useDeferredValue(turno.tiempos)
  const tr = useMemo(
    () => construirTrabajo({ eventos, ...(tiempos ? { tiempos } : {}), prompt: turno.prompt, raiz: turno.raiz, enCurso, estadoTurno: turno.estado, ahora }),
    [eventos, tiempos, turno.prompt, turno.raiz, turno.estado, enCurso, ahora]
  )
  const panel = useRef<HTMLDivElement>(null)
  const pestanas = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    panel.current?.focus()
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) cerrar()
    }
    // Clic fuera del panel lo cierra (no si cae en otro diálogo abierto encima, p. ej. una confirmación).
    const fuera = (e: PointerEvent): void => {
      const t = e.target as Element | null
      if (!t || panel.current?.contains(t) || t.closest?.('[role="dialog"], [role="alertdialog"], .modal')) return
      cerrar()
    }
    window.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', fuera, true)
    return () => {
      window.removeEventListener('keydown', tecla)
      document.removeEventListener('pointerdown', fuera, true)
    }
  }, [cerrar])

  const moverPestana = (e: EventoTeclado<HTMLDivElement>): void => {
    const i = VISTAS.findIndex((v) => v.id === vista)
    const siguiente = e.key === 'ArrowRight' ? (i + 1) % VISTAS.length : e.key === 'ArrowLeft' ? (i - 1 + VISTAS.length) % VISTAS.length : -1
    if (siguiente < 0) return
    e.preventDefault()
    setVista(VISTAS[siguiente]!.id)
    pestanas.current[siguiente]?.focus()
  }

  const raiz = tr.nodos[RAIZ]!
  const subagentes = tr.orden.length - 1
  // Portal a <body>: dentro de una celda, un ancestro con transform o backdrop-filter haría que «fixed» fuera relativo a ella.
  return createPortal(
    <aside
      ref={panel}
      tabIndex={-1}
      className={`trb${amplio ? ' amplio' : ''}${saliendo ? ' saliendo' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="trb-titulo"
      onAnimationEnd={(e) => e.target === e.currentTarget && saliendo && onCerrar()}
      data-vivo={enCurso ? 'si' : 'no'}
    >
      <div className="trb-fondo" aria-hidden="true">
        <span className="trb-rejilla" />
        <span className="trb-aurora" />
        <span className="trb-barrido" />
      </div>
      <header className="trb-cab">
        <div className="trb-titulo">
          <Nucleo estado={raiz.estado} />
          <div>
            <h3 id="trb-titulo">Trabajo del asistente</h3>
            <p title={turno.prompt}>{turno.prompt || '(sin mensaje)'}</p>
          </div>
        </div>
        <div className="trb-acciones">
          <button type="button" className="ag-icono" onClick={() => setAmplio((v) => !v)} aria-pressed={amplio} title={amplio ? 'Volver al panel lateral' : 'Ampliar a toda la ventana'}>
            {amplio ? <IconoReducir /> : <IconoAmpliar />}
          </button>
          <button type="button" className="ag-icono" onClick={cerrar} aria-label="Cerrar" title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>
      </header>

      <dl className="trb-resumen">
        <div>
          <dt>Estado</dt>
          <dd className={`trb-estado estado-${raiz.estado}`}>{ESTADO[raiz.estado]}</dd>
        </div>
        <div>
          <dt>Subagentes</dt>
          <dd>
            {subagentes}
            {tr.activos > 0 && <span className="trb-activos"> · {tr.activos} activos</span>}
          </dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd>
            {tr.skills.length}
            {tr.skills.some((s) => s.fin === undefined) && <span className="trb-activos"> · cargando</span>}
          </dd>
        </div>
        <div>
          <dt>Pasos</dt>
          <dd>{tr.totalPasos}</dd>
        </div>
        <div>
          <dt>Tiempo</dt>
          <dd>{tr.relativo ? '—' : duracion(transcurrido(tr, raiz))}</dd>
        </div>
      </dl>

      <Telemetria tr={tr} vivo={enCurso} ahora={ahora} />

      <div className="trb-pestanas" role="tablist" aria-label="Vistas del trabajo" onKeyDown={moverPestana}>
        <span className="trb-indicador" aria-hidden="true" style={{ '--i': VISTAS.findIndex((v) => v.id === vista), '--n': VISTAS.length } as React.CSSProperties} />
        {VISTAS.map((v, i) => (
          <button
            key={v.id}
            ref={(b) => void (pestanas.current[i] = b)}
            type="button"
            role="tab"
            id={`trb-tab-${v.id}`}
            aria-selected={vista === v.id}
            aria-controls={`trb-vista-${v.id}`}
            tabIndex={vista === v.id ? 0 : -1}
            className={vista === v.id ? 'activa' : undefined}
            onClick={() => setVista(v.id)}
          >
            {v.texto}
            {v.id === 'actividad' && tr.actividad.length > 0 && <span className="trb-contador">{tr.actividad.length}</span>}
            {v.id === 'skills' && tr.skills.length > 0 && <span className={`trb-contador${tr.skills.some((s) => s.fin === undefined) ? ' viva' : ''}`}>{tr.skills.length}</span>}
          </button>
        ))}
      </div>

      <div key={vista} className="trb-cuerpo" role="tabpanel" id={`trb-vista-${vista}`} aria-labelledby={`trb-tab-${vista}`}>
        {vista === 'arbol' && <VistaArbol tr={tr} />}
        {vista === 'skills' && <VistaSkills tr={tr} vivo={enCurso} />}
        {vista === 'tiempo' && <VistaTiempo tr={tr} />}
        {vista === 'actividad' && <VistaActividad tr={tr} vivo={enCurso} />}
      </div>
      {tr.relativo && <p className="trb-nota">Turno recuperado del historial: sin tiempos reales, la escala sigue el orden de los pasos.</p>}
    </aside>,
    document.body
  )
}

// ---------------------------------------------------------------- HUD

/** Núcleo del estado general: anillos que giran mientras trabaja, se detienen en verde al terminar y en rojo si falla. */
function Nucleo({ estado }: { estado: EstadoNodo }) {
  return (
    <span className={`trb-nucleo estado-${estado}`} aria-hidden="true">
      <span className="trb-anillo a1" />
      <span className="trb-anillo a2" />
      <span className="trb-anillo a3" />
      <span className="trb-centro" />
    </span>
  )
}

/** Barras de telemetría: cuántas acciones hubo en cada tramo del turno (la última se rellena en vivo). */
const TRAMOS = 32
export function tramosActividad(tr: Pick<Trabajo, 'actividad' | 'desde' | 'hasta'>, ahora: number, vivo: boolean, tramos = TRAMOS): number[] {
  const fin = vivo ? Math.max(tr.hasta, ahora) : tr.hasta
  const ancho = Math.max(1, (fin - tr.desde) / tramos)
  const cuenta = new Array<number>(tramos).fill(0)
  for (const a of tr.actividad) cuenta[Math.min(tramos - 1, Math.max(0, Math.floor((a.t - tr.desde) / ancho)))]!++
  return cuenta
}

function Telemetria({ tr, vivo, ahora }: { tr: Trabajo; vivo: boolean; ahora: number }) {
  const cuenta = useMemo(() => tramosActividad(tr, ahora, vivo), [tr, ahora, vivo])
  const max = Math.max(1, ...cuenta)
  if (tr.actividad.length === 0) return null
  return (
    <div className={`trb-telemetria${vivo ? ' viva' : ''}`} role="img" aria-label={`Actividad del turno: ${tr.actividad.length} acciones`}>
      {cuenta.map((c, i) => (
        <span key={i} className={c ? 'con' : undefined} style={{ '--h': `${Math.max(6, Math.round((c / max) * 100))}%`, '--d': `${i * 18}ms` } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- árbol

export function VistaArbol({ tr }: { tr: Trabajo }) {
  return (
    <ol className="trb-arbol" aria-label="Agentes">
      <RamaArbol tr={tr} id={RAIZ} />
    </ol>
  )
}

function RamaArbol({ tr, id }: { tr: Trabajo; id: string }) {
  const n = tr.nodos[id]
  if (!n) return null
  return (
    <li className="trb-rama">
      <TarjetaAgente n={n} tr={tr} />
      {n.hijos.length > 0 && (
        <ol className="trb-hijos">
          {n.hijos.map((h) => (
            <li key={h} className={`trb-enlace estado-${tr.nodos[h]?.estado ?? 'completado'}`}>
              <span className="trb-conector" aria-hidden="true">
                <span className="trb-particula" />
              </span>
              <ol className="trb-sub">
                <RamaArbol tr={tr} id={h} />
              </ol>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

const TarjetaAgente = memo(function TarjetaAgente({ n, tr }: { n: NodoTrabajo; tr: Trabajo }) {
  const ultimo = n.pasos.at(-1)
  return (
    <article
      className={`trb-tarjeta estado-${n.estado} tono-${tonoDe(n.agente)}`}
      aria-label={`${n.agente}: ${ESTADO[n.estado]}`}
      style={{ '--orden': Math.max(0, Math.min(12, tr.orden.indexOf(n.id))) } as React.CSSProperties}
    >
      <div className="trb-tarjeta-cab">
        <span className={`trb-orbe${n.categoriaActual ? ` cat-${n.categoriaActual}` : ''}`} aria-hidden="true">
          {n.estado === 'completado' ? <IconoHecho /> : n.estado === 'error' ? '!' : n.categoriaActual ? <IconoCategoria categoria={n.categoriaActual} /> : <span className="trb-punto" />}
        </span>
        <div className="trb-nombre">
          <strong>{n.id === RAIZ ? n.agente || 'asistente' : n.agente}</strong>
          <span className={`trb-chip estado-${n.estado}`}>{ESTADO[n.estado]}</span>
        </div>
        <span className="trb-meta">
          {n.pasos.length} {n.pasos.length === 1 ? 'paso' : 'pasos'}
          {!tr.relativo && ` · ${duracion(transcurrido(tr, n))}`}
          {n.tokens ? ` · ${(n.tokens / 1000).toFixed(1)} k tok` : ''}
        </span>
      </div>
      {n.tarea && n.id !== RAIZ && <p className="trb-tarea" title={n.tarea}>{n.tarea}</p>}
      {n.actual ? (
        <p className="trb-ahora" role="status">
          <span className="trb-brillo">{n.actual}</span>
        </p>
      ) : ultimo && n.estado !== 'completado' ? (
        <p className="trb-ultimo">Último: {ultimo.titulo}{ultimo.detalle ? ` · ${ultimo.detalle}` : ''}</p>
      ) : n.ultimoTexto && n.id !== RAIZ ? (
        <p className="trb-ultimo" title={n.ultimoTexto}>{n.ultimoTexto.replace(/\s+/g, ' ').slice(0, 160)}</p>
      ) : null}
      {tr.skills.some((s) => s.nodo === n.id) && (
        <div className="trb-skills-fila" aria-label="Skills que usa">
          {tr.skills.filter((s) => s.nodo === n.id).map((s) => (
            <span key={s.id} className={`trb-skill-chip${s.fin === undefined ? ' cargando' : ''}${s.error ? ' fallo' : ''}`} title={s.resumen ?? s.nombre}>
              <IconoSkill /> {s.nombre}
            </span>
          ))}
        </div>
      )}
      {n.pasos.length > 0 && (
        <div className="trb-huellas" aria-hidden="true">
          {n.pasos.slice(-24).map((p) => (
            <span key={p.id} className={`trb-huella cat-${p.categoria}${p.fin === undefined ? ' viva' : ''}${p.error ? ' fallo' : ''}`} title={`${p.titulo}${p.detalle ? ` · ${p.detalle}` : ''}`} />
          ))}
        </div>
      )}
    </article>
  )
})

// ---------------------------------------------------------------- línea de tiempo

export function VistaTiempo({ tr }: { tr: Trabajo }) {
  const filas = enOrdenDeArbol(tr)
  const total = tr.hasta - tr.desde
  const pct = (t: number): number => Math.min(100, Math.max(0, ((t - tr.desde) / total) * 100))
  const marcas = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="trb-tiempo">
      <div className="trb-eje" aria-hidden="true">
        <span />
        <div className="trb-eje-pista">
          {marcas.map((m) => (
            <span key={m} style={{ left: `${m * 100}%` }}>
              {tr.relativo ? '' : duracion(total * m)}
            </span>
          ))}
        </div>
      </div>
      <ul className="trb-filas" aria-label="Línea de tiempo por agente">
        {filas.map((n) => {
          const izq = pct(n.inicio)
          const ancho = Math.max(0.8, pct(n.fin ?? tr.hasta) - izq)
          const largo = Math.max(1, (n.fin ?? tr.hasta) - n.inicio)
          return (
            <li key={n.id} className={`trb-fila estado-${n.estado} tono-${tonoDe(n.agente)}`}>
              <span className="trb-fila-nombre" style={{ paddingLeft: Math.min(n.profundidad, 4) * 12 }} title={n.tarea || n.agente}>
                {n.agente || 'asistente'}
              </span>
              <div className="trb-pista">
                <div className="trb-barra" style={{ left: `${izq}%`, width: `${ancho}%` }} title={`${n.agente}: ${ESTADO[n.estado]}${tr.relativo ? '' : ` · ${duracion(largo)}`}`}>
                  {n.pasos.map((p) => (
                    <span
                      key={p.id}
                      className={`trb-segmento cat-${p.categoria}${p.error ? ' fallo' : ''}`}
                      style={{ left: `${((p.inicio - n.inicio) / largo) * 100}%`, width: `max(3px, ${(((p.fin ?? tr.hasta) - p.inicio) / largo) * 100}%)` }}
                      title={`${p.titulo}${p.detalle ? ` · ${p.detalle}` : ''}${tr.relativo ? '' : ` · ${duracion((p.fin ?? tr.hasta) - p.inicio)}`}`}
                    />
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- skills

export function VistaSkills({ tr, vivo }: { tr: Trabajo; vivo: boolean }) {
  // Más recientes arriba; la que se está cargando ahora, la primera
  const lista = useMemo(() => [...tr.skills].sort((a, b) => Number(b.fin === undefined) - Number(a.fin === undefined) || b.inicio - a.inicio), [tr.skills])
  if (lista.length === 0) {
    return <p className="trb-vacio">{vivo ? 'Todavía no ha usado ninguna skill. Aparecerán aquí en cuanto cargue una.' : 'No se usó ninguna skill en este turno.'}</p>
  }
  const nombres = new Set(lista.map((s) => s.nombre))
  return (
    <div className="trb-skills">
      <p className="trb-skills-res">
        {nombres.size} {nombres.size === 1 ? 'skill distinta' : 'skills distintas'} · {lista.length} {lista.length === 1 ? 'carga' : 'cargas'}
      </p>
      <ol className="trb-skills-lista" aria-live={vivo ? 'polite' : 'off'}>
        {lista.map((s) => (
          <TarjetaSkill key={s.id} s={s} tr={tr} />
        ))}
      </ol>
    </div>
  )
}

function TarjetaSkill({ s, tr }: { s: SkillUso; tr: Trabajo }) {
  const cargando = s.fin === undefined
  return (
    <li className={`trb-skill${cargando ? ' cargando' : ''}${s.error ? ' fallo' : ''}`}>
      <span className="trb-skill-ico" aria-hidden="true">{s.error ? '!' : cargando ? <span className="trb-punto" /> : <IconoSkill />}</span>
      <div className="trb-skill-cuerpo">
        <div className="trb-skill-cab">
          <strong className="mono">{s.nombre}</strong>
          <span className={`trb-chip ${s.error ? 'estado-error' : cargando ? 'estado-trabajando' : 'estado-completado'}`}>{s.error ? 'No cargó' : cargando ? 'Cargando' : 'En uso'}</span>
          <span className={`trb-agente tono-${tonoDe(s.agente)}`}>{s.agente || 'asistente'}</span>
        </div>
        {s.argumentos && <p className="trb-skill-args" title={s.argumentos}>Con: {s.argumentos}</p>}
        {s.resumen && <p className="trb-skill-resumen" title={s.resumen}>{s.resumen}</p>}
        <span className="trb-skill-meta">
          {marca(tr, s.inicio)}
          {s.fin !== undefined && !tr.relativo ? ` · ${duracion(s.fin - s.inicio)}` : ''}
          {s.via === 'archivo' ? ' · leyendo su SKILL.md' : ''}
        </span>
      </div>
    </li>
  )
}

const IconoSkill = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
)

// ---------------------------------------------------------------- actividad

type Filtro = 'todo' | 'herramientas' | 'agentes' | 'avisos'
const FILTROS: { id: Filtro; texto: string; tipos?: ActividadTrabajo['tipo'][] }[] = [
  { id: 'todo', texto: 'Todo' },
  { id: 'herramientas', texto: 'Herramientas', tipos: ['herramienta'] },
  { id: 'agentes', texto: 'Agentes', tipos: ['subagente', 'fin_subagente', 'texto'] },
  { id: 'avisos', texto: 'Avisos', tipos: ['permiso', 'guardrail', 'contexto', 'flujo', 'worktree'] }
]

export function VistaActividad({ tr, vivo }: { tr: Trabajo; vivo: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>('todo')
  const [abierto, setAbierto] = useState<string | null>(null)
  const lista = useRef<HTMLOListElement>(null)
  const pegado = useRef(true)
  const tipos = FILTROS.find((f) => f.id === filtro)!.tipos
  const items = tipos ? tr.actividad.filter((a) => tipos.includes(a.tipo) || (filtro === 'avisos' && a.error)) : tr.actividad
  const pasos = useMemo(() => new Map(Object.values(tr.nodos).flatMap((n) => n.pasos.map((p) => [p.id, p] as const))), [tr])

  // En vivo baja sola mientras se está al final; si se sube a leer, se queda quieta.
  useEffect(() => {
    if (vivo && pegado.current && lista.current) lista.current.scrollTop = lista.current.scrollHeight
  }, [items.length, vivo])

  return (
    <div className="trb-actividad">
      <div className="trb-filtros" role="group" aria-label="Filtrar actividad">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filtro === f.id} className={filtro === f.id ? 'activo' : undefined} onClick={() => setFiltro(f.id)}>
            {f.texto}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="trb-vacio">{vivo ? 'Esperando la primera acción…' : 'Nada que mostrar con este filtro.'}</p>
      ) : (
        <ol
          ref={lista}
          className="trb-registro"
          aria-live={vivo ? 'polite' : 'off'}
          onScroll={(e) => {
            const el = e.currentTarget
            pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {items.map((a) => {
            const paso = a.paso ? pasos.get(a.paso) : undefined
            const desplegado = abierto === a.clave
            return (
              <li key={a.clave} className={`trb-item tipo-${a.tipo}${a.error ? ' fallo' : ''}`}>
                <button type="button" className="trb-item-fila" onClick={() => paso && setAbierto(desplegado ? null : a.clave)} aria-expanded={paso ? desplegado : undefined} disabled={!paso}>
                  <span className="trb-hora">{marca(tr, a.t)}</span>
                  <span className={`trb-agente tono-${tonoDe(a.agente)}`}>{a.agente || 'asistente'}</span>
                  <span className={`trb-icono${a.categoria ? ` cat-${a.categoria}` : ''}`} aria-hidden="true">
                    {a.categoria ? <IconoCategoria categoria={a.categoria} /> : a.tipo === 'permiso' ? '?' : a.tipo === 'guardrail' ? '⛨' : '•'}
                  </span>
                  <span className="trb-texto">{a.texto}</span>
                  {paso && <span className="trb-flecha" aria-hidden="true">{desplegado ? '▾' : '▸'}</span>}
                </button>
                {desplegado && paso && <DetallePaso p={paso} tr={tr} />}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function DetallePaso({ p, tr }: { p: PasoTrabajo; tr: Trabajo }) {
  const entrada = JSON.stringify(p.entrada, null, 2)
  const sinPermiso = p.error && p.resultado ? explicarDenegacion({ herramienta: p.nombre, entrada: p.entrada, texto: p.resultado }) : null
  return (
    <div className="trb-detalle">
      {sinPermiso && <AvisoPermiso d={sinPermiso} />}
      <div className="trb-detalle-meta">
        <code>{p.nombre}</code>
        {!tr.relativo && <span>{p.fin === undefined ? 'en curso' : duracion(p.fin - p.inicio)}</span>}
        {p.error && <span className="trb-chip estado-error">falló</span>}
      </div>
      {EDITAN.has(p.nombre) ? (
        <DiffEdicion nombre={p.nombre} entrada={p.entrada} />
      ) : (
        <pre className="trb-pre">{entrada.length > 1500 ? `${entrada.slice(0, 1500)}\n[… recortado]` : entrada}</pre>
      )}
      {p.resultado !== undefined && p.resultado.trim() && (
        <>
          <span className="trb-detalle-sub">Resultado</span>
          <pre className={`trb-pre${p.error ? ' fallo' : ''}`}>{p.resultado.length > 1500 ? `${p.resultado.slice(0, 1500)}\n[… recortado]` : p.resultado}</pre>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- iconos

const IconoHecho = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className="trb-check" d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)
const IconoAmpliar = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </svg>
)
const IconoReducir = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" />
  </svg>
)

/** Icono del botón «Ver trabajo»: tres nodos conectados (agente y subagentes). */
export const IconoTrabajo = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="5" r="2.4" />
    <circle cx="5.5" cy="18.5" r="2.4" />
    <circle cx="18.5" cy="18.5" r="2.4" />
    <path d="M12 7.4v4.1M12 11.5l-5 4.7M12 11.5l5 4.7" />
  </svg>
)
