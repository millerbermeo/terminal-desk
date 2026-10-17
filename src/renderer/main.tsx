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
import './estilos.css'

// ?ventana=<token> => ventana separada (solo terminales); sin parámetro => ventana principal
const parametros = new URLSearchParams(location.search)
const token = parametros.get('ventana')
// ?navegador=<id> => barra de direcciones de una ventana del navegador integrado
const navegador = Number(parametros.get('navegador') ?? 0)

/** Ventana principal: sin sesión en el servidor solo se ve el acceso; con sesión, la app. */
function Raiz() {
  const [sesion, setSesion] = useState<EstadoSesion | null>(null)
  const [cuenta, setCuenta] = useState(false)
  const refrescar = useCallback(() => void window.api.sesion.estado().then(setSesion), [])
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

  if (!sesion) return null
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

createRoot(document.getElementById('root')!).render(
  <>
    {navegador > 0 ? <VentanaNavegador id={navegador} /> : token ? <VentanaSeparada token={token} /> : <Raiz />}
    <AnfitrionConfirmar />
  </>
)
