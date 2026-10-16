import { useCallback, useEffect, useState } from 'react'
import type { DatosProyectos, Proyecto, ProveedorEstado } from '@shared/modelos'
import { IconoPestanas, IconoRejilla, IconoReiniciar } from './components/Iconos'
import { Sidebar, type Vista } from './components/Sidebar'
import { ConfigProveedores } from './components/ConfigProveedores'
import { ConfigProyectos } from './components/ConfigProyectos'
import { TerminalGrid, type Modo } from './components/TerminalGrid'

export interface TerminalInfo {
  id: string
  titulo: string
  cwd?: string
  proveedorId?: string
}

let contador = 0

export function App() {
  const [datos, setDatos] = useState<DatosProyectos>({ grupos: [], proyectos: [] })
  const [terminales, setTerminales] = useState<TerminalInfo[]>([])
  const [activa, setActiva] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('rejilla')
  const [vista, setVista] = useState<Vista>('terminales')
  const [reiniciarLayout, setReiniciarLayout] = useState(0)
  const [personalizado, setPersonalizado] = useState(false)
  const [proveedores, setProveedores] = useState<ProveedorEstado[]>([])

  useEffect(() => {
    void window.api.proyectos.listar().then(setDatos)
    void window.api.proveedores.listar().then(setProveedores).catch(() => undefined)
  }, [])

  const abrir = useCallback((titulo: string, cwd?: string) => {
    const id = `t${++contador}`
    setTerminales((ts) => [...ts, { id, titulo, cwd }])
    setActiva(id)
    setVista('terminales')
  }, [])

  const abrirConProveedor = useCallback((p: Proyecto, prov: ProveedorEstado) => {
    const id = `t${++contador}`
    setTerminales((ts) => [...ts, { id, titulo: `${p.nombre} · ${prov.nombre}`, cwd: p.ruta, proveedorId: prov.id }])
    setActiva(id)
    setVista('terminales')
  }, [])

  const abrirVarios = useCallback((proyectos: Proyecto[]) => {
    if (proyectos.length === 0) return
    const nuevas = proyectos.map((p) => ({ id: `t${++contador}`, titulo: p.nombre, cwd: p.ruta }))
    setTerminales((ts) => [...ts, ...nuevas])
    setActiva(nuevas[0].id)
    setVista('terminales')
  }, [])

  const cerrar = useCallback((id: string) => {
    setTerminales((ts) => {
      const resto = ts.filter((t) => t.id !== id)
      setActiva((a) => (a === id ? (resto[resto.length - 1]?.id ?? null) : a))
      return resto
    })
  }, [])

  return (
    <div className="app">
      <Sidebar datos={datos} onAbrir={(p: Proyecto) => abrir(p.nombre, p.ruta)} onAbrirVarios={abrirVarios}
        onNueva={() => abrir('Terminal')}
        proveedores={proveedores}
        onAbrirConProveedor={abrirConProveedor}
        vista={vista}
        onVista={setVista}
      />
      {vista === 'config' && <ConfigProyectos datos={datos} onDatos={setDatos} />}
      {vista === 'proveedores' && <ConfigProveedores proveedores={proveedores} onProveedores={setProveedores} />}
      {/* siempre montado (oculto en config) para no matar los procesos de las terminales */}
      <main className="principal" style={{ display: vista !== 'terminales' ? 'none' : 'flex' }}>
        <div className="barra">
          <span className="barra-info">
            <span className="punto" /> {terminales.length} {terminales.length === 1 ? 'terminal' : 'terminales'}
          </span>
          <div className="barra-acciones">
          {modo === 'rejilla' && personalizado && (
            <button onClick={() => setReiniciarLayout((n) => n + 1)} title="Volver a la cuadrícula automática">
              <IconoReiniciar /> Reorganizar
            </button>
          )}
          <div className="segmentado" role="group" aria-label="Vista">
            <button className={modo === 'rejilla' ? 'on' : ''} onClick={() => setModo('rejilla')} title="Rejilla">
              <IconoRejilla /> Rejilla
            </button>
            <button className={modo === 'pestanas' ? 'on' : ''} onClick={() => setModo('pestanas')} title="Pestañas">
              <IconoPestanas /> Pestañas
            </button>
          </div>
          </div>
        </div>
        <TerminalGrid
          terminales={terminales}
          activa={activa}
          modo={modo}
          reiniciarLayout={reiniciarLayout}
          onPersonalizado={setPersonalizado}
          onActivar={setActiva}
          onCerrar={cerrar}
        />
      </main>
    </div>
  )
}
