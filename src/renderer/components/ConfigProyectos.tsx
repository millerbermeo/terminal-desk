import { useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { IconoBasura, IconoCarpeta, IconoMas } from './Iconos'
import { ModalAgregar } from './ModalAgregar'
import { ModalEliminarGrupo } from './ModalEliminarGrupo'

interface Props {
  datos: DatosProyectos
  onDatos: (d: DatosProyectos) => void
}

export function ConfigProyectos({ datos, onDatos }: Props) {
  const [modal, setModal] = useState(false)
  const [grupoAEliminar, setGrupoAEliminar] = useState<string | null>(null)
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const lista = (grupoId: string | undefined, nombre: string, proyectos: typeof datos.proyectos) => (
    <section className="cfg-grupo" key={grupoId ?? 'sin-grupo'}>
      <div className="cfg-grupo-cab">
        <h3>
          {nombre} <small>{proyectos.length}</small>
        </h3>
        {grupoId && (
          <button className="peligro" title="Elimina el grupo; sus proyectos pasan a «Sin grupo»" onClick={() => setGrupoAEliminar(grupoId)}>
            Eliminar grupo
          </button>
        )}
      </div>
      {proyectos.length === 0 && <p className="cfg-vacio">Sin proyectos</p>}
      {proyectos.map((p) => (
        <div className="cfg-proyecto" key={p.id}>
          <IconoCarpeta />
          <strong>{p.nombre}</strong>
          <code>{p.ruta}</code>
          <button className="peligro" title="Quitar de la lista (no borra la carpeta)" onClick={() => void window.api.proyectos.eliminar(p.id).then(onDatos)}>
            <IconoBasura /> Quitar
          </button>
        </div>
      ))}
    </section>
  )

  return (
    <div className="config">
      <div className="cfg-cab">
        <h2>Configurar proyectos</h2>
        <button className="primario" onClick={() => setModal(true)}>
          <IconoMas /> Agregar proyectos
        </button>
      </div>

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
