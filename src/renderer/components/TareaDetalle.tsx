import { useEffect, useRef, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { PRIORIDADES, dependenciasAbiertas, type DetalleTarea, type EstadoTarea, type ItemLista, type Prioridad, type Tarea, type TipoReferencia } from '@shared/tareas'
import { NOMBRE_PRIORIDAD } from './Tareas'
import { ModalConfirmar } from './ModalConfirmar'

interface Props {
  id: string
  datos: DatosProyectos
  todas: Tarea[]
  estados: EstadoTarea[]
  onCerrar: () => void
  onEstado: (t: Tarea, estado: string) => Promise<void>
  onAbrir: (id: string) => void
  intentar: (f: () => Promise<unknown>) => Promise<boolean>
}

const fechaLocal = (ms: number): string => new Date(ms).toLocaleDateString('sv-SE')

/** Texto editable que no pierde lo que escribes si la tarea cambia por fuera (p. ej. la IA); se guarda al salir del campo. */
function useBorrador(servidor: string): [string, (v: string) => void] {
  const [v, setV] = useState(servidor)
  const previo = useRef(servidor)
  useEffect(() => {
    const anterior = previo.current // el actualizador corre después: no puede leer la referencia ya reasignada
    previo.current = servidor
    setV((actual) => (actual === anterior ? servidor : actual))
  }, [servidor])
  return [v, setV]
}

function ListaItems({ titulo, items, vacio, onMarcar, onQuitar, onAnadir }: { titulo: string; items: ItemLista[]; vacio: string; onMarcar: (i: ItemLista, hecho: boolean) => void; onQuitar: (i: ItemLista) => void; onAnadir: (texto: string) => Promise<boolean> }) {
  const [nuevo, setNuevo] = useState('')
  return (
    <section className="td-seccion">
      <h4>
        {titulo} {items.length > 0 && <span className="chip">{items.filter((i) => i.hecho).length}/{items.length}</span>}
      </h4>
      <ul className="td-items">
        {items.map((i) => (
          <li key={i.id} className={i.hecho ? 'hecho' : ''}>
            <label>
              <input type="checkbox" checked={i.hecho} onChange={(e) => onMarcar(i, e.target.checked)} /> <span>{i.texto}</span>
            </label>
            <button className="icono" onClick={() => onQuitar(i)} title="Quitar" aria-label={`Quitar «${i.texto}»`}>
              ✕
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="tareas-suave">{vacio}</li>}
      </ul>
      <form
        className="td-fila"
        onSubmit={(e) => {
          e.preventDefault()
          if (nuevo.trim()) void onAnadir(nuevo.trim()).then((ok) => ok && setNuevo(''))
        }}
      >
        <input value={nuevo} maxLength={300} onChange={(e) => setNuevo(e.target.value)} placeholder="Añadir… (Enter)" aria-label={`Añadir a ${titulo}`} />
      </form>
    </section>
  )
}

export function TareaDetalle({ id, datos, todas, estados, onCerrar, onEstado, onAbrir, intentar }: Props) {
  const [det, setDet] = useState<DetalleTarea | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const op = window.api.tareas.operar
  // El detalle (bloqueos, historial) se vuelve a pedir cada vez que cambian las tareas.
  useEffect(() => {
    let vigente = true
    op('obtener', { tarea: id })
      .then((d) => vigente && setDet(d))
      .catch(() => vigente && setDet(null))
    return () => {
      vigente = false
    }
  }, [id, todas, op])

  const t = det?.tarea
  const [titulo, setTitulo] = useBorrador(t?.titulo ?? '')
  const [descripcion, setDescripcion] = useBorrador(t?.descripcion ?? '')
  const [notas, setNotas] = useBorrador(t?.notasTecnicas ?? '')
  const [etiquetas, setEtiquetas] = useBorrador(t?.etiquetas.join(', ') ?? '')
  const [comentario, setComentario] = useState('')
  const [ref, setRef] = useState<{ tipo: TipoReferencia; titulo: string; destino: string }>({ tipo: 'enlace', titulo: '', destino: '' })

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !confirmar) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, confirmar])

  if (!det || !t) return null
  const editar = (parche: Parameters<typeof op<'editar'>>[1]['parche']): Promise<boolean> => intentar(() => op('editar', { tarea: t.id, parche }))
  const guardarTexto = (campo: 'titulo' | 'descripcion' | 'notasTecnicas', valor: string, actual: string): void => {
    if (valor.trim() === actual.trim()) return
    void editar({ [campo]: valor }).then((ok) => !ok && (campo === 'titulo' ? setTitulo(actual) : campo === 'descripcion' ? setDescripcion(actual) : setNotas(actual)))
  }
  const item = (lista: 'criterios' | 'checklist') => ({
    onMarcar: (i: ItemLista, hecho: boolean): void => void intentar(() => op('item', { tarea: t.id, lista, accion: 'marcar', itemId: i.id, hecho })),
    onQuitar: (i: ItemLista): void => void intentar(() => op('item', { tarea: t.id, lista, accion: 'quitar', itemId: i.id })),
    onAnadir: (texto: string): Promise<boolean> => intentar(() => op('item', { tarea: t.id, lista, accion: 'anadir', texto }))
  })
  const candidatas = todas.filter((x) => x.id !== t.id && !t.dependeDe.includes(x.id))
  const espera = dependenciasAbiertas(t, todas, estados)

  return (
    <div className="td-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <aside className="td" role="dialog" aria-modal="true" aria-label={`Tarea ${t.numero}`}>
        <header className="td-cab">
          <span className="tarea-num">#{t.numero}</span>
          <input className="td-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} onBlur={() => titulo.trim() && guardarTexto('titulo', titulo, t.titulo)} aria-label="Título" />
          <button className="peligro" onClick={() => setConfirmar(true)} title="Eliminar la tarea">
            Eliminar
          </button>
          <button className="icono" onClick={onCerrar} title="Cerrar (Esc)" aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="td-cuerpo">
          {espera.length > 0 && (
            <p className="td-aviso">
              Espera a:{' '}
              {espera.map((d) => (
                <button key={d.id} className="enlace" onClick={() => onAbrir(d.id)}>
                  #{d.numero} {d.titulo}
                </button>
              ))}
            </p>
          )}
          <div className="td-rejilla">
            <label>
              Estado
              <select value={t.estado} onChange={(e) => void onEstado(t, e.target.value)}>
                {estados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select value={t.prioridad} onChange={(e) => void editar({ prioridad: e.target.value as Prioridad })}>
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {NOMBRE_PRIORIDAD[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proyecto
              <select value={t.proyectoId ?? ''} onChange={(e) => void editar({ proyectoId: e.target.value || null })}>
                <option value="">Sin proyecto</option>
                {t.proyectoId && !datos.proyectos.some((p) => p.id === t.proyectoId) && <option value={t.proyectoId}>(proyecto eliminado)</option>}
                {datos.proyectos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Grupo
              <select value={t.grupoId ?? ''} onChange={(e) => void editar({ grupoId: e.target.value || null })}>
                <option value="">Sin grupo</option>
                {datos.grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vence
              <span className="td-fila">
                <input type="date" value={t.vence !== undefined ? fechaLocal(t.vence) : ''} onChange={(e) => void editar({ vence: e.target.value ? new Date(`${e.target.value}T23:59:59`).getTime() : null })} />
                {t.vence !== undefined && (
                  <button className="icono" onClick={() => void editar({ vence: null })} title="Quitar fecha" aria-label="Quitar fecha">
                    ✕
                  </button>
                )}
              </span>
            </label>
            <label>
              Etiquetas (separadas por comas)
              <input
                value={etiquetas}
                onChange={(e) => setEtiquetas(e.target.value)}
                onBlur={() => {
                  const lista = [...new Set(etiquetas.split(',').map((x) => x.trim()).filter(Boolean))]
                  if (lista.join('\n') !== t.etiquetas.join('\n')) void editar({ etiquetas: lista }).then((ok) => !ok && setEtiquetas(t.etiquetas.join(', ')))
                }}
              />
            </label>
          </div>

          <section className="td-seccion">
            <h4>Descripción</h4>
            <textarea rows={4} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} onBlur={() => guardarTexto('descripcion', descripcion, t.descripcion)} placeholder="Qué hay que hacer y por qué…" />
          </section>

          <ListaItems titulo="Criterios de aceptación" items={t.criterios} vacio="Sin criterios: define cuándo se da por terminada." {...item('criterios')} />
          <ListaItems titulo="Subtareas" items={t.checklist} vacio="Sin subtareas." {...item('checklist')} />

          <section className="td-seccion">
            <h4>Depende de</h4>
            <div className="td-chips">
              {t.dependeDe.map((d) => {
                const x = todas.find((y) => y.id === d)
                return (
                  <span key={d} className="chip">
                    {x ? (
                      <button className="enlace" onClick={() => onAbrir(x.id)}>
                        #{x.numero} {x.titulo}
                      </button>
                    ) : (
                      'tarea eliminada'
                    )}{' '}
                    <button className="icono" onClick={() => void intentar(() => op('dependencias', { tarea: t.id, dependeDe: t.dependeDe.filter((z) => z !== d) }))} aria-label="Quitar dependencia">
                      ✕
                    </button>
                  </span>
                )
              })}
              {t.dependeDe.length === 0 && <span className="tareas-suave">Ninguna.</span>}
            </div>
            {candidatas.length > 0 && (
              <select
                value=""
                aria-label="Añadir dependencia"
                onChange={(e) => e.target.value && void intentar(() => op('dependencias', { tarea: t.id, dependeDe: [...t.dependeDe, e.target.value] }))}
              >
                <option value="">Añadir dependencia…</option>
                {candidatas.map((x) => (
                  <option key={x.id} value={x.id}>
                    #{x.numero} {x.titulo}
                  </option>
                ))}
              </select>
            )}
          </section>

          <section className="td-seccion">
            <h4>Referencias</h4>
            <ul className="td-items">
              {t.referencias.map((r) => (
                <li key={r.id}>
                  <span>
                    <span className="chip">{r.tipo}</span>{' '}
                    {r.tipo === 'enlace' ? (
                      <a href={r.destino} target="_blank" rel="noreferrer">
                        {r.titulo}
                      </a>
                    ) : r.tipo === 'nota' ? (
                      <span>{r.destino}</span>
                    ) : (
                      <code>{r.destino}</code>
                    )}
                  </span>
                  <button className="icono" onClick={() => void intentar(() => op('referencia', { tarea: t.id, accion: 'quitar', referenciaId: r.id }))} aria-label="Quitar referencia">
                    ✕
                  </button>
                </li>
              ))}
              {t.referencias.length === 0 && <li className="tareas-suave">Sin referencias.</li>}
            </ul>
            <form
              className="td-fila"
              onSubmit={(e) => {
                e.preventDefault()
                if (ref.destino.trim()) void intentar(() => op('referencia', { tarea: t.id, accion: 'anadir', tipo: ref.tipo, ...(ref.titulo.trim() ? { titulo: ref.titulo.trim() } : {}), destino: ref.destino.trim() })).then((ok) => ok && setRef({ ...ref, titulo: '', destino: '' }))
              }}
            >
              <select value={ref.tipo} onChange={(e) => setRef({ ...ref, tipo: e.target.value as TipoReferencia })} aria-label="Tipo de referencia">
                <option value="enlace">Enlace</option>
                <option value="archivo">Archivo</option>
                <option value="nota">Nota</option>
              </select>
              <input value={ref.titulo} onChange={(e) => setRef({ ...ref, titulo: e.target.value })} placeholder="Título (opcional)" aria-label="Título de la referencia" />
              <input value={ref.destino} onChange={(e) => setRef({ ...ref, destino: e.target.value })} placeholder={ref.tipo === 'enlace' ? 'https://…' : ref.tipo === 'archivo' ? 'ruta/del/archivo' : 'texto'} aria-label="Destino de la referencia" />
              <button type="submit" disabled={!ref.destino.trim()}>
                Añadir
              </button>
            </form>
          </section>

          <section className="td-seccion">
            <h4>Información técnica</h4>
            <textarea rows={4} value={notas} onChange={(e) => setNotas(e.target.value)} onBlur={() => guardarTexto('notasTecnicas', notas, t.notasTecnicas)} placeholder="Archivos, enfoque, restricciones…" />
          </section>

          <section className="td-seccion">
            <h4>Comentarios ({t.comentarios.length})</h4>
            <ul className="td-comentarios">
              {t.comentarios.map((c) => (
                <li key={c.id}>
                  <span className={`chip ${c.autor === 'ia' ? 'chip-ok' : ''}`}>{c.autor === 'ia' ? '✦ IA' : 'Tú'}</span> <time className="tareas-suave">{new Date(c.fecha).toLocaleString()}</time>
                  <p>{c.texto}</p>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (comentario.trim()) void intentar(() => op('comentar', { tarea: t.id, texto: comentario.trim() })).then((ok) => ok && setComentario(''))
              }}
            >
              <textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario, decisión técnica, observación…" aria-label="Nuevo comentario" />
              <button type="submit" disabled={!comentario.trim()}>
                Comentar
              </button>
            </form>
          </section>

          <section className="td-seccion">
            <h4>Historial</h4>
            <ul className="actividad">
              {det.actividad.map((a) => (
                <li key={a.id}>
                  <span className={`chip ${a.autor === 'ia' ? 'chip-ok' : ''}`}>{a.autor === 'ia' ? '✦ IA' : 'Tú'}</span>
                  <span className="actividad-texto">
                    {a.detalle}
                    {a.motivo && <em className="tareas-suave"> — {a.motivo}</em>}
                  </span>
                  <time className="tareas-suave">{new Date(a.fecha).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
      {confirmar && (
        <ModalConfirmar
          titulo="Eliminar tarea"
          texto={`¿Eliminar #${t.numero} «${t.titulo}»? Las tareas que dependían de ella dejan de esperarla. Si solo ya no hace falta, mejor descártala con un motivo.`}
          etiqueta="Eliminar"
          onConfirmar={() => void intentar(() => op('eliminar', { tarea: t.id })).then((ok) => ok && onCerrar())}
          onCerrar={() => setConfirmar(false)}
        />
      )}
    </div>
  )
}
