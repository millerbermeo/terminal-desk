import { createRoot } from 'react-dom/client'
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

createRoot(document.getElementById('root')!).render(
  <>
    {navegador > 0 ? <VentanaNavegador id={navegador} /> : token ? <VentanaSeparada token={token} /> : <App />}
    <AnfitrionConfirmar />
  </>
)
