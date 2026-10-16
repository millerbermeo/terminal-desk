import { useCallback, useEffect, useState } from 'react'
import type { DatosProyectos, Proyecto } from '@shared/modelos'
import { IconoPestanas, IconoRejilla } from './components/Iconos'
import { Sidebar } from './components/Sidebar'
import { ConfigProyectos } from './components/ConfigProyectos'
import { TerminalGrid, type Modo } from './components/TerminalGrid'

export interface TerminalInfo {
  id: string
  titulo: string
  cwd?: string
}

let contador = 0

export function App() {
  const [datos, setDatos] = useState<DatosProyectos>({ grupos: [], proyectos: [] })
  const [terminales, setTerminales] = useState<TerminalInfo[]>([])
  const [activa, setActiva] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('rejilla')
  const [vista, setVista] = useState<'terminales' | 'config'>('terminales')

  useEffect(() => {
    void window.api.proyectos.listar().then(setDatos)
  }, [])

  const abrir = useCallback((titulo: string, cwd?: string) => {
    const id = `t${++contador}`
    setTerminales((ts) => [...ts, { id, titulo, cwd }])
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
        onConfig={() => setVista(vista === 'config' ? 'terminales' : 'config')}
        configActiva={vista === 'config'}
      />
      {vista === 'config' && <ConfigProyectos datos={datos} onDatos={setDatos} />}
      {/* siempre montado (oculto en config) para no matar los procesos de las terminales */}
      <main className="principal" style={{ display: vista === 'config' ? 'none' : 'flex' }}>
        <div className="barra">
          <span className="barra-info">
            <span className="punto" /> {terminales.length} {terminales.length === 1 ? 'terminal' : 'terminales'}
          </span>
          <div className="segmentado" role="group" aria-label="Vista">
            <button className={modo === 'rejilla' ? 'on' : ''} onClick={() => setModo('rejilla')} title="Rejilla">
              <IconoRejilla /> Rejilla
            </button>
            <button className={modo === 'pestanas' ? 'on' : ''} onClick={() => setModo('pestanas')} title="Pestañas">
              <IconoPestanas /> Pestañas
            </button>
          </div>
        </div>
        <TerminalGrid terminales={terminales} activa={activa} modo={modo} onActivar={setActiva} onCerrar={cerrar} />
      </main>
    </div>
  )
}
