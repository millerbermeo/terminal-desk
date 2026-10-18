import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { EstadoSesion } from '@shared/sesion'
import { Acceso } from './components/Acceso'
import { Cuenta } from './components/Cuenta'
import { confirmar } from './confirmar'
import { App } from './App'
import { AnfitrionConfirmar } from './confirmar'
import { VentanaNavegador } from './VentanaNavegador'
import { VentanaSeparada } from './VentanaSeparada'
import { LimiteErrores } from './components/LimiteErrores'
import { capturarErroresGlobales, vigilarVistaVacia } from './vigilancia'
import './estilos.css'
import './estilos-mejoras.css'

// ?ventana=<token> => ventana separada (solo terminales); sin parámetro => ventana principal
const parametros = new URLSearchParams(location.search)
const token = parametros.get('ventana')
// ?navegador=<id> => barra de direcciones de una ventana del navegador integrado
const navegador = Number(parametros.get('navegador') ?? 0)

/** Ventana principal: sin sesión en el servidor solo se ve el acceso; con sesión, la app. */
function Raiz() {
  const [sesion, setSesion] = useState<EstadoSesion | null>(null)
  const [cuenta, setCuenta] = useState(false)
  const [fallo, setFallo] = useState(false)
  const refrescar = useCallback(() => {
    setFallo(false)
    window.api.sesion.estado().then(setSesion, (err: unknown) => {
      // antes, un fallo aquí dejaba la pantalla en blanco para siempre
      window.api.registro.enviar({ kind: 'sesion-estado', message: err instanceof Error ? err.message : String(err) })
      setFallo(true)
    })
  }, [])
  useEffect(refrescar, [refrescar])
  useEffect(() => window.api.sesion.onPerdida(refrescar), [refrescar]) // el token venció: vuelve el acceso

  const cerrarSesion = async (todas: boolean): Promise<void> => {
    const ok = await confirmar({
      titulo: todas ? 'Cerrar sesión en todos los equipos' : 'Cerrar sesión',
      texto:
        (todas ? 'Tu cuenta dejará de estar abierta en cualquier equipo, también en este. ' : '') +
        'Se cerrarán todas las terminales abiertas. Tus proyectos y agentes siguen en el servidor.',
      etiqueta: 'Cerrar sesión',
      tono: 'aviso'
    })
    if (!ok) return
    setCuenta(false)
    setSesion(todas ? await window.api.sesion.cuenta('cerrarTodas', {}) : await window.api.sesion.cerrar())
  }

  if (!sesion) {
    return fallo ? (
      <div className="limite-errores" role="alert">
        <strong>No se pudo comprobar tu sesión.</strong>
        <span>Puede ser un fallo momentáneo del servidor o de la red.</span>
        <span className="limite-acciones">
          <button type="button" onClick={refrescar}>
            Reintentar
          </button>
        </span>
      </div>
    ) : (
      <div className="cargando-app" aria-live="polite">
        Cargando…
      </div>
    )
  }
  if (!sesion.activa) return <Acceso servidor={sesion.servidor} onEntrar={setSesion} onServidor={setSesion} />
  return (
    <>
      <App email={sesion.email} onCuenta={() => setCuenta(true)} onSesionPerdida={refrescar} />
      {cuenta && (
        <Cuenta email={sesion.email} onCerrarSesion={() => void cerrarSesion(false)} onCerrarTodas={() => void cerrarSesion(true)} onCerrar={() => setCuenta(false)} />
      )}
    </>
  )
}

capturarErroresGlobales()
createRoot(document.getElementById('root')!).render(
  <>
    <LimiteErrores zona="ventana">{navegador > 0 ? <VentanaNavegador id={navegador} /> : token ? <VentanaSeparada token={token} /> : <Raiz />}</LimiteErrores>
    <AnfitrionConfirmar />
  </>
)
vigilarVistaVacia()
