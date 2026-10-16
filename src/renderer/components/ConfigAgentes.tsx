import { useState } from 'react'
import type { BibliotecaAgentes, DatosProyectos, Recurso, TipoRecurso } from '@shared/modelos'
import { activosDe } from '@shared/agentes'
import { IconoAgente, IconoBasura, IconoCarpeta, IconoLapiz, IconoMas } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'
import { ModalRecurso } from './ModalRecurso'

interface Props {
  datos: DatosProyectos
  biblioteca: BibliotecaAgentes
  onBiblioteca: (b: BibliotecaAgentes) => void
}

type Destino = { tipo: 'grupo' | 'proyecto'; id: string }

export function ConfigAgentes({ datos, biblioteca, onBiblioteca }: Props) {
  const [pestana, setPestana] = useState<'biblioteca' | 'activacion'>('biblioteca')
  const [modal, setModal] = useState<{ tipo: TipoRecurso; inicial?: Recurso } | null>(null)
  const [porEliminar, setPorEliminar] = useState<Recurso | null>(null)
  const [destino, setDestino] = useState<Destino | null>(
    datos.grupos[0] ? { tipo: 'grupo', id: datos.grupos[0].id } : datos.proyectos[0] ? { tipo: 'proyecto', id: datos.proyectos[0].id } : null
  )

  const nombreProyecto = (id?: string): string => datos.proyectos.find((p) => p.id === id)?.nombre ?? 'proyecto eliminado'

  // ------------------------------------------------------------ biblioteca
  const fila = (r: Recurso) => (
    <div className="cfg-proyecto" key={r.id}>
      <strong className="mono">{r.nombre}</strong>
      <span className="rec-desc" title={r.descripcion}>{r.descripcion}</span>
      {r.tipo === 'agente' && r.modelo && <span className="chip">{r.modelo}</span>}
      {r.tipo === 'agente' && !!r.herramientas?.length && (
        <span className="chip" title={r.herramientas.join(', ')}>{r.herramientas.length} herramientas</span>
      )}
      <span className={`chip ${r.ambito === 'compartido' ? 'chip-ok' : 'chip-aviso'}`} title={r.ambito === 'proyecto' ? 'Solo se carga en este proyecto' : 'Se activa por grupo o proyecto'}>
        {r.ambito === 'compartido' ? 'Compartido' : nombreProyecto(r.proyectoId)}
      </span>
      <button className="icono" title="Editar" onClick={() => setModal({ tipo: r.tipo, inicial: r })}>
        <IconoLapiz />
      </button>
      <button className="peligro" title="Eliminar" onClick={() => setPorEliminar(r)}>
        <IconoBasura />
      </button>
    </div>
  )

  const seccion = (titulo: string, tipo: TipoRecurso, vacio: string) => {
    const lista = biblioteca.recursos.filter((r) => r.tipo === tipo)
    return (
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>
            {titulo} <small>{lista.length}</small>
          </h3>
          <button onClick={() => setModal({ tipo })}>
            <IconoMas /> {tipo === 'agente' ? 'Agente' : 'Skill'}
          </button>
        </div>
        {lista.length === 0 ? <p className="cfg-vacio">{vacio}</p> : lista.map(fila)}
      </section>
    )
  }

  // ------------------------------------------------------------ activación
  const interruptor = (r: Recurso, marcado: boolean, bloqueado: boolean, nota?: string) => (
    <div className="cfg-proyecto" key={r.id}>
      <label className={`interruptor${bloqueado ? ' bloqueado' : ''}`}>
        <input
          type="checkbox"
          checked={marcado}
          disabled={bloqueado}
          onChange={(e) => destino && void window.api.agentes.activar(destino, r.id, e.target.checked).then(onBiblioteca)}
        />
        <span />
      </label>
      <strong className="mono">{r.nombre}</strong>
      <span className="rec-desc" title={r.descripcion}>{r.descripcion}</span>
      {nota && <span className="chip chip-aviso">{nota}</span>}
    </div>
  )

  const panelActivacion = () => {
    if (!destino) return <p className="cfg-vacio">Agrega proyectos para poder activar agentes.</p>
    const proyecto = destino.tipo === 'proyecto' ? datos.proyectos.find((p) => p.id === destino.id) : undefined
    const grupo = datos.grupos.find((g) => g.id === (destino.tipo === 'grupo' ? destino.id : proyecto?.grupo))
    const compartidos = biblioteca.recursos.filter((r) => r.ambito === 'compartido')
    const enGrupo = new Set((grupo && biblioteca.activaciones.grupos[grupo.id]) || [])
    const enProyecto = new Set((proyecto && biblioteca.activaciones.proyectos[proyecto.id]) || [])
    const individuales = proyecto ? biblioteca.recursos.filter((r) => r.ambito === 'proyecto' && r.proyectoId === proyecto.id) : []
    const resumen = proyecto ? activosDe(biblioteca, proyecto) : []
    const nAgentes = resumen.filter((a) => a.recurso.tipo === 'agente').length
    const nSkills = resumen.length - nAgentes

    const bloque = (titulo: string, tipo: TipoRecurso) => {
      const lista = compartidos.filter((r) => r.tipo === tipo)
      return (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>
              {titulo} <small>{lista.length}</small>
            </h3>
          </div>
          {lista.length === 0 && <p className="cfg-vacio">No hay {tipo === 'agente' ? 'agentes' : 'skills'} compartidos. Créalos en «Biblioteca».</p>}
          {lista.map((r) =>
            destino.tipo === 'grupo'
              ? interruptor(r, enGrupo.has(r.id), false)
              : interruptor(r, enProyecto.has(r.id) || enGrupo.has(r.id), enGrupo.has(r.id), enGrupo.has(r.id) ? `por grupo «${grupo?.nombre}»` : undefined)
          )}
        </section>
      )
    }

    return (
      <div className="act-panel">
        <h3 className="act-titulo">
          {destino.tipo === 'grupo' ? `Grupo «${grupo?.nombre}»` : `Proyecto «${proyecto?.nombre}»`}
        </h3>
        <p className="cfg-intro">
          {destino.tipo === 'grupo'
            ? 'Lo que actives aquí se carga en todos los proyectos del grupo.'
            : 'Se suma a lo que ya activa su grupo. Para quitar algo heredado, desactívalo en el grupo.'}
        </p>
        {bloque('Subagentes compartidos', 'agente')}
        {bloque('Skills compartidas', 'skill')}
        {proyecto && individuales.length > 0 && (
          <section className="cfg-grupo">
            <div className="cfg-grupo-cab">
              <h3>
                Individuales de este proyecto <small>{individuales.length}</small>
              </h3>
            </div>
            {individuales.map((r) => (
              <div className="cfg-proyecto" key={r.id}>
                <IconoAgente />
                <strong className="mono">{r.nombre}</strong>
                <span className="rec-desc" title={r.descripcion}>{r.descripcion}</span>
                <span className="chip chip-ok">siempre activo</span>
              </div>
            ))}
          </section>
        )}
        {proyecto && (
          <p className="act-resumen">
            Al abrir «{proyecto.nombre}» con Claude se cargan <strong>{nAgentes}</strong> subagente{nAgentes === 1 ? '' : 's'} y <strong>{nSkills}</strong> skill{nSkills === 1 ? '' : 's'}.
          </p>
        )}
      </div>
    )
  }

  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))
  const esDestino = (t: Destino['tipo'], id: string): boolean => destino?.tipo === t && destino.id === id
  const itemProyecto = (p: { id: string; nombre: string }) => (
    <button key={p.id} className={`item act-item act-proyecto${esDestino('proyecto', p.id) ? ' activo' : ''}`} onClick={() => setDestino({ tipo: 'proyecto', id: p.id })}>
      <IconoCarpeta />
      <span className="item-nombre">{p.nombre}</span>
    </button>
  )

  return (
    <div className="config">
      <div className="cfg-cab">
        <h2>Agentes y skills</h2>
        <div className="barra-acciones">
          <button className="primario" onClick={() => setModal({ tipo: 'agente' })}>
            <IconoMas /> Agente
          </button>
          <button onClick={() => setModal({ tipo: 'skill' })}>
            <IconoMas /> Skill
          </button>
        </div>
      </div>
      <p className="cfg-intro">
        Subagentes y skills de Claude Code. Se cargan <strong>solo al abrir una terminal con Claude</strong> desde un proyecto (✦ → Claude Code); una terminal
        normal, o escribir <code>claude</code> a mano, no los lleva. No se escribe nada en el repositorio del proyecto.
      </p>

      <div className="segmentado pestanas-cfg" role="tablist">
        <button className={pestana === 'biblioteca' ? 'on' : ''} onClick={() => setPestana('biblioteca')}>
          Biblioteca
        </button>
        <button className={pestana === 'activacion' ? 'on' : ''} onClick={() => setPestana('activacion')}>
          Activación por grupo / proyecto
        </button>
      </div>

      {pestana === 'biblioteca' ? (
        <>
          {seccion('Subagentes', 'agente', 'Sin subagentes. Un subagente es un especialista (revisor, tester…) al que Claude delega tareas.')}
          {seccion('Skills', 'skill', 'Sin skills. Una skill son instrucciones que Claude carga cuando la tarea las necesita.')}
        </>
      ) : (
        <div className="act-columnas">
          <nav className="act-destinos">
            {datos.grupos.map((g) => (
              <div key={g.id}>
                <button className={`item act-item act-grupo${esDestino('grupo', g.id) ? ' activo' : ''}`} onClick={() => setDestino({ tipo: 'grupo', id: g.id })}>
                  <IconoAgente />
                  <span className="item-nombre">{g.nombre}</span>
                  <span className="chip">grupo</span>
                </button>
                {datos.proyectos.filter((p) => p.grupo === g.id).map(itemProyecto)}
              </div>
            ))}
            {sinGrupo.length > 0 && (
              <div>
                <div className="act-etiqueta">Sin grupo</div>
                {sinGrupo.map(itemProyecto)}
              </div>
            )}
          </nav>
          {panelActivacion()}
        </div>
      )}

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
