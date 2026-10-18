import { useCallback, useEffect, useState } from 'react'
import { IconoMas, IconoPestanas, IconoRejilla, IconoReiniciar, IconoVolver } from './components/Iconos'
import { TerminalGrid, type Modo } from './components/TerminalGrid'
import type { TerminalInfo } from './App'
import { aPayload, reducirPestanas } from './duplicar'
import { ModalSolicitudGlobal } from './components/ModalSolicitud'
import { escucharSolicitudes } from './agente/solicitudes'

let contador = 0

/** Ventana aparte con las terminales de una pestaña: sin barra lateral ni pestañas. */
export function VentanaSeparada({ token }: { token: string }) {
  const [nombre, setNombre] = useState('')
  const [ventanaId, setVentanaId] = useState('')
  const [terminales, setTerminales] = useState<TerminalInfo[] | null>(null)
  const [activa, setActiva] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('rejilla')
  const [reiniciarLayout, setReiniciarLayout] = useState(0)
  const [personalizado, setPersonalizado] = useState(false)

  useEffect(() => escucharSolicitudes(), [])

  useEffect(() => {
    void window.api.ventana.tomar(token).then((p) => {
      if (!p) return setTerminales([])
      setNombre(p.nombre)
      setVentanaId(p.ventanaId)
      setModo(p.modo)
      setTerminales(p.terminales)
      setActiva(p.terminales[0]?.id ?? null)
      document.title = `${p.nombre} · Odesk Agent`
    })
  }, [token])

  const agregar = useCallback(() => {
    const id = `s${++contador}`
    setTerminales((ts) => [...(ts ?? []), { id, titulo: `Terminal ${contador}` }])
    setActiva(id)
  }, [])

  const alPty = useCallback((id: string, ptyId: string) => {
    setTerminales((ts) => (ts ?? []).map((t) => (t.id === id ? { ...t, ptyId } : t)))
  }, [])

  // Devuelve las terminales a la ventana principal (los procesos siguen vivos) y esta ventana se cierra.
  const devolver = (): void => {
    const lista = (terminales ?? []).filter((t): t is TerminalInfo & { ptyId: string } => !!t.ptyId)
    window.api.ventana.devolver({
      ventanaId: ventanaId || 'devueltas',
      nombre,
      modo,
      terminales: lista.map(aPayload)
    })
  }

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
            <button onClick={devolver} title="Devolver estas terminales a la ventana principal (como pestaña)">
              <IconoVolver /> Devolver a la principal
            </button>
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
          onPty={alPty}
          onVista={(id, vista) => setTerminales((ts) => (ts ?? []).map((t) => (t.id === id ? { ...t, vista, extraActiva: undefined } : t)))}
          onPestanas={(id, op) => setTerminales((ts) => (ts ?? []).map((t) => (t.id === id ? reducirPestanas(t, op) : t)))}
        />
        <ModalSolicitudGlobal />
      </main>
    </div>
  )
}
