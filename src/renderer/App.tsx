import { useCallback, useEffect, useState } from 'react'
import type { DatosProyectos, Proyecto } from '@shared/modelos'
import { Sidebar } from './components/Sidebar'
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

  useEffect(() => {
    void window.api.proyectos.listar().then(setDatos)
  }, [])

  const abrir = useCallback((titulo: string, cwd?: string) => {
    const id = `t${++contador}`
    setTerminales((ts) => [...ts, { id, titulo, cwd }])
    setActiva(id)
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
      <Sidebar datos={datos} onAbrir={(p: Proyecto) => abrir(p.nombre, p.ruta)} onNueva={() => abrir('Terminal')} />
      <main className="principal">
        <div className="barra">
          <span>{terminales.length} terminal(es)</span>
          <button onClick={() => setModo(modo === 'rejilla' ? 'pestanas' : 'rejilla')}>
            Vista: {modo === 'rejilla' ? 'Rejilla' : 'Pestañas'}
          </button>
        </div>
        <TerminalGrid terminales={terminales} activa={activa} modo={modo} onActivar={setActiva} onCerrar={cerrar} />
      </main>
    </div>
  )
}
