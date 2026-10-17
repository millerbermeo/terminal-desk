import { useCallback, useEffect, useRef, useState } from 'react'
import type { BibliotecaAgentes, DatosProyectos, Proyecto, ProveedorEstado } from '@shared/modelos'
import { EstadoVacio } from './components/EstadoVacio'
import { IconoCerrar, IconoMas, IconoPestanas, IconoRejilla, IconoReiniciar, IconoTerminal, IconoVentana } from './components/Iconos'
import { Sidebar, type Vista } from './components/Sidebar'
import { Asistente } from './components/Asistente'
import { Tareas } from './components/Tareas'
import { Versiones } from './components/Versiones'
import { Api } from './components/Api'
import { Navegador } from './components/Navegador'
import { ModalSolicitudGlobal } from './components/ModalSolicitud'
import { escucharSolicitudes, useSolicitudes } from './agente/solicitudes'
import { ConfigAgentes } from './components/ConfigAgentes'
import { ConfigProveedores } from './components/ConfigProveedores'
import { ConfigProyectos } from './components/ConfigProyectos'
import { ModalAgregar } from './components/ModalAgregar'
import { ModalConfirmar } from './components/ModalConfirmar'
import { TerminalGrid, type Modo } from './components/TerminalGrid'
import { transferidas } from './components/TerminalPanel'

export interface TerminalInfo {
  id: string
  titulo: string
  cwd?: string
  proveedorId?: string
  proyectoId?: string // proyecto de origen (para no duplicar al hacer clic de nuevo)
  ptyId?: string // proceso real (lo informa el panel al crearlo; también viene así de otra ventana)
  vista?: 'terminal' | 'asistente' | 'archivos' // qué se muestra en la celda; la terminal sigue viva debajo
}

/** Una pestaña de la app: normalmente un grupo de proyectos con sus terminales. */
interface Ventana {
  id: string // clave del grupo, '__sin-grupo__', '__libre__' o un id propio
  nombre: string
  terminales: TerminalInfo[]
  activa: string | null // terminal con foco
  modo: Modo
  reiniciarLayout: number
  personalizado: boolean
}

const SIN_GRUPO = '__sin-grupo__'
const LIBRE = '__libre__'

let contador = 0
const nuevaVentana = (id: string, nombre: string, terminales: TerminalInfo[] = []): Ventana => ({
  id,
  nombre,
  terminales,
  activa: terminales[0]?.id ?? null,
  modo: 'rejilla',
  reiniciarLayout: 0,
  personalizado: false
})
const nuevaTerminal = (titulo: string, cwd?: string, proveedorId?: string, proyectoId?: string): TerminalInfo => ({
  id: `t${++contador}`,
  titulo,
  cwd,
  proveedorId,
  proyectoId
})

/** "Backend", "Backend · 2", … para distinguir varias terminales del mismo proyecto. */
function tituloUnico(base: string, existentes: TerminalInfo[]): string {
  const usados = new Set(existentes.map((t) => t.titulo))
  if (!usados.has(base)) return base
  for (let n = 2; ; n++) if (!usados.has(`${base} · ${n}`)) return `${base} · ${n}`
}

export function App() {
  const [datos, setDatos] = useState<DatosProyectos>({ grupos: [], proyectos: [] })
  const [modalAgregar, setModalAgregar] = useState<{ rutas: string[] } | null>(null)

  /** «Abrir carpeta»: explorador nativo y, con lo elegido, el formulario ya relleno (grupo y nombre editables). */
  const abrirCarpeta = async (): Promise<void> => {
    const rutas = await window.api.proyectos.elegirCarpetas()
    if (rutas.length > 0) setModalAgregar({ rutas })
  }
  const [ventanas, setVentanas] = useState<Ventana[]>([])
  const [ventanaActiva, setVentanaActiva] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('terminales')
  const solicitudes = useSolicitudes()
  useEffect(() => escucharSolicitudes(), [])
  const [proveedores, setProveedores] = useState<ProveedorEstado[]>([])
  const [biblioteca, setBiblioteca] = useState<BibliotecaAgentes>({ recursos: [], activaciones: { proyectos: {}, grupos: {} } })
  const [porCerrar, setPorCerrar] = useState<string | null>(null)
  const [separando, setSeparando] = useState<{ id: string; x: number; y: number } | null>(null) // pestaña arrastrada fuera de la barra
  const drag = useRef<{ id: string; x0: number; y0: number; movido: boolean } | null>(null)
  const [menuNueva, setMenuNueva] = useState<string | null>(null) // id de la pestaña con el menú «+ Terminal» abierto

  useEffect(() => {
    void window.api.proyectos.listar().then(setDatos)
    void window.api.proveedores.listar().then(setProveedores).catch(() => undefined)
    void window.api.agentes.listar().then(setBiblioteca).catch(() => undefined)
  }, [])

  const cambiar = useCallback((id: string, f: (v: Ventana) => Ventana): void => {
    setVentanas((vs) => vs.map((v) => (v.id === id ? f(v) : v)))
  }, [])

  /** Añade terminales a la pestaña `id` (la crea si no existe) y la muestra. */
  const agregar = useCallback((id: string, nombre: string, terminales: TerminalInfo[]): void => {
    setVentanas((vs) =>
      vs.some((v) => v.id === id)
        ? vs.map((v) => (v.id === id ? { ...v, terminales: [...v.terminales, ...terminales], activa: terminales[0].id } : v))
        : [...vs, nuevaVentana(id, nombre, terminales)]
    )
    setVentanaActiva(id)
    setVista('terminales')
  }, [])

  const claveDe = useCallback(
    (p: Proyecto): { id: string; nombre: string } => {
      const g = datos.grupos.find((x) => x.id === p.grupo)
      return g ? { id: g.id, nombre: g.nombre } : { id: SIN_GRUPO, nombre: 'Sin grupo' }
    },
    [datos.grupos]
  )

  const enfocar = useCallback((ventanaId: string, termId: string): void => {
    cambiar(ventanaId, (v) => ({ ...v, activa: termId }))
    setVentanaActiva(ventanaId)
    setVista('terminales')
  }, [cambiar])

  // Clic en un proyecto: si ya tiene terminal en la pestaña de su grupo, se va a ella (no se abre otra).
  // Con proveedor de IA (✦) sí se abre una terminal nueva, porque es una acción explícita.
  const abrirProyecto = useCallback(
    (p: Proyecto, prov?: ProveedorEstado) => {
      const { id, nombre } = claveDe(p)
      const ventana = ventanas.find((v) => v.id === id)
      if (!prov) {
        const existente = ventana?.terminales.find((t) => t.proyectoId === p.id && !t.proveedorId)
        if (ventana && existente) return enfocar(id, existente.id)
      }
      const titulo = tituloUnico(prov ? `${p.nombre} · ${prov.nombre}` : p.nombre, ventana?.terminales ?? [])
      agregar(id, nombre, [nuevaTerminal(titulo, p.ruta, prov?.id, p.id)])
    },
    [agregar, claveDe, enfocar, ventanas]
  )

  // «Asistente integrado»: una celda del proyecto que arranca en la vista del asistente (su terminal queda viva debajo).
  const abrirAsistente = useCallback(
    (p: Proyecto) => {
      const { id, nombre } = claveDe(p)
      const ventana = ventanas.find((v) => v.id === id)
      const titulo = tituloUnico(`${p.nombre} · Asistente`, ventana?.terminales ?? [])
      agregar(id, nombre, [{ ...nuevaTerminal(titulo, p.ruta, undefined, p.id), vista: 'asistente' }])
    },
    [agregar, claveDe, ventanas]
  )

  // Un grupo: sin pestaña se abre con una terminal por proyecto; con pestaña se va a ella
  // y se reabren las terminales de los proyectos que hayan quedado sin ninguna.
  const abrirGrupo = useCallback(
    (clave: string, nombre: string, proyectos: Proyecto[]) => {
      const ventana = ventanas.find((v) => v.id === clave)
      if (!ventana) {
        if (proyectos.length > 0) agregar(clave, nombre, proyectos.map((p) => nuevaTerminal(p.nombre, p.ruta, undefined, p.id)))
        return
      }
      const faltan = proyectos.filter((p) => !ventana.terminales.some((t) => t.proyectoId === p.id && !t.proveedorId))
      if (faltan.length > 0) agregar(clave, nombre, faltan.map((p) => nuevaTerminal(tituloUnico(p.nombre, ventana.terminales), p.ruta, undefined, p.id)))
      else enfocar(clave, ventana.activa ?? ventana.terminales[0]?.id ?? '')
    },
    [agregar, enfocar, ventanas]
  )

  // Terminal extra dentro de una pestaña (botón «+ Terminal»): de un proyecto del grupo o vacía.
  const agregarEnVentana = useCallback(
    (v: Ventana, p?: Proyecto) => {
      setMenuNueva(null)
      const titulo = tituloUnico(p ? p.nombre : 'Terminal', v.terminales)
      agregar(v.id, v.nombre, [nuevaTerminal(titulo, p?.ruta, undefined, p?.id)])
    },
    [agregar]
  )

  // Terminal suelta: en la pestaña activa (o en una pestaña "Terminales" si no hay ninguna).
  const abrirLibre = useCallback(() => {
    const destino = ventanas.find((v) => v.id === ventanaActiva)
    agregar(destino?.id ?? LIBRE, destino?.nombre ?? 'Terminales', [nuevaTerminal('Terminal')])
  }, [agregar, ventanas, ventanaActiva])

  const nuevaPestana = useCallback(() => {
    const id = `v${++contador}`
    agregar(id, 'Terminales', [nuevaTerminal('Terminal')])
  }, [agregar])

  const cerrarTerminal = useCallback(
    (ventanaId: string, termId: string) => {
      cambiar(ventanaId, (v) => {
        const resto = v.terminales.filter((t) => t.id !== termId)
        return { ...v, terminales: resto, activa: v.activa === termId ? (resto[resto.length - 1]?.id ?? null) : v.activa }
      })
    },
    [cambiar]
  )

  const cerrarVentana = useCallback(
    (id: string) => {
      setVentanas((vs) => {
        const i = vs.findIndex((v) => v.id === id)
        const resto = vs.filter((v) => v.id !== id)
        setVentanaActiva((a) => (a === id ? (resto[Math.min(i, resto.length - 1)]?.id ?? null) : a))
        return resto
      })
    },
    []
  )

  useEffect(() => {
    if (!menuNueva) return
    const cerrar = (): void => setMenuNueva(null)
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
  }, [menuNueva])

  const alPty = useCallback(
    (ventanaId: string, termId: string, ptyId: string) =>
      cambiar(ventanaId, (v) => ({ ...v, terminales: v.terminales.map((t) => (t.id === termId ? { ...t, ptyId } : t)) })),
    [cambiar]
  )

  // Pasa la pestaña a una ventana nueva: los procesos siguen vivos (se transfiere el pty, no se reinicia).
  const separar = useCallback(
    (v: Ventana, pos?: { x: number; y: number }) => {
      const terminales = v.terminales.filter((t): t is TerminalInfo & { ptyId: string } => !!t.ptyId)
      if (terminales.length === 0) return
      terminales.forEach((t) => transferidas.add(t.ptyId))
      window.api.ventana.separar(
        {
          ventanaId: v.id,
          nombre: v.nombre,
          modo: v.modo,
          terminales: terminales.map((t) => ({ id: t.id, titulo: t.titulo, ptyId: t.ptyId, cwd: t.cwd, proveedorId: t.proveedorId, proyectoId: t.proyectoId, vista: t.vista }))
        },
        pos
      )
      cerrarVentana(v.id)
    },
    [cerrarVentana]
  )

  // Arrastrar una pestaña fuera de la barra la abre en una ventana aparte; un clic sin mover la activa.
  const barraPestanas = useRef<HTMLDivElement>(null)
  const fueraDeBarra = (e: React.PointerEvent): boolean => {
    const r = barraPestanas.current?.getBoundingClientRect()
    return !!r && (e.clientY > r.bottom + 30 || e.clientY < r.top - 30 || e.clientX < 0 || e.clientX > window.innerWidth || e.clientY < 0 || e.clientY > window.innerHeight)
  }
  const pestanaAbajo = (e: React.PointerEvent, v: Ventana): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { id: v.id, x0: e.clientX, y0: e.clientY, movido: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const pestanaMueve = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    if (!d.movido && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) d.movido = true
    setSeparando(d.movido && fueraDeBarra(e) ? { id: d.id, x: e.clientX, y: e.clientY } : null)
  }
  const pestanaSuelta = (e: React.PointerEvent, v: Ventana): void => {
    const d = drag.current
    drag.current = null
    setSeparando(null)
    if (!d) return
    if (!d.movido) setVentanaActiva(v.id)
    else if (fueraDeBarra(e)) separar(v, { x: e.screenX, y: e.screenY })
  }

  // Terminales devueltas desde una ventana separada: vuelven como pestaña (o se suman a la de su grupo).
  useEffect(
    () =>
      window.api.ventana.onRecibir((p) => {
        const terminales: TerminalInfo[] = p.terminales.map((t) => ({ ...t }))
        if (terminales.length === 0) return
        setVentanas((vs) => {
          const existe = vs.some((v) => v.id === p.ventanaId)
          return existe
            ? vs.map((v) => (v.id === p.ventanaId ? { ...v, terminales: [...v.terminales, ...terminales], activa: terminales[0].id } : v))
            : [...vs, { ...nuevaVentana(p.ventanaId, p.nombre, terminales), modo: p.modo }]
        })
        setVentanaActiva(p.ventanaId)
        setVista('terminales')
      }),
    []
  )

  const pedirCierre = (v: Ventana): void => (v.terminales.length > 0 ? setPorCerrar(v.id) : cerrarVentana(v.id))
  const abiertos = new Set(ventanas.map((v) => v.id))
  const terminalesPorProyecto: Record<string, number> = {}
  for (const v of ventanas) for (const t of v.terminales) if (t.proyectoId) terminalesPorProyecto[t.proyectoId] = (terminalesPorProyecto[t.proyectoId] ?? 0) + 1
  const ventanaConfirmar = ventanas.find((v) => v.id === porCerrar)

  return (
    <div className="app">
      <Sidebar
        datos={datos}
        onAbrir={(p) => abrirProyecto(p)}
        onAbrirGrupo={abrirGrupo}
        abiertos={abiertos}
        terminalesPorProyecto={terminalesPorProyecto}
        onNueva={abrirLibre}
        onAbrirCarpeta={() => void abrirCarpeta()}
        onAgregarRuta={() => setModalAgregar({ rutas: [] })}
        proveedores={proveedores}
        onAbrirConProveedor={abrirProyecto}
        vista={vista}
        onVista={setVista}
        pendientesAsistente={solicitudes.length}
        onAbrirAsistente={abrirAsistente}
      />
      {modalAgregar && (
        <ModalAgregar
          datos={datos}
          rutasIniciales={modalAgregar.rutas}
          onCerrar={() => setModalAgregar(null)}
          onGuardado={(d) => {
            setDatos(d)
            setVista('terminales')
          }}
        />
      )}
      {vista === 'config' && <ConfigProyectos datos={datos} onDatos={setDatos} />}
      {vista === 'agentes' && <ConfigAgentes datos={datos} biblioteca={biblioteca} onBiblioteca={setBiblioteca} />}
      {vista === 'proveedores' && <ConfigProveedores proveedores={proveedores} onProveedores={setProveedores} />}
      <Asistente datos={datos} visible={vista === 'asistente'} />
      <Tareas datos={datos} visible={vista === 'tareas'} />
      <Versiones datos={datos} visible={vista === 'versiones'} onDatos={setDatos} />
      <Api visible={vista === 'api'} />
      <Navegador visible={vista === 'navegador'} />
      {/* siempre montado (oculto en las pantallas de configuración) para no matar los procesos de las terminales */}
      <main className="principal" style={{ display: vista !== 'terminales' ? 'none' : 'flex' }}>
        <div className="ventanas" role="tablist" ref={barraPestanas}>
          {ventanas.map((v) => (
            <div
              key={v.id}
              role="tab"
              aria-selected={v.id === ventanaActiva}
              tabIndex={0}
              className={`ventana-tab${v.id === ventanaActiva ? ' activa' : ''}${separando?.id === v.id ? ' arrastrada' : ''}`}
              title={`${v.nombre} · arrastra hacia abajo para abrirla en otra ventana`}
              onPointerDown={(e) => pestanaAbajo(e, v)}
              onPointerMove={pestanaMueve}
              onPointerUp={(e) => pestanaSuelta(e, v)}
              onPointerCancel={() => {
                drag.current = null
                setSeparando(null)
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setVentanaActiva(v.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  pedirCierre(v)
                }
              }}
            >
              <IconoTerminal />
              <span className="ventana-nombre">{v.nombre}</span>
              <span className="contador">{v.terminales.length}</span>
              <button
                className="cerrar separar"
                title="Abrir en una ventana nueva"
                disabled={v.terminales.length === 0 || v.terminales.some((t) => !t.ptyId)}
                onClick={(e) => {
                  e.stopPropagation()
                  separar(v)
                }}
              >
                <IconoVentana />
              </button>
              <button
                className="cerrar"
                title="Cerrar pestaña"
                onClick={(e) => {
                  e.stopPropagation()
                  pedirCierre(v)
                }}
              >
                <IconoCerrar />
              </button>
            </div>
          ))}
          <button className="icono nueva-pestana" title="Pestaña nueva con una terminal" onClick={nuevaPestana}>
            <IconoMas />
          </button>
        </div>

        {separando && (
          <div className="pestana-fantasma" style={{ left: separando.x, top: separando.y }}>
            <IconoVentana /> Soltar para abrir «{ventanas.find((v) => v.id === separando.id)?.nombre}» en una ventana nueva
          </div>
        )}

        {ventanas.length === 0 && (
          <EstadoVacio
            icono={<IconoTerminal />}
            titulo="Sin pestañas abiertas"
            texto="Abre un grupo con ▶ en la barra lateral (una pestaña por grupo), elige un proyecto o crea una pestaña nueva."
            accion={
              <button className="primario" onClick={nuevaPestana}>
                <IconoMas /> Nueva terminal
              </button>
            }
          />
        )}

        {ventanas.map((v) => (
          <section key={v.id} className="ventana" style={{ display: v.id === ventanaActiva ? 'flex' : 'none' }}>
            <div className="barra">
              <span className="barra-info">
                <span className="punto" /> {v.terminales.length} {v.terminales.length === 1 ? 'terminal' : 'terminales'}
              </span>
              <div className="barra-acciones">
                <div className="menu-nueva">
                  <button onClick={() => setMenuNueva(menuNueva === v.id ? null : v.id)} aria-haspopup="menu" aria-expanded={menuNueva === v.id}>
                    <IconoMas /> Terminal
                  </button>
                  {menuNueva === v.id && (
                    <div className="menu-ia menu-nueva-lista" role="menu" onMouseDown={(e) => e.stopPropagation()}>
                      <div className="menu-ia-tit">Nueva terminal en «{v.nombre}»</div>
                      {datos.proyectos
                        .filter((p) => claveDe(p).id === v.id)
                        .map((p) => (
                          <button key={p.id} role="menuitem" onClick={() => agregarEnVentana(v, p)} title={p.ruta}>
                            <IconoTerminal />
                            <span>{p.nombre}</span>
                          </button>
                        ))}
                      <button role="menuitem" onClick={() => agregarEnVentana(v)}>
                        <IconoTerminal />
                        <span>Terminal vacía (carpeta personal)</span>
                      </button>
                    </div>
                  )}
                </div>
                {v.modo === 'rejilla' && v.personalizado && (
                  <button onClick={() => cambiar(v.id, (x) => ({ ...x, reiniciarLayout: x.reiniciarLayout + 1 }))} title="Volver a la cuadrícula automática">
                    <IconoReiniciar /> Reorganizar
                  </button>
                )}
                <div className="segmentado" role="group" aria-label="Vista">
                  <button className={v.modo === 'rejilla' ? 'on' : ''} onClick={() => cambiar(v.id, (x) => ({ ...x, modo: 'rejilla' }))} title="Rejilla">
                    <IconoRejilla /> Rejilla
                  </button>
                  <button className={v.modo === 'pestanas' ? 'on' : ''} onClick={() => cambiar(v.id, (x) => ({ ...x, modo: 'pestanas' }))} title="Una terminal a la vez">
                    <IconoPestanas /> Pestañas
                  </button>
                </div>
              </div>
            </div>
            <TerminalGrid
              terminales={v.terminales}
              activa={v.activa}
              modo={v.modo}
              reiniciarLayout={v.reiniciarLayout}
              onPersonalizado={(p) => cambiar(v.id, (x) => (x.personalizado === p ? x : { ...x, personalizado: p }))}
              onActivar={(t) => cambiar(v.id, (x) => (x.activa === t ? x : { ...x, activa: t }))}
              onCerrar={(t) => cerrarTerminal(v.id, t)}
              onPty={(t, pty) => alPty(v.id, t, pty)}
              onVista={(t, vis) => cambiar(v.id, (x) => ({ ...x, terminales: x.terminales.map((y) => (y.id === t ? { ...y, vista: vis } : y)) }))}
            />
          </section>
        ))}
      </main>

      <ModalSolicitudGlobal />

      {ventanaConfirmar && (
        <ModalConfirmar
          titulo={`Cerrar «${ventanaConfirmar.nombre}»`}
          texto={`Se cerrarán sus ${ventanaConfirmar.terminales.length} terminal${ventanaConfirmar.terminales.length === 1 ? '' : 'es'} y los procesos que estén ejecutando.`}
          etiqueta="Cerrar pestaña" tono="aviso"
          onConfirmar={() => cerrarVentana(ventanaConfirmar.id)}
          onCerrar={() => setPorCerrar(null)}
        />
      )}
    </div>
  )
}
