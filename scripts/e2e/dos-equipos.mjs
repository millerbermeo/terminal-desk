/**
 * Prueba de punta a punta con Electron real: dos «computadoras» (dos HOME y dos carpetas distintas) contra el API local, y dos
 * cuentas en el mismo equipo. Requisitos:
 *  - API en marcha SIN SMTP y SIN Google, con su salida en un archivo:  (cd ../terminal-desk-api && pnpm dev > /tmp/api.log 2>&1 &)
 *    (sin SMTP los códigos por correo se escriben en ese log: de ahí los lee la prueba).
 *  - La app compilada (`pnpm build`), un entorno gráfico y `psql` con acceso a la base `desk`.
 * Uso:  API_LOG=/tmp/api.log node scripts/e2e/dos-equipos.mjs
 * Borra al final las cuentas y carpetas que crea.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(tmpdir(), 'odesk-e2e-equipos')
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = process.env.ODESK_API_URL || 'http://localhost:3000'
const API_LOG = process.env.API_LOG || '/tmp/api.log'
const sello = Date.now()
const EMAIL = `e2e-${sello}@desk.local`, PASS = 'clave-dos-pcs-1'
const OTRO = `e2e-otro-${sello}@desk.local`, PASS_OTRO = 'clave-otra-cuenta-1'
const PSQL = { env: { ...process.env, PGPASSWORD: process.env.DB_PASS ?? 'admin123' } }
const sql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'desk', '-tAc', q], PSQL).toString().trim()
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const paso = (t, ok, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${t}${extra ? ' — ' + extra : ''}`)
  if (!ok) process.exitCode = 1
}

/** Último código enviado a `email` (el API sin SMTP escribe los correos en su log). */
function codigoDe(email) {
  const log = readFileSync(API_LOG, 'utf8')
  const desde = log.lastIndexOf(`Para ${email}`)
  const m = desde >= 0 ? /Tu código es: (\d{6})/.exec(log.slice(desde)) : null
  if (!m) throw new Error(`no hay código para ${email} en ${API_LOG}`)
  return m[1]
}

rmSync(RAIZ, { recursive: true, force: true })
const casa = (n) => {
  const h = join(RAIZ, n)
  mkdirSync(join(h, '.odesk-agent'), { recursive: true })
  return h
}
const entorno = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))

/** Se conecta por CDP a la ventana principal que escucha en `puerto` (la lanza si `home` se indica). */
async function conectar(puerto, home) {
  let proc
  if (home) proc = spawn(join(APP, 'node_modules/.bin/electron'), ['.', `--remote-debugging-port=${puerto}`], { cwd: APP, stdio: 'ignore', env: { ...entorno, HOME: home, ODESK_API_URL: API } })
  let pagina
  for (let i = 0; i < 80 && !pagina; i++) {
    await dormir(500)
    try {
      pagina = (await (await fetch(`http://localhost:${puerto}/json`)).json()).find((t) => t.type === 'page' && !t.url.includes('navegador='))
    } catch {
      /* aún arrancando */
    }
  }
  if (!pagina) throw new Error('electron no arrancó')
  const ws = new WebSocket(pagina.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let n = 0
  const esp = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && esp.has(d.id)) {
      esp.get(d.id)(d)
      esp.delete(d.id)
    }
  }
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const id = ++n
      esp.set(id, r)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await cdp('Page.bringToFront')
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  await dormir(1500)
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails).slice(0, 400))
    return r.result.result.value
  }
  const pid = Number(execFileSync('fuser', [`${puerto}/tcp`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\s+/)[0])
  return {
    pid,
    ev,
    texto: () => ev('document.body.innerText'),
    soltar: () => ws.close(),
    cerrar: async () => {
      ws.close()
      try {
        execFileSync('fuser', ['-k', `${puerto}/tcp`], { stdio: 'ignore' })
      } catch {
        /* ya cerrado */
      }
      proc?.kill('SIGTERM')
      await dormir(1500)
    }
  }
}

/** Registra la cuenta con la interfaz real y la activa con el código del correo. */
async function crearCuenta(app, email, pass) {
  const r = await app.ev(`window.api.sesion.cuenta('registrar',{email:${JSON.stringify(email)},password:${JSON.stringify(pass)}})`)
  if (!r.ok) throw new Error(r.mensaje)
  await dormir(300)
  return app.ev(`window.api.sesion.cuenta('verificar',{email:${JSON.stringify(email)},code:'${codigoDe(email)}'})`)
}

try {
  // ───────── PC 1: cuenta nueva con verificación por correo
  const hA = casa('pc1')
  const carpetaA = join(hA, 'proyectos', 'demo')
  mkdirSync(carpetaA, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: carpetaA })
  execFileSync('git', ['remote', 'add', 'origin', 'https://token123@github.com/yo/demo.git'], { cwd: carpetaA })
  let a = await conectar(9301, hA)
  paso('PC1 arranca sin sesión, en la pantalla de acceso', !(await a.ev('window.api.sesion.estado()')).activa && /Iniciar sesión/.test(await a.texto()))
  const reg = await a.ev(`window.api.sesion.cuenta('registrar',{email:'${EMAIL}',password:'${PASS}'})`)
  paso('registrarse no da sesión: pide el código del correo', reg.ok && !(await a.ev('window.api.sesion.estado()')).activa, reg.mensaje)
  const sinActivar = await a.ev(`window.api.sesion.iniciar({email:'${EMAIL}',password:'${PASS}'})`)
  paso('entrar sin activar la cuenta no deja pasar y lo dice', sinActivar.ok === false && sinActivar.verificacionPendiente === true, sinActivar.mensaje)
  const malo = await a.ev(`window.api.sesion.cuenta('verificar',{email:'${EMAIL}',code:'000000'})`)
  paso('un código equivocado no activa', malo.ok === false)
  const act = await a.ev(`window.api.sesion.cuenta('verificar',{email:'${EMAIL}',code:'${codigoDe(EMAIL)}'})`)
  paso('con el código del correo se activa y entra', act.ok === true && act.estado.email === EMAIL, act.mensaje)
  const yaExiste = await a.ev(`window.api.sesion.cuenta('registrar',{email:'${EMAIL}',password:'otra-clave-123'})`)
  paso('registrar un correo existente responde igual que uno nuevo (no lo revela)', yaExiste.ok && yaExiste.mensaje === reg.mensaje)
  const g = await a.ev('window.api.sesion.iniciarConGoogle()')
  paso('Google sin credenciales en el servidor: error claro', g.ok === false && /GOOGLE_CLIENT_ID/.test(g.mensaje))
  const inseguro = await a.ev(`window.api.sesion.fijarServidor('http://api.ejemplo.invalid')`)
  await a.ev(`window.api.sesion.fijarServidor('${API}')`)
  paso('cambiar a un servidor http externo se acepta pero...', inseguro.ok === true)
  // (la app no mandaría credenciales a ese servidor: lo cubren los tests unitarios; aquí se vuelve al local)
  const reentrar = await a.ev(`window.api.sesion.iniciar({email:'${EMAIL}',password:'${PASS}'})`)
  paso('...y al volver al servidor local se entra de nuevo', reentrar.ok === true, reentrar.mensaje)

  const r1 = await a.ev(`window.api.proyectos.agregar({proyectos:[{nombre:'Proyecto Demo',ruta:${JSON.stringify(carpetaA)}}]})`)
  paso('PC1 agrega la carpeta', r1.errores.length === 0 && r1.datos.proyectos.length === 1, JSON.stringify(r1.errores))
  const pid = r1.datos.proyectos[0].id
  paso('PC1 escribió .odesk/project.json con solo el projectId', readFileSync(join(carpetaA, '.odesk', 'project.json'), 'utf8').trim() === JSON.stringify({ projectId: pid }, null, 2))
  paso('PC1 recibe el aviso de subir .odesk a git', r1.avisos?.[0]?.includes('Falta subir .odesk/project.json'))
  await a.ev(`window.api.tareas.operar('crear',{titulo:'Tarea secreta de A',proyectoId:${JSON.stringify(pid)}})`)
  mkdirSync(join(hA, '.odesk-agent', 'conversaciones'), { recursive: true })
  const ahora = new Date().toISOString()
  writeFileSync(
    join(hA, '.odesk-agent', 'conversaciones', 'chat-pc1.json'),
    JSON.stringify({ id: 'chat-pc1', proyectoId: pid, titulo: 'Hablé con la IA en PC1', creada: ahora, actualizada: ahora, mensajes: [], uso: { tokensEntrada: 1, tokensSalida: 1 }, transcripcion: [{ prompt: 'hola desde PC1', modo: 'chat', destino: 'x', raiz: carpetaA, eventos: [], estado: 'completado', proyectoId: pid }] })
  )
  await dormir(4000)
  await a.cerrar()
  a = await conectar(9301, hA) // al arrancar con sesión sube la conversación local (no estaba en el servidor)
  await dormir(4000)

  // ───────── servidor
  const login = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) })).json()
  const H = { authorization: `Bearer ${login.token}` }
  const ctx = await (await fetch(`${API}/projects/${pid}/context`, { headers: H })).json()
  paso('el servidor tiene la tarea y la conversación de PC1', ctx.tasks.some((t) => t.data.titulo === 'Tarea secreta de A') && ctx.chats.some((c) => c.id === 'chat-pc1'))
  paso('el servidor guarda el repo sin credenciales y sin ruta', ctx.project.repo === 'https://github.com/yo/demo.git' && !('path' in ctx.project))

  // ───────── Otra cuenta en el MISMO equipo: no debe ver nada de A
  const uidA = sql(`select id from users where email='${EMAIL}'`)
  const vivasAntes = Number(sql(`select count(*) from sessions where user_id='${uidA}' and revoked_at is null`))
  await a.ev('window.api.sesion.cerrar()')
  const vivasDespues = Number(sql(`select count(*) from sessions where user_id='${uidA}' and revoked_at is null`))
  paso('cerrar sesión la revoca en el servidor', vivasDespues === vivasAntes - 1, `${vivasAntes} → ${vivasDespues}`)
  // crear la otra cuenta reinicia la app (sus datos locales se separan): hay que reconectar
  await crearCuenta(a, OTRO, PASS_OTRO).catch(() => undefined)
  a.soltar()
  await dormir(3000)
  a = await conectar(9301)
  let estado = await a.ev('window.api.sesion.estado()')
  if (!estado.activa) {
    // sin llavero del sistema el token no se guarda en disco: tras el reinicio se vuelve a entrar
    await a.ev(`window.api.sesion.iniciar({email:'${OTRO}',password:'${PASS_OTRO}'})`)
    estado = await a.ev('window.api.sesion.estado()')
  }
  paso('la otra cuenta entra en el mismo equipo', estado.activa && estado.email === OTRO)
  const proyOtro = await a.ev('window.api.proyectos.listar()')
  const tareasOtro = await a.ev(`window.api.tareas.operar('listar',{})`)
  paso('la otra cuenta NO ve proyectos de A', proyOtro.proyectos.length === 0)
  paso('la otra cuenta NO ve tareas de A (ni locales)', !tareasOtro.some((t) => t.titulo === 'Tarea secreta de A'), `${tareasOtro.length} tareas`)
  paso('la otra cuenta NO tiene las conversaciones de A en disco', !existsSync(join(hA, '.odesk-agent', 'conversaciones', 'chat-pc1.json')))
  const ajeno = await fetch(`${API}/projects/${pid}/context`, {
    headers: { authorization: `Bearer ${(await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OTRO, password: PASS_OTRO }) })).json()).token}` }
  })
  paso('la otra cuenta tampoco puede pedir al servidor el proyecto de A', ajeno.status === 404)
  // vuelve A: recupera lo suyo
  await a.ev('window.api.sesion.cerrar()')
  await a.ev(`window.api.sesion.iniciar({email:'${EMAIL}',password:'${PASS}'})`)
  a.soltar()
  await dormir(3000)
  a = await conectar(9301)
  if (!(await a.ev('window.api.sesion.estado()')).activa) await a.ev(`window.api.sesion.iniciar({email:'${EMAIL}',password:'${PASS}'})`)
  const tareasA = await a.ev(`window.api.tareas.operar('listar',{proyectoId:${JSON.stringify(pid)}})`)
  paso('al volver A, recupera sus proyectos, tareas y conversaciones', (await a.ev('window.api.proyectos.listar()')).proyectos.length === 1 && tareasA.some((t) => t.titulo === 'Tarea secreta de A') && existsSync(join(hA, '.odesk-agent', 'conversaciones', 'chat-pc1.json')))

  // ───────── Datos de cuenta y claves en la nube (desde PC1)
  await a.ev(`window.api.tareas.operar('crear',{titulo:'Tarea suelta de la cuenta'})`)
  await a.ev(`window.api.core.memoriaGuardar({tipo:'regla',titulo:'Usa pnpm',contenido:'En este equipo y en todos: pnpm, no npm.'})`)
  await a.ev(`window.api.proveedores.guardar({id:'',nombre:'Mi IA e2e',comando:'claude',env:{MI_CLAVE_E2E:'sk-e2e-muy-secreta'}})`)
  const bov = await a.ev(`window.api.sesion.cuenta('bovedaCrear',{frase:'frase de la boveda e2e'})`)
  paso('PC1 crea la bóveda de claves', bov.ok && bov.estado.desbloqueada, bov.mensaje)
  const s1 = await a.ev(`window.api.sesion.cuenta('sincronizar',{})`)
  paso('PC1 sincroniza con la nube', s1.ok, s1.mensaje)
  const docs = await (await fetch(`${API}/me/docs`, { headers: { authorization: `Bearer ${(await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) })).json()).token}` } })).json()
  const enNube = JSON.stringify(docs)
  paso('en la nube: memoria, tarea suelta, columnas y proveedores', /Usa pnpm/.test(enNube) && /Tarea suelta de la cuenta/.test(enNube) && docs.docs.some((d) => d.id === 'tareas-estados') && /Mi IA e2e/.test(enNube))
  paso('en la nube NO hay claves en claro (ni en datos ni en la bóveda)', !enNube.includes('sk-e2e-muy-secreta') && !sql(`select data::text from user_vault where user_id='${uidA}'`).includes('sk-e2e-muy-secreta'))

  // ───────── PC 2: "git pull" = la carpeta trae .odesk/project.json
  const hB = casa('pc2')
  const carpetaB = join(hB, 'otra-ruta', 'demo-clonado')
  mkdirSync(join(carpetaB, '.odesk'), { recursive: true })
  cpSync(join(carpetaA, '.odesk', 'project.json'), join(carpetaB, '.odesk', 'project.json'))
  let b = await conectar(9302, hB)
  const li = await b.ev(`window.api.sesion.iniciar({email:'${EMAIL}',password:'${PASS}'})`)
  paso('PC2 entra con la misma cuenta', li.ok, li.mensaje)
  const r2 = await b.ev(`window.api.proyectos.agregar({proyectos:[{nombre:'Lo que sea',ruta:${JSON.stringify(carpetaB)}}]})`)
  paso('PC2 reconoce el proyecto por .odesk/project.json y usa SU ruta', r2.reanudados?.[0] === pid && r2.datos.proyectos[0].ruta === carpetaB)
  await dormir(3000)
  const tareasB = await b.ev(`window.api.tareas.operar('listar',{proyectoId:${JSON.stringify(pid)}})`)
  paso('PC2 ve la tarea y la conversación de PC1', tareasB.some((t) => t.titulo === 'Tarea secreta de A') && existsSync(join(hB, '.odesk-agent', 'conversaciones', 'chat-pc1.json')))
  const s2 = await b.ev(`window.api.sesion.cuenta('sincronizar',{})`)
  paso('PC2 sincroniza', s2.ok, s2.mensaje)
  const sueltasB = await b.ev(`window.api.tareas.operar('listar',{})`)
  paso('PC2 tiene la tarea sin proyecto de PC1', sueltasB.some((t) => t.titulo === 'Tarea suelta de la cuenta'))
  const memB = await b.ev('window.api.core.memoriaListar()')
  paso('PC2 tiene la memoria del asistente de PC1', memB.some((m) => m.titulo === 'Usa pnpm'))
  let provB = (await b.ev('window.api.proveedores.listar()')).find((p) => p.nombre === 'Mi IA e2e')
  paso('PC2 tiene el proveedor de PC1, todavía SIN la clave', !!provB && Object.keys(provB.env).length === 0)
  const malaFrase = await b.ev(`window.api.sesion.cuenta('bovedaDesbloquear',{frase:'no es la frase!!'})`)
  paso('la bóveda no se abre con otra frase', malaFrase.ok === false)
  const desb = await b.ev(`window.api.sesion.cuenta('bovedaDesbloquear',{frase:'frase de la boveda e2e'})`)
  provB = (await b.ev('window.api.proveedores.listar()')).find((p) => p.nombre === 'Mi IA e2e')
  paso('con la frase, PC2 recibe la clave del proveedor', desb.ok && provB?.env?.MI_CLAVE_E2E === 'sk-e2e-muy-secreta')
  // borrar una conversación en PC1 la borra en PC2
  await a.ev(`window.api.core.sesionBorrar('chat-pc1')`)
  await a.ev(`window.api.sesion.cuenta('sincronizar',{})`)
  await b.ev(`window.api.sesion.cuenta('sincronizar',{})`)
  paso('borrar una conversación en PC1 la borra en PC2', !existsSync(join(hB, '.odesk-agent', 'conversaciones', 'chat-pc1.json')))
  // una tarea creada en PC1 aparece en PC2 sin reiniciar (bucle de sincronización)
  await a.ev(`window.api.tareas.operar('crear',{titulo:'Nueva en PC1 sin reiniciar',proyectoId:${JSON.stringify(pid)}})`)
  await a.ev(`window.api.sesion.cuenta('sincronizar',{})`)
  await b.ev(`window.api.sesion.cuenta('sincronizar',{})`)
  paso('una tarea nueva de PC1 llega a PC2 sin reiniciar', (await b.ev(`window.api.tareas.operar('listar',{proyectoId:${JSON.stringify(pid)}})`)).some((t) => t.titulo === 'Nueva en PC1 sin reiniciar'))
  await b.ev('location.reload()').catch(() => undefined)
  await dormir(3000)
  await b.ev(`[...document.querySelectorAll('nav.lista button, .lista .item')].find((x) => x.textContent.includes('Proyecto Demo'))?.click()`)
  await dormir(3500)
  const descendientes = (raiz) => {
    const todos = [raiz]
    for (let i = 0; i < todos.length; i++) {
      try {
        todos.push(...execFileSync('pgrep', ['-P', String(todos[i])]).toString().split('\n').filter(Boolean).map(Number))
      } catch {
        /* sin hijos */
      }
    }
    return todos
  }
  const cwds = descendientes(b.pid).map((p) => {
    try {
      return readlinkSync(`/proc/${p}/cwd`)
    } catch {
      return ''
    }
  })
  paso('la terminal de PC2 se abre en la carpeta de PC2', cwds.includes(carpetaB) && !cwds.includes(carpetaA))

  // ───────── Cambiar la contraseña en PC1 expulsa a PC2
  const cambio = await a.ev(`window.api.sesion.cuenta('cambiarPassword',{actual:'${PASS}',nueva:'clave-nueva-e2e-9'})`)
  paso('PC1 cambia la contraseña', cambio.ok, cambio.mensaje)
  paso('PC1 sigue dentro', (await a.ev('window.api.proyectos.listar()')).proyectos.length === 1)
  await b.ev('window.api.proyectos.listar()').catch(() => undefined)
  await dormir(1500)
  paso('PC2 queda fuera y vuelve a la pantalla de acceso', !(await b.ev('window.api.sesion.estado()')).activa && /Iniciar sesión/.test(await b.texto()))

  // ───────── Recuperar la contraseña desde PC2 y cerrar en todos los equipos
  await b.ev(`window.api.sesion.cuenta('olvido',{email:'${EMAIL}'})`)
  await dormir(300)
  const rest = await b.ev(`window.api.sesion.cuenta('restablecer',{email:'${EMAIL}',code:'${codigoDe(EMAIL)}',password:'clave-recuperada-1'})`)
  paso('PC2 recupera la contraseña con el código del correo y entra', rest.ok === true)
  await a.ev('window.api.proyectos.listar()').catch(() => undefined)
  await dormir(1500)
  paso('restablecer la contraseña cierra la sesión de PC1', !(await a.ev('window.api.sesion.estado()')).activa)
  const todas = await b.ev(`window.api.sesion.cuenta('cerrarTodas',{})`)
  paso('«cerrar en todos los equipos» deja sin sesiones vivas', !todas.activa && Number(sql(`select count(*) from sessions where user_id='${uidA}' and revoked_at is null`)) === 0)
  await b.cerrar()
  await a.cerrar()
} catch (err) {
  paso('la prueba terminó sin errores', false, String(err?.message ?? err))
} finally {
  for (const p of ['9301', '9302']) {
    try {
      execFileSync('fuser', ['-k', `${p}/tcp`], { stdio: 'ignore' })
    } catch {
      /* nada escuchando */
    }
  }
  sql(`delete from users where email in ('${EMAIL}','${OTRO}')`)
  rmSync(RAIZ, { recursive: true, force: true })
  console.log(process.exitCode ? '\nHAY FALLOS' : '\nTODO OK')
}
