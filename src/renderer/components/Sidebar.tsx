import type { DatosProyectos, Proyecto } from '@shared/modelos'

interface Props {
  datos: DatosProyectos
  onAbrir: (p: Proyecto) => void
  onNueva: () => void
  onConfig: () => void
  configActiva: boolean
}

export function Sidebar({ datos, onAbrir, onNueva, onConfig, configActiva }: Props) {
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const lista = (proyectos: Proyecto[]) =>
    proyectos.map((p) => (
      <li key={p.id} title={p.ruta} onClick={() => onAbrir(p)}>
        {p.nombre}
      </li>
    ))

  return (
    <aside className="sidebar">
      <h1>Centro de Proyectos</h1>
      <button className="nueva" onClick={onNueva}>
        + Nueva terminal
      </button>
      <button className={`nueva${configActiva ? ' on' : ''}`} onClick={onConfig}>
        ⚙ Configurar proyectos
      </button>
      {datos.grupos.map((g) => (
        <section key={g.id}>
          <h2>{g.nombre}</h2>
          <ul>{lista(datos.proyectos.filter((p) => p.grupo === g.id))}</ul>
        </section>
      ))}
      {sinGrupo.length > 0 && (
        <section>
          <h2>Sin grupo</h2>
          <ul>{lista(sinGrupo)}</ul>
        </section>
      )}
    </aside>
  )
}
