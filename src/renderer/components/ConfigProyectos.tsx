import { useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { ModalAgregar } from './ModalAgregar'

interface Props {
  datos: DatosProyectos
  onDatos: (d: DatosProyectos) => void
}

export function ConfigProyectos({ datos, onDatos }: Props) {
  const [modal, setModal] = useState(false)
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const lista = (grupoId: string | undefined, nombre: string, proyectos: typeof datos.proyectos) => (
    <section className="cfg-grupo" key={grupoId ?? 'sin-grupo'}>
      <div className="cfg-grupo-cab">
        <h3>
          {nombre} <small>({proyectos.length})</small>
        </h3>
        {grupoId && (
          <button title="Elimina el grupo; sus proyectos pasan a «Sin grupo»" onClick={() => void window.api.proyectos.eliminarGrupo(grupoId).then(onDatos)}>
            Eliminar grupo
          </button>
        )}
      </div>
      {proyectos.length === 0 && <p className="cfg-vacio">Sin proyectos</p>}
      {proyectos.map((p) => (
        <div className="cfg-proyecto" key={p.id}>
          <strong>{p.nombre}</strong>
          <code>{p.ruta}</code>
          <button title="Quitar de la lista (no borra la carpeta)" onClick={() => void window.api.proyectos.eliminar(p.id).then(onDatos)}>
            Quitar
          </button>
        </div>
      ))}
    </section>
  )

  return (
    <div className="config">
      <div className="cfg-cab">
        <h2>Configurar proyectos</h2>
        <button className="primario" onClick={() => setModal(true)}>+ Agregar proyectos</button>
      </div>

      {datos.grupos.map((g) =>
        lista(g.id, g.nombre, datos.proyectos.filter((p) => p.grupo === g.id))
      )}
      {(sinGrupo.length > 0 || datos.grupos.length === 0) && lista(undefined, 'Sin grupo', sinGrupo)}
      {modal && (
        <ModalAgregar
          datos={datos}
          onCerrar={() => setModal(false)}
          onGuardado={(d) => {
            onDatos(d)
            setModal(false)
          }}
        />
      )}
    </div>
  )
}
