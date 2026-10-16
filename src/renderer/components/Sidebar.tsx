import { useState } from 'react'
import type { DatosProyectos, Proyecto } from '@shared/modelos'
import { IconoCarpeta, IconoChevron, IconoEngranaje, IconoMas } from './Iconos'

interface Props {
  datos: DatosProyectos
  onAbrir: (p: Proyecto) => void
  onNueva: () => void
  onConfig: () => void
  configActiva: boolean
}

export function Sidebar({ datos, onAbrir, onNueva, onConfig, configActiva }: Props) {
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const alternar = (id: string): void =>
    setCerrados((c) => {
      const n = new Set(c)
      if (!n.delete(id)) n.add(id)
      return n
    })

  const seccion = (id: string, nombre: string, proyectos: Proyecto[]) => (
    <section key={id} className={cerrados.has(id) ? 'cerrada' : ''}>
      <button className="seccion-cab" onClick={() => alternar(id)} aria-expanded={!cerrados.has(id)}>
        <span className="chevron"><IconoChevron /></span>
        <span className="seccion-nombre">{nombre}</span>
        <span className="contador">{proyectos.length}</span>
      </button>
      <div className="seccion-cuerpo">
        <ul>
          {proyectos.map((p) => (
            <li key={p.id}>
              <button className="item" title={p.ruta} onClick={() => onAbrir(p)}>
                <IconoCarpeta />
                <span>{p.nombre}</span>
              </button>
            </li>
          ))}
          {proyectos.length === 0 && <li className="item-vacio">Sin proyectos</li>}
        </ul>
      </div>
    </section>
  )

  return (
    <aside className="sidebar">
      <header className="marca">
        <div className="logo">CP</div>
        <h1>Centro de Proyectos</h1>
      </header>
      <div className="acciones">
        <button className="btn-nueva" onClick={onNueva}>
          <IconoMas /> Nueva terminal
        </button>
      </div>
      <nav className="lista">
        {datos.grupos.map((g) =>
          seccion(g.id, g.nombre, datos.proyectos.filter((p) => p.grupo === g.id))
        )}
        {sinGrupo.length > 0 && seccion('__sin-grupo__', 'Sin grupo', sinGrupo)}
      </nav>
      <footer>
        <button className={`item item-config${configActiva ? ' activo' : ''}`} onClick={onConfig}>
          <IconoEngranaje />
          <span>Configurar proyectos</span>
        </button>
      </footer>
    </aside>
  )
}
