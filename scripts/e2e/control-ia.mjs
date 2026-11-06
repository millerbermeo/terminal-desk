/**
 * Prueba de punta a punta (Electron real, ptys reales, puertos reales) de:
 *  - el control de Odesk por MCP desde un asistente externo (servidor «odesk» lanzado como lo haría Claude Desktop): proyectos,
 *    terminales, servicios de arranque, ajustes, historial, Asistente, y la confirmación en Odesk de lo destructivo;
 *  - el Asistente con un `claude` FALSO (no gasta tokens): corte por límite de pasos → continuación automática en un proceso nuevo,
 *    Playwright + Chrome DevTools en el mismo navegador (args del --mcp-config) y la guía en el prompt de sistema;
 *  - el scroll del chat mientras responde (se puede subir; aparece «ir abajo»; al pulsarlo vuelve a seguir el final);
 *  - la instalación del MCP en clientes externos desde Proveedores de IA.
 *      pnpm build && pnpm e2e:control-ia
 * Usa un HOME temporal (no toca ~/.odesk-agent ni ~/.claude) y borra todo al terminar.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as servidorTcp } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RAIZ = join(tmpdir(), `odesk-e2e-control-${Date.now()}`)
const HOME = join(RAIZ, 'home')
const DIR = join(HOME, '.odesk-agent')
const CDP = 9312
const ELECTRON = join(APP, 'node_modules/.bin/electron')
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
let fallos = 0
const paso = (t, ok, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${t}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`)
  if (!ok) fallos++
}
const hasta = async (cond, ms = 15000) => {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    try {
      if (await cond()) return true
    } catch {
      /* aún no */
    }
    await dormir(100)
  }
  return false
}
const puertoLibre = () => new Promise((r) => { const s = servidorTcp().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const abierto = (puerto) => new Promise((r) => { const s = servidorTcp().once('error', () => r(true)).listen(puerto, '127.0.0.1', () => s.close(() => r(false))) })

if (!existsSync(join(APP, 'out', 'main', 'mcp-tareas.js'))) throw new Error('Falta out/: ejecuta pnpm build')
mkdirSync(DIR, { recursive: true })
mkdirSync(join(HOME, '.claude'), { recursive: true })

// ───────── `claude` falso: sesión de suscripción, proceso persistente stream-json con eco, y anota con qué argumentos lo lanzan
const VOLCADO = join(RAIZ, 'claude.jsonl')
const BIN = join(RAIZ, 'bin')
mkdirSync(BIN, { recursive: true })
writeFileSync(
  join(BIN, 'claude'),
  `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
const anota = (o) => fs.appendFileSync(${JSON.stringify(VOLCADO)}, JSON.stringify({ pid: process.pid, ...o }) + '\\n')
if (a[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0) }
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'e2e@desk.local' })); process.exit(0) }
if (a.includes('--no-session-persistence')) {
  let t = ''; process.stdin.on('data', (d) => (t += d)); process.stdin.on('end', () => { console.log(JSON.stringify({ is_error: false, result: 'Título e2e' })); process.exit(0) })
  return
}
const sid = a.includes('--resume') ? a[a.indexOf('--resume') + 1] : 'ses-' + process.pid
anota({ arranque: true, args: a })
const l = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
let iniciado = false, entrada = '', parar = null
let ultimo = ''
const resultado = (error) => l({ type: 'result', subtype: error ? 'error_during_execution' : 'success', is_error: Boolean(error), session_id: sid, result: error ? undefined : ultimo, usage: { input_tokens: 5, output_tokens: 2 }, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 5, outputTokens: 2, costUSD: 0.001, contextWindow: 200000 } } })
const paso = (texto) => (ultimo = texto, l({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, output_tokens: 2 }, content: [{ type: 'text', text: texto }] } }))
function recibir(m) {
  if (!iniciado) { iniciado = true; l({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-sonnet-5-5' }) }
  if (m.type === 'control_request') {
    anota({ control: m.request.subtype })
    if (m.request.subtype === 'interrupt' && parar) { parar(); parar = null }
    return l({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } })
  }
  if (m.type !== 'user') return
  const texto = typeof m.message.content === 'string' ? m.message.content : JSON.stringify(m.message.content)
  anota({ usuario: texto.slice(-200) })
  l({ type: 'user', uuid: m.uuid, session_id: sid, message: m.message })
  if (texto.includes('BUCLE')) { for (let k = 0; k < 10; k++) paso('paso ' + k); return resultado(false) }
  if (texto.includes('Continúa exactamente')) {
    // respuesta larga y lenta: da tiempo a probar el scroll del chat mientras llega
    let i = 0, todo = ''
    const t = setInterval(() => {
      const linea = 'Línea ' + i + ' de la respuesta larga del asistente falso.\\n'
      todo += linea
      l({ type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: linea } } })
      if (++i >= 90) { clearInterval(t); parar = null; paso(todo + 'FIN-RESPUESTA-LARGA'); resultado(false) }
    }, 120)
    parar = () => { clearInterval(t); resultado(true) }
    return
  }
  paso('hecho: ' + texto.slice(-40)); resultado(false)
}
process.stdin.on('data', (d) => { entrada += d; let n; while ((n = entrada.indexOf('\\n')) >= 0) { const x = entrada.slice(0, n); entrada = entrada.slice(n + 1); if (x.trim()) recibir(JSON.parse(x)) } })
process.stdin.on('end', () => process.exit(0))
`
)
chmodSync(join(BIN, 'claude'), 0o755)
const volcado = () => (existsSync(VOLCADO) ? readFileSync(VOLCADO, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)) : [])

// ───────── API mínima en memoria (login, proyectos, comandos de arranque)
const EMAIL = 'e2e-control@desk.local'
const proyectos = []
const arranque = []
const api = createServer((req, res) => {
  const responder = (c, cuerpo) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo)) }
  const cuerpo = () => new Promise((r) => { const t = []; req.on('data', (x) => t.push(x)); req.on('end', () => r(JSON.parse(Buffer.concat(t).toString() || '{}'))) })
  const url = (req.url ?? '').split('?')[0]
  if (url === '/auth/login') return responder(200, { token: 'token-falso', usuario: { id: 'u1', email: EMAIL } })
  if (url === '/projects' && req.method === 'GET') return responder(200, { groups: [], projects: proyectos.map((p) => ({ id: p.id, name: p.name, repo: null, groupId: null })) })
  if (url === '/projects' && req.method === 'POST') return void cuerpo().then((c) => { const p = { id: randomUUID(), name: c.name }; proyectos.push(p); responder(201, { id: p.id, name: p.name, repo: null, groupId: null }) })
  const uno = /^\/projects\/([^/?]+)$/.exec(url)
  if (uno && req.method === 'GET') { const p = proyectos.find((x) => x.id === uno[1]); return p ? responder(200, { id: p.id, name: p.name, repo: null, groupId: null }) : responder(404, { message: 'no existe' }) }
  if (url === '/arranque' && req.method === 'GET') return responder(200, { commands: arranque })
  if (url === '/arranque' && req.method === 'PUT') return void cuerpo().then((c) => { const previo = arranque.find((x) => x.id === c.id); const fila = { id: randomUUID(), position: arranque.filter((x) => x.projectId === c.projectId).length, ...(previo ?? {}), ...c }; if (previo) Object.assign(previo, fila); else arranque.push(fila); responder(200, fila) })
  responder(404, { message: 'no implementado' })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const URL_API = `http://127.0.0.1:${api.address().port}`

// ───────── Electron real
const CONFIRMAR = join(RAIZ, 'confirmar.txt')
writeFileSync(CONFIRMAR, 'rechazar')
const fijarRespuesta = (r) => writeFileSync(CONFIRMAR, r)
const preguntas = () => (existsSync(CONFIRMAR + '.log') ? readFileSync(CONFIRMAR + '.log', 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)) : [])
const entorno = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
await hasta(async () => !(await abierto(CDP)), 15000)
const proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${CDP}`], {
  cwd: APP,
  stdio: process.env.DEPURAR ? 'inherit' : 'ignore',
  env: { ...entorno, HOME, PATH: `${BIN}:${process.env.PATH}`, ODESK_API_URL: URL_API, ODESK_PERMITIR_HTTP: '1', ODESK_SIN_CAVEMAN: '1', ODESK_SIN_PLAYWRIGHT: '1', ODESK_MAX_PASOS: '4', ODESK_E2E_CONFIRMAR: CONFIRMAR }
})
const hijos = []
async function limpiar() {
  for (const h of hijos) try { h.kill('SIGKILL') } catch { /* ya no está */ }
  proc.kill('SIGTERM')
  api.close()
  await dormir(1500)
  if (!process.env.CONSERVAR) rmSync(RAIZ, { recursive: true, force: true })
}
process.on('SIGINT', () => void limpiar().then(() => process.exit(1)))

// ───────── cliente MCP externo: el mismo servidor «odesk» que se instala en Claude Desktop/Cursor (sin proyecto ligado)
function clienteMcp() {
  const p = spawn(ELECTRON, [join(APP, 'out', 'main', 'mcp-tareas.js')], { env: { ...entorno, ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: DIR, HOME }, stdio: ['pipe', 'pipe', 'pipe'] })
  hijos.push(p)
  let buf = '', id = 0
  const esperas = new Map()
  p.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const x = buf.slice(0, n); buf = buf.slice(n + 1); try { const m = JSON.parse(x); esperas.get(m.id)?.(m); esperas.delete(m.id) } catch { /* ruido */ } } })
  const pedir = (method, params) => new Promise((r) => { const i = ++id; esperas.set(i, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n') })
  const tool = async (name, args = {}) => {
    const r = await pedir('tools/call', { name, arguments: args })
    return { texto: r.result?.content?.[0]?.text ?? JSON.stringify(r.error), error: Boolean(r.result?.isError || r.error) }
  }
  const json = async (name, args) => { const r = await tool(name, args); try { return JSON.parse(r.texto) } catch { throw new Error(`${name}: ${r.texto}`) } }
  return { pedir, tool, json }
}

try {
  let pagina
  for (let i = 0; i < 80 && !pagina; i++) {
    await dormir(500)
    try { pagina = (await (await fetch(`http://localhost:${CDP}/json`)).json()).find((t) => t.type === 'page' && !t.url.includes('navegador=')) } catch { /* arrancando */ }
  }
  if (!pagina) throw new Error('electron no arrancó')
  const ws = new WebSocket(pagina.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let n = 0
  const esp = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && esp.has(d.id)) { esp.get(d.id)(d); esp.delete(d.id) } }
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  await cdp('Page.bringToFront')
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  await dormir(1500)
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails).slice(0, 500))
    return r.result.result.value
  }
  const texto = () => ev('document.body.innerText').catch(() => '')

  // ───────── sesión y proyectos
  const login = await ev(`window.api.sesion.iniciar({email:${JSON.stringify(EMAIL)},password:'x'})`)
  paso('entra con el API de prueba', login.ok === true, login.mensaje)
  const tienda = join(RAIZ, 'tienda'), blog = join(RAIZ, 'blog')
  mkdirSync(tienda, { recursive: true })
  mkdirSync(blog, { recursive: true })
  writeFileSync(join(tienda, 'notas.txt'), 'version uno\n')
  const ag = await ev(`window.api.proyectos.agregar({proyectos:[{nombre:'Tienda',ruta:${JSON.stringify(tienda)}},{nombre:'Blog',ruta:${JSON.stringify(blog)}}]})`)
  paso('registra los proyectos', ag.errores.length === 0 && ag.datos.proyectos.length === 2, JSON.stringify(ag.errores))
  const idTienda = ag.datos.proyectos.find((p) => p.nombre === 'Tienda').id
  const idBlog = ag.datos.proyectos.find((p) => p.nombre === 'Blog').id
  await ev('location.reload()').catch(() => undefined)
  await dormir(500)
  paso('la interfaz muestra los proyectos', await hasta(async () => /Tienda/.test(await texto()) && /Blog/.test(await texto())))

  // ───────── MCP externo
  const mcp = clienteMcp()
  const ini = await mcp.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Cliente E2E', version: '1' } })
  paso('el servidor MCP «odesk» responde al cliente externo', ini.result?.serverInfo?.name === 'odesk')
  const lista = (await mcp.pedir('tools/list', {})).result.tools.map((t) => t.name)
  paso('expone las herramientas de la app', ['odesk_proyectos', 'terminal_abrir', 'servicios_arrancar', 'asistente_enviar', 'historial_restaurar'].every((x) => lista.includes(x)), `${lista.length} herramientas`)

  const est = await mcp.json('odesk_proyectos')
  paso('odesk_proyectos lista los proyectos de este equipo', est.proyectos.map((p) => p.nombre).sort().join() === 'Blog,Tienda', JSON.stringify(est.proyectos))

  // ───────── proyectos y terminales
  const xterms = () => ev(`[...document.querySelectorAll('main.principal:not(.servicios) .xterm')].length`)
  await mcp.tool('proyecto_abrir', { proyecto_id: idTienda })
  paso('proyecto_abrir abre la terminal del proyecto en la interfaz', await hasta(async () => (await xterms()) === 1, 10000), `${await xterms()} terminales`)
  const abierta = await mcp.json('terminal_abrir', { proyecto_id: idTienda })
  paso('terminal_abrir crea una terminal nueva y la muestra', await hasta(async () => (await xterms()) === 2, 10000) && /Tienda · IA/.test(await texto()), JSON.stringify(abierta))
  const t = abierta.terminal
  const listadas = await mcp.json('terminal_listar', { proyecto_id: idTienda })
  paso('terminal_listar sabe de qué proyecto es cada terminal (la del usuario y la de la IA)', listadas.length === 2 && listadas.some((x) => x.id === t && x.abierta_por_ia) && listadas.some((x) => !x.abierta_por_ia), JSON.stringify(listadas))
  await hasta(async () => !(await mcp.tool('terminal_leer', { terminal: t })).texto.includes('sin salida'), 5000)
  await mcp.tool('terminal_escribir', { terminal: t, texto: 'echo HOLA-E2E-$((40+2))' })
  const leido = (await mcp.tool('terminal_leer', { terminal: t, esperar_ms: 1200 })).texto
  paso('terminal_escribir ejecuta y terminal_leer ve la salida (sin colores)', /HOLA-E2E-42/.test(leido) && !/\u001b\[/.test(leido), leido.split('\n').slice(-3).join(' | '))
  const peligro = await mcp.tool('terminal_escribir', { terminal: t, texto: 'sudo rm -rf /' })
  paso('bloquea un comando catastrófico', peligro.error && /Bloqueado/.test(peligro.texto), peligro.texto)
  paso('una tecla especial (ctrl+c) también llega', !(await mcp.tool('terminal_escribir', { terminal: t, tecla: 'ctrl+c' })).error)

  fijarRespuesta('rechazar')
  const noCierra = await mcp.tool('terminal_cerrar', { terminal: t })
  const q = preguntas().at(-1)
  paso('cerrar una terminal se pregunta en Odesk, con el nombre del cliente', q?.cliente === 'Cliente E2E' && q.pregunta.includes(t), JSON.stringify(q))
  paso('rechazado: no se cierra', noCierra.error && (await mcp.json('terminal_listar')).some((x) => x.id === t) && (await xterms()) === 2, noCierra.texto)
  fijarRespuesta('permitir')
  const cierra = await mcp.tool('terminal_cerrar', { terminal: t })
  paso('permitido: se cierra el proceso y la celda', !cierra.error && (await hasta(async () => (await xterms()) === 1, 8000)) && !(await mcp.json('terminal_listar')).some((x) => x.id === t), cierra.texto)

  // ───────── servicios de arranque
  const P = await puertoLibre()
  await ev(`window.api.arranque.operar('guardar', ${JSON.stringify({ proyectoId: idTienda, comando: { nombre: 'Web', comando: `node -e "require('net').createServer().listen(${P},'127.0.0.1',()=>console.log('SERV'+'IDOR LISTO'))"`, puerto: P, esperar: 'puerto' } })})`)
  const sl = await mcp.json('servicios_listar', { proyecto_id: idTienda })
  paso('servicios_listar muestra el comando detenido', sl.length === 1 && sl[0].estado === 'detenido' && sl[0].puerto === P, JSON.stringify(sl))
  const arr = await mcp.json('servicios_arrancar', { proyecto_id: idTienda })
  paso('servicios_arrancar lo lanza y espera a que esté listo', arr[0]?.estado === 'listo' && (await abierto(P)), JSON.stringify(arr))
  paso('servicio_logs lee su salida', /SERVIDOR LISTO/.test((await mcp.tool('servicio_logs', { proyecto_id: idTienda, id: sl[0].id })).texto))
  fijarRespuesta('rechazar')
  const noPara = await mcp.tool('servicios_detener', { proyecto_id: idTienda })
  paso('detener sin permiso no para nada', noPara.error && (await abierto(P)), noPara.texto)
  fijarRespuesta('permitir')
  const rein = await mcp.json('servicios_reiniciar', { proyecto_id: idTienda })
  paso('servicios_reiniciar (permitido) lo para y lo vuelve a lanzar', rein[0]?.estado === 'listo' && (await abierto(P)), JSON.stringify(rein))
  await mcp.tool('servicios_detener', { proyecto_id: idTienda })
  paso('servicios_detener (permitido) libera el puerto', await hasta(async () => !(await abierto(P)), 8000))

  // ───────── ajustes
  await mcp.tool('ajustes_fijar', { proyecto_id: idTienda, modelo: 'opus' })
  paso('ajustes_fijar cambia el modelo sin preguntar', (await mcp.json('ajustes_leer', { proyecto_id: idTienda })).ajustes.modelo === 'opus')
  fijarRespuesta('rechazar')
  const sinAuto = await mcp.tool('ajustes_fijar', { proyecto_id: idTienda, autonomia: 'autonomo' })
  paso('pasar a «autonomo» se pregunta; rechazado no cambia', sinAuto.error && (await mcp.json('ajustes_leer', { proyecto_id: idTienda })).ajustes.autonomia !== 'autonomo' && /Autónomo/.test(preguntas().at(-1)?.pregunta))
  fijarRespuesta('permitir')
  await mcp.tool('ajustes_fijar', { proyecto_id: idTienda, autonomia: 'autonomo', modelo: 'auto' })
  const aj = (await mcp.json('ajustes_leer', { proyecto_id: idTienda })).ajustes
  paso('permitido sí cambia (y «auto» vuelve al modelo por defecto)', aj.autonomia === 'autonomo' && !aj.modelo, JSON.stringify(aj))
  paso('consumo responde', !(await mcp.tool('consumo')).error)

  // ───────── historial local (vigila la carpeta: cada cambio externo es una versión)
  const versionesDe = async () => { const v = await mcp.json('historial_versiones', { proyecto_id: idTienda, ruta: 'notas.txt' }).catch(() => []); return Array.isArray(v) ? v : [] }
  await dormir(1500)
  writeFileSync(join(tienda, 'notas.txt'), 'version dos\n')
  await hasta(async () => (await versionesDe()).length >= 1, 12000)
  await dormir(1200)
  writeFileSync(join(tienda, 'notas.txt'), 'version tres\n')
  const conVersiones = await hasta(async () => (await versionesDe()).length >= 2, 12000)
  const versiones = await versionesDe()
  paso('el historial local registra los cambios del archivo', conVersiones, `${versiones.length} versiones`)
  if (conVersiones) {
    const vieja = versiones.reduce((a, b) => (a.fecha <= b.fecha ? a : b))
    const diff = await mcp.tool('historial_comparar', { proyecto_id: idTienda, ruta: 'notas.txt', hasta: vieja.id })
    paso('historial_comparar da las diferencias', !diff.error && /dos|tres/.test(diff.texto), diff.texto.slice(0, 160))
    fijarRespuesta('rechazar')
    await mcp.tool('historial_restaurar', { proyecto_id: idTienda, ruta: 'notas.txt', version: vieja.id })
    paso('historial_restaurar sin permiso no toca el archivo', readFileSync(join(tienda, 'notas.txt'), 'utf8') === 'version tres\n')
    fijarRespuesta('permitir')
    await mcp.tool('historial_restaurar', { proyecto_id: idTienda, ruta: 'notas.txt', version: vieja.id })
    paso('historial_restaurar (permitido) devuelve el archivo a la versión', readFileSync(join(tienda, 'notas.txt'), 'utf8') === 'version dos\n', readFileSync(join(tienda, 'notas.txt'), 'utf8'))
  }

  // ───────── Asistente: mensaje externo, corte por pasos → continuación en proceso nuevo, scroll del chat
  await mcp.tool('asistente_enviar', { proyecto_id: idTienda, mensaje: 'Prueba BUCLE desde fuera' })
  paso('asistente_enviar abre el Asistente del proyecto con el mensaje', await hasta(async () => /Prueba BUCLE desde fuera/.test(await texto()), 10000))
  const hilo = `[...document.querySelectorAll('.ag-hilo')].find((e) => e.offsetParent)`
  const largo = await hasta(async () => /Línea 2\d de la respuesta/.test(await texto()) && (await ev(`(() => { const h = ${hilo}; return !!h && h.scrollHeight > h.clientHeight + 300 })()`)), 25000)
  paso('tras cortarse por el límite de pasos, sigue sola (continuación automática)', largo && /Línea/.test(await texto()))
  const arranques = volcado().filter((x) => x.arranque && x.args.includes('--mcp-config'))
  paso('la continuación va en un proceso NUEVO que reanuda la sesión', arranques.length >= 2 && arranques[1].args.includes('--resume') && arranques[0].pid !== arranques[1].pid, `${arranques.length} procesos`)
  paso('y no se perdió el mensaje (sin «no lo repitió a tiempo»)', !/no lo repitió a tiempo/.test(await texto()))

  // scroll mientras responde
  await ev(`(() => { const h = ${hilo}; h.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, bubbles: true })); h.scrollTop = 0 })()`)
  const alto0 = await ev(`(${hilo}).scrollHeight`)
  await dormir(1500)
  const tras = await ev(`(() => { const h = ${hilo}; return { top: h.scrollTop, alto: h.scrollHeight, boton: !!h.querySelector('.ag-ir-abajo') } })()`)
  paso('mientras responde se puede subir: no lo devuelve al final', tras.top < 60 && tras.alto > alto0, JSON.stringify(tras))
  paso('aparece el botón «ir abajo»', tras.boton)
  await ev(`(${hilo}).querySelector('.ag-ir-abajo').click()`)
  await dormir(1200)
  const abajo = await ev(`(() => { const h = ${hilo}; return { falta: h.scrollHeight - h.scrollTop - h.clientHeight, boton: !!h.querySelector('.ag-ir-abajo') } })()`)
  paso('al pulsarlo baja al final y el botón desaparece', abajo.falta < 80 && !abajo.boton, JSON.stringify(abajo))
  await dormir(1000)
  const sigue = await ev(`(() => { const h = ${hilo}; return h.scrollHeight - h.scrollTop - h.clientHeight })()`)
  paso('y vuelve a seguir la respuesta mientras llega', sigue < 80, `${sigue}px del final`)
  paso('la respuesta termina', await hasta(async () => /FIN-RESPUESTA-LARGA/.test(await texto()), 20000))

  // args con que el Asistente lanzó el CLI: Playwright + DevTools en el mismo navegador y la guía en el prompt
  const args = arranques[0]?.args ?? []
  const cfg = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers
  const pw = cfg.playwright?.args ?? [], dt = cfg['chrome-devtools']?.args ?? []
  const puerto = /:(\d+)$/.exec(dt[dt.indexOf('--browserUrl') + 1] ?? '')?.[1]
  const cfgPw = pw.includes('--config') ? JSON.parse(readFileSync(pw[pw.indexOf('--config') + 1], 'utf8')) : {}
  paso('el Asistente lleva Chrome DevTools MCP de serie', Boolean(cfg['chrome-devtools']) && dt.includes('chrome-devtools-mcp@latest'))
  paso('DevTools se conecta al puerto que abre el Chromium de Playwright', Boolean(puerto) && cfgPw.browser?.launchOptions?.args?.includes(`--remote-debugging-port=${puerto}`), `puerto ${puerto}`)
  const sistema = args[args.indexOf('--append-system-prompt') + 1] ?? ''
  paso('y la guía de cómo usarlos juntos va en el prompt de sistema', /Chrome DevTools/.test(sistema) && /MISMO navegador/.test(sistema))

  const convs = await mcp.json('asistente_conversaciones', { proyecto_id: idTienda })
  const conv = convs[0]
  const leida = conv ? await mcp.json('asistente_leer', { conversacion: conv.id }) : undefined
  paso('asistente_conversaciones/asistente_leer devuelven la conversación y su respuesta', /BUCLE/.test(leida?.turnos?.[0]?.usuario ?? '') && /FIN-RESPUESTA-LARGA/.test(leida?.turnos?.[0]?.respuesta ?? ''), JSON.stringify(leida).slice(0, 200))

  // ───────── instalar el MCP en un cliente externo desde la interfaz
  await ev(`[...document.querySelectorAll('aside button')].find((b) => b.textContent.trim().startsWith('Proveedores')).click()`)
  paso('Proveedores de IA enseña «Controlar Odesk desde otros asistentes»', await hasta(async () => /Controlar Odesk desde otros asistentes/.test(await texto()), 8000))
  const filaCursor = `[...document.querySelectorAll('.cfg-proyecto')].find((e) => e.textContent.includes('Cursor'))`
  await ev(`${filaCursor}.querySelector('button').click()`)
  const mcpCursor = join(HOME, '.cursor', 'mcp.json')
  paso('«Instalar» en Cursor escribe la entrada «odesk»', await hasta(() => existsSync(mcpCursor) && Boolean(JSON.parse(readFileSync(mcpCursor, 'utf8')).mcpServers?.odesk), 8000))
  const entrada = JSON.parse(readFileSync(mcpCursor, 'utf8')).mcpServers.odesk
  // el cliente externo lanzaría exactamente esto: se comprueba que funciona
  const lanzado = spawn(entrada.command, entrada.args, { env: { ...entorno, ...entrada.env, HOME }, stdio: ['pipe', 'pipe', 'ignore'] })
  hijos.push(lanzado)
  const respuesta = await new Promise((r) => {
    let b = ''
    lanzado.stdout.on('data', (d) => { b += d; if (b.includes('\n')) r(b) })
    lanzado.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'odesk_proyectos', arguments: {} } }) + '\n')
    setTimeout(() => r(b), 10000)
  })
  paso('con esa configuración el cliente externo maneja Odesk', /Tienda/.test(respuesta), respuesta.slice(0, 120))
  await hasta(async () => /Quitar/.test(await ev(`${filaCursor}.textContent`)), 5000)
  await ev(`${filaCursor}.querySelector('button').click()`)
  paso('«Quitar» deja el archivo sin la entrada', await hasta(() => !JSON.parse(readFileSync(mcpCursor, 'utf8')).mcpServers?.odesk, 8000))

  // ───────── quitar un proyecto (último: cambia la lista)
  fijarRespuesta('permitir')
  const quitado = await mcp.tool('proyecto_quitar', { proyecto_id: idBlog })
  paso('proyecto_quitar (permitido) lo suelta de este equipo y la interfaz se actualiza', !quitado.error && (await hasta(async () => !/\bBlog\b/.test(await ev(`document.querySelector('aside').innerText`)), 8000)) && existsSync(blog), quitado.texto)
} catch (e) {
  console.log('FALLO inesperado —', e.message)
  fallos++
} finally {
  await limpiar()
}
console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallo(s).`)
process.exit(fallos === 0 ? 0 : 1)
