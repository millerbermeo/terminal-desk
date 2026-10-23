import { useEffect, useRef, useState, type ReactNode } from 'react'
import { trabajandoAhora, type AvisoEquipo, type PendienteClonar } from '@shared/equipos'
import type { DatosProyectos, Proyecto, ProveedorEstado } from '@shared/modelos'
import logo from '../assets/logo.png'
import { IconoCarpeta, IconoAbrirTodas, IconoAgente, IconoChevron, IconoChispa, IconoEngranaje, IconoApi, IconoBuscar, IconoGitHub, IconoGlobo, IconoLibro, IconoMas, IconoNube, IconoPanelLateral, IconoRama, IconoRayo, IconoTareas, IconoUsuario } from './Iconos'

interface Props {
  datos: DatosProyectos
  onAbrir: (p: Proyecto) => void
  /** clave de grupo, nombre y proyectos: abre (o enfoca) la pestaña de ese grupo */
  onAbrirGrupo: (clave: string, nombre: string, p: Proyecto[]) => void
  abiertos: Set<string> // claves de grupo con pestaña abierta
  terminalesPorProyecto: Record<string, number> // terminales abiertas de cada proyecto
  onNueva: () => void
  /** Diálogo nativo para elegir carpetas y agregarlas como proyectos. */
  onAbrirCarpeta: () => void
  /** Formulario para escribir o pegar una ruta. */
  onAgregarRuta: () => void
  proveedores: ProveedorEstado[]
  onAbrirConProveedor: (p: Proyecto, prov: ProveedorEstado) => void
  vista: Vista
  onVista: (v: Vista) => void
  /** Confirmaciones que el asistente está esperando (insignia en el acceso al asistente). */
  pendientesAsistente: number
  /** Abre una celda del proyecto con el asistente integrado. */
  onAbrirAsistente: (p: Proyecto) => void
  /** Abre los comandos de arranque del proyecto. */
  onArranque: (p: Proyecto) => void
  /** Proyectos con algún comando de arranque en marcha (para el indicador). */
  enMarcha: ReadonlySet<string>
  /** Servicios abiertos en la sección «Servicios» (insignia del acceso). */
  serviciosActivos: number
  /** Cuenta con la que se entró al servidor; abre su panel (contraseña, cerrar sesión). */
  email?: string
  onCuenta: () => void
  /** Proyectos de la cuenta con repositorio que aún no tienen carpeta en este equipo (y abrir el diálogo para clonarlos). */
  pendientes: PendienteClonar[]
  /** Otros equipos con trabajo sin subir, por id de proyecto: se marca el proyecto en la lista. */
  avisosPorProyecto: Record<string, AvisoEquipo[]>
  onClonarPendientes: (idInicial?: string) => void
}

interface ItemNav {
  vista: Vista
  icono: ReactNode
  texto: string
  titulo?: string
}

const NAV: { grupo: string; items: ItemNav[] }[] = [
  {
    grupo: 'Herramientas',
    items: [
      { vista: 'servicios', icono: <IconoRayo />, texto: 'Servicios', titulo: 'Los comandos de arranque de tus proyectos en marcha (API, frontend, base de datos…), cada uno en su terminal' },
      { vista: 'asistente', icono: <IconoChispa />, texto: 'Asistente' },
      { vista: 'tareas', icono: <IconoTareas />, texto: 'Tareas' },
      { vista: 'versiones', icono: <IconoRama />, texto: 'Versiones' },
      { vista: 'api', icono: <IconoApi />, texto: 'Cliente API' },
      { vista: 'navegador', icono: <IconoGlobo />, texto: 'Navegador' }
    ]
  },
  {
    grupo: 'Ajustes',
    items: [
      { vista: 'github', icono: <IconoGitHub />, texto: 'GitHub', titulo: 'Tu cuenta de GitHub: perfil, permisos, organizaciones, repositorios y lo pendiente' },
      { vista: 'agentes', icono: <IconoAgente />, texto: 'Agentes y skills' },
      { vista: 'proveedores', icono: <IconoChispa />, texto: 'Proveedores de IA' },
      { vista: 'config', icono: <IconoEngranaje />, texto: 'Configurar proyectos' },
      { vista: 'guia', icono: <IconoLibro />, texto: 'Guía de la app', titulo: 'Qué trae la app, para qué sirve cada herramienta y cómo se usa' }
    ]
  }
]

const CLAVE_MINI = 'odesk.sidebar.mini'
const ESTRECHO = '(max-width: 760px)'

/** Barra lateral compacta (solo iconos): a mano, o sola cuando la ventana es estrecha. */
function useBarraCompacta(): [boolean, boolean, () => void] {
  const [manual, setManual] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_MINI) === '1'
    } catch {
      return false
    }
  })
  const [estrecho, setEstrecho] = useState(() => window.matchMedia(ESTRECHO).matches)
  useEffect(() => {
    const mq = window.matchMedia(ESTRECHO)
    const alCambiar = (e: MediaQueryListEvent): void => setEstrecho(e.matches)
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])
  const alternar = (): void =>
    setManual((m) => {
      try {
        localStorage.setItem(CLAVE_MINI, m ? '0' : '1')
      } catch {
        // sin almacenamiento: solo dura esta sesión
      }
      return !m
    })
  return [manual || estrecho, estrecho, alternar]
}

export type Vista = 'terminales' | 'servicios' | 'config' | 'github' | 'proveedores' | 'agentes' | 'asistente' | 'tareas' | 'versiones' | 'api' | 'navegador' | 'guia'

interface MenuIA {
  proyecto: Proyecto
  top: number
  left: number
}

export function Sidebar({ datos, onAbrir, onAbrirGrupo, abiertos, terminalesPorProyecto, onNueva, onAbrirCarpeta, onAgregarRuta, proveedores, onAbrirConProveedor, vista, onVista, pendientesAsistente, onAbrirAsistente, onArranque, enMarcha, serviciosActivos, email, onCuenta, pendientes, avisosPorProyecto, onClonarPendientes }: Props) {
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuIA | null>(null)
  const [compacta, forzada, alternarCompacta] = useBarraCompacta()
  const [filtro, setFiltro] = useState('')
  const pie = useRef<HTMLElement>(null)

  // El menú de abajo tiene su propio scroll (con la ventana baja no cabe entero): la herramienta abierta siempre queda a la vista.
  useEffect(() => {
    pie.current?.querySelector('.item-config.activo')?.scrollIntoView({ block: 'nearest' })
  }, [vista])

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

  const q = filtro.trim().toLowerCase()
  const seccion = (id: string, nombre: string, todos: Proyecto[]) => {
    const proyectos = q ? todos.filter((p) => p.nombre.toLowerCase().includes(q)) : todos
    if (q && proyectos.length === 0) return null
    return (
    <section key={id} className={cerrados.has(id) && !q ? 'cerrada' : ''}>
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
                  <span className="item-nombre">{p.nombre}</span>
                  {avisosPorProyecto[p.id]?.length > 0 && (
                    <span
                      className={`aviso-equipo${avisosPorProyecto[p.id]!.some((a) => trabajandoAhora(a)) ? ' vivo' : ''}`}
                      title={avisosPorProyecto[p.id]!.map((a) => `${a.equipo}: ${[a.cambios > 0 ? `${a.cambios} sin guardar` : '', a.adelante > 0 ? `${a.adelante} sin enviar` : ''].filter(Boolean).join(', ')}${a.rama ? ` (${a.rama})` : ''}`).join('\n')}
                    />
                  )}
                  {terminalesPorProyecto[p.id] > 0 && (
                    <span
                      key={terminalesPorProyecto[p.id]}
                      className="insignia"
                      title={`${terminalesPorProyecto[p.id]} terminal${terminalesPorProyecto[p.id] === 1 ? '' : 'es'} abierta${terminalesPorProyecto[p.id] === 1 ? '' : 's'}`}
                    >
                      {terminalesPorProyecto[p.id]}
                    </span>
                  )}
                </button>
                <button
                  className={`icono abrir-arranque${enMarcha.has(p.id) ? ' en-marcha' : ''}`}
                  title={enMarcha.has(p.id) ? 'Comandos de arranque (hay servicios en marcha)' : 'Comandos de arranque'}
                  aria-label={`Comandos de arranque de ${p.nombre}`}
                  onClick={() => onArranque(p)}
                >
                  <IconoRayo />
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
  }

  return (
    <aside className={`sidebar${compacta ? ' compacta' : ''}`}>
      <header className="marca">
        <img className="logo" src={logo} alt="Odesk Agent" />
        <h1>Odesk Agent</h1>
        <button
          className="icono sidebar-toggle"
          onClick={alternarCompacta}
          disabled={forzada}
          title={compacta ? 'Expandir la barra lateral' : 'Contraer la barra lateral'}
          aria-label={compacta ? 'Expandir la barra lateral' : 'Contraer la barra lateral'}
          aria-pressed={compacta}
        >
          <IconoPanelLateral />
        </button>
      </header>
      <div className="acciones">
        <button className="btn-nueva" onClick={onNueva} title="Nueva terminal" aria-label="Nueva terminal">
          <IconoMas /> <span className="txt">Nueva terminal</span>
        </button>
        <div className="acciones-proyecto">
          <button onClick={onAbrirCarpeta} title="Elegir una carpeta con el explorador de archivos y agregarla como proyecto">
            <IconoCarpeta /> <span className="txt">Abrir carpeta</span>
          </button>
          <button onClick={onAgregarRuta} title="Escribir o pegar la ruta de un proyecto (con autocompletado)">
            <IconoMas /> <span className="txt">Agregar ruta</span>
          </button>
        </div>
      </div>
      <div className="buscar">
        <IconoBuscar />
        <input
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFiltro('')}
          placeholder="Filtrar proyectos…"
          aria-label="Filtrar proyectos"
          spellCheck={false}
        />
      </div>
      <nav className="lista">
        {datos.grupos.map((g) =>
          seccion(g.id, g.nombre, datos.proyectos.filter((p) => p.grupo === g.id))
        )}
        {sinGrupo.length > 0 && seccion('__sin-grupo__', 'Sin grupo', sinGrupo)}
        {pendientes.length > 0 && !q && (
          <section className="en-cuenta">
            <div className="seccion-cab">
              <div className="seccion-toggle en-cuenta-tit">
                <IconoNube />
                <span className="seccion-nombre">En tu cuenta</span>
                <span className="contador">{pendientes.length}</span>
              </div>
              <button className="icono abrir-todas" title="Clonar todos los proyectos que faltan en este equipo" aria-label="Clonar todos los proyectos que faltan" onClick={() => onClonarPendientes()}>
                <IconoAbrirTodas />
              </button>
            </div>
            <ul>
              {pendientes.map((p) => (
                <li key={p.id}>
                  <button className="item item-pendiente" title={`${p.nombre}: está en otro equipo de tu cuenta. Clic para clonarlo aquí o, si ya lo tienes en este equipo, enlazar su carpeta.`} onClick={() => onClonarPendientes(p.id)}>
                    <IconoNube />
                    <span className="item-nombre">{p.nombre}</span>
                    <span className="chip item-clonar">clonar</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>
      <footer ref={pie}>
        {NAV.map((g) => (
          <div className="nav-grupo" key={g.grupo}>
            <div className="nav-etiqueta">{g.grupo}</div>
            {g.items.map((i) => (
              <button
                key={i.vista}
                className={`item item-config${vista === i.vista ? ' activo' : ''}`}
                onClick={() => onVista(vista === i.vista ? 'terminales' : i.vista)}
                title={i.titulo ?? i.texto}
                aria-current={vista === i.vista ? 'page' : undefined}
              >
                <span className="item-icono">{i.icono}</span>
                <span className="txt">{i.texto}</span>
                {i.vista === 'servicios' && serviciosActivos > 0 && <span className="insignia" title="Servicios abiertos">{serviciosActivos}</span>}
                {i.vista === 'asistente' && pendientesAsistente > 0 && <span className="insignia" title="El asistente espera tu confirmación">{pendientesAsistente}</span>}
              </button>
            ))}
          </div>
        ))}
        <button className="cuenta-tarjeta" onClick={onCuenta} title={`Cuenta${email ? ` · ${email}` : ''}: cambiar contraseña o cerrar sesión`}>
          <span className="avatar" aria-hidden="true">{(email ?? '?').charAt(0).toUpperCase()}</span>
          <span className="cuenta-datos txt">
            <strong>Mi cuenta</strong>
            {email && <small>{email}</small>}
          </span>
          <span className="cuenta-chev"><IconoChevron /></span>
        </button>
      </footer>
      {menu && (
        <div className="menu-ia" style={{ top: menu.top, left: menu.left }} onMouseDown={(e) => e.stopPropagation()} role="menu">
          <div className="menu-ia-tit">Abrir «{menu.proyecto.nombre}» con</div>
          <button
            role="menuitem"
            onClick={() => {
              onAbrirAsistente(menu.proyecto)
              setMenu(null)
            }}
          >
            <IconoChispa />
            <span className="txt" title="Asistente integrado">Asistente integrado</span>
          </button>
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
              <span className="txt" title={prov.nombre}>{prov.nombre}</span>
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
