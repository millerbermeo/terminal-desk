import { useMemo, useRef, useState, type ReactNode } from 'react'
import { buscar, CATEGORIAS, SECCIONES, type Seccion } from '../documentacion/contenido'
import {
  IconoActividad,
  IconoAgente,
  IconoAlerta,
  IconoApi,
  IconoArchivo,
  IconoBuscar,
  IconoCarpeta,
  IconoCerebro,
  IconoChispa,
  IconoEscudo,
  IconoEvals,
  IconoGlobo,
  IconoInfo,
  IconoLibro,
  IconoRama,
  IconoRayo,
  IconoReloj,
  IconoServidor,
  IconoTareas,
  IconoTerminal,
  IconoVentana
} from './Iconos'

const ICONOS: Record<string, () => ReactNode> = {
  actividad: IconoActividad,
  agente: IconoAgente,
  alerta: IconoAlerta,
  api: IconoApi,
  archivo: IconoArchivo,
  carpeta: IconoCarpeta,
  cerebro: IconoCerebro,
  chispa: IconoChispa,
  escudo: IconoEscudo,
  evals: IconoEvals,
  globo: IconoGlobo,
  info: IconoInfo,
  rama: IconoRama,
  rayo: IconoRayo,
  reloj: IconoReloj,
  servidor: IconoServidor,
  tareas: IconoTareas,
  terminal: IconoTerminal,
  ventana: IconoVentana
}

const Icono = ({ clave }: { clave: string }) => {
  const C = ICONOS[clave] ?? IconoLibro
  return <C />
}

/** Guía de la aplicación: qué es cada herramienta, para qué sirve y cómo se usa. */
export function Documentacion({ visible }: { visible: boolean }) {
  const [texto, setTexto] = useState('')
  const [abierta, setAbierta] = useState<string>(SECCIONES[0]!.id)
  const cuerpo = useRef<HTMLDivElement>(null)

  const encontradas = useMemo(() => buscar(texto), [texto])
  const ids = useMemo(() => new Set(encontradas.map((s) => s.id)), [encontradas])
  // Al filtrar, si la sección abierta ya no está en la lista se muestra la primera que sí.
  const seccion = (ids.has(abierta) ? SECCIONES.find((s) => s.id === abierta) : encontradas[0]) ?? null

  const ir = (id: string): void => {
    setAbierta(id)
    cuerpo.current?.scrollTo({ top: 0 })
  }

  return (
    <main className="doc" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="doc-indice">
        <div className="doc-buscar">
          <IconoBuscar />
          <input
            type="search"
            value={texto}
            placeholder="Buscar en la guía…"
            aria-label="Buscar en la guía"
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        {texto.trim() !== '' && (
          <p className="doc-resultados">
            {encontradas.length === 0
              ? 'Sin resultados'
              : `${encontradas.length} de ${SECCIONES.length} secciones`}
          </p>
        )}
        <nav>
          {CATEGORIAS.map((cat) => {
            const items = encontradas.filter((s) => s.categoria === cat)
            if (items.length === 0) return null
            return (
              <section key={cat}>
                <h4>{cat}</h4>
                <ul>
                  {items.map((s) => (
                    <li key={s.id}>
                      <button
                        className={`doc-enlace${s.id === seccion?.id ? ' activo' : ''}`}
                        onClick={() => ir(s.id)}
                        title={s.gancho}
                      >
                        <Icono clave={s.icono} />
                        <span>{s.titulo}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </nav>
      </div>

      <div className="doc-cuerpo" ref={cuerpo}>
        {seccion ? <Detalle seccion={seccion} onIr={ir} /> : <p className="doc-vacio">Nada coincide con «{texto}».</p>}
      </div>
    </main>
  )
}

function Detalle({ seccion: s, onIr }: { seccion: Seccion; onIr: (id: string) => void }) {
  const relacionadas = (s.relacionadas ?? [])
    .map((id) => SECCIONES.find((x) => x.id === id))
    .filter((x): x is Seccion => !!x)

  return (
    <article className="doc-art" key={s.id}>
      <header className="doc-cab">
        <span className="doc-icono">
          <Icono clave={s.icono} />
        </span>
        <div>
          <p className="doc-categoria">{s.categoria}</p>
          <h2>{s.titulo}</h2>
        </div>
      </header>

      <p className="doc-resumen">{s.resumen}</p>
      {s.donde && (
        <p className="doc-donde">
          <strong>Dónde está:</strong> {s.donde}
        </p>
      )}

      <section className="doc-seccion">
        <h3>Para qué sirve</h3>
        <ul className="doc-lista">
          {s.paraQue.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="doc-seccion">
        <h3>Cómo se usa</h3>
        <ol className="doc-pasos">
          {s.pasos.map((p) => (
            <li key={p.titulo}>
              <strong>{p.titulo}</strong>
              <span>{p.texto}</span>
            </li>
          ))}
        </ol>
      </section>

      {(s.bloques ?? []).map((b) => (
        <section className="doc-seccion" key={b.titulo}>
          <h3>{b.titulo}</h3>
          <ul className="doc-lista">
            {b.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ))}

      {s.atajos && s.atajos.length > 0 && (
        <section className="doc-seccion">
          <h3>Atajos</h3>
          <table className="doc-tabla">
            <tbody>
              {s.atajos.map((a) => (
                <tr key={a.tecla}>
                  <td>
                    <kbd>{a.tecla}</kbd>
                  </td>
                  <td>{a.que}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.limites && s.limites.length > 0 && (
        <section className="doc-seccion doc-limites">
          <h3>Lo que no hace</h3>
          <ul className="doc-lista">
            {s.limites.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {relacionadas.length > 0 && (
        <footer className="doc-relacionadas">
          <h3>Seguir por aquí</h3>
          <div>
            {relacionadas.map((r) => (
              <button key={r.id} className="doc-chip" onClick={() => onIr(r.id)} title={r.gancho}>
                <Icono clave={r.icono} />
                <span>{r.titulo}</span>
              </button>
            ))}
          </div>
        </footer>
      )}
    </article>
  )
}
