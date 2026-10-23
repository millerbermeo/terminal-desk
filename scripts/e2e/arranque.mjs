/**
 * Prueba de punta a punta de los comandos de arranque con Electron real (ptys reales, procesos reales, puertos reales).
 * Dos modos:
 *  - Por defecto levanta un API mínimo en memoria (login, proyectos y /arranque): solo necesita la app compilada y un entorno gráfico.
 *      pnpm build && pnpm e2e:arranque
 *  - `API_REAL=1`: usa el API de verdad (`../terminal-desk-api` compilado con `pnpm build`) con una base Postgres desechable
 *    (`desk_e2e_arranque`, se crea y se borra; DB_HOST/DB_USER/DB_PASS como en dos-equipos.mjs) y comprueba además lo guardado en la
 *    base y que otro equipo de la cuenta ve los mismos comandos.
 *      API_REAL=1 pnpm e2e:arranque
 * Usa un HOME temporal (no toca ~/.odesk-agent) y borra todo al terminar.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as servidorTcp } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RAIZ = join(tmpdir(), `odesk-e2e-arranque-${Date.now()}`)
const CDP = 9311
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
let fallos = 0
const paso = (t, ok, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${t}${extra ? ' — ' + extra : ''}`)
  if (!ok) fallos++
}
const hasta = async (cond, ms = 15000) => {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await cond()) return true
    await dormir(60)
  }
  return false
}
const puertoLibre = () =>
  new Promise((r) => {
    const s = servidorTcp().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => r(p))
    })
  })
const abierto = (puerto) =>
  new Promise((r) => {
    const s = servidorTcp().once('error', () => r(true)).listen(puerto, '127.0.0.1', () => s.close(() => r(false)))
  })
const vivo = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// ───────── API: la de verdad (API_REAL=1) o una mínima en memoria
const REAL = process.env.API_REAL === '1'
const EMAIL = 'e2e-arranque@desk.local'
const PASS = 'clave-e2e-123'
const proyectos = []
const arranque = []
let api, procApi, URL_API, tokenCuenta
const DB = { host: process.env.DB_HOST ?? 'localhost', user: process.env.DB_USER ?? 'postgres', pass: process.env.DB_PASS ?? 'admin123', nombre: 'desk_e2e_arranque' }
const psql = (q, base = DB.nombre) => execFileSync('psql', ['-h', DB.host, '-U', DB.user, '-d', base, '-tAc', q], { env: { ...process.env, PGPASSWORD: DB.pass } }).toString().trim()

if (REAL) {
  const dirApi = resolve(APP, '..', 'terminal-desk-api')
  psql(`DROP DATABASE IF EXISTS ${DB.nombre} WITH (FORCE)`, 'postgres')
  psql(`CREATE DATABASE ${DB.nombre}`, 'postgres')
  const puertoApi = await new Promise((r) => { const t = servidorTcp().listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => r(p)) }) })
  const entornoApi = { ...process.env, DB_HOST: DB.host, DB_USER: DB.user, DB_PASS: DB.pass, DB_NAME: DB.nombre, PORT: String(puertoApi), HOST: '127.0.0.1', SMTP_HOST: '' }
  const mig = spawnSync('pnpm', ['migration:ejecutar'], { cwd: dirApi, env: entornoApi, encoding: 'utf8' })
  if (mig.status !== 0) throw new Error(`migraciones: ${mig.stdout}${mig.stderr}`)
  const logApi = join(RAIZ, 'api.log')
  mkdirSync(RAIZ, { recursive: true })
  const fd = (await import('node:fs')).openSync(logApi, 'w')
  procApi = spawn('node', ['dist/main.js'], { cwd: dirApi, env: entornoApi, stdio: ['ignore', fd, fd] })
  URL_API = `http://127.0.0.1:${puertoApi}`
  for (let i = 0; i < 60; i++) { try { await fetch(`${URL_API}/auth/google/disponible`); break } catch { await dormir(250) } }
  const post = async (ruta, cuerpo, token) => { const r = await fetch(URL_API + ruta, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(cuerpo) }); return { status: r.status, cuerpo: await r.json().catch(() => ({})) } }
  await post('/auth/register', { email: EMAIL, password: PASS })
  await dormir(300)
  const log = readFileSync(logApi, 'utf8')
  const codigo = /Tu código es: (\d{6})/.exec(log.slice(log.lastIndexOf(`Para ${EMAIL}`)))?.[1]
  if (!codigo) throw new Error(`no hay código de verificación en ${logApi}`)
  tokenCuenta = (await post('/auth/verify', { email: EMAIL, code: codigo, password: PASS })).cuerpo.token
} else {
  api = createServer((req, res) => {
    const responder = (c, cuerpo) => {
      res.writeHead(c, { 'content-type': 'application/json' })
      res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo))
    }
    const cuerpo = () => new Promise((r) => { const t = []; req.on('data', (x) => t.push(x)); req.on('end', () => r(JSON.parse(Buffer.concat(t).toString() || '{}'))) })
    if (req.url === '/auth/login') return responder(200, { token: 'token-falso', usuario: { id: 'u1', email: EMAIL } })
    if (req.url === '/projects' && req.method === 'GET') return responder(200, { groups: [], projects: proyectos.map((p) => ({ id: p.id, name: p.name, repo: null, groupId: null })) })
    if (req.url === '/projects' && req.method === 'POST') return void cuerpo().then((c) => { const p = { id: randomUUID(), name: c.name }; proyectos.push(p); responder(201, { id: p.id, name: p.name, repo: null, groupId: null }) })
    const uno = /^\/projects\/([^/?]+)$/.exec(req.url ?? '')
    if (uno && req.method === 'GET') { const p = proyectos.find((x) => x.id === uno[1]); return p ? responder(200, { id: p.id, name: p.name, repo: null, groupId: null }) : responder(404, { message: 'no existe' }) }
    if (req.url === '/arranque' && req.method === 'GET') return responder(200, { commands: arranque })
    if (req.url === '/arranque' && req.method === 'PUT') return void cuerpo().then((c) => { const previo = arranque.find((x) => x.id === c.id); const fila = { id: randomUUID(), position: arranque.filter((x) => x.projectId === c.projectId).length, ...(previo ?? {}), ...c }; if (previo) Object.assign(previo, fila); else arranque.push(fila); responder(200, fila) })
    if (req.url === '/arranque/orden' && req.method === 'PUT') return void cuerpo().then((c) => { c.ids.forEach((id, i) => { const f = arranque.find((x) => x.id === id); if (f) f.position = i }); responder(200, { commands: arranque }) })
    const del = /^\/arranque\/([^/?]+)$/.exec(req.url ?? '')
    if (del && req.method === 'DELETE') { const i = arranque.findIndex((x) => x.id === del[1]); if (i >= 0) arranque.splice(i, 1); return responder(i >= 0 ? 204 : 404, i >= 0 ? undefined : { message: 'no existe' }) }
    responder(404, { message: 'no implementado' })
  })
  await new Promise((r) => api.listen(0, '127.0.0.1', r))
  URL_API = `http://127.0.0.1:${api.address().port}`
}

// ───────── Electron real, manejado por CDP
mkdirSync(join(RAIZ, 'home', '.odesk-agent'), { recursive: true })
const entorno = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
const proc = spawn(join(APP, 'node_modules/.bin/electron'), ['.', `--remote-debugging-port=${CDP}`], { cwd: APP, stdio: process.env.DEPURAR ? 'inherit' : 'ignore', env: { ...entorno, HOME: join(RAIZ, 'home'), ODESK_API_URL: URL_API, ODESK_PERMITIR_HTTP: '1' } })
const extraños = []
async function limpiar() {
  proc.kill('SIGTERM')
  for (const p of extraños) try { process.kill(p, 'SIGKILL') } catch { /* ya no está */ }
  api?.close()
  procApi?.kill('SIGTERM')
  await dormir(1500)
  if (REAL) try { psql(`DROP DATABASE IF EXISTS ${DB.nombre} WITH (FORCE)`, 'postgres') } catch { /* ya no está */ }
  rmSync(RAIZ, { recursive: true, force: true })
}
process.on('SIGINT', () => void limpiar().then(() => process.exit(1)))

try {
  let pagina
  for (let i = 0; i < 80 && !pagina; i++) {
    await dormir(500)
    try { pagina = (await (await fetch(`http://localhost:${CDP}/json`)).json()).find((t) => t.type === 'page' && !t.url.includes('navegador=')) } catch { /* aún arrancando */ }
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
  const op = (o, e) => ev(`window.api.arranque.operar(${JSON.stringify(o)}, ${JSON.stringify(e)})`)
  const estados = async (proyectoId) => Object.fromEntries((await op('estados', { proyectoId })).map((e) => [e.comandoId, e]))

  // ───────── sesión y dos proyectos
  const login = await ev(`window.api.sesion.iniciar({email:${JSON.stringify(EMAIL)},password:${JSON.stringify(PASS)}})`)
  paso('entra con el API de prueba', login.ok === true, login.mensaje)
  const tienda = join(RAIZ, 'tienda'), blog = join(RAIZ, 'blog')
  mkdirSync(join(tienda, 'api'), { recursive: true })
  mkdirSync(blog, { recursive: true })
  const ag = await ev(`window.api.proyectos.agregar({proyectos:[{nombre:'Tienda',ruta:${JSON.stringify(tienda)}},{nombre:'Blog',ruta:${JSON.stringify(blog)}}]})`)
  paso('registra los proyectos', ag.errores.length === 0 && ag.datos.proyectos.length === 2, JSON.stringify(ag.errores))
  const idTienda = ag.datos.proyectos.find((p) => p.nombre === 'Tienda').id
  const idBlog = ag.datos.proyectos.find((p) => p.nombre === 'Blog').id

  const [P1, P2, P3, P4] = [await puertoLibre(), await puertoLibre(), await puertoLibre(), await puertoLibre()]
  // un servidor mínimo en el puerto dado; `retardo` ms antes de abrirlo y un texto en la salida (partido en dos para que no esté en el comando)
  const servidor = (puerto, retardo, texto = '') => `node -e "setTimeout(()=>{require('net').createServer().listen(${puerto},'127.0.0.1',()=>console.log('${texto.slice(0, 3)}'+'${texto.slice(3)}'))},${retardo})"`

  await ev('location.reload()').catch(() => undefined)
  await dormir(500)
  paso('la interfaz muestra los proyectos tras entrar', await hasta(async () => /Tienda/.test(await ev('document.body.innerText').catch(() => '')) && /Blog/.test(await ev('document.body.innerText').catch(() => '')), 15000))
  await ev('window.__t=[];window.api.arranque.onTerminal(t=>window.__t.push(t))')

  // ───────── configuración sin repetidos
  const g = (e) => op('guardar', { proyectoId: idTienda, comando: e })
  const rBase = await g({ nombre: 'Base', comando: servidor(P1, 1500), puerto: P1, esperar: 'puerto' })
  const rApi = await g({ nombre: 'API', comando: servidor(P2, 0, 'API LISTA'), cwd: 'api', puerto: P2, esperar: 'texto', textoListo: 'api lista' })
  const rWeb = await g({ nombre: 'Web', comando: servidor(P3, 0), puerto: P3, esperar: 'puerto', siempre: true })
  paso('guarda los tres comandos en orden', rBase.ok && rApi.ok && rWeb.ok && rWeb.comandos.map((c) => c.nombre).join() === 'Base,API,Web')
  if (REAL) {
    if (process.env.DEPURAR) console.log('DB:', psql(`SELECT count(*) FROM project_start_commands`), psql(`SELECT string_agg(name || ':' || position || ':' || coalesce(port::text,'-') || ':' || wait_for || ':' || always, ',') FROM project_start_commands`), 'token:', String(tokenCuenta).slice(0, 8), idTienda)
    paso('quedan guardados en la base de datos (project_start_commands)', Number(psql(`SELECT count(*) FROM project_start_commands WHERE project_id='${idTienda}'`)) === 3)
    paso('con su orden, puerto y modo de espera', psql(`SELECT string_agg(name || ':' || position || ':' || coalesce(port::text,'-') || ':' || wait_for || ':' || always, ',' ORDER BY position) FROM project_start_commands WHERE project_id='${idTienda}'`) === `Base:0:${P1}:puerto:false,API:1:${P2}:texto:false,Web:2:${P3}:puerto:true`)
    const otro = await (await fetch(`${URL_API}/arranque?projectId=${idTienda}`, { headers: { authorization: `Bearer ${tokenCuenta}` } })).json()
    paso('otro equipo de la cuenta ve los mismos comandos, en el mismo orden', otro.commands.map((c) => c.name).join() === 'Base,API,Web')
    const repetido = await fetch(`${URL_API}/arranque`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenCuenta}` }, body: JSON.stringify({ projectId: idTienda, name: 'Copia', command: ` ${servidor(P1, 1500)} ` }) })
    paso('el servidor también rechaza un repetido (409)', repetido.status === 409)
  }
  const dup = await g({ nombre: 'Otra', comando: `  ${servidor(P1, 1500)}  ` })
  paso('rechaza el mismo comando en la misma carpeta', dup.ok === false && /mismo comando/.test(dup.mensaje), dup.mensaje)
  paso('rechaza el mismo puerto', (await g({ nombre: 'X', comando: 'echo x', puerto: P1 })).ok === false)
  paso('rechaza una carpeta fuera del proyecto', (await g({ nombre: 'Y', comando: 'echo y', cwd: '../blog' })).ok === false)
  paso('rechaza varias líneas', (await g({ nombre: 'Z', comando: 'echo a\necho b' })).ok === false)
  const [base, api2, web] = rWeb.comandos

  // ───────── arrancar en orden, esperando a cada uno
  paso('antes de arrancar no hay conflictos', (await op('revisar', { proyectoId: idTienda })).length === 0)
  const aperturas = {}
  const sondeo = setInterval(async () => { for (const p of [P1, P2, P3]) if (!aperturas[p] && (await abierto(p))) aperturas[p] = Date.now() }, 40)
  const t0 = Date.now()
  paso('arrancar responde ya', (await op('arrancar', { proyectoId: idTienda })).ok === true)
  const todos = await hasta(async () => Object.values(await estados(idTienda)).filter((e) => e.estado === 'listo').length === 3, 25000)
  clearInterval(sondeo)
  const est = await estados(idTienda)
  paso('los tres quedan listos', todos, Object.values(est).map((e) => `${e.estado}${e.mensaje ? ' (' + e.mensaje + ')' : ''}`).join(', '))
  paso('el puerto de la base abrió ~1,5 s después de empezar', aperturas[P1] - t0 >= 1300, `${aperturas[P1] - t0} ms`)
  paso('API y Web esperaron a la base: abren sus puertos después, aunque no tardan nada', aperturas[P2] > aperturas[P1] && aperturas[P3] > aperturas[P2], `base ${aperturas[P1] - t0}, api ${aperturas[P2] - t0}, web ${aperturas[P3] - t0} ms`)
  await dormir(500)
  if (process.env.DEPURAR) console.log(await ev('JSON.stringify({t:window.__t,txt:document.body.innerText.slice(0,600),xt:document.querySelectorAll(".xterm").length})'))
  const celdas = await ev(`[...document.querySelectorAll('main.servicios .xterm')].length`)
  paso('la interfaz muestra una terminal por comando', celdas >= 3, `${celdas} terminales`)
  paso('y NINGUNA en la rejilla de terminales de los proyectos', (await ev(`[...document.querySelectorAll('main.principal:not(.servicios) .xterm')].length`)) === 0)
  await ev(`[...document.querySelectorAll('aside button')].find((b) => b.textContent.trim().startsWith('Servicios')).click()`)
  await dormir(600)
  const textoUI = await ev('document.body.innerText')
  paso('la sección «Servicios» enseña cada uno con el nombre del proyecto y del comando', /Tienda · Base/.test(textoUI) && /Tienda · API/.test(textoUI) && /Tienda · Web/.test(textoUI))

  if (process.env.CAPTURA) {
    const fotoServ = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(process.env.CAPTURA.replace(/\.png$/, '-servicios.png'), Buffer.from(fotoServ.result.data, 'base64'))
    // ayuda de desarrollo: foto del modal con los comandos en marcha (CAPTURA=/ruta/modal.png)
    await ev(`document.querySelector('button[aria-label^="Comandos de arranque de Tienda"]').click()`)
    await dormir(800)
    const foto = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(process.env.CAPTURA, Buffer.from(foto.result.data, 'base64'))
    await ev(`document.querySelector('.modal.arranque button[title^="Cerrar"]').click()`)
  }

  // ───────── no se lanza dos veces
  await op('arrancar', { proyectoId: idTienda })
  await hasta(async () => Object.values(await estados(idTienda)).every((e) => e.mensaje === 'Ya estaba en marcha'), 8000)
  paso('arrancar de nuevo no duplica nada', (await ev(`[...document.querySelectorAll('main.servicios .xterm')].length`)) === celdas)

  // ───────── puerto ocupado por otro proyecto
  const rb = await op('guardar', { proyectoId: idBlog, comando: { nombre: 'Blog dev', comando: servidor(P1, 0), puerto: P1, esperar: 'puerto' } })
  paso('avisa al guardar un puerto que usa otro proyecto', rb.ok && rb.avisos.length === 1 && /«Base» de «Tienda»/.test(rb.avisos[0]), rb.avisos?.[0])
  const conf = await op('revisar', { proyectoId: idBlog })
  paso('revisar dice que el puerto es de OTRO PROYECTO (por el árbol de procesos de la terminal)', conf.length === 1 && conf[0].tipo === 'otro-proyecto' && conf[0].proyectoNombre === 'Tienda' && conf[0].otroComando === 'Base' && conf[0].bloquea && conf[0].puedeLiberar, JSON.stringify(conf[0]))
  const pidBase = conf[0].pid
  await op('arrancar', { proyectoId: idBlog })
  const bloqueado = await hasta(async () => Object.values(await estados(idBlog))[0]?.estado === 'error', 8000)
  paso('sin decidir nada NO pisa el puerto y da error', bloqueado && vivo(pidBase), Object.values(await estados(idBlog))[0]?.mensaje)
  const celdasAntes = await ev(`[...document.querySelectorAll('main.servicios .xterm')].length`)
  paso('y no abrió ninguna terminal', celdasAntes === celdas)

  const blogCmd = (await op('listar', { proyectoId: idBlog }))[0]
  await op('arrancar', { proyectoId: idBlog, resoluciones: { [blogCmd.id]: 'liberar' } })
  const liberado = await hasta(async () => Object.values(await estados(idBlog))[0]?.estado === 'listo', 15000)
  paso('eligiendo «liberar» cierra el proceso y arranca el del otro proyecto', liberado && !vivo(pidBase), Object.values(await estados(idBlog))[0]?.mensaje)

  // ───────── programa ajeno
  const ajeno = spawn(process.execPath, ['-e', `require('net').createServer().listen(${P4},'127.0.0.1');setInterval(()=>{},1000)`], { cwd: tmpdir(), stdio: 'ignore' })
  extraños.push(ajeno.pid)
  await hasta(() => abierto(P4))
  await op('guardar', { proyectoId: idBlog, comando: { nombre: 'Otro', comando: servidor(P4, 0), puerto: P4, esperar: 'puerto' } })
  const cAjeno = (await op('revisar', { proyectoId: idBlog, ids: undefined })).find((c) => c.puerto === P4)
  paso('un programa que no es de ningún proyecto se reconoce como ajeno', cAjeno?.tipo === 'ajeno' && cAjeno.pid === ajeno.pid, JSON.stringify(cAjeno))
  const idOtro = (await op('listar', { proyectoId: idBlog })).find((c) => c.nombre === 'Otro').id
  await op('arrancar', { proyectoId: idBlog, ids: [idOtro], resoluciones: { [idOtro]: 'omitir' } })
  await hasta(async () => (await estados(idBlog))[idOtro]?.estado === 'omitido', 8000)
  paso('«omitir» lo salta y no toca el proceso', (await estados(idBlog))[idOtro]?.estado === 'omitido' && vivo(ajeno.pid))

  // ───────── detener
  await op('detener', { proyectoId: idBlog })
  ajeno.kill('SIGKILL')
  await op('detener', { proyectoId: idTienda })
  const cerrados = await hasta(async () => !(await abierto(P1)) && !(await abierto(P2)) && !(await abierto(P3)), 8000)
  paso('detener cierra las terminales y libera los puertos', cerrados)
  await dormir(500)
  paso('y quita sus celdas de la interfaz', (await ev(`[...document.querySelectorAll('main.servicios .xterm')].length`)) <= 1, `${await ev(`[...document.querySelectorAll('main.servicios .xterm')].length`)} terminales`)
  paso('los comandos quedan detenidos', Object.values(await estados(idTienda)).every((e) => e.estado === 'detenido'))

  // ───────── «siempre»
  const auto = await op('autoarrancar', { proyectoId: idTienda })
  paso('autoarrancar lanza solo los marcados «siempre»', auto.ok && auto.comandos === 1)
  await hasta(async () => (await estados(idTienda))[web.id]?.estado === 'listo', 10000)
  const e2 = await estados(idTienda)
  paso('arrancó la Web y no los otros', (await abierto(P3)) && !(await abierto(P1)) && !(await abierto(P2)) && e2[web.id]?.estado === 'listo')

  // ───────── terminar un comando solo / eliminar
  await op('eliminar', { proyectoId: idTienda, id: web.id })
  paso('eliminar un comando en marcha lo detiene', await hasta(async () => !(await abierto(P3)), 8000))
  paso('y queda fuera de la lista', (await op('listar', { proyectoId: idTienda })).every((c) => c.id !== web.id))
  if (REAL) paso('y de la base de datos', Number(psql(`SELECT count(*) FROM project_start_commands WHERE project_id='${idTienda}'`)) === 2)
  void base; void api2
} catch (e) {
  console.log('FALLO inesperado —', e.message)
  fallos++
} finally {
  await limpiar()
}
console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallo(s).`)
process.exit(fallos === 0 ? 0 : 1)
