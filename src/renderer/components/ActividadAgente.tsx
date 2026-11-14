import { memo, useEffect, useState, type ReactNode } from 'react'
import type { EventoAgente } from '@shared/core/agente'
import { actividadActual, contarPasos, describirHerramienta, duracion, type Categoria, type PasoHerramienta } from '../agente/actividad'

/**
 * El trabajo del Asistente mientras ocurre (capa «apple-design»): estado visible en todo momento (barra viva con lo que
 * hace ahora y el tiempo), jerarquía clara (cada paso con su icono y el dato que importa; el detalle técnico, un nivel
 * más abajo) y movimiento sobrio que respeta «reducir movimiento».
 */

const trazo = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const ICONOS: Record<Categoria, ReactNode> = {
  leer: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  buscar: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  editar: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
  navegador: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
    </>
  ),
  tareas: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  memoria: <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" />,
  git: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="8" r="2.2" />
      <path d="M6 8.2v7.6M18 10.2c0 4-6 3-11 6" />
    </>
  ),
  agente: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" />,
  movil: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  otra: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </>
  )
}

export function IconoCategoria({ categoria }: { categoria: Categoria }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" {...trazo}>
      {ICONOS[categoria]}
    </svg>
  )
}

/** Cómo se cuentan en el resumen de un grupo terminado. */
const NOMBRE_CATEGORIA: Record<Categoria, [string, string]> = {
  leer: ['lectura', 'lecturas'],
  buscar: ['búsqueda', 'búsquedas'],
  editar: ['edición', 'ediciones'],
  terminal: ['comando', 'comandos'],
  web: ['consulta web', 'consultas web'],
  navegador: ['acción en el navegador', 'acciones en el navegador'],
  tareas: ['tarea', 'tareas'],
  memoria: ['nota', 'notas'],
  git: ['operación de git', 'operaciones de git'],
  agente: ['agente', 'agentes'],
  movil: ['acción en el móvil', 'acciones en el móvil'],
  otra: ['otra', 'otras']
}

const MAX_SALIDA = 20_000
const cuerpoEntrada = (nombre: string, e: Record<string, unknown>): string => {
  if (nombre === 'Bash' && typeof e.command === 'string') return `$ ${e.command}`
  const t = JSON.stringify(e, null, 2)
  return t.length > 4000 ? t.slice(0, 4000) + '\n…' : t
}

function Girando() {
  return <span className="ag-girando" aria-label="en curso" />
}

/** Un paso: icono, qué hace y el dato clave; al abrirlo, la herramienta real, su entrada y su resultado. */
const PasoVista = memo(function PasoVista({ paso }: { paso: PasoHerramienta }) {
  const { inicio, fin } = paso
  const d = describirHerramienta(inicio.llamada.nombre, inicio.llamada.entrada)
  const estado = !fin ? 'curso' : fin.resultado.error ? 'error' : 'ok'
  const salida = fin ? fin.resultado.texto : ''
  return (
    <li className={`ag-paso ${estado} cat-${d.categoria}`}>
      <details>
        <summary>
          <span className="ag-paso-icono">
            <IconoCategoria categoria={d.categoria} />
          </span>
          <span className="ag-paso-titulo">{estado === 'curso' ? d.enCurso : d.titulo}</span>
          {d.detalle && (
            <span className="ag-paso-detalle" title={d.detalle}>
              {d.detalle}
            </span>
          )}
          <span className="ag-paso-estado">{estado === 'curso' ? <Girando /> : estado === 'error' ? '✗' : '✓'}</span>
        </summary>
        <div className="ag-paso-cuerpo">
          <div className="ag-paso-nombre">{inicio.llamada.nombre}</div>
          <pre className="ag-paso-entrada">{cuerpoEntrada(inicio.llamada.nombre, inicio.llamada.entrada)}</pre>
          <pre className={fin?.resultado.error ? 'ag-paso-salida error' : 'ag-paso-salida'}>{fin ? (salida.length > MAX_SALIDA ? salida.slice(0, MAX_SALIDA) + '\n…' : salida) || '(sin salida)' : 'ejecutando…'}</pre>
        </div>
      </details>
    </li>
  )
})

const VISIBLES_EN_VIVO = 5

/**
 * Herramientas seguidas como línea de tiempo. Con 3 o más se agrupan bajo una cabecera: abierta mientras el grupo está
 * vivo (se ven los últimos pasos), plegada al terminar con un resumen («4 lecturas · 2 ediciones · 1 falló»). Lo que la
 * persona abra o cierre a mano se respeta.
 */
export function GrupoHerramientas({ pasos, vivo }: { pasos: PasoHerramienta[]; vivo: boolean }) {
  const [abierto, setAbierto] = useState<boolean | null>(null)
  const [todos, setTodos] = useState(false)
  const enCurso = pasos.some((p) => !p.fin)
  const fallos = pasos.filter((p) => p.fin?.resultado.error).length
  if (pasos.length < 3) return <ol className="ag-pasos">{pasos.map((p) => <PasoVista key={p.inicio.llamada.id} paso={p} />)}</ol>

  const abiertoEf = abierto ?? vivo
  const ocultos = abiertoEf && vivo && !todos ? Math.max(0, pasos.length - VISIBLES_EN_VIVO) : 0
  const conteo = new Map<Categoria, number>()
  for (const p of pasos) {
    const c = describirHerramienta(p.inicio.llamada.nombre, p.inicio.llamada.entrada).categoria
    conteo.set(c, (conteo.get(c) ?? 0) + 1)
  }
  const resumen = [...conteo].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return (
    <div className={`ag-grupo${abiertoEf ? ' abierto' : ''}${enCurso ? ' vivo' : ''}`}>
      <button type="button" className="ag-grupo-cab" aria-expanded={abiertoEf} onClick={() => setAbierto(!abiertoEf)}>
        <span className="ag-grupo-flecha" aria-hidden="true">
          ›
        </span>
        <strong>{enCurso ? 'Trabajando' : `${pasos.length} pasos`}</strong>
        {enCurso && <span className="ag-grupo-n">{pasos.length} pasos</span>}
        <span className="ag-grupo-resumen">
          {resumen.map(([c, n]) => (
            <span key={c} className={`ag-grupo-cat cat-${c}`}>
              <IconoCategoria categoria={c} /> {n} {NOMBRE_CATEGORIA[c][n === 1 ? 0 : 1]}
            </span>
          ))}
        </span>
        {fallos > 0 && <span className="ag-grupo-fallos">{fallos === 1 ? '1 falló' : `${fallos} fallaron`}</span>}
        {enCurso && <Girando />}
      </button>
      {abiertoEf && (
        <ol className="ag-pasos">
          {ocultos > 0 && (
            <li className="ag-pasos-mas">
              <button type="button" onClick={() => setTodos(true)}>
                Ver {ocultos} {ocultos === 1 ? 'paso anterior' : 'pasos anteriores'}
              </button>
            </li>
          )}
          {pasos.slice(ocultos).map((p) => (
            <PasoVista key={p.inicio.llamada.id} paso={p} />
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Barra viva de un turno en curso: qué hace ahora (con brillo que recorre el texto), pasos y tiempo, y «Detener».
 * Tiene su propio reloj: el turno no se repinta cada segundo.
 */
export function EstadoVivo({ eventos, escribiendo, inicio, onDetener, puedeDetener }: { eventos: EventoAgente[]; escribiendo: boolean; inicio?: number; onDetener: () => void; puedeDetener: boolean }) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const a = actividadActual(eventos, escribiendo)
  const pasos = contarPasos(eventos)
  return (
    <div className="ag-vivo">
      <span className={`ag-vivo-orbe${a.categoria ? ` cat-${a.categoria}` : ''}`} aria-hidden="true">
        {a.categoria && <IconoCategoria categoria={a.categoria} />}
      </span>
      <span className="ag-vivo-texto" role="status" aria-live="polite" title={a.texto}>
        {a.texto}…
      </span>
      <span className="ag-vivo-meta">
        {pasos > 0 && `${pasos} ${pasos === 1 ? 'paso' : 'pasos'}`}
        {pasos > 0 && inicio !== undefined && ' · '}
        {inicio !== undefined && <span className="ag-vivo-reloj">{duracion(ahora - inicio)}</span>}
      </span>
      <button type="button" className="ag-vivo-detener" onClick={onDetener} disabled={!puedeDetener} title="Detener la tarea (lo ya hecho se conserva)">
        <span aria-hidden="true" className="ag-vivo-cuadro" />
        Detener
      </button>
    </div>
  )
}
