import { useCallback, useEffect, useState } from 'react'
import { IconoMas, IconoPestanas, IconoRejilla, IconoReiniciar } from './components/Iconos'
import { TerminalGrid, type Modo } from './components/TerminalGrid'
import type { TerminalInfo } from './App'

let contador = 0

/** Ventana aparte con las terminales de una pestaña: sin barra lateral ni pestañas. */
export function VentanaSeparada({ token }: { token: string }) {
  const [nombre, setNombre] = useState('')
  const [terminales, setTerminales] = useState<TerminalInfo[] | null>(null)
  const [activa, setActiva] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('rejilla')
  const [reiniciarLayout, setReiniciarLayout] = useState(0)
  const [personalizado, setPersonalizado] = useState(false)

  useEffect(() => {
    void window.api.ventana.tomar(token).then((p) => {
      if (!p) return setTerminales([])
      setNombre(p.nombre)
      setModo(p.modo)
      setTerminales(p.terminales)
      setActiva(p.terminales[0]?.id ?? null)
      document.title = `${p.nombre} · Centro de Proyectos`
    })
  }, [token])

  const agregar = useCallback(() => {
    const id = `s${++contador}`
    setTerminales((ts) => [...(ts ?? []), { id, titulo: `Terminal ${contador}` }])
    setActiva(id)
  }, [])

  const cerrar = useCallback((id: string) => {
    setTerminales((ts) => {
      const resto = (ts ?? []).filter((t) => t.id !== id)
      setActiva((a) => (a === id ? (resto[resto.length - 1]?.id ?? null) : a))
      return resto
    })
  }, [])

  if (!terminales) return <div className="app ventana-sola" />

  return (
    <div className="app ventana-sola">
      <main className="principal">
        <div className="barra">
          <span className="barra-info">
            <span className="punto" /> {nombre} · {terminales.length} {terminales.length === 1 ? 'terminal' : 'terminales'}
          </span>
          <div className="barra-acciones">
            <button onClick={agregar} title="Terminal nueva (carpeta personal)">
              <IconoMas /> Terminal
            </button>
            {modo === 'rejilla' && personalizado && (
              <button onClick={() => setReiniciarLayout((n) => n + 1)} title="Volver a la cuadrícula automática">
                <IconoReiniciar /> Reorganizar
              </button>
            )}
            <div className="segmentado" role="group" aria-label="Vista">
              <button className={modo === 'rejilla' ? 'on' : ''} onClick={() => setModo('rejilla')} title="Rejilla">
                <IconoRejilla /> Rejilla
              </button>
              <button className={modo === 'pestanas' ? 'on' : ''} onClick={() => setModo('pestanas')} title="Una terminal a la vez">
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
