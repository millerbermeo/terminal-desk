import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { BibliotecaAgentes, DatosProyectos, Recurso, TipoRecurso } from '@shared/modelos'
import { activosDe } from '@shared/agentes'
import { EstadoVacio } from './EstadoVacio'
import { IconoAgente, IconoBasura, IconoBuscar, IconoCarpeta, IconoChevron, IconoChispa, IconoLapiz, IconoMas, IconoRayo } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'
import { ModalRecurso } from './ModalRecurso'

interface Props {
  datos: DatosProyectos
  biblioteca: BibliotecaAgentes
  onBiblioteca: (b: BibliotecaAgentes) => void
}

type Destino = { tipo: 'grupo' | 'proyecto'; id: string }
type FiltroTipo = 'todos' | TipoRecurso
type FiltroAmbito = 'todos' | 'compartido' | 'proyecto'

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`
const coincide = (r: Recurso, palabras: string[]): boolean => {
  if (!palabras.length) return true
  const texto = sinAcentos([r.nombre, r.descripcion, r.modelo, r.herramientas?.join(' '), r.contenido].filter(Boolean).join(' '))
  return palabras.every((w) => texto.includes(w))
}

/** Icono con fondo de color según el tipo: el agente en índigo, la skill en violeta. */
const Ficha = ({ tipo, chica }: { tipo: TipoRecurso; chica?: boolean }) => (
  <span className={`ak-ficha ak-${tipo}${chica ? ' chica' : ''}`} aria-hidden>
    {tipo === 'agente' ? <IconoAgente /> : <IconoChispa />}
  </span>
)

function Segmentos<T extends string>({ valor, opciones, onCambio, etiqueta }: { valor: T; opciones: { v: T; t: ReactNode }[]; onCambio: (v: T) => void; etiqueta: string }) {
  return (
    <div className="segmentado ak-seg" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.v} role="tab" aria-selected={valor === o.v} className={valor === o.v ? 'on' : ''} onClick={() => onCambio(o.v)}>
          {o.t}
        </button>
      ))}
    </div>
  )
}

export function ConfigAgentes({ datos, biblioteca, onBiblioteca }: Props) {
  const [pestana, setPestana] = useState<'biblioteca' | 'activacion'>('biblioteca')
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos')
  const [filtroAmbito, setFiltroAmbito] = useState<FiltroAmbito>('todos')
  const [buscaDestino, setBuscaDestino] = useState('')
  const [buscaActivos, setBuscaActivos] = useState('')
  const [plegados, setPlegados] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ tipo: TipoRecurso; inicial?: Recurso } | null>(null)
  const [porEliminar, setPorEliminar] = useState<Recurso | null>(null)
  const [destino, setDestino] = useState<Destino | null>(
    datos.grupos[0] ? { tipo: 'grupo', id: datos.grupos[0].id } : datos.proyectos[0] ? { tipo: 'proyecto', id: datos.proyectos[0].id } : null
  )
  const refBusca = useRef<HTMLInputElement>(null)

  // «/» enfoca el buscador de la biblioteca (como en la mayoría de apps de escritorio)
  useEffect(() => {
    const tecla = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== '/' || pestana !== 'biblioteca' || modal) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      refBusca.current?.focus()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [pestana, modal])

  const nombreProyecto = (id?: string): string => datos.proyectos.find((p) => p.id === id)?.nombre ?? 'proyecto eliminado'
  const recursos = biblioteca.recursos
  const nAgentes = recursos.filter((r) => r.tipo === 'agente').length
  const nSkills = recursos.length - nAgentes
  const nCompartidos = recursos.filter((r) => r.ambito === 'compartido').length

  // En cuántos grupos y proyectos está activo cada recurso compartido
  const usos = useMemo(() => {
    const m = new Map<string, { grupos: number; proyectos: number }>()
    const sumar = (ids: string[] | undefined, k: 'grupos' | 'proyectos'): void =>
      (ids ?? []).forEach((id) => {
        const u = m.get(id) ?? { grupos: 0, proyectos: 0 }
        u[k]++
        m.set(id, u)
      })
    Object.values(biblioteca.activaciones.grupos).forEach((ids) => sumar(ids, 'grupos'))
    Object.values(biblioteca.activaciones.proyectos).forEach((ids) => sumar(ids, 'proyectos'))
    return m
  }, [biblioteca.activaciones])
  const totalActivaciones = [...usos.values()].reduce((s, u) => s + u.grupos + u.proyectos, 0)

  // ------------------------------------------------------------ biblioteca
  const palabras = sinAcentos(busca).split(/\s+/).filter(Boolean)
  const filtrados = recursos.filter(
    (r) => (filtroTipo === 'todos' || r.tipo === filtroTipo) && (filtroAmbito === 'todos' || r.ambito === filtroAmbito) && coincide(r, palabras)
  )
  const hayFiltro = palabras.length > 0 || filtroTipo !== 'todos' || filtroAmbito !== 'todos'
  const limpiarFiltros = (): void => {
    setBusca('')
    setFiltroTipo('todos')
    setFiltroAmbito('todos')
  }

  const tarjeta = (r: Recurso) => {
    const u = usos.get(r.id)
    const activo = r.ambito === 'proyecto' ? 'Siempre activo en su proyecto' : u ? `Activo en ${[u.grupos && plural(u.grupos, 'grupo', 'grupos'), u.proyectos && plural(u.proyectos, 'proyecto', 'proyectos')].filter(Boolean).join(' y ')}` : 'Sin activar'
    const editar = (): void => setModal({ tipo: r.tipo, inicial: r })
    return (
      <article
        key={r.id}
        className="ak-tarjeta"
        tabIndex={0}
        role="button"
        aria-label={`Editar ${r.nombre}`}
        onClick={editar}
        onKeyDown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), editar())}
      >
        <header className="ak-tarjeta-cab">
          <Ficha tipo={r.tipo} />
          <div className="ak-tarjeta-tit">
            <strong className="mono" title={r.nombre}>{r.nombre}</strong>
            <span className="ak-tipo">{r.tipo === 'agente' ? 'Subagente' : 'Skill'}</span>
          </div>
          <div className="ak-acciones" onClick={(e) => e.stopPropagation()}>
            <button className="icono" title="Editar" aria-label={`Editar ${r.nombre}`} onClick={editar}>
              <IconoLapiz />
            </button>
            <button className="icono peligro" title="Eliminar" aria-label={`Eliminar ${r.nombre}`} onClick={() => setPorEliminar(r)}>
              <IconoBasura />
            </button>
          </div>
        </header>
        <p className={`ak-desc${r.descripcion ? '' : ' vacia'}`}>{r.descripcion || 'Sin descripción: añade cuándo debe usarlo Claude.'}</p>
        <footer className="ak-meta">
          <span className={`ak-ambito ${r.ambito}`} title={r.ambito === 'proyecto' ? 'Solo se carga en este proyecto' : 'Se activa por grupo o proyecto'}>
            {r.ambito === 'compartido' ? 'Compartido' : nombreProyecto(r.proyectoId)}
          </span>
          {r.tipo === 'agente' && r.modelo && <span className="chip">{r.modelo}</span>}
          {r.tipo === 'agente' && (
            <span className="chip" title={r.herramientas?.length ? r.herramientas.join(', ') : 'Todas las herramientas de la sesión'}>
              {r.herramientas?.length ? plural(r.herramientas.length, 'herramienta', 'herramientas') : 'Todas las herramientas'}
            </span>
          )}
          <span className={`ak-uso${u || r.ambito === 'proyecto' ? ' on' : ''}`}>
            <i aria-hidden /> {activo}
          </span>
        </footer>
      </article>
    )
  }

  const nueva = (tipo: TipoRecurso) => (
    <button key={`nueva-${tipo}`} className="ak-tarjeta ak-nueva" onClick={() => setModal({ tipo })}>
      <span className="ak-nueva-mas"><IconoMas /></span>
      <strong>{tipo === 'agente' ? 'Nuevo subagente' : 'Nueva skill'}</strong>
      <span>{tipo === 'agente' ? 'Un especialista al que Claude delega' : 'Instrucciones que Claude carga al necesitarlas'}</span>
    </button>
  )

  const seccionBiblioteca = (tipo: TipoRecurso) => {
    const lista = filtrados.filter((r) => r.tipo === tipo)
    const todos = recursos.filter((r) => r.tipo === tipo)
    if (hayFiltro && lista.length === 0 && filtroTipo === 'todos') return null
    return (
      <section className="ak-seccion" key={tipo}>
        <div className="ak-seccion-cab">
          <Ficha tipo={tipo} chica />
          <h3>{tipo === 'agente' ? 'Subagentes' : 'Skills'}</h3>
          <span className="contador">{hayFiltro ? `${lista.length} de ${todos.length}` : todos.length}</span>
          <p>{tipo === 'agente' ? 'Especialistas (revisor, tester…) a los que Claude delega una tarea completa.' : 'Instrucciones que Claude carga solo cuando la tarea las necesita.'}</p>
        </div>
        {todos.length === 0 && !hayFiltro ? (
          <div className="ak-rejilla">{nueva(tipo)}</div>
        ) : lista.length === 0 ? (
          <EstadoVacio variante="compacto" icono={<IconoBuscar />} titulo="Sin coincidencias" texto="Prueba con otras palabras o quita los filtros." />
        ) : (
          <div className="ak-rejilla">
            {lista.map(tarjeta)}
            {!hayFiltro && nueva(tipo)}
          </div>
        )}
      </section>
    )
  }

  const vistaBiblioteca = (
    <>
      <div className="ak-herramientas">
        <div className="buscar ak-buscar">
          <IconoBuscar />
          <input
            ref={refBusca}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setBusca(''), e.currentTarget.blur())}
            placeholder="Buscar por nombre, descripción, modelo o contenido…"
            aria-label="Buscar en la biblioteca"
            spellCheck={false}
          />
          {!busca && <kbd className="ak-atajo">/</kbd>}
        </div>
        <Segmentos
          etiqueta="Tipo"
          valor={filtroTipo}
          onCambio={setFiltroTipo}
          opciones={[
            { v: 'todos', t: <>Todos <span className="contador">{recursos.length}</span></> },
            { v: 'agente', t: <>Subagentes <span className="contador">{nAgentes}</span></> },
            { v: 'skill', t: <>Skills <span className="contador">{nSkills}</span></> }
          ]}
        />
        <Segmentos
          etiqueta="Ámbito"
          valor={filtroAmbito}
          onCambio={setFiltroAmbito}
          opciones={[
            { v: 'todos', t: 'Cualquier ámbito' },
            { v: 'compartido', t: 'Compartidos' },
            { v: 'proyecto', t: 'De un proyecto' }
          ]}
        />
        {hayFiltro && (
          <button className="ak-limpiar" onClick={limpiarFiltros}>
            Quitar filtros
          </button>
        )}
      </div>
      {recursos.length === 0 ? (
        <div className="ak-inicio">
          <EstadoVacio
            icono={<IconoAgente />}
            titulo="Tu biblioteca está vacía"
            texto="Crea subagentes y skills una vez y actívalos en los grupos o proyectos donde los quieras."
            accion={
              <div className="ak-inicio-acc">
                <button className="primario" onClick={() => setModal({ tipo: 'agente' })}>
                  <IconoMas /> Subagente
                </button>
                <button onClick={() => setModal({ tipo: 'skill' })}>
                  <IconoMas /> Skill
                </button>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {filtroTipo !== 'skill' && seccionBiblioteca('agente')}
          {filtroTipo !== 'agente' && seccionBiblioteca('skill')}
          {hayFiltro && filtrados.length === 0 && filtroTipo === 'todos' && (
            <EstadoVacio
              icono={<IconoBuscar />}
              titulo="Sin coincidencias"
              texto={palabras.length ? `Nada coincide con «${busca.trim()}».` : 'Ningún recurso cumple estos filtros.'}
              accion={<button onClick={limpiarFiltros}>Quitar filtros</button>}
            />
          )}
        </>
      )}
    </>
  )

  // ------------------------------------------------------------ activación
  const activar = async (ids: string[], activo: boolean): Promise<void> => {
    if (!destino || !ids.length) return
    setOcupado((s) => new Set([...s, ...ids]))
    try {
      let ultima: BibliotecaAgentes | undefined
      for (const id of ids) ultima = await window.api.agentes.activar(destino, id, activo)
      if (ultima) onBiblioteca(ultima)
    } finally {
      setOcupado((s) => {
        const n = new Set(s)
        ids.forEach((id) => n.delete(id))
        return n
      })
    }
  }

  const cuentaDestino = (d: Destino): number => (d.tipo === 'grupo' ? biblioteca.activaciones.grupos[d.id] : biblioteca.activaciones.proyectos[d.id])?.length ?? 0

  const panelActivacion = () => {
    if (!destino) return <EstadoVacio icono={<IconoCarpeta />} titulo="Agrega proyectos" texto="Los subagentes y skills se activan por grupo o por proyecto." />
    const proyecto = destino.tipo === 'proyecto' ? datos.proyectos.find((p) => p.id === destino.id) : undefined
    const grupo = datos.grupos.find((g) => g.id === (destino.tipo === 'grupo' ? destino.id : proyecto?.grupo))
    const compartidos = recursos.filter((r) => r.ambito === 'compartido')
    const enGrupo = new Set((grupo && biblioteca.activaciones.grupos[grupo.id]) || [])
    const enProyecto = new Set((proyecto && biblioteca.activaciones.proyectos[proyecto.id]) || [])
    const individuales = proyecto ? recursos.filter((r) => r.ambito === 'proyecto' && r.proyectoId === proyecto.id) : []
    const resumen = proyecto ? activosDe(biblioteca, proyecto) : compartidos.filter((r) => enGrupo.has(r.id)).map((recurso) => ({ recurso }))
    const cargaAgentes = resumen.filter((a) => a.recurso.tipo === 'agente').length
    const cargaSkills = resumen.length - cargaAgentes
    const pal = sinAcentos(buscaActivos).split(/\s+/).filter(Boolean)
    const propio = (r: Recurso): boolean => (destino.tipo === 'grupo' ? enGrupo.has(r.id) : enProyecto.has(r.id))

    const fila = (r: Recurso) => {
      const heredado = destino.tipo === 'proyecto' && enGrupo.has(r.id)
      const marcado = heredado || propio(r)
      const espera = ocupado.has(r.id)
      return (
        <label key={r.id} className={`ak-fila${marcado ? ' on' : ''}${heredado ? ' heredado' : ''}${espera ? ' espera' : ''}`}>
          <Ficha tipo={r.tipo} chica />
          <span className="ak-fila-txt">
            <strong className="mono">{r.nombre}</strong>
            <span title={r.descripcion}>{r.descripcion || 'Sin descripción'}</span>
          </span>
          {heredado && (
            <span className="ak-heredado" title="Para quitarlo, desactívalo en el grupo">
              Por el grupo «{grupo?.nombre}»
            </span>
          )}
          <span className={`interruptor${heredado ? ' bloqueado' : ''}`}>
            <input type="checkbox" checked={marcado} disabled={heredado || espera} onChange={(e) => void activar([r.id], e.target.checked)} aria-label={`Activar ${r.nombre}`} />
            <span />
          </span>
        </label>
      )
    }

    const bloque = (tipo: TipoRecurso) => {
      const todos = compartidos.filter((r) => r.tipo === tipo)
      const lista = todos.filter((r) => coincide(r, pal))
      const editables = lista.filter((r) => !(destino.tipo === 'proyecto' && enGrupo.has(r.id)))
      const apagados = editables.filter((r) => !propio(r)).map((r) => r.id)
      const encendidos = editables.filter(propio).map((r) => r.id)
      return (
        <section className="ak-bloque" key={tipo}>
          <div className="ak-bloque-cab">
            <Ficha tipo={tipo} chica />
            <h4>{tipo === 'agente' ? 'Subagentes compartidos' : 'Skills compartidas'}</h4>
            <span className="contador">{todos.length}</span>
            <span className="ag-espacio" />
            {editables.length > 0 && (
              <>
                <button className="ak-mini" disabled={!apagados.length} onClick={() => void activar(apagados, true)}>
                  Activar todos
                </button>
                <button className="ak-mini" disabled={!encendidos.length} onClick={() => void activar(encendidos, false)}>
                  Ninguno
                </button>
              </>
            )}
          </div>
          {todos.length === 0 ? (
            <div className="ak-bloque-vacio">
              No hay {tipo === 'agente' ? 'subagentes' : 'skills'} compartidos.{' '}
              <button className="ini-enlace" onClick={() => setModal({ tipo })}>
                Crear {tipo === 'agente' ? 'uno' : 'una'}
              </button>
            </div>
          ) : lista.length === 0 ? (
            <div className="ak-bloque-vacio">Nada coincide con «{buscaActivos.trim()}».</div>
          ) : (
            <div className="ak-filas">{lista.map(fila)}</div>
          )}
        </section>
      )
    }

    return (
      <div className="ak-panel" key={`${destino.tipo}:${destino.id}`}>
        <header className="ak-panel-cab">
          <span className={`ak-panel-ico ${destino.tipo}`}>{destino.tipo === 'grupo' ? <IconoRayo /> : <IconoCarpeta />}</span>
          <div className="ak-panel-tit">
            <span className="ak-sobre">{destino.tipo === 'grupo' ? 'Grupo' : grupo ? `Proyecto · grupo «${grupo.nombre}»` : 'Proyecto sin grupo'}</span>
            <h3>{destino.tipo === 'grupo' ? grupo?.nombre : proyecto?.nombre}</h3>
          </div>
          <div className="ak-carga" title={destino.tipo === 'grupo' ? 'Lo que se carga en cada proyecto del grupo' : 'Lo que se carga al abrir Claude en este proyecto'}>
            <span><b>{cargaAgentes}</b> {cargaAgentes === 1 ? 'subagente' : 'subagentes'}</span>
            <span><b>{cargaSkills}</b> {cargaSkills === 1 ? 'skill' : 'skills'}</span>
          </div>
        </header>
        <p className="ak-panel-nota">
          {destino.tipo === 'grupo'
            ? 'Lo que actives aquí se carga en todos los proyectos del grupo.'
            : 'Se suma a lo que ya activa su grupo. Lo heredado se quita desde el grupo.'}
        </p>
        {compartidos.length > 5 && (
          <div className="buscar ak-buscar chico">
            <IconoBuscar />
            <input type="search" value={buscaActivos} onChange={(e) => setBuscaActivos(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar recursos" spellCheck={false} />
          </div>
        )}
        {bloque('agente')}
        {bloque('skill')}
        {proyecto && individuales.length > 0 && (
          <section className="ak-bloque">
            <div className="ak-bloque-cab">
              <Ficha tipo="agente" chica />
              <h4>Solo de este proyecto</h4>
              <span className="contador">{individuales.length}</span>
            </div>
            <div className="ak-filas">
              {individuales.map((r) => (
                <div key={r.id} className="ak-fila on fijo">
                  <Ficha tipo={r.tipo} chica />
                  <span className="ak-fila-txt">
                    <strong className="mono">{r.nombre}</strong>
                    <span title={r.descripcion}>{r.descripcion || 'Sin descripción'}</span>
                  </span>
                  <span className="ak-heredado ok">Siempre activo</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    )
  }

  const pd = sinAcentos(buscaDestino)
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))
  const esDestino = (t: Destino['tipo'], id: string): boolean => destino?.tipo === t && destino.id === id
  const itemProyecto = (p: { id: string; nombre: string }) => {
    const n = cuentaDestino({ tipo: 'proyecto', id: p.id })
    return (
      <button key={p.id} className={`ak-destino proyecto${esDestino('proyecto', p.id) ? ' activo' : ''}`} onClick={() => setDestino({ tipo: 'proyecto', id: p.id })}>
        <IconoCarpeta />
        <span className="ak-destino-nombre">{p.nombre}</span>
        {n > 0 && <span className="ak-cuenta">{n}</span>}
      </button>
    )
  }

  const vistaActivacion = (
    <div className="ak-columnas">
      <nav className="ak-destinos" aria-label="Grupos y proyectos">
        <div className="buscar ak-buscar chico">
          <IconoBuscar />
          <input type="search" value={buscaDestino} onChange={(e) => setBuscaDestino(e.target.value)} placeholder="Buscar grupo o proyecto…" aria-label="Buscar grupo o proyecto" spellCheck={false} />
        </div>
        <div className="ak-destinos-lista">
          {datos.grupos.map((g) => {
            const hijos = datos.proyectos.filter((p) => p.grupo === g.id)
            const grupoCoincide = !pd || sinAcentos(g.nombre).includes(pd)
            const visibles = grupoCoincide ? hijos : hijos.filter((p) => sinAcentos(p.nombre).includes(pd))
            if (!grupoCoincide && visibles.length === 0) return null
            const plegado = plegados.has(g.id) && !pd
            const n = cuentaDestino({ tipo: 'grupo', id: g.id })
            return (
              <div key={g.id} className="ak-destino-grupo">
                <div className={`ak-destino grupo${esDestino('grupo', g.id) ? ' activo' : ''}`}>
                  <button
                    className={`ak-plegar${plegado ? '' : ' abierto'}`}
                    aria-label={plegado ? 'Desplegar' : 'Plegar'}
                    onClick={() => setPlegados((s) => (s.has(g.id) ? new Set([...s].filter((x) => x !== g.id)) : new Set([...s, g.id])))}
                  >
                    <IconoChevron />
                  </button>
                  <button className="ak-destino-btn" onClick={() => setDestino({ tipo: 'grupo', id: g.id })}>
                    <span className="ak-destino-nombre">{g.nombre}</span>
                    {n > 0 && <span className="ak-cuenta">{n}</span>}
                  </button>
                </div>
                {!plegado && <div className="ak-destino-hijos">{visibles.map(itemProyecto)}</div>}
              </div>
            )
          })}
          {sinGrupo.some((p) => !pd || sinAcentos(p.nombre).includes(pd)) && (
            <div className="ak-destino-grupo">
              <div className="ak-etiqueta">Sin grupo</div>
              <div className="ak-destino-hijos">{sinGrupo.filter((p) => !pd || sinAcentos(p.nombre).includes(pd)).map(itemProyecto)}</div>
            </div>
          )}
        </div>
      </nav>
      {panelActivacion()}
    </div>
  )

  return (
    <div className="config ancha ak">
      <header className="ak-cab">
        <div className="ak-cab-txt">
          <h2>Agentes y skills</h2>
          <p>
            Se cargan <strong>solo al abrir Claude desde un proyecto</strong> (✦ → Claude Code) y en el Asistente. Una terminal normal, o escribir <code>claude</code> a mano, no los
            lleva. No se escribe nada en el repositorio.
          </p>
        </div>
        <div className="ak-cab-acc">
          <button onClick={() => setModal({ tipo: 'skill' })}>
            <IconoMas /> Skill
          </button>
          <button className="primario" onClick={() => setModal({ tipo: 'agente' })}>
            <IconoMas /> Subagente
          </button>
        </div>
      </header>

      <div className="ak-kpis">
        <button className="ak-kpi" onClick={() => (setPestana('biblioteca'), setFiltroTipo('agente'))}>
          <Ficha tipo="agente" />
          <span><b>{nAgentes}</b>Subagentes</span>
        </button>
        <button className="ak-kpi" onClick={() => (setPestana('biblioteca'), setFiltroTipo('skill'))}>
          <Ficha tipo="skill" />
          <span><b>{nSkills}</b>Skills</span>
        </button>
        <button className="ak-kpi" onClick={() => (setPestana('biblioteca'), setFiltroTipo('todos'), setFiltroAmbito('compartido'))}>
          <span className="ak-ficha ak-comp" aria-hidden><IconoRayo /></span>
          <span><b>{nCompartidos}</b>Compartidos</span>
        </button>
        <button className="ak-kpi" onClick={() => setPestana('activacion')}>
          <span className="ak-ficha ak-act" aria-hidden><IconoCarpeta /></span>
          <span><b>{totalActivaciones}</b>Activaciones</span>
        </button>
      </div>

      <div className="ak-tabs">
        <Segmentos
          etiqueta="Sección"
          valor={pestana}
          onCambio={setPestana}
          opciones={[
            { v: 'biblioteca', t: 'Biblioteca' },
            { v: 'activacion', t: 'Activación por grupo y proyecto' }
          ]}
        />
      </div>

      <div className="ak-vista" key={pestana}>
        {pestana === 'biblioteca' ? vistaBiblioteca : vistaActivacion}
      </div>

      {modal && (
        <ModalRecurso key={modal.inicial?.id ?? modal.tipo} tipo={modal.tipo} inicial={modal.inicial} datos={datos} onGuardado={onBiblioteca} onCerrar={() => setModal(null)} />
      )}
      {porEliminar && (
        <ModalConfirmar
          titulo={`Eliminar «${porEliminar.nombre}»`}
          texto="Se quita de la biblioteca y de todas las activaciones. Las sesiones de Claude ya abiertas lo conservan hasta que las cierres."
          etiqueta="Eliminar"
          onConfirmar={() => void window.api.agentes.eliminar(porEliminar.id).then(onBiblioteca)}
          onCerrar={() => setPorEliminar(null)}
        />
      )}
    </div>
  )
}
