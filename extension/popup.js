const $ = (id) => document.getElementById(id)
const pedir = (m) => chrome.runtime.sendMessage(m)

function mostrarError(texto) {
  $('error').textContent = texto || ''
}

async function pintar() {
  const s = await pedir({ tipo: 'estado' })
  const chip = $('estado')
  const textos = { conectado: s.pausado ? 'En pausa' : 'Conectado', conectando: 'Conectando…', desconectado: 'Sin Odesk', 'sin-emparejar': 'Sin emparejar' }
  chip.textContent = textos[s.estado] ?? s.estado
  chip.className = `chip ${s.estado === 'conectado' ? (s.pausado ? 'aviso' : 'ok') : 'neutro'}`
  $('emparejar').hidden = s.estado !== 'sin-emparejar'
  $('desconectado').hidden = !(s.estado === 'desconectado' || s.estado === 'conectando')
  $('conectado').hidden = s.estado !== 'conectado'
  $('olvidar').hidden = s.estado === 'sin-emparejar'
  if (s.error && s.estado !== 'conectado') mostrarError(s.error)

  const a = s.actual
  $('pestana').textContent = a ? `${a.titulo || a.url}` : ''
  $('pestana').title = a?.url ?? ''
  $('compartir').hidden = !a || a.compartida
  $('compartir').disabled = !a?.web
  $('compartir').title = a?.web ? '' : 'Solo páginas web (http/https)'
  $('dejar').hidden = !a?.compartida
  $('resumen').textContent = s.pestanas === 1 ? '1 pestaña compartida con Odesk.' : `${s.pestanas} pestañas compartidas con Odesk.`
  $('pausar').textContent = s.pausado ? 'Reanudar el control de la IA' : 'Pausar el control de la IA'
  $('pausar').className = s.pausado ? 'primario' : ''
  $('pausar').dataset.pausado = String(s.pausado)
}

async function accion(m) {
  mostrarError('')
  const r = await pedir(m)
  if (r?.error) mostrarError(r.error)
  await pintar()
}

$('form-codigo').addEventListener('submit', (e) => {
  e.preventDefault()
  const codigo = $('codigo').value.replace(/\D/g, '')
  if (codigo.length !== 6) return mostrarError('El código tiene 6 cifras.')
  void accion({ tipo: 'emparejar', codigo })
})
$('reintentar').addEventListener('click', () => void accion({ tipo: 'reconectar' }))
$('compartir').addEventListener('click', () => void accion({ tipo: 'compartir' }))
$('dejar').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) void accion({ tipo: 'dejar', id: tab.id })
})
$('pausar').addEventListener('click', () => void accion({ tipo: 'pausar', valor: $('pausar').dataset.pausado !== 'true' }))
$('olvidar').addEventListener('click', () => void accion({ tipo: 'olvidar' }))

void pintar()
setInterval(() => void pintar(), 1500)
