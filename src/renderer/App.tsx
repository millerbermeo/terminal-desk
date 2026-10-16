import { useCallback, useEffect, useState } from 'react'
import type { DatosProyectos, Proyecto, ProveedorEstado } from '@shared/modelos'
import { IconoCerrar, IconoMas, IconoPestanas, IconoRejilla, IconoReiniciar, IconoTerminal } from './components/Iconos'
import { Sidebar, type Vista } from './components/Sidebar'
import { ConfigProveedores } from './components/ConfigProveedores'
import { ConfigProyectos } from './components/ConfigProyectos'
import { ModalConfirmar } from './components/ModalConfirmar'
import { TerminalGrid, type Modo } from './components/TerminalGrid'

export interface TerminalInfo {
  id: string
  titulo: string
  cwd?: string
  proveedorId?: string
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
const nuevaTerminal = (titulo: string, cwd?: string, proveedorId?: string): TerminalInfo => ({
  id: `t${++contador}`,
  titulo,
  cwd,
  proveedorId
})

export function App() {
  const [datos, setDatos] = useState<DatosProyectos>({ grupos: [], proyectos: [] })
  const [ventanas, setVentanas] = useState<Ventana[]>([])
  const [ventanaActiva, setVentanaActiva] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('terminales')
  const [proveedores, setProveedores] = useState<ProveedorEstado[]>([])
  const [porCerrar, setPorCerrar] = useState<string | null>(null)

  useEffect(() => {
    void window.api.proyectos.listar().then(setDatos)
    void window.api.proveedores.listar().then(setProveedores).catch(() => undefined)
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

  // Un proyecto se abre en la pestaña de su grupo.
  const abrirProyecto = useCallback(
    (p: Proyecto, prov?: ProveedorEstado) => {
      const { id, nombre } = claveDe(p)
      agregar(id, nombre, [nuevaTerminal(prov ? `${p.nombre} · ${prov.nombre}` : p.nombre, p.ruta, prov?.id)])
    },
    [agregar, claveDe]
  )

  // Un grupo: si ya tiene pestaña se va a ella; si no, se abre con una terminal por proyecto.
  const abrirGrupo = useCallback(
    (clave: string, nombre: string, proyectos: Proyecto[]) => {
      if (ventanas.some((v) => v.id === clave)) {
        setVentanaActiva(clave)
        setVista('terminales')
      } else if (proyectos.length > 0) {
        agregar(clave, nombre, proyectos.map((p) => nuevaTerminal(p.nombre, p.ruta)))
      }
    },
    [agregar, ventanas]
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

  const pedirCierre = (v: Ventana): void => (v.terminales.length > 0 ? setPorCerrar(v.id) : cerrarVentana(v.id))
  const abiertos = new Set(ventanas.map((v) => v.id))
  const ventanaConfirmar = ventanas.find((v) => v.id === porCerrar)

  return (
    <div className="app">
      <Sidebar
        datos={datos}
        onAbrir={(p) => abrirProyecto(p)}
        onAbrirGrupo={abrirGrupo}
        abiertos={abiertos}
        onNueva={abrirLibre}
        proveedores={proveedores}
        onAbrirConProveedor={abrirProyecto}
        vista={vista}
        onVista={setVista}
      />
      {vista === 'config' && <ConfigProyectos datos={datos} onDatos={setDatos} />}
      {vista === 'proveedores' && <ConfigProveedores proveedores={proveedores} onProveedores={setProveedores} />}
      {/* siempre montado (oculto en las pantallas de configuración) para no matar los procesos de las terminales */}
      <main className="principal" style={{ display: vista !== 'terminales' ? 'none' : 'flex' }}>
        <div className="ventanas" role="tablist">
          {ventanas.map((v) => (
            <div
              key={v.id}
              role="tab"
              aria-selected={v.id === ventanaActiva}
              tabIndex={0}
              className={`ventana-tab${v.id === ventanaActiva ? ' activa' : ''}`}
              title={v.nombre}
              onClick={() => setVentanaActiva(v.id)}
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

        {ventanas.length === 0 && (
          <div className="vacio vacio-global">
            <div className="vacio-icono"><IconoTerminal /></div>
            <strong>Sin pestañas abiertas</strong>
            <span>Abre un grupo con ▶ en la barra lateral (una pestaña por grupo), elige un proyecto o crea una pestaña nueva.</span>
          </div>
        )}

        {ventanas.map((v) => (
          <section key={v.id} className="ventana" style={{ display: v.id === ventanaActiva ? 'flex' : 'none' }}>
            <div className="barra">
              <span className="barra-info">
                <span className="punto" /> {v.terminales.length} {v.terminales.length === 1 ? 'terminal' : 'terminales'}
              </span>
              <div className="barra-acciones">
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
            />
          </section>
        ))}
      </main>

      {ventanaConfirmar && (
        <ModalConfirmar
          titulo={`Cerrar «${ventanaConfirmar.nombre}»`}
          texto={`Se cerrarán sus ${ventanaConfirmar.terminales.length} terminal${ventanaConfirmar.terminales.length === 1 ? '' : 'es'} y los procesos que estén ejecutando.`}
          etiqueta="Cerrar pestaña"
          onConfirmar={() => cerrarVentana(ventanaConfirmar.id)}
          onCerrar={() => setPorCerrar(null)}
        />
      )}
    </div>
  )
}
