import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PuenteChrome } from '../src/main/chrome/puente'
import { ChromeIA } from '../src/main/chrome-ia'

/**
 * De punta a punta con un Chromium real: carga la extensión de `extension/`, la empareja con el puente y maneja una página local con
 * las herramientas chrome_*. Usa el Chromium de Playwright si está en ~/.cache/ms-playwright (Chrome de marca ya no admite
 * --load-extension) o el de ODESK_E2E_CHROMIUM. Sin ninguno, se omite.
 */
function buscarChromium(): string | undefined {
  if (process.env.ODESK_E2E_CHROMIUM) return process.env.ODESK_E2E_CHROMIUM
  const base = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(base)) return undefined
  for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const ruta = join(base, d, sub)
      if (existsSync(ruta)) return ruta
    }
  }
  return undefined
}

const CHROMIUM = buscarChromium()
const EXTENSION = resolve(__dirname, '..', 'extension')

const PAGINA = `<!doctype html><html><head><title>Prueba Odesk</title></head><body>
<h1>Hola desde la prueba</h1>
<label>Nombre <input id="nombre"></label>
<button id="guardar" onclick="document.getElementById('salida').textContent='Guardado: '+document.getElementById('nombre').value; console.error('error de prueba')">Guardar</button>
<button id="borrar" onclick="document.getElementById('salida').textContent = confirm('¿Borrar todo?') ? 'borrado' : 'no borrado'">Quitar</button>
<p id="salida">nada</p>
</body></html>`

/** CDP mínimo sobre el WebSocket de un objetivo. */
async function cdp(url: string) {
  const ws = new WebSocket(url)
  await new Promise((r, x) => ((ws.onopen = r), (ws.onerror = x)))
  let n = 0
  const pendientes = new Map<number, (v: { result?: unknown; error?: unknown }) => void>()
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: unknown }
    if (m.id) pendientes.get(m.id)?.(m)
  }
  return {
    enviar: (method: string, params: object = {}) =>
      new Promise<{ result?: unknown; error?: unknown }>((r) => {
        const id = ++n
        pendientes.set(id, r)
        ws.send(JSON.stringify({ id, method, params }))
      }),
    cerrar: () => ws.close()
  }
}

describe.skipIf(!CHROMIUM)('Chrome real con la extensión (e2e)', () => {
  let dir = ''
  let chromium: ChildProcess | undefined
  let web: Server | undefined
  let puente: PuenteChrome
  let ia: ChromeIA
  let urlPagina = ''
  const confirmaciones: string[] = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chrome-e2e-'))
    web = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), r.end(PAGINA)))
    await new Promise<void>((r) => web!.listen(0, '127.0.0.1', () => r()))
    urlPagina = `http://localhost:${(web.address() as { port: number }).port}/`

    puente = new PuenteChrome({ archivo: join(dir, 'chrome.json') })
    await puente.iniciar()
    expect(puente.puerto).not.toBeNull()
    ia = new ChromeIA({ puente, preguntarSitio: async () => 'sesion', confirmar: async (p) => (confirmaciones.push(p), true) })

    chromium = spawn(
      CHROMIUM!,
      ['--headless=new', `--user-data-dir=${join(dir, 'perfil')}`, `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    const puertoCdp = await new Promise<number>((resolver, rechazar) => {
      let err = ''
      const t = setTimeout(() => rechazar(new Error(`Chromium no arrancó:\n${err}`)), 20_000)
      chromium!.stderr!.on('data', (d: Buffer) => {
        err += d.toString()
        const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(err)
        if (m) {
          clearTimeout(t)
          resolver(Number(m[1]))
        }
      })
    })

    // Id de la extensión: su service worker aparece entre los objetivos.
    type Objetivo = { url: string; type: string; webSocketDebuggerUrl: string }
    const objetivos = async (): Promise<Objetivo[]> => (await (await fetch(`http://127.0.0.1:${puertoCdp}/json/list`)).json()) as Objetivo[]
    // Chromium trae extensiones internas con su propio background.js: la nuestra se reconoce por el nombre del manifiesto.
    let sw: Objetivo | undefined
    for (let i = 0; i < 50 && !sw; i++) {
      for (const x of (await objetivos()).filter((o) => o.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js/.test(o.url))) {
        const c = await cdp(x.webSocketDebuggerUrl)
        const r = (await c.enviar('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true })).result as { result?: { value?: string } }
        c.cerrar()
        if (r.result?.value === 'Odesk Code · Chrome') sw = x
      }
      if (!sw) await new Promise((r) => setTimeout(r, 200))
    }
    expect(sw).toBeDefined()

    // Emparejar como lo haría el usuario: el código de Odesk escrito en la ventana de la extensión (abierta por la propia extensión).
    const { codigo } = puente.nuevoCodigo()
    const trabajador = await cdp(sw!.webSocketDebuggerUrl)
    const r = await trabajador.enviar('Runtime.evaluate', { expression: `odesk.emparejar('${codigo}')`, awaitPromise: true, returnByValue: true })
    trabajador.cerrar()
    expect((r.result as { result: { value: string } }).result.value, JSON.stringify(r)).toBe('')
    for (let i = 0; i < 50 && !puente.conectado; i++) await new Promise((x) => setTimeout(x, 100))
    expect(puente.conectado).toBe(true)
  }, 60_000)

  afterAll(async () => {
    chromium?.kill('SIGKILL')
    await puente?.detener()
    await new Promise<void>((r) => (web ? web.close(() => r()) : r()))
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('abre una pestaña en el grupo «Odesk», lee la página, escribe y hace clic', async () => {
    const abierta = await ia.ejecutar('chrome_abrir', { url: urlPagina })
    expect(abierta.texto).toMatch(/Pestaña \d+ abierta/)
    expect(abierta.texto).toContain('Prueba Odesk')
    const lista = await ia.ejecutar('chrome_pestanas', {})
    expect(lista.texto).toContain(urlPagina)

    const foto = await ia.ejecutar('chrome_instantanea', {})
    expect(foto.texto).toContain('Hola desde la prueba')
    const ref = (re: RegExp): string => {
      const linea = foto.texto.split('\n').find((l) => re.test(l))
      return /\[ref=(e\d+)\]/.exec(linea ?? '')![1]!
    }
    await ia.ejecutar('chrome_escribir', { ref: ref(/^- textbox "Nombre"/), texto: 'Ada' })
    await ia.ejecutar('chrome_clic', { ref: ref(/^- button "Guardar"/) })
    const espera = await ia.ejecutar('chrome_esperar', { texto: 'Guardado: Ada' })
    expect(espera.texto).toContain('Listo')
    const consola = await ia.ejecutar('chrome_consola', { solo_errores: true })
    expect(consola.texto).toContain('error de prueba')
  }, 60_000)

  it('rechaza los confirm() de la página y confirma el JavaScript con el usuario', async () => {
    const foto = await ia.ejecutar('chrome_instantanea', {})
    const linea = foto.texto.split('\n').find((l) => /^- button "Quitar"/.test(l))
    const ref = /\[ref=(e\d+)\]/.exec(linea ?? '')![1]!
    await ia.ejecutar('chrome_clic', { ref })
    await ia.ejecutar('chrome_esperar', { texto: 'no borrado' })

    const r = await ia.ejecutar('chrome_evaluar', { codigo: 'document.title' })
    expect(r.texto).toContain('Prueba Odesk')
    expect(confirmaciones.some((c) => c.includes('document.title'))).toBe(true)
  }, 60_000)

  it('no deja tocar pestañas que no están en el grupo «Odesk»', async () => {
    await expect(puente.pedir('estado', { pestana: 999_999 })).rejects.toThrow(/no está compartida/)
    await expect(ia.ejecutar('chrome_cerrar', { pestana: 999_999 })).rejects.toThrow(/no está en el grupo/)
  })

  it('cierra la pestaña', async () => {
    const r = await ia.ejecutar('chrome_cerrar', {})
    expect(r.texto).toMatch(/cerrada/)
    expect((await ia.ejecutar('chrome_pestanas', {})).texto).toContain('No hay pestañas')
  })
})
