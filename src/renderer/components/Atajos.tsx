import { useMemo, useState } from 'react'
import { ATAJOS_DEF, teclasParaMostrar, type CategoriaAtajo, type DefAtajo } from '@shared/atajos'
import { ATAJOS as ATAJOS_TAREAS } from './tareas/AyudaAtajos'

const MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

const ORDEN: CategoriaAtajo[] = ['General', 'Ir a', 'Terminales', 'Dentro de la terminal', 'Asistente', 'Editor de archivos', 'Navegador', 'Tareas', 'Pantalla']

const NOTA: Partial<Record<CategoriaAtajo, string>> = {
  'Ir a': 'Saltan a esa sección desde cualquier sitio, también con el foco dentro de una terminal.',
  Terminales: 'Funcionan con el foco en cualquier parte, incluida la terminal: la app los intercepta antes de que lleguen al shell.',
  Asistente: 'Valen igual en el Asistente de un proyecto, el de un grupo y el general: es el mismo chat. Se usan con el foco dentro del chat.',
  Tareas: 'Solo en la pantalla Tareas.'
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Fila {
  id: string
  teclas: string[]
  accion: string
  donde?: string
}

const TAREAS: DefAtajo[] = ATAJOS_TAREAS.map((a, i) => ({ id: `tarea-${i}`, combos: [a.teclas], accion: a.accion, categoria: 'Tareas', informativo: true, mostrar: a.teclas }))

/** Vista con todos los atajos de teclado de la app (F1 o Ctrl+Mayús+K), con buscador. */
export function Atajos() {
  const [filtro, setFiltro] = useState('')
  const grupos = useMemo(() => {
    const q = norm(filtro).split(/\s+/).filter(Boolean)
    const filas = new Map<CategoriaAtajo, Fila[]>()
    for (const a of [...ATAJOS_DEF, ...TAREAS]) {
      const teclas = teclasParaMostrar(a, MAC)
      if (/^terminal-[2-9]$/.test(a.id)) continue
      const texto = norm(`${a.accion} ${a.categoria} ${a.donde ?? ''} ${teclas.join(' ')}`)
      if (!q.every((p) => texto.includes(p))) continue
      const l = filas.get(a.categoria) ?? []
      l.push({ id: a.id, teclas, accion: a.accion.startsWith('Ir a la terminal 1') ? 'Ir a la terminal N de la pestaña activa' : a.accion, ...(a.donde ? { donde: a.donde } : {}) })
      filas.set(a.categoria, l)
    }
    return ORDEN.filter((c) => filas.has(c)).map((c) => ({ categoria: c, filas: filas.get(c)! }))
  }, [filtro])

  return (
    <div className="config ancha atajos-vista">
      <div className="cfg-cab">
        <h2>Atajos de teclado</h2>
      </div>
      <p className="cfg-intro">
        Todos los atajos de Odesk Code. {MAC ? '⌘ = Cmd.' : 'En macOS, Ctrl se cambia por ⌘.'} Pulsa <kbd>F1</kbd> en cualquier momento para volver aquí, o <kbd>{MAC ? '⌘' : 'Ctrl'} + Mayús + P</kbd> para saltar entre terminales.
      </p>
      <input className="atajos-buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar un atajo o una acción…" aria-label="Buscar atajos" />
      {grupos.length === 0 && <p className="cfg-intro">Ningún atajo coincide con «{filtro}».</p>}
      {grupos.map((g) => (
        <section key={g.categoria}>
          <h3 className="cfg-subtitulo">{g.categoria}</h3>
          {NOTA[g.categoria] && <p className="cfg-nota">{NOTA[g.categoria]}</p>}
          <dl className="atajos atajos-ancho">
            {g.filas.map((f) => (
              <div key={f.id}>
                <dt>
                  {f.teclas.map((t, i) => (
                    <span key={t}>
                      {i > 0 && <span className="atajos-o"> o </span>}
                      <kbd>{t}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>
                  {f.accion}
                  {f.donde && <small className="atajos-donde"> · {f.donde}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
