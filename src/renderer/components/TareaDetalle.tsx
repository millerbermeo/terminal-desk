import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { COLORES_TAREA, PRIORIDADES, dependenciasAbiertas, type DetalleTarea, type EstadoTarea, type ItemLista, type ParcheTarea, type Prioridad, type Tarea, type TipoReferencia } from '@shared/tareas'
import { progresoTarea } from '@shared/tareas-vista'
import { NOMBRE_COLOR, NOMBRE_PRIORIDAD } from './tareas/constantes'
import { Avatar } from './tareas/Selectores'
import { IconoCerrar } from './Iconos'

interface Props {
  id: string
  datos: DatosProyectos
  todas: Tarea[]
  estados: EstadoTarea[]
  etiquetasUsadas: string[]
  onCerrar: () => void
  onEstado: (t: Tarea, estado: string) => Promise<void>
  onAbrir: (id: string) => void
  /** Pasa a la tarea anterior (-1) o siguiente (+1) de la vista. */
  onNavegar: (delta: -1 | 1) => void
  onEliminar: (t: Tarea) => void
  onDuplicar: (t: Tarea) => void
  intentar: (f: () => Promise<unknown>) => Promise<boolean>
}

type Pestana = 'detalles' | 'comentarios' | 'actividad'
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

interface PropsLista {
  titulo: string
  items: ItemLista[]
  vacio: string
  onMarcar: (i: ItemLista, hecho: boolean) => void
  onQuitar: (i: ItemLista) => void
  onAnadir: (texto: string) => Promise<boolean>
  onEditar: (i: ItemLista, texto: string) => void
  onMover: (i: ItemLista, indice: number) => void
  /** Solo las subtareas se pueden convertir en una tarea propia. */
  onConvertir?: (i: ItemLista) => void
}

function ListaItems({ titulo, items, vacio, onMarcar, onQuitar, onAnadir, onEditar, onMover, onConvertir }: PropsLista) {
  const [nuevo, setNuevo] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [borrador, setBorrador] = useState('')
  const [arrastrado, setArrastrado] = useState<string | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)
  const p = progresoTarea(titulo === 'Subtareas' ? { checklist: items, criterios: [] } : { checklist: [], criterios: items })
  return (
    <section className="td-seccion">
      <h4>
        {titulo} {items.length > 0 && <span className="chip">{p.hechos}/{p.total}</span>}
      </h4>
      {items.length > 0 && (
        <div className="td-progreso" aria-hidden="true">
          <span className="barra-prog"><span style={{ width: `${p.pct}%` }} className={p.pct === 100 ? 'completa' : ''} /></span>
        </div>
      )}
      <ul className="td-items">
        {items.map((i, n) => (
          <li
            key={i.id}
            className={`${i.hecho ? 'hecho' : ''}${sobre === n && arrastrado !== i.id ? ' destino' : ''}`}
            draggable={editando !== i.id}
            onDragStart={(e) => {
              setArrastrado(i.id)
              e.dataTransfer.setData('text/plain', `item:${i.id}`)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!arrastrado) return
              e.preventDefault()
              setSobre(n)
            }}
            onDragEnd={() => {
              setArrastrado(null)
              setSobre(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const origen = items.find((x) => x.id === arrastrado)
              setArrastrado(null)
              setSobre(null)
              if (origen && origen.id !== i.id) onMover(origen, n)
            }}
          >
            <span className="td-asa" aria-hidden="true" title="Arrastra para reordenar">⋮⋮</span>
            {editando === i.id ? (
              <input
                autoFocus
                value={borrador}
                maxLength={300}
                aria-label="Editar texto"
                onChange={(e) => setBorrador(e.target.value)}
                onBlur={() => {
                  setEditando(null)
                  if (borrador.trim() && borrador.trim() !== i.texto) onEditar(i, borrador.trim())
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setBorrador(i.texto)
                    setEditando(null)
                  }
                }}
              />
            ) : (
              <label>
                <input type="checkbox" checked={i.hecho} onChange={(e) => onMarcar(i, e.target.checked)} />{' '}
                <span
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    setBorrador(i.texto)
                    setEditando(i.id)
                  }}
                  title="Doble clic para editar"
                >
                  {i.texto}
                </span>
              </label>
            )}
            {onConvertir && (
              <button className="icono" onClick={() => onConvertir(i)} title="Convertir en tarea" aria-label={`Convertir «${i.texto}» en tarea`}>
                ↗
              </button>
            )}
            <button className="icono" onClick={() => onQuitar(i)} title="Quitar" aria-label={`Quitar «${i.texto}»`}>
              <IconoCerrar />
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

/** Una fila de propiedad al estilo ClickUp: nombre a la izquierda, valor editable a la derecha. */
function Propiedad({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="td-prop">
      <span className="td-prop-nombre">{nombre}</span>
      <div className="td-prop-valor">{children}</div>
    </div>
  )
}

export function TareaDetalle({ id, datos, todas, estados, etiquetasUsadas, onCerrar, onEstado, onAbrir, onNavegar, onEliminar, onDuplicar, intentar }: Props) {
  const [det, setDet] = useState<DetalleTarea | null>(null)
  const [pestana, setPestana] = useState<Pestana>('detalles')
  const [guardado, setGuardado] = useState<'' | 'guardando' | 'ok' | 'error'>('')
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
  useEffect(() => setPestana('detalles'), [id])

  const t = det?.tarea
  const [titulo, setTitulo] = useBorrador(t?.titulo ?? '')
  const [descripcion, setDescripcion] = useBorrador(t?.descripcion ?? '')
  const [notas, setNotas] = useBorrador(t?.notasTecnicas ?? '')
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('')
  const [comentario, setComentario] = useState('')
  const [ref, setRef] = useState<{ tipo: TipoReferencia; titulo: string; destino: string }>({ tipo: 'enlace', titulo: '', destino: '' })
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.modal-fondo, .emg')) {
        const activo = document.activeElement as HTMLElement | null
        // Si estás escribiendo, primero se guarda (el campo pierde el foco) y luego se cierra.
        if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA' || activo.tagName === 'SELECT')) {
          activo.blur()
          setTimeout(onCerrar, 0)
        } else onCerrar()
      }
      if (e.altKey && e.key === 'ArrowLeft') onNavegar(-1)
      if (e.altKey && e.key === 'ArrowRight') onNavegar(1)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, onNavegar])

  const hitos = useMemo(() => [...new Set(todas.map((x) => x.hito).filter((h): h is string => !!h))].sort(), [todas])

  if (!det || !t) return null

  /** Ejecuta un cambio y muestra «Guardado ✓» (o el error). */
  const guardar = async (f: () => Promise<unknown>): Promise<boolean> => {
    clearTimeout(temporizador.current)
    setGuardado('guardando')
    const ok = await intentar(f)
    setGuardado(ok ? 'ok' : 'error')
    temporizador.current = setTimeout(() => setGuardado(''), 2500)
    return ok
  }
  const editar = (parche: ParcheTarea): Promise<boolean> => guardar(() => op('editar', { tarea: t.id, parche }))
  const guardarTexto = (campo: 'titulo' | 'descripcion' | 'notasTecnicas', valor: string, actual: string): void => {
    if (valor.trim() === actual.trim()) return
    void editar({ [campo]: valor }).then((ok) => !ok && (campo === 'titulo' ? setTitulo(actual) : campo === 'descripcion' ? setDescripcion(actual) : setNotas(actual)))
  }
  const item = (lista: 'criterios' | 'checklist') => ({
    onMarcar: (i: ItemLista, hecho: boolean): void => void guardar(() => op('item', { tarea: t.id, lista, accion: 'marcar', itemId: i.id, hecho })),
    onQuitar: (i: ItemLista): void => void guardar(() => op('item', { tarea: t.id, lista, accion: 'quitar', itemId: i.id })),
    onAnadir: (texto: string): Promise<boolean> => guardar(() => op('item', { tarea: t.id, lista, accion: 'anadir', texto })),
    onEditar: (i: ItemLista, texto: string): void => void guardar(() => op('item', { tarea: t.id, lista, accion: 'editar', itemId: i.id, texto })),
    onMover: (i: ItemLista, indice: number): void => void guardar(() => op('item', { tarea: t.id, lista, accion: 'mover', itemId: i.id, indice }))
  })
  const convertir = (i: ItemLista): void =>
    void guardar(async () => {
      await op('crear', { titulo: i.texto, ...(t.proyectoId ? { proyectoId: t.proyectoId } : {}), ...(t.grupoId ? { grupoId: t.grupoId } : {}), prioridad: t.prioridad })
      await op('item', { tarea: t.id, lista: 'checklist', accion: 'quitar', itemId: i.id })
    })
  const anadirEtiqueta = (): void => {
    const e = nuevaEtiqueta.trim()
    setNuevaEtiqueta('')
    if (e && !t.etiquetas.includes(e)) void editar({ etiquetas: [...t.etiquetas, e] })
  }
  const candidatas = todas.filter((x) => x.id !== t.id && !t.dependeDe.includes(x.id))
  const espera = dependenciasAbiertas(t, todas, estados)
  const estadoActual = estados.find((e) => e.id === t.estado)
  const progreso = progresoTarea(t)

  return (
    <div className="td-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <aside className="td" role="dialog" aria-modal="true" aria-label={`Tarea ${t.numero}`}>
        <header className="td-cab">
          <span className="tarea-num">#{t.numero}</span>
          <div className="td-nav">
            <button className="icono" onClick={() => onNavegar(-1)} title="Tarea anterior (Alt+←)" aria-label="Tarea anterior">‹</button>
            <button className="icono" onClick={() => onNavegar(1)} title="Tarea siguiente (Alt+→)" aria-label="Tarea siguiente">›</button>
          </div>
          <span className={`td-guardado ${guardado}`} role="status" aria-live="polite">
            {guardado === 'guardando' ? 'Guardando…' : guardado === 'ok' ? 'Guardado ✓' : guardado === 'error' ? 'No se guardó' : ''}
          </span>
          <span className="ag-espacio" />
          <button onClick={() => onDuplicar(t)} title="Duplicar la tarea">Duplicar</button>
          <button className="peligro" onClick={() => onEliminar(t)} title="Eliminar la tarea">
            Eliminar
          </button>
          <button className="icono" onClick={onCerrar} title="Cerrar (Esc)" aria-label="Cerrar">
            <IconoCerrar />
          </button>
        </header>
        <div className="td-titular">
          <input className="td-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} onBlur={() => titulo.trim() && guardarTexto('titulo', titulo, t.titulo)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Título" />
          <div className="td-resumen-chips">
            <select className={`chip cat-${estadoActual?.categoria}`} value={t.estado} onChange={(e) => void onEstado(t, e.target.value)} aria-label="Estado">
              {estados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            {progreso.total > 0 && (
              <span className="td-progreso-mini" title={`${progreso.hechos} de ${progreso.total}`}>
                <span className="barra-prog"><span style={{ width: `${progreso.pct}%` }} className={progreso.pct === 100 ? 'completa' : ''} /></span>
                <small>{progreso.pct}%</small>
              </span>
            )}
          </div>
        </div>
        <div className="td-pestanas" role="tablist">
          {(['detalles', 'comentarios', 'actividad'] as const).map((p) => (
            <button key={p} role="tab" aria-selected={pestana === p} className={pestana === p ? 'on' : ''} onClick={() => setPestana(p)}>
              {p === 'detalles' ? 'Detalles' : p === 'comentarios' ? `Comentarios (${t.comentarios.length})` : 'Actividad'}
            </button>
          ))}
        </div>
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

          {pestana === 'detalles' && (
            <div className="td-grid">
              <div className="td-principal">
                <section className="td-seccion">
                  <h4>Descripción</h4>
                  <textarea rows={5} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} onBlur={() => guardarTexto('descripcion', descripcion, t.descripcion)} placeholder="Qué hay que hacer y por qué…" />
                </section>

                <ListaItems titulo="Subtareas" items={t.checklist} vacio="Sin subtareas." onConvertir={convertir} {...item('checklist')} />
                <ListaItems titulo="Criterios de aceptación" items={t.criterios} vacio="Sin criterios: define cuándo se da por terminada." {...item('criterios')} />

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
                          <button className="icono" onClick={() => void guardar(() => op('dependencias', { tarea: t.id, dependeDe: t.dependeDe.filter((z) => z !== d) }))} aria-label="Quitar dependencia">
                            <IconoCerrar />
                          </button>
                        </span>
                      )
                    })}
                    {t.dependeDe.length === 0 && <span className="tareas-suave">Ninguna.</span>}
                  </div>
                  {det.bloquea.length > 0 && (
                    <p className="tareas-suave">
                      Bloquea a:{' '}
                      {det.bloquea.map((b) => (
                        <button key={b.id} className="enlace" onClick={() => onAbrir(b.id)}>
                          #{b.numero} {b.titulo}
                        </button>
                      ))}
                    </p>
                  )}
                  {candidatas.length > 0 && (
                    <select value="" aria-label="Añadir dependencia" onChange={(e) => e.target.value && void guardar(() => op('dependencias', { tarea: t.id, dependeDe: [...t.dependeDe, e.target.value] }))}>
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
                        <button className="icono" onClick={() => void guardar(() => op('referencia', { tarea: t.id, accion: 'quitar', referenciaId: r.id }))} aria-label="Quitar referencia">
                          <IconoCerrar />
                        </button>
                      </li>
                    ))}
                    {t.referencias.length === 0 && <li className="tareas-suave">Sin referencias.</li>}
                  </ul>
                  <form
                    className="td-fila"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (ref.destino.trim()) void guardar(() => op('referencia', { tarea: t.id, accion: 'anadir', tipo: ref.tipo, ...(ref.titulo.trim() ? { titulo: ref.titulo.trim() } : {}), destino: ref.destino.trim() })).then((ok) => ok && setRef({ ...ref, titulo: '', destino: '' }))
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
              </div>

              <div className="td-props" aria-label="Propiedades">
                <Propiedad nombre="Responsable">
                  <span className="td-fila">
                    <Avatar {...(t.responsable ? { responsable: t.responsable } : {})} />
                    <select value={t.responsable ?? ''} onChange={(e) => void editar({ responsable: (e.target.value || null) as 'usuario' | 'ia' | null })} aria-label="Responsable">
                      <option value="">Sin asignar</option>
                      <option value="usuario">Yo</option>
                      <option value="ia">IA (Asistente)</option>
                    </select>
                  </span>
                </Propiedad>
                <Propiedad nombre="Prioridad">
                  <select value={t.prioridad} onChange={(e) => void editar({ prioridad: e.target.value as Prioridad })} aria-label="Prioridad">
                    {PRIORIDADES.map((p) => (
                      <option key={p} value={p}>
                        {NOMBRE_PRIORIDAD[p]}
                      </option>
                    ))}
                  </select>
                </Propiedad>
                <Propiedad nombre="Inicio">
                  <span className="td-fila">
                    <input type="date" value={t.inicio !== undefined ? fechaLocal(t.inicio) : ''} onChange={(e) => void editar({ inicio: e.target.value ? new Date(`${e.target.value}T00:00:00`).getTime() : null })} aria-label="Fecha de inicio" />
                    {t.inicio !== undefined && (
                      <button className="icono" onClick={() => void editar({ inicio: null })} title="Quitar fecha" aria-label="Quitar fecha de inicio">
                        <IconoCerrar />
                      </button>
                    )}
                  </span>
                </Propiedad>
                <Propiedad nombre="Vence">
                  <span className="td-fila">
                    <input type="date" value={t.vence !== undefined ? fechaLocal(t.vence) : ''} onChange={(e) => void editar({ vence: e.target.value ? new Date(`${e.target.value}T23:59:59`).getTime() : null })} aria-label="Fecha de vencimiento" />
                    {t.vence !== undefined && (
                      <button className="icono" onClick={() => void editar({ vence: null })} title="Quitar fecha" aria-label="Quitar fecha de vencimiento">
                        <IconoCerrar />
                      </button>
                    )}
                  </span>
                </Propiedad>
                <Propiedad nombre="Estimación">
                  <input
                    key={`est-${t.estimacion ?? ''}`}
                    type="number"
                    min={0}
                    max={999}
                    step="0.5"
                    defaultValue={t.estimacion ?? ''}
                    placeholder="puntos"
                    aria-label="Estimación en puntos"
                    onBlur={(e) => {
                      const n = e.target.value.trim() === '' ? null : Number(e.target.value)
                      if (n !== null && !Number.isFinite(n)) return
                      if ((n ?? undefined) !== t.estimacion) void editar({ estimacion: n })
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </Propiedad>
                <Propiedad nombre="Hito">
                  <input
                    key={`hito-${t.hito ?? ''}`}
                    list="td-hitos"
                    maxLength={60}
                    defaultValue={t.hito ?? ''}
                    placeholder="sprint, versión…"
                    aria-label="Hito"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v !== (t.hito ?? '')) void editar({ hito: v || null })
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <datalist id="td-hitos">{hitos.map((h) => <option key={h} value={h} />)}</datalist>
                </Propiedad>
                <Propiedad nombre="Proyecto">
                  <select value={t.proyectoId ?? ''} onChange={(e) => void editar({ proyectoId: e.target.value || null })} aria-label="Proyecto">
                    <option value="">Sin proyecto</option>
                    {t.proyectoId && !datos.proyectos.some((p) => p.id === t.proyectoId) && <option value={t.proyectoId}>(proyecto eliminado)</option>}
                    {datos.proyectos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </Propiedad>
                <Propiedad nombre="Grupo">
                  <select value={t.grupoId ?? ''} onChange={(e) => void editar({ grupoId: e.target.value || null })} aria-label="Grupo">
                    <option value="">Sin grupo</option>
                    {datos.grupos.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nombre}
                      </option>
                    ))}
                  </select>
                </Propiedad>
                <Propiedad nombre="Etiquetas">
                  <div className="td-chips">
                    {t.etiquetas.map((e) => (
                      <span key={e} className="chip etiqueta">
                        {e}{' '}
                        <button className="icono" onClick={() => void editar({ etiquetas: t.etiquetas.filter((x) => x !== e) })} aria-label={`Quitar etiqueta ${e}`}>
                          <IconoCerrar />
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    list="td-etiquetas"
                    value={nuevaEtiqueta}
                    maxLength={30}
                    placeholder="Añadir etiqueta… (Enter)"
                    aria-label="Añadir etiqueta"
                    onChange={(e) => setNuevaEtiqueta(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        anadirEtiqueta()
                      }
                    }}
                  />
                  <datalist id="td-etiquetas">{etiquetasUsadas.filter((e) => !t.etiquetas.includes(e)).map((e) => <option key={e} value={e} />)}</datalist>
                </Propiedad>
                <Propiedad nombre="Color">
                  <span className="td-colores" role="radiogroup" aria-label="Color de la tarjeta">
                    <button type="button" role="radio" aria-checked={!t.color} className={`td-color sin-color${!t.color ? ' on' : ''}`} onClick={() => void editar({ color: null })} title="Sin color" aria-label="Sin color" />
                    {COLORES_TAREA.map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={t.color === c} className={`td-color color-${c}${t.color === c ? ' on' : ''}`} onClick={() => void editar({ color: c })} title={NOMBRE_COLOR[c]} aria-label={NOMBRE_COLOR[c]} />
                    ))}
                  </span>
                </Propiedad>
                <p className="tareas-suave td-meta">
                  Creada {new Date(t.creada).toLocaleDateString()} · actualizada {new Date(t.actualizada).toLocaleString()}
                  {t.completada ? ` · terminada ${new Date(t.completada).toLocaleDateString()}` : ''}
                </p>
              </div>
            </div>
          )}

          {pestana === 'comentarios' && (
            <section className="td-seccion">
              <ul className="td-comentarios">
                {t.comentarios.map((c) => (
                  <li key={c.id}>
                    <span className={`chip ${c.autor === 'ia' ? 'chip-ok' : ''}`}>{c.autor === 'ia' ? '✦ IA' : 'Tú'}</span> <time className="tareas-suave">{new Date(c.fecha).toLocaleString()}</time>
                    <p>{c.texto}</p>
                  </li>
                ))}
                {t.comentarios.length === 0 && <li className="tareas-suave">Aún no hay comentarios.</li>}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (comentario.trim()) void guardar(() => op('comentar', { tarea: t.id, texto: comentario.trim() })).then((ok) => ok && setComentario(''))
                }}
              >
                <textarea
                  rows={3}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && comentario.trim()) {
                      e.preventDefault()
                      void guardar(() => op('comentar', { tarea: t.id, texto: comentario.trim() })).then((ok) => ok && setComentario(''))
                    }
                  }}
                  placeholder="Comentario, decisión técnica, observación…  (Ctrl+Enter envía)"
                  aria-label="Nuevo comentario"
                />
                <button type="submit" className="primario" disabled={!comentario.trim()}>
                  Comentar
                </button>
              </form>
            </section>
          )}

          {pestana === 'actividad' && (
            <section className="td-seccion">
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
          )}
        </div>
      </aside>
    </div>
  )
}
