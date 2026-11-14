import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DatosProyectos, Proyecto } from '@shared/modelos'
import type { ResumenUso } from '@shared/core/uso'
import { categoriaDe, resumirTareas, type EstadoTarea, type Tarea } from '@shared/tareas'
import type { EstadoGit } from '@shared/versiones'
import { IconoApi, IconoCarpeta, IconoChispa, IconoGlobo, IconoRama, IconoRayo, IconoTareas, IconoTerminal } from './Iconos'
import type { Vista } from './Sidebar'

interface Props {
  datos: DatosProyectos
  visible: boolean
  terminalesAbiertas: number
  serviciosActivos: number
  solicitudesAsistente: number
  pendientesClonar: number
  email?: string
  onVista: (v: Vista) => void
  onAbrirProyecto: (p: Proyecto) => void
  onAgregar: () => void
}

interface GitProyecto {
  proyecto: Proyecto
  estado?: EstadoGit
  /** Commits por día (14 días, el último = hoy). */
  dias: number[]
}

const DIAS = 14
const MAX_REPOS = 16
const fmt = new Intl.NumberFormat('es')
const compacto = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

const saludo = (): string => {
  const h = new Date().getHours()
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

const COLOR_CAT: Record<string, string> = {
  pendiente: '#8b93ff',
  en_curso: '#fbbf24',
  bloqueada: '#f87171',
  hecha: '#34d399',
  cancelada: '#6b6b78'
}

/** Anillo de progreso (0-100). */
function Anillo({ valor, tam = 84, trazo = 9, color = 'var(--acento)', children }: { valor: number; tam?: number; trazo?: number; color?: string; children?: ReactNode }) {
  const r = (tam - trazo) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, valor))
  return (
    <div className="ini-anillo" style={{ width: tam, height: tam }}>
      <svg width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`}>
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={trazo} />
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke={color} strokeWidth={trazo} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${tam / 2} ${tam / 2})`} style={{ transition: 'stroke-dasharray .8s cubic-bezier(.32,.72,0,1)' }} />
      </svg>
      <div className="ini-anillo-centro">{children}</div>
    </div>
  )
}

/** Dona con segmentos. */
function Dona({ partes, tam = 132, trazo = 16, children }: { partes: { valor: number; color: string; titulo: string }[]; tam?: number; trazo?: number; children?: ReactNode }) {
  const total = partes.reduce((a, p) => a + p.valor, 0)
  const r = (tam - trazo) / 2
  const c = 2 * Math.PI * r
  let acum = 0
  return (
    <div className="ini-anillo" style={{ width: tam, height: tam }}>
      <svg width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`}>
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={trazo} />
        {total > 0 &&
          partes
            .filter((p) => p.valor > 0)
            .map((p) => {
              const largo = (p.valor / total) * c
              const el = (
                <circle key={p.titulo} cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke={p.color} strokeWidth={trazo} strokeDasharray={`${Math.max(largo - 2, 0.5)} ${c}`} strokeDashoffset={-acum} transform={`rotate(-90 ${tam / 2} ${tam / 2})`}>
                  <title>{`${p.titulo}: ${p.valor}`}</title>
                </circle>
              )
              acum += largo
              return el
            })}
      </svg>
      <div className="ini-anillo-centro">{children}</div>
    </div>
  )
}

function Tarjeta({ titulo, icono, accion, onAccion, className = '', children }: { titulo: string; icono: ReactNode; accion?: string; onAccion?: () => void; className?: string; children: ReactNode }) {
  return (
    <section className={`ini-tarjeta ${className}`}>
      <header>
        <span className="ini-tarjeta-ico">{icono}</span>
        <h3>{titulo}</h3>
        {accion && onAccion && (
          <button className="ini-enlace" onClick={onAccion}>
            {accion} ›
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

export function Inicio({ datos, visible, terminalesAbiertas, serviciosActivos, solicitudesAsistente, pendientesClonar, email, onVista, onAbrirProyecto, onAgregar }: Props) {
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [estados, setEstados] = useState<EstadoTarea[]>([])
  const [git, setGit] = useState<GitProyecto[]>([])
  const [uso, setUso] = useState<ResumenUso | null>(null)
  const [cargandoGit, setCargandoGit] = useState(true)

  const cargarTareas = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([window.api.tareas.operar('listar', {}), window.api.tareas.operar('estados', {})])
      setTareas(t)
      setEstados(e)
    } catch {
      /* sin tareas */
    }
  }, [])

  const cargarGit = useCallback(async () => {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const inicio = hoy.getTime() - (DIAS - 1) * 86_400_000
    const lote = datos.proyectos.slice(0, MAX_REPOS)
    const r = await Promise.all(
      lote.map(async (proyecto): Promise<GitProyecto> => {
        try {
          const estado = await window.api.git.operar('estado', { proyectoId: proyecto.id })
          const dias = new Array<number>(DIAS).fill(0)
          if (estado.repo && !estado.sinCommits) {
            const h = await window.api.git.operar('historial', { proyectoId: proyecto.id, limite: 150 })
            for (const c of h.commits) {
              const f = new Date(c.fecha)
              f.setHours(0, 0, 0, 0)
              const i = Math.round((f.getTime() - inicio) / 86_400_000)
              if (i >= 0 && i < DIAS) dias[i]!++
            }
          }
          return { proyecto, estado, dias }
        } catch {
          return { proyecto, dias: new Array<number>(DIAS).fill(0) }
        }
      })
    )
    setGit(r)
    setCargandoGit(false)
  }, [datos.proyectos])

  useEffect(() => {
    if (!visible) return
    void cargarTareas()
    void cargarGit()
    void window.api.core.uso().then(setUso).catch(() => undefined)
    const t = setInterval(() => {
      void cargarGit()
      void window.api.core.uso().then(setUso).catch(() => undefined)
    }, 45_000)
    const off = window.api.tareas.onCambio(() => void cargarTareas())
    const off2 = window.api.core.onUso(setUso)
    return () => {
      clearInterval(t)
      off()
      off2()
    }
  }, [visible, cargarTareas, cargarGit])

  const resumen = useMemo(() => resumirTareas(tareas, tareas, estados), [tareas, estados])
  const porCategoria = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tareas) {
      const c = categoriaDe(estados, t.estado) ?? 'pendiente'
      m[c] = (m[c] ?? 0) + 1
    }
    return m
  }, [tareas, estados])
  const porPrioridad = useMemo(() => {
    const m = { urgente: 0, alta: 0, media: 0, baja: 0 }
    for (const t of tareas) if (!categoriaDe(estados, t.estado) || ['pendiente', 'en_curso', 'bloqueada'].includes(categoriaDe(estados, t.estado)!)) m[t.prioridad]++
    return m
  }, [tareas, estados])

  const cambiosTotales = git.reduce((a, g) => a + (g.estado?.archivos.length ?? 0), 0)
  const conCambios = git.filter((g) => (g.estado?.archivos.length ?? 0) > 0).sort((a, b) => b.estado!.archivos.length - a.estado!.archivos.length)
  const maxCambios = Math.max(1, ...conCambios.map((g) => g.estado!.archivos.length))
  const porSubir = git.filter((g) => (g.estado?.adelante ?? 0) > 0)
  const actividad = useMemo(() => {
    const d = new Array<number>(DIAS).fill(0)
    for (const g of git) g.dias.forEach((n, i) => (d[i]! += n))
    return d
  }, [git])
  const maxAct = Math.max(1, ...actividad)
  const totalCommits = actividad.reduce((a, b) => a + b, 0)

  const grupos = [...datos.grupos.map((g) => ({ id: g.id, nombre: g.nombre, n: datos.proyectos.filter((p) => p.grupo === g.id).length })), { id: '', nombre: 'Sin grupo', n: datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo)).length }].filter((g) => g.n > 0)
  const maxGrupo = Math.max(1, ...grupos.map((g) => g.n))

  const nombre = email ? email.split('@')[0] : ''
  const fecha = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
  const plan = uso?.plan
  const nombreProyecto = (id?: string): string | undefined => datos.proyectos.find((p) => p.id === id)?.nombre

  const atencion: { clave: string; texto: string; tono: 'error' | 'aviso' | 'info'; vista?: Vista; accion?: () => void }[] = []
  if (solicitudesAsistente > 0) atencion.push({ clave: 'as', texto: `El asistente espera tu confirmación (${solicitudesAsistente})`, tono: 'aviso', vista: 'asistente' })
  if (resumen.vencidas.length > 0) atencion.push({ clave: 'ven', texto: `${resumen.vencidas.length} ${resumen.vencidas.length === 1 ? 'tarea vencida' : 'tareas vencidas'}`, tono: 'error', vista: 'tareas' })
  if (resumen.bloqueadas.length > 0) atencion.push({ clave: 'blo', texto: `${resumen.bloqueadas.length} ${resumen.bloqueadas.length === 1 ? 'tarea bloqueada' : 'tareas bloqueadas'}`, tono: 'aviso', vista: 'tareas' })
  if (porSubir.length > 0) atencion.push({ clave: 'sub', texto: `${porSubir.length} ${porSubir.length === 1 ? 'proyecto con commits sin subir' : 'proyectos con commits sin subir'}`, tono: 'info', vista: 'versiones' })
  if (pendientesClonar > 0) atencion.push({ clave: 'cl', texto: `${pendientesClonar} ${pendientesClonar === 1 ? 'proyecto de tu cuenta falta' : 'proyectos de tu cuenta faltan'} en este equipo`, tono: 'info', vista: 'config' })
  if (plan?.cincoHoras && plan.cincoHoras.porcentaje >= 80) atencion.push({ clave: 'plan', texto: `Plan de IA al ${Math.round(plan.cincoHoras.porcentaje)} % en la ventana de 5 h`, tono: 'aviso', vista: 'proveedores' })

  const modulos: { vista: Vista; texto: string; desc: string; icono: ReactNode; dato?: string }[] = [
    { vista: 'terminales', texto: 'Terminales', desc: 'Tus pestañas y rejillas', icono: <IconoTerminal />, dato: `${terminalesAbiertas} abiertas` },
    { vista: 'servicios', texto: 'Servicios', desc: 'Procesos en marcha', icono: <IconoRayo />, dato: `${serviciosActivos} activos` },
    { vista: 'asistente', texto: 'Asistente', desc: 'Chat con IA por proyecto', icono: <IconoChispa />, dato: solicitudesAsistente ? `${solicitudesAsistente} pendientes` : undefined },
    { vista: 'tareas', texto: 'Tareas', desc: 'Tablero y seguimiento', icono: <IconoTareas />, dato: `${resumen.abiertas} abiertas` },
    { vista: 'versiones', texto: 'Versiones', desc: 'Git, ramas y fusiones', icono: <IconoRama />, dato: cambiosTotales ? `${cambiosTotales} cambios` : undefined },
    { vista: 'api', texto: 'Cliente API', desc: 'Prueba tus endpoints', icono: <IconoApi /> },
    { vista: 'navegador', texto: 'Navegador', desc: 'Previsualiza tus apps', icono: <IconoGlobo /> },
    { vista: 'config', texto: 'Proyectos', desc: 'Grupos y carpetas', icono: <IconoCarpeta />, dato: `${datos.proyectos.length} proyectos` }
  ]

  if (datos.proyectos.length === 0) {
    return (
      <div className="config ini" style={{ display: visible ? undefined : 'none' }}>
        <div className="ini-vacio">
          <h2>{saludo()}{nombre ? `, ${nombre}` : ''}</h2>
          <p>Empieza agregando tu primer proyecto. Aquí verás tareas, cambios de git, servicios y consumo de IA de un vistazo.</p>
          <button className="pj-btn pj-primario" onClick={onAgregar}>
            Agregar proyectos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="config ini" style={{ display: visible ? undefined : 'none' }}>
      <div className="ini-cab">
        <div>
          <span className="ini-fecha">{fecha}</span>
          <h2>
            {saludo()}
            {nombre ? `, ${nombre}` : ''}
          </h2>
        </div>
        <div className="ini-cab-acc">
          <button className="pj-btn" onClick={() => onVista('terminales')}>
            <IconoTerminal /> Ir a terminales
          </button>
          <button className="pj-btn pj-primario" onClick={onAgregar}>
            Agregar proyectos
          </button>
        </div>
      </div>

      <div className="ini-kpis">
        {[
          { t: 'Proyectos', v: datos.proyectos.length, s: `${datos.grupos.length} ${datos.grupos.length === 1 ? 'grupo' : 'grupos'}`, c: 'var(--acento)', ir: 'config' as Vista },
          { t: 'Terminales', v: terminalesAbiertas, s: `${serviciosActivos} ${serviciosActivos === 1 ? 'servicio' : 'servicios'} en marcha`, c: 'var(--ok)', ir: 'terminales' as Vista },
          { t: 'Tareas abiertas', v: resumen.abiertas, s: `${resumen.progreso} % completado`, c: 'var(--aviso)', ir: 'tareas' as Vista },
          { t: 'Cambios sin confirmar', v: cargandoGit ? '…' : cambiosTotales, s: `${conCambios.length} ${conCambios.length === 1 ? 'proyecto' : 'proyectos'}`, c: 'var(--violeta)', ir: 'versiones' as Vista },
          { t: 'Tokens hoy', v: uso ? compacto(uso.total.entrada + uso.total.salida) : '–', s: uso ? `${compacto(uso.ultimos7Dias.entrada + uso.ultimos7Dias.salida)} en 7 días` : 'sin datos', c: '#60a5fa', ir: 'asistente' as Vista }
        ].map((k) => (
          <button className="ini-kpi" key={k.t} onClick={() => onVista(k.ir)} style={{ ['--k' as string]: k.c }}>
            <span className="ini-kpi-t">{k.t}</span>
            <strong>{typeof k.v === 'number' ? fmt.format(k.v) : k.v}</strong>
            <span className="ini-kpi-s">{k.s}</span>
          </button>
        ))}
      </div>

      {atencion.length > 0 && (
        <div className="ini-atencion">
          {atencion.map((a) => (
            <button key={a.clave} className={`ini-aviso ${a.tono}`} onClick={() => a.vista && onVista(a.vista)}>
              <span className="ini-aviso-punto" />
              {a.texto}
              <span className="ini-aviso-flecha">›</span>
            </button>
          ))}
        </div>
      )}

      <div className="ini-rejilla">
        <Tarjeta titulo="Tareas" icono={<IconoTareas />} accion="Abrir tablero" onAccion={() => onVista('tareas')} className="ini-c-tareas">
          {tareas.length === 0 ? (
            <p className="ini-nada">Aún no hay tareas. Créalas desde la vista Tareas o pídeselas al asistente.</p>
          ) : (
            <div className="ini-tareas">
              <Dona
                partes={['pendiente', 'en_curso', 'bloqueada', 'hecha', 'cancelada'].map((c) => ({ valor: porCategoria[c] ?? 0, color: COLOR_CAT[c]!, titulo: c.replace('_', ' ') }))}
              >
                <strong>{resumen.progreso}%</strong>
                <small>completado</small>
              </Dona>
              <ul className="ini-leyenda">
                {[
                  ['pendiente', 'Pendientes'],
                  ['en_curso', 'En curso'],
                  ['bloqueada', 'Bloqueadas'],
                  ['hecha', 'Hechas']
                ].map(([c, n]) => (
                  <li key={c}>
                    <i style={{ background: COLOR_CAT[c!] }} />
                    {n} <b>{porCategoria[c!] ?? 0}</b>
                  </li>
                ))}
              </ul>
              <div className="ini-prio">
                <span className="ini-sub">Abiertas por prioridad</span>
                {(['urgente', 'alta', 'media', 'baja'] as const).map((p) => {
                  const mx = Math.max(1, ...Object.values(porPrioridad))
                  return (
                    <div className="ini-barra-fila" key={p}>
                      <span>{p}</span>
                      <div className="ini-barra">
                        <div className={`ini-barra-r prio-${p}`} style={{ width: `${(porPrioridad[p] / mx) * 100}%` }} />
                      </div>
                      <b>{porPrioridad[p]}</b>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {resumen.siguiente && (
            <button className="ini-siguiente" onClick={() => onVista('tareas')}>
              <span className="ini-sub">Siguiente recomendada</span>
              <span>
                <b>#{resumen.siguiente.numero}</b> {resumen.siguiente.titulo}
                {nombreProyecto(tareas.find((t) => t.id === resumen.siguiente!.id)?.proyectoId) && <em> · {nombreProyecto(tareas.find((t) => t.id === resumen.siguiente!.id)?.proyectoId)}</em>}
              </span>
            </button>
          )}
        </Tarjeta>

        <Tarjeta titulo="Actividad de commits" icono={<IconoRama />} accion="Ver versiones" onAccion={() => onVista('versiones')} className="ini-c-act">
          <div className="ini-act-cab">
            <strong>{totalCommits}</strong>
            <span>commits en {DIAS} días</span>
          </div>
          <div className="ini-barras" role="img" aria-label="Commits por día">
            {actividad.map((n, i) => {
              const d = new Date()
              d.setDate(d.getDate() - (DIAS - 1 - i))
              return (
                <div className="ini-col" key={i} title={`${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })}: ${n}`}>
                  <div className="ini-col-b" style={{ height: `${Math.max((n / maxAct) * 100, n ? 6 : 2)}%`, opacity: n ? 1 : 0.35 }} />
                  <span>{i === DIAS - 1 ? 'hoy' : d.getDate()}</span>
                </div>
              )
            })}
          </div>
        </Tarjeta>

        <Tarjeta titulo="Cambios por proyecto" icono={<IconoRama />} accion="Revisar" onAccion={() => onVista('versiones')} className="ini-c-cambios">
          {cargandoGit ? (
            <p className="ini-nada">Leyendo repositorios…</p>
          ) : conCambios.length === 0 ? (
            <p className="ini-nada">Todo limpio: no hay cambios sin confirmar.</p>
          ) : (
            <ul className="ini-lista">
              {conCambios.slice(0, 7).map((g) => (
                <li key={g.proyecto.id}>
                  <button onClick={() => onAbrirProyecto(g.proyecto)} title={`Abrir ${g.proyecto.nombre}`}>
                    <span className="ini-lista-n">{g.proyecto.nombre}</span>
                    {g.estado?.rama && <span className="chip">{g.estado.rama}</span>}
                    <div className="ini-barra">
                      <div className="ini-barra-r" style={{ width: `${(g.estado!.archivos.length / maxCambios) * 100}%` }} />
                    </div>
                    <b>{g.estado!.archivos.length}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Consumo de IA" icono={<IconoChispa />} accion="Asistente" onAccion={() => onVista('asistente')} className="ini-c-ia">
          {!uso ? (
            <p className="ini-nada">Sin datos de consumo todavía.</p>
          ) : (
            <>
              <div className="ini-anillos">
                {plan?.cincoHoras && (
                  <div className="ini-anillo-et">
                    <Anillo valor={plan.cincoHoras.porcentaje} color={plan.cincoHoras.porcentaje >= 80 ? 'var(--aviso)' : 'var(--acento)'}>
                      <strong>{Math.round(plan.cincoHoras.porcentaje)}%</strong>
                    </Anillo>
                    <span>Ventana 5 h</span>
                  </div>
                )}
                {plan?.semana && (
                  <div className="ini-anillo-et">
                    <Anillo valor={plan.semana.porcentaje} color="var(--violeta)">
                      <strong>{Math.round(plan.semana.porcentaje)}%</strong>
                    </Anillo>
                    <span>Semana</span>
                  </div>
                )}
                {!plan && (
                  <div className="ini-anillo-et">
                    <Anillo valor={Math.min(100, ((uso.total.entrada + uso.total.salida) / Math.max(1, uso.ultimos7Dias.entrada + uso.ultimos7Dias.salida)) * 100)} color="var(--acento)">
                      <strong>{compacto(uso.total.entrada + uso.total.salida)}</strong>
                    </Anillo>
                    <span>Hoy / 7 días</span>
                  </div>
                )}
              </div>
              <dl className="ini-datos">
                <div>
                  <dt>Hoy</dt>
                  <dd>{compacto(uso.total.entrada + uso.total.salida)} tokens · {uso.total.llamadas} llamadas</dd>
                </div>
                <div>
                  <dt>7 días</dt>
                  <dd>{compacto(uso.ultimos7Dias.entrada + uso.ultimos7Dias.salida)} tokens</dd>
                </div>
                {Object.entries(uso.hoy).length > 0 && (
                  <div>
                    <dt>Modelo principal</dt>
                    <dd>{Object.entries(uso.hoy).sort((a, b) => b[1].entrada + b[1].salida - (a[1].entrada + a[1].salida))[0]![0]}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo="Proyectos por grupo" icono={<IconoCarpeta />} accion="Gestionar" onAccion={() => onVista('config')} className="ini-c-grupos">
          <ul className="ini-lista">
            {grupos.map((g) => (
              <li key={g.id || 'sg'}>
                <div className="ini-fila">
                  <span className="ini-lista-n">{g.nombre}</span>
                  <div className="ini-barra">
                    <div className="ini-barra-r" style={{ width: `${(g.n / maxGrupo) * 100}%` }} />
                  </div>
                  <b>{g.n}</b>
                </div>
              </li>
            ))}
          </ul>
        </Tarjeta>

        <Tarjeta titulo="Ramas y sincronización" icono={<IconoRama />} className="ini-c-ramas">
          {cargandoGit ? (
            <p className="ini-nada">Leyendo repositorios…</p>
          ) : (
            <ul className="ini-lista ini-ramas">
              {git
                .filter((g) => g.estado?.repo)
                .slice(0, 8)
                .map((g) => (
                  <li key={g.proyecto.id}>
                    <button onClick={() => onAbrirProyecto(g.proyecto)}>
                      <span className="ini-lista-n">{g.proyecto.nombre}</span>
                      <span className="chip">{g.estado!.rama ?? g.estado!.desacoplado ?? '—'}</span>
                      {g.estado!.adelante > 0 && <span className="chip chip-aviso" title="Commits sin subir">↑{g.estado!.adelante}</span>}
                      {g.estado!.atras > 0 && <span className="chip chip-aviso" title="Commits por bajar">↓{g.estado!.atras}</span>}
                      {g.estado!.adelante === 0 && g.estado!.atras === 0 && g.estado!.upstream && <span className="chip chip-ok">al día</span>}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      <h3 className="ini-titulo-sec">Módulos</h3>
      <div className="ini-modulos">
        {modulos.map((m) => (
          <button className="ini-modulo" key={m.vista} onClick={() => onVista(m.vista)}>
            <span className="ini-modulo-ico">{m.icono}</span>
            <span className="ini-modulo-t">
              <b>{m.texto}</b>
              <small>{m.dato ?? m.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
