// Odesk Code · Chrome — service worker de la extensión.
//
// Se conecta por WebSocket al puente local de Odesk (127.0.0.1, puertos fijos) y ejecuta lo que pide la IA SOLO en las pestañas del
// grupo «Odesk» (las que abre Odesk o las que el usuario comparte desde el botón de la extensión). Habla con cada pestaña con
// chrome.debugger (protocolo de DevTools), como las DevTools: Chrome muestra la barra «… está depurando este navegador»; si el usuario
// pulsa «Cancelar» en esa barra, el control queda en pausa.
//
// Odesk ya decide qué sitios se pueden usar y confirma lo delicado; aquí van las barreras propias del navegador: qué pestañas, qué
// métodos de DevTools (lista cerrada) y qué datos salen (consola y red sin cabeceras ni cuerpos).

const PUERTOS = [47615, 47616, 47617, 47618, 47619]
const PROTOCOLO = 1
const VERSION = chrome.runtime.getManifest().version
const MUNDO = 'odesk-ia'
const LATIDO_MS = 20_000

// Métodos de DevTools que Odesk puede pedir. Nada de cookies, almacenamiento, descargas ni red con cuerpos.
const METODOS = ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.captureScreenshot', 'Page.getLayoutMetrics', 'Page.handleJavaScriptDialog', 'Runtime.evaluate']
const EVENTOS = new Set(['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded', 'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFailed', 'Page.javascriptDialogOpening'])

let ws = null
let conectando = null
let estado = 'desconectado' // desconectado | conectando | conectado | sin-emparejar
let ultimoError = ''
let latido = null
let reintento = null
let pausaReintento = 2000
const depurando = new Set()

// ───────────────────────── Almacenamiento ─────────────────────────

const local = (claves) => chrome.storage.local.get(claves)
const sesion = async () => {
  const s = await chrome.storage.session.get(['pestanas', 'grupos'])
  return { pestanas: new Set(s.pestanas ?? []), grupos: s.grupos ?? {} }
}
const guardarSesion = (s) => chrome.storage.session.set({ pestanas: [...s.pestanas], grupos: s.grupos })
const pausado = async () => (await local(['pausado'])).pausado === true

function nombreNavegador() {
  const d = navigator.userAgentData
  const marca = d?.brands?.find((b) => !/not.?a.?brand|chromium/i.test(b.brand)) ?? d?.brands?.find((b) => /chromium/i.test(b.brand))
  return `${marca ? `${marca.brand} ${marca.version}` : 'Chrome'}${d?.platform ? ` · ${d.platform}` : ''}`
}

// ───────────────────────── Conexión con Odesk ─────────────────────────

function enviar(m) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
}

function abrirSocket(puerto) {
  return new Promise((resolver, rechazar) => {
    const s = new WebSocket(`ws://127.0.0.1:${puerto}`)
    const t = setTimeout(() => (s.close(), rechazar(new Error('tiempo'))), 3000)
    s.onopen = () => (clearTimeout(t), resolver(s))
    s.onerror = () => (clearTimeout(t), rechazar(new Error('sin servidor')))
  })
}

/** Primer mensaje del servidor tras el saludo: bienvenida o rechazo. */
function esperarRespuesta(s) {
  return new Promise((resolver) => {
    const t = setTimeout(() => resolver({ t: 'rechazo', motivo: 'tiempo' }), 5000)
    s.onmessage = (ev) => {
      clearTimeout(t)
      try {
        resolver(JSON.parse(ev.data))
      } catch {
        resolver({ t: 'rechazo', motivo: 'respuesta' })
      }
    }
    s.onclose = () => (clearTimeout(t), resolver({ t: 'rechazo', motivo: 'cerrado' }))
  })
}

const MOTIVOS = {
  token: 'Odesk no reconoce esta extensión: vuelve a emparejarla.',
  olvidada: 'Odesk olvidó esta extensión: vuelve a emparejarla.',
  codigo: 'Código incorrecto.',
  'sin-codigo': 'No hay ningún código en vigor: genera uno en Odesk (Proveedores de IA → Chrome).',
  intentos: 'Demasiados intentos: genera otro código en Odesk.',
  protocolo: 'Esta extensión y Odesk no son de la misma versión: actualiza las dos.',
  tiempo: 'Odesk no respondió.',
  cerrado: 'Odesk cerró la conexión.'
}

/** Conecta (o empareja con `codigo`). Devuelve '' si quedó conectada, o el error. */
async function conectar(codigo) {
  if (conectando) return conectando
  conectando = (async () => {
    if (!codigo && ws?.readyState === WebSocket.OPEN) return ''
    const { token, puerto } = await local(['token', 'puerto'])
    if (!token && !codigo) {
      estado = 'sin-emparejar'
      return MOTIVOS['sin-codigo']
    }
    estado = 'conectando'
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
    const orden = puerto ? [puerto, ...PUERTOS.filter((p) => p !== puerto)] : PUERTOS
    for (const p of orden) {
      let s
      try {
        s = await abrirSocket(p)
      } catch {
        continue
      }
      const respuesta = esperarRespuesta(s)
      s.send(JSON.stringify(codigo ? { t: 'emparejar', codigo, protocolo: PROTOCOLO, navegador: nombreNavegador(), version: VERSION } : { t: 'hola', token, protocolo: PROTOCOLO, navegador: nombreNavegador(), version: VERSION }))
      const r = await respuesta
      if (r.t !== 'bienvenida') {
        s.close()
        if (r.motivo === 'token' || r.motivo === 'olvidada') await chrome.storage.local.remove('token')
        estado = r.motivo === 'token' || r.motivo === 'olvidada' || !token ? 'sin-emparejar' : 'desconectado'
        ultimoError = MOTIVOS[r.motivo] ?? `Odesk rechazó la conexión (${r.motivo}).`
        return ultimoError
      }
      await chrome.storage.local.set({ puerto: p, ...(r.token ? { token: r.token } : {}) })
      preparar(s)
      return ''
    }
    estado = 'desconectado'
    ultimoError = 'No se encuentra Odesk Code: ábrelo en este equipo.'
    return ultimoError
  })().finally(() => (conectando = null))
  return conectando
}

function preparar(s) {
  ws = s
  estado = 'conectado'
  ultimoError = ''
  pausaReintento = 2000
  s.onmessage = (ev) => {
    let m
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.t === 'pedir') void atender(m)
    else if (m.t === 'rechazo') {
      if (m.motivo === 'olvidada') void chrome.storage.local.remove('token')
      ultimoError = MOTIVOS[m.motivo] ?? ''
    }
  }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    clearInterval(latido)
    void local(['token']).then(({ token }) => {
      estado = token ? 'desconectado' : 'sin-emparejar'
      if (token) programarReintento()
    })
  }
  clearInterval(latido)
  // El latido mantiene despierto el service worker (Chrome 116+) y le dice a Odesk que seguimos aquí.
  latido = setInterval(() => enviar({ t: 'latido' }), LATIDO_MS)
  void enviarPestanas()
}

function programarReintento() {
  clearTimeout(reintento)
  reintento = setTimeout(() => void conectar(), pausaReintento)
  pausaReintento = Math.min(pausaReintento * 2, 30_000)
}

// ───────────────────────── Pestañas del grupo «Odesk» ─────────────────────────

async function listar() {
  const s = await sesion()
  const lista = []
  for (const id of s.pestanas) {
    try {
      const t = await chrome.tabs.get(id)
      lista.push({ id, url: t.url || t.pendingUrl || '', titulo: t.title || '', cargando: t.status === 'loading', activa: t.active })
    } catch {
      s.pestanas.delete(id)
    }
  }
  await guardarSesion(s)
  return lista
}

let avisoPestanas = null
function enviarPestanas() {
  clearTimeout(avisoPestanas)
  avisoPestanas = setTimeout(async () => enviar({ t: 'pestanas', lista: await listar(), pausado: await pausado() }), 120)
}

async function comprobar(id) {
  if (typeof id !== 'number' || !(await sesion()).pestanas.has(id)) throw new Error('Esa pestaña no está compartida con Odesk (no está en el grupo «Odesk»).')
}

/** Mete la pestaña en el grupo «Odesk» de su ventana (lo crea si hace falta). */
async function agrupar(tab) {
  const s = await sesion()
  let grupo = s.grupos[tab.windowId]
  if (grupo !== undefined) {
    try {
      await chrome.tabGroups.get(grupo)
    } catch {
      grupo = undefined
    }
  }
  if (grupo === undefined) {
    grupo = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } })
    await chrome.tabGroups.update(grupo, { title: 'Odesk', color: 'purple' })
  } else await chrome.tabs.group({ tabIds: [tab.id], groupId: grupo })
  s.grupos[tab.windowId] = grupo
  s.pestanas.add(tab.id)
  await guardarSesion(s)
  enviarPestanas()
}

async function soltar(id) {
  const s = await sesion()
  s.pestanas.delete(id)
  await guardarSesion(s)
  if (depurando.has(id)) await chrome.debugger.detach({ tabId: id }).catch(() => undefined)
  depurando.delete(id)
  await chrome.tabs.ungroup(id).catch(() => undefined)
  enviarPestanas()
}

async function compartir(tab) {
  if (!/^https?:/.test(tab.url || '')) throw new Error('Solo se pueden compartir páginas web (http/https).')
  await agrupar(tab)
}

// ───────────────────────── Depurador (DevTools) ─────────────────────────

async function depurar(id) {
  if (depurando.has(id)) return
  try {
    await chrome.debugger.attach({ tabId: id }, '1.3')
  } catch (e) {
    const m = String(e?.message || e)
    if (/already attached/i.test(m)) throw new Error('Esa pestaña tiene abiertas sus herramientas de desarrollo (u otra extensión la está depurando): ciérralas y repite.', { cause: e })
    throw new Error(`Chrome no deja controlar esta pestaña: ${m}`, { cause: e })
  }
  depurando.add(id)
  const d = { tabId: id }
  for (const [metodo, params] of [['Page.enable'], ['Runtime.enable'], ['Log.enable'], ['Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }]]) {
    await chrome.debugger.sendCommand(d, metodo, params ?? {}).catch(() => undefined)
  }
}

async function cdp(id, metodo, params) {
  await depurar(id)
  return chrome.debugger.sendCommand({ tabId: id }, metodo, params ?? {})
}

/** Ejecuta código en un mundo aislado de la página (no lo ve el JavaScript de la página; la CSP no lo bloquea). */
async function aislado(id, codigo) {
  const { frameTree } = await cdp(id, 'Page.getFrameTree')
  const { executionContextId } = await cdp(id, 'Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: MUNDO })
  const r = await cdp(id, 'Runtime.evaluate', { expression: codigo, contextId: executionContextId, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'Error en la página')
  return r.result?.value
}

/** Lo justo de cada evento: nunca cabeceras, cuerpos ni cookies. */
function resumirEvento(metodo, p) {
  switch (metodo) {
    case 'Network.requestWillBeSent':
      return { requestId: p.requestId, type: p.type, request: { method: p.request?.method, url: String(p.request?.url ?? '').slice(0, 2000) } }
    case 'Network.responseReceived':
      return { requestId: p.requestId, type: p.type, response: { status: p.response?.status } }
    case 'Network.loadingFailed':
      return { requestId: p.requestId, type: p.type, errorText: p.errorText, canceled: p.canceled }
    case 'Runtime.consoleAPICalled':
      return { type: p.type, args: (p.args ?? []).slice(0, 10).map((a) => ({ type: a.type, value: typeof a.value === 'object' ? undefined : a.value, description: a.description?.slice(0, 1000) })) }
    case 'Runtime.exceptionThrown':
      return { exceptionDetails: { text: p.exceptionDetails?.text, url: p.exceptionDetails?.url, lineNumber: p.exceptionDetails?.lineNumber, exception: { description: p.exceptionDetails?.exception?.description?.slice(0, 2000) } } }
    case 'Log.entryAdded':
      return { entry: { level: p.entry?.level, text: String(p.entry?.text ?? '').slice(0, 2000), url: p.entry?.url } }
    case 'Page.javascriptDialogOpening':
      return { type: p.type, message: String(p.message ?? '').slice(0, 500) }
  }
  return {}
}

chrome.debugger.onEvent.addListener((fuente, metodo, params) => {
  if (fuente.tabId === undefined || !EVENTOS.has(metodo) || !depurando.has(fuente.tabId)) return
  enviar({ t: 'evento', pestana: fuente.tabId, metodo, params: resumirEvento(metodo, params ?? {}) })
})

chrome.debugger.onDetach.addListener(async (fuente, motivo) => {
  depurando.delete(fuente.tabId)
  // «Cancelar» en la barra de depuración = el usuario quiere parar: pausa todo hasta que lo reanude desde el botón de la extensión.
  if (motivo === 'canceled_by_user') await fijarPausa(true)
})

// ───────────────────────── Peticiones de Odesk ─────────────────────────

const LIBRES = new Set(['pestanas', 'estado', 'zoom'])

async function ejecutar(m) {
  if (!LIBRES.has(m.op) && (await pausado())) throw new Error('El usuario pausó el control de Chrome desde la extensión.')
  switch (m.op) {
    case 'pestanas':
      return listar()
    case 'abrir': {
      if (!/^https?:\/\//.test(String(m.url))) throw new Error('Solo direcciones http/https.')
      const tab = await chrome.tabs.create({ url: m.url, active: true })
      await agrupar(tab)
      return tab.id
    }
    case 'cerrar':
      await comprobar(m.pestana)
      await chrome.tabs.remove(m.pestana)
      return true
    case 'estado': {
      await comprobar(m.pestana)
      const t = await chrome.tabs.get(m.pestana)
      return { url: t.url || t.pendingUrl || '', titulo: t.title || '', cargando: t.status === 'loading' }
    }
    case 'navegar':
      await comprobar(m.pestana)
      if (typeof m.url === 'string') {
        if (!/^https?:\/\//.test(m.url)) throw new Error('Solo direcciones http/https.')
        await chrome.tabs.update(m.pestana, { url: m.url })
      } else if (m.accion === 'atras') await chrome.tabs.goBack(m.pestana).catch(() => undefined)
      else if (m.accion === 'adelante') await chrome.tabs.goForward(m.pestana).catch(() => undefined)
      else if (m.accion === 'recargar') await chrome.tabs.reload(m.pestana)
      else throw new Error('Navegación desconocida.')
      return true
    case 'zoom':
      await comprobar(m.pestana)
      return chrome.tabs.getZoom(m.pestana)
    case 'cdp':
      await comprobar(m.pestana)
      if (!METODOS.includes(m.metodo)) throw new Error(`La extensión no permite «${m.metodo}».`)
      return cdp(m.pestana, m.metodo, m.params)
    case 'aislado':
      await comprobar(m.pestana)
      return aislado(m.pestana, String(m.codigo))
    case 'anunciar':
      await comprobar(m.pestana)
      await chrome.action.setBadgeBackgroundColor({ tabId: m.pestana, color: '#7c3aed' })
      await chrome.action.setBadgeText({ tabId: m.pestana, text: 'IA' })
      await chrome.action.setTitle({ tabId: m.pestana, title: `Odesk: ${String(m.texto).slice(0, 120)}` })
      return true
  }
  throw new Error(`Operación desconocida: ${m.op}`)
}

async function atender(m) {
  try {
    enviar({ t: 'respuesta', id: m.id, ok: true, valor: await ejecutar(m) })
  } catch (e) {
    enviar({ t: 'respuesta', id: m.id, ok: false, error: String(e?.message || e) })
  }
}

async function fijarPausa(valor) {
  await chrome.storage.local.set({ pausado: valor })
  if (valor) for (const id of [...depurando]) await chrome.debugger.detach({ tabId: id }).catch(() => undefined)
  if (valor) depurando.clear()
  await chrome.action.setBadgeText({ text: valor ? '||' : '' })
  enviarPestanas()
}

// ───────────────────────── Eventos del navegador ─────────────────────────

chrome.tabs.onRemoved.addListener(async (id) => {
  const s = await sesion()
  depurando.delete(id)
  if (s.pestanas.delete(id)) {
    await guardarSesion(s)
    enviarPestanas()
  }
})

chrome.tabs.onUpdated.addListener(async (id, cambio) => {
  const s = await sesion()
  if (!s.pestanas.has(id)) return
  // El usuario la sacó del grupo «Odesk»: deja de estar compartida.
  if (cambio.groupId !== undefined && !Object.values(s.grupos).includes(cambio.groupId)) return soltar(id)
  if (cambio.status || cambio.title || cambio.url) enviarPestanas()
})

chrome.tabGroups.onRemoved.addListener(async (grupo) => {
  const s = await sesion()
  for (const [ventana, g] of Object.entries(s.grupos)) if (g === grupo.id) delete s.grupos[ventana]
  await guardarSesion(s)
})

// Despertar periódico: si Odesk se abrió después que Chrome, se conecta solo.
chrome.alarms.create('odesk-conectar', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((a) => a.name === 'odesk-conectar' && void conectar())
chrome.runtime.onStartup.addListener(() => void conectar())
chrome.runtime.onInstalled.addListener(() => void conectar())

// ───────────────────────── Ventana emergente ─────────────────────────

chrome.runtime.onMessage.addListener((m, _remitente, responder) => {
  ;(async () => {
    switch (m?.tipo) {
      case 'estado': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        const s = await sesion()
        const { token } = await local(['token'])
        return {
          estado: ws?.readyState === WebSocket.OPEN ? 'conectado' : token ? estado === 'sin-emparejar' ? 'desconectado' : estado : 'sin-emparejar',
          error: ultimoError,
          pausado: await pausado(),
          pestanas: s.pestanas.size,
          actual: tab ? { id: tab.id, url: tab.url || '', titulo: tab.title || '', compartida: s.pestanas.has(tab.id), web: /^https?:/.test(tab.url || '') } : null
        }
      }
      case 'emparejar':
        return { error: await conectar(String(m.codigo || '').replace(/\D/g, '')) }
      case 'reconectar':
        pausaReintento = 2000
        return { error: await conectar() }
      case 'compartir': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab) return { error: 'No hay pestaña activa.' }
        await compartir(tab)
        return { error: '' }
      }
      case 'dejar':
        await soltar(m.id)
        return { error: '' }
      case 'pausar':
        await fijarPausa(m.valor === true)
        return { error: '' }
      case 'olvidar':
        await chrome.storage.local.remove(['token', 'puerto'])
        if (ws) ws.close()
        estado = 'sin-emparejar'
        return { error: '' }
    }
    return { error: 'Mensaje desconocido' }
  })()
    .then(responder)
    .catch((e) => responder({ error: String(e?.message || e) }))
  return true
})

// Diagnóstico desde las DevTools del service worker (chrome://extensions → «service worker»): odesk.emparejar('123456'), odesk.estado().
// Solo es accesible desde el contexto de la propia extensión.
globalThis.odesk = {
  emparejar: (codigo) => conectar(String(codigo).replace(/\D/g, '')),
  estado: () => ({ estado, error: ultimoError, depurando: [...depurando] })
}

void conectar()
