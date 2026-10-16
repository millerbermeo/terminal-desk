import { useEffect, useState } from 'react'
import type { DatosProyectos, Proyecto, ProveedorEstado } from '@shared/modelos'
import { IconoCarpeta, IconoAbrirTodas, IconoChevron, IconoChispa, IconoEngranaje, IconoMas } from './Iconos'

interface Props {
  datos: DatosProyectos
  onAbrir: (p: Proyecto) => void
  /** clave de grupo, nombre y proyectos: abre (o enfoca) la pestaña de ese grupo */
  onAbrirGrupo: (clave: string, nombre: string, p: Proyecto[]) => void
  abiertos: Set<string> // claves de grupo con pestaña abierta
  onNueva: () => void
  proveedores: ProveedorEstado[]
  onAbrirConProveedor: (p: Proyecto, prov: ProveedorEstado) => void
  vista: Vista
  onVista: (v: Vista) => void
}

export type Vista = 'terminales' | 'config' | 'proveedores'

interface MenuIA {
  proyecto: Proyecto
  top: number
  left: number
}

export function Sidebar({ datos, onAbrir, onAbrirGrupo, abiertos, onNueva, proveedores, onAbrirConProveedor, vista, onVista }: Props) {
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuIA | null>(null)

  useEffect(() => {
    if (!menu) return
    const cerrar = (): void => setMenu(null)
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('mousedown', cerrar)
    window.addEventListener('keydown', tecla)
    window.addEventListener('blur', cerrar)
    return () => {
      window.removeEventListener('mousedown', cerrar)
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('blur', cerrar)
    }
  }, [menu])
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const alternar = (id: string): void =>
    setCerrados((c) => {
      const n = new Set(c)
      if (!n.delete(id)) n.add(id)
      return n
    })

  const seccion = (id: string, nombre: string, proyectos: Proyecto[]) => (
    <section key={id} className={cerrados.has(id) ? 'cerrada' : ''}>
      <div className="seccion-cab">
        <button className="seccion-toggle" onClick={() => alternar(id)} aria-expanded={!cerrados.has(id)}>
          <span className="chevron"><IconoChevron /></span>
          <span className="seccion-nombre">{nombre}</span>
          {abiertos.has(id) && <span className="punto-abierto" title="Pestaña abierta" />}
          <span className="contador">{proyectos.length}</span>
        </button>
        <button
          className="icono abrir-todas"
          disabled={proyectos.length === 0}
          title={abiertos.has(id) ? 'Ir a la pestaña de este grupo' : `Abrir ${proyectos.length} terminal${proyectos.length === 1 ? '' : 'es'} en una pestaña nueva (una por proyecto)`}
          aria-label={`Abrir una terminal por cada proyecto de ${nombre}`}
          onClick={() => onAbrirGrupo(id, nombre, proyectos)}
        >
          <IconoAbrirTodas />
        </button>
      </div>
      <div className="seccion-cuerpo">
        <ul>
          {proyectos.map((p) => (
            <li key={p.id}>
              <div className="fila-proyecto">
                <button className="item" title={p.ruta} onClick={() => onAbrir(p)}>
                  <IconoCarpeta />
                  <span>{p.nombre}</span>
                </button>
                <button
                  className="icono abrir-ia"
                  title="Abrir con un proveedor de IA"
                  aria-label={`Abrir ${p.nombre} con un proveedor de IA`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ proyecto: p, top: r.bottom + 4, left: r.left })
                  }}
                >
                  <IconoChispa />
                </button>
              </div>
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
        <button className={`item item-config${vista === 'proveedores' ? ' activo' : ''}`} onClick={() => onVista(vista === 'proveedores' ? 'terminales' : 'proveedores')}>
          <IconoChispa />
          <span>Proveedores de IA</span>
        </button>
        <button className={`item item-config${vista === 'config' ? ' activo' : ''}`} onClick={() => onVista(vista === 'config' ? 'terminales' : 'config')}>
          <IconoEngranaje />
          <span>Configurar proyectos</span>
        </button>
      </footer>
      {menu && (
        <div className="menu-ia" style={{ top: menu.top, left: menu.left }} onMouseDown={(e) => e.stopPropagation()} role="menu">
          <div className="menu-ia-tit">Abrir «{menu.proyecto.nombre}» con</div>
          {proveedores.map((prov) => (
            <button
              key={prov.id}
              role="menuitem"
              onClick={() => {
                onAbrirConProveedor(menu.proyecto, prov)
                setMenu(null)
              }}
            >
              <IconoChispa />
              <span>{prov.nombre}</span>
              {!prov.disponible && <small title="No encontrado en el PATH de la app">?</small>}
            </button>
          ))}
          {proveedores.length === 0 && (
            <button onClick={() => { onVista('proveedores'); setMenu(null) }}>Configurar proveedores…</button>
          )}
        </div>
      )}
    </aside>
  )
}
