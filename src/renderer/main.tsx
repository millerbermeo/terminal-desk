import { createRoot } from 'react-dom/client'
import { App } from './App'
import { VentanaSeparada } from './VentanaSeparada'
import './estilos.css'

// ?ventana=<token> => ventana separada (solo terminales); sin parámetro => ventana principal
const token = new URLSearchParams(location.search).get('ventana')

createRoot(document.getElementById('root')!).render(token ? <VentanaSeparada token={token} /> : <App />)
