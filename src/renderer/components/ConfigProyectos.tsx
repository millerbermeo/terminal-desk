import { useMemo, useState } from 'react'
import { confirmar } from '../confirmar'
import { mensajeDe } from '../tareas/useTareas'
import { proyectosConNombreRepetido, type DatosProyectos } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoBasura, IconoBuscar, IconoCarpeta, IconoCerrar, IconoChevron, IconoCheck, IconoCopiar, IconoLapiz, IconoMas } from './Iconos'
import { ModalAgregar } from './ModalAgregar'
import { ModalEliminarGrupo } from './ModalEliminarGrupo'

const REQUIERE_CONFIRMACION = 'REQUIERE_CONFIRMACION:'

interface Props {
  datos: DatosProyectos
  onDatos: (d: DatosProyectos) => void
}

export function ConfigProyectos({ datos, onDatos }: Props) {
  const [modal, setModal] = useState(false)
  const [grupoAEliminar, setGrupoAEliminar] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Record<string, { tipo: 'ok' | 'error'; texto: string }>>({})
  const [cambiando, setCambiando] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null)
  const [filtro, setFiltro] = useState('')
  const [plegados, setPlegados] = useState<Set<string>>(new Set())
  const [copiado, setCopiado] = useState<string | null>(null)
  const repetidos = useMemo(() => proyectosConNombreRepetido(datos.proyectos), [datos.proyectos])

  const guardarNombre = async (): Promise<void> => {
    if (!editando) return
    const { id, nombre } = editando
    try {
      onDatos(await window.api.proyectos.renombrar(id, nombre))
      setEditando(null)
      setMensajes((m) => ({ ...m, [id]: { tipo: 'ok', texto: 'Nombre cambiado.' } }))
    } catch (err) {
      setMensajes((m) => ({ ...m, [id]: { tipo: 'error', texto: mensajeDe(err) } }))
    }
  }

  /** Te equivocaste de carpeta al enlazar el proyecto: se elige la correcta y se suelta el enlace de la anterior. */
  const cambiarCarpeta = async (id: string, nombre: string): Promise<void> => {
    const elegida = (await window.api.proyectos.elegirCarpetas())[0]
    if (!elegida) return
    setCambiando(id)
    setMensajes((m) => ({ ...m, [id]: { tipo: 'ok', texto: '' } }))
    try {
      let r: { datos: DatosProyectos; aviso?: string }
      try {
        r = await window.api.proyectos.cambiarCarpeta(id, elegida)
      } catch (err) {
        const m = mensajeDe(err)
        if (!m.includes(REQUIERE_CONFIRMACION)) throw err
        const sigue = await confirmar({
          titulo: 'Revisa esta carpeta antes de cambiarla',
          tono: 'aviso',
          etiqueta: 'Cambiar de todos modos',
          texto: `${m.slice(m.indexOf(REQUIERE_CONFIRMACION) + REQUIERE_CONFIRMACION.length).trim()}\n\n¿Usar esta carpeta para «${nombre}» igualmente?`
        })
        if (!sigue) return
        r = await window.api.proyectos.cambiarCarpeta(id, elegida, true)
      }
      onDatos(r.datos)
      setMensajes((m) => ({ ...m, [id]: { tipo: 'ok', texto: r.aviso ?? 'Carpeta cambiada.' } }))
    } catch (err) {
      setMensajes((m) => ({ ...m, [id]: { tipo: 'error', texto: mensajeDe(err) } }))
    } finally {
      setCambiando(null)
    }
  }
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))
  const q = filtro.trim().toLowerCase()
  const coincide = (p: (typeof datos.proyectos)[number]): boolean => !q || p.nombre.toLowerCase().includes(q) || p.ruta.toLowerCase().includes(q)

  const alternar = (clave: string): void =>
    setPlegados((s) => {
      const n = new Set(s)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })

  const copiarRuta = (id: string, ruta: string): void => {
    void navigator.clipboard.writeText(ruta).then(() => {
      setCopiado(id)
      setTimeout(() => setCopiado((c) => (c === id ? null : c)), 1400)
    })
  }

  const matiz = (t: string): number => [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)

  const lista = (grupoId: string | undefined, nombre: string, todos: typeof datos.proyectos) => {
    const proyectos = todos.filter(coincide)
    if (q && proyectos.length === 0) return null
    const clave = grupoId ?? 'sin-grupo'
    const abierto = q ? true : !plegados.has(clave)
    const h = matiz(nombre)
    return (
      <section className="pj-grupo" key={clave} style={{ ['--pj-h' as string]: h }}>
        <header className="pj-grupo-cab">
          <button className="pj-plegar" aria-expanded={abierto} onClick={() => alternar(clave)} title={abierto ? 'Contraer grupo' : 'Expandir grupo'}>
            <span className={`pj-chev${abierto ? ' abierto' : ''}`}>
              <IconoChevron />
            </span>
            <span className="pj-punto" />
            <h3>{nombre}</h3>
            <span className="pj-cuenta">{todos.length}</span>
          </button>
          {grupoId && (
            <button className="pj-btn pj-btn-peligro" title="Elimina el grupo; sus proyectos pasan a «Sin grupo»" onClick={() => setGrupoAEliminar(grupoId)}>
              <IconoBasura /> Eliminar grupo
            </button>
          )}
        </header>
        {abierto && (
          <div className="pj-rejilla">
            {proyectos.length === 0 && <EstadoVacio variante="compacto" icono={<IconoCarpeta />} titulo="Aún no hay proyectos" texto="Agrégalos con «Agregar proyectos» o arrástralos desde otro grupo." />}
            {proyectos.map((p) => {
              const edit = editando?.id === p.id
              const msg = mensajes[p.id]
              return (
                <article className={`pj-tarjeta${repetidos.has(p.id) ? ' repetido' : ''}${edit ? ' editando' : ''}`} key={p.id}>
                  <div className="pj-fila-sup">
                    <span className="pj-icono">
                      <IconoCarpeta />
                    </span>
                    <div className="pj-titulo">
                      {edit ? (
                        <input
                          className="pj-input"
                          value={editando.nombre}
                          autoFocus
                          aria-label={`Nuevo nombre de «${p.nombre}»`}
                          onChange={(e) => setEditando({ id: p.id, nombre: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void guardarNombre()
                            if (e.key === 'Escape') setEditando(null)
                          }}
                        />
                      ) : (
                        <strong title={p.nombre}>{p.nombre}</strong>
                      )}
                      <div className="pj-chips">
                        {repetidos.has(p.id) && !edit && <span className="chip chip-repetido" title="Otro proyecto tiene este mismo nombre: edítalo para distinguirlos">nombre repetido</span>}
                        {p.local && <span className="chip" title="Solo en este equipo: sin seguimiento remoto">local</span>}
                      </div>
                    </div>
                    {edit ? (
                      <div className="pj-acciones fijas">
                        <button className="pj-icon-btn ok" title="Guardar" onClick={() => void guardarNombre()} disabled={!editando.nombre.trim()}>
                          <IconoCheck />
                        </button>
                        <button className="pj-icon-btn" title="Cancelar" onClick={() => setEditando(null)}>
                          <IconoCerrar />
                        </button>
                      </div>
                    ) : (
                      <div className="pj-acciones">
                        <button className="pj-icon-btn" title="Cambiar el nombre (no se admiten repetidos)" onClick={() => setEditando({ id: p.id, nombre: p.nombre })}>
                          <IconoLapiz />
                        </button>
                        <button className="pj-icon-btn peligro" title="Quitar de la lista (no borra la carpeta)" onClick={() => void window.api.proyectos.eliminar(p.id).then(onDatos)}>
                          <IconoBasura />
                        </button>
                      </div>
                    )}
                  </div>
                  <button className="pj-ruta" title={`${p.ruta}\nClic para copiar`} onClick={() => copiarRuta(p.id, p.ruta)}>
                    <code>{p.ruta}</code>
                    <span className="pj-copiar">{copiado === p.id ? <IconoCheck /> : <IconoCopiar />}</span>
                  </button>
                  <div className="pj-fila-inf">
                    <button
                      className="pj-btn"
                      disabled={cambiando === p.id}
                      title="¿Enlazaste la carpeta equivocada? Elige la correcta: se suelta el enlace de la anterior (no borra nada de tu código)"
                      onClick={() => void cambiarCarpeta(p.id, p.nombre)}
                    >
                      {cambiando === p.id ? <span className="spinner" /> : <IconoCarpeta />} Cambiar carpeta
                    </button>
                    <label className="pj-mover" title="Mover a otro grupo">
                      <select
                        value={grupoId ?? ''}
                        aria-label={`Mover «${p.nombre}» a otro grupo`}
                        onChange={(e) => void window.api.proyectos.moverAGrupo(p.id, e.target.value || null).then(onDatos).catch((err) => setMensajes((m) => ({ ...m, [p.id]: { tipo: 'error', texto: mensajeDe(err) } })))}
                      >
                        <option value="">Sin grupo</option>
                        {datos.grupos.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nombre}
                          </option>
                        ))}
                      </select>
                      <IconoChevron />
                    </label>
                  </div>
                  {msg?.texto && (
                    <p className={msg.tipo === 'error' ? 'cfg-error' : 'pj-ok'} role={msg.tipo === 'error' ? 'alert' : 'status'}>
                      {msg.texto}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  const total = datos.proyectos.length
  const hayResultados = !q || datos.proyectos.some(coincide)

  return (
    <div className="config pj">
      <div className="pj-cab">
        <div className="pj-cab-txt">
          <h2>Proyectos</h2>
          <p>
            {total} {total === 1 ? 'proyecto' : 'proyectos'} en {datos.grupos.length} {datos.grupos.length === 1 ? 'grupo' : 'grupos'}
            {sinGrupo.length > 0 && datos.grupos.length > 0 ? ` · ${sinGrupo.length} sin grupo` : ''}
          </p>
        </div>
        <div className="pj-barra">
          <label className="pj-buscar">
            <IconoBuscar />
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por nombre o ruta…" aria-label="Buscar proyectos" />
            {filtro && (
              <button type="button" className="pj-limpiar" onClick={() => setFiltro('')} aria-label="Limpiar búsqueda">
                <IconoCerrar />
              </button>
            )}
          </label>
          {datos.grupos.length > 0 && (
            <button className="pj-btn" onClick={() => setPlegados(plegados.size ? new Set() : new Set([...datos.grupos.map((g) => g.id), 'sin-grupo']))}>
              {plegados.size ? 'Expandir todo' : 'Contraer todo'}
            </button>
          )}
          <button className="pj-btn pj-primario" onClick={() => setModal(true)}>
            <IconoMas /> Agregar proyectos
          </button>
        </div>
      </div>

      {!hayResultados && <EstadoVacio icono={<IconoBuscar />} titulo="Sin resultados" texto={`Ningún proyecto coincide con «${filtro}».`} />}
      {datos.grupos.map((g) =>
        lista(g.id, g.nombre, datos.proyectos.filter((p) => p.grupo === g.id))
      )}
      {(sinGrupo.length > 0 || datos.grupos.length === 0) && lista(undefined, 'Sin grupo', sinGrupo)}
      {grupoAEliminar && datos.grupos.some((g) => g.id === grupoAEliminar) && (
        <ModalEliminarGrupo
          grupo={datos.grupos.find((g) => g.id === grupoAEliminar)!}
          proyectos={datos.proyectos.filter((p) => p.grupo === grupoAEliminar).length}
          onEliminado={onDatos}
          onCerrar={() => setGrupoAEliminar(null)}
        />
      )}
      {modal && (
        <ModalAgregar
          datos={datos}
          onCerrar={() => setModal(false)}
          onGuardado={onDatos}
        />
      )}
    </div>
  )
}
