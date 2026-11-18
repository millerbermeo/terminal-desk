import { describe, expect, it, vi } from 'vitest'
import { AVISO_CONTENIDO_WEB } from '../src/shared/chrome-herramientas'
import { clicSensible, esLocal, origenDe } from '../src/shared/chrome'
import type { DatosChrome, EventoPagina, PuenteChrome } from '../src/main/chrome/puente'
import { ChromeIA, type DecisionSitio } from '../src/main/chrome-ia'

/** Extensión falsa: pestañas en memoria y respuestas del mundo aislado según la función de `window.__odesk` llamada. */
function montar(o: { url?: string; desc?: string; decision?: DecisionSitio; confirma?: boolean; activo?: boolean; conectado?: boolean } = {}) {
  const datos: DatosChrome = { activo: o.activo ?? true, extensiones: [], sitios: [] }
  const pestanas = [{ id: 5, url: o.url ?? 'https://banco.example', titulo: 'Banco', cargando: false, activa: true }]
  const pedidos: { op: string; datos: Record<string, unknown> }[] = []
  const puente = {
    conectado: o.conectado ?? true,
    pausado: false,
    pestanas,
    navegador: { nombre: 'Chrome 157', version: '1.0.0' },
    alEvento: undefined as ((e: EventoPagina) => void) | undefined,
    leerDatos: async () => datos,
    cambiarDatos: async (f: (d: DatosChrome) => void) => f(datos),
    pedir: async (op: string, d: Record<string, unknown> = {}) => {
      pedidos.push({ op, datos: d })
      switch (op) {
        case 'pestanas':
          return pestanas
        case 'estado':
          return { url: pestanas[0]!.url, titulo: 'Banco', cargando: false }
        case 'zoom':
          return 1
        case 'abrir':
          pestanas.push({ id: 9, url: String(d.url), titulo: '', cargando: false, activa: true })
          return 9
        case 'aislado': {
          const f = /window\.__odesk\.(\w+)\(/g
          let fn = ''
          for (let m; (m = f.exec(String(d.codigo))); ) fn = m[1]!
          if (fn === 'instantanea') return { ok: '- heading "Tu banco" [e1]' }
          if (fn === 'punto') return { ok: { x: 10, y: 10, desc: o.desc ?? 'botón «Ver más»', tapa: null, deshabilitado: false, archivo: false } }
          return { ok: true }
        }
        case 'cdp':
          if (d.metodo === 'Runtime.evaluate') return { result: { value: 'ok' } }
          return {}
      }
      return true
    }
  }
  const preguntarSitio = vi.fn(async () => o.decision ?? 'sesion')
  const confirmar = vi.fn(async () => o.confirma ?? true)
  const ia = new ChromeIA({ puente: puente as unknown as PuenteChrome, preguntarSitio, confirmar })
  return { ia, puente, datos, pedidos, preguntarSitio, confirmar }
}

describe('lógica pura de Chrome', () => {
  it('origen, local y clics sensibles', () => {
    expect(origenDe('https://a.com/x?y')).toBe('https://a.com')
    expect(origenDe('chrome://settings')).toBeNull()
    expect(esLocal('http://localhost:5173')).toBe(true)
    expect(esLocal('http://127.0.0.1:3000')).toBe(true)
    expect(esLocal('https://banco.example')).toBe(false)
    for (const d of ['botón «Comprar ahora»', 'botón «Pagar 20 €»', 'botón «Publicar»', 'botón «Eliminar cuenta»', 'button "Place order"', 'botón «Enviar»']) expect(clicSensible(d)).toBe(true)
    for (const d of ['botón «Ver más»', 'enlace «Inicio»', 'botón «Siguiente»']) expect(clicSensible(d)).toBe(false)
  })
})

describe('ChromeIA', () => {
  it('apagado o sin conexión: lo dice sin tocar nada', async () => {
    expect((await montar({ activo: false }).ia.ejecutar('chrome_instantanea', {})).error).toBe(true)
    await expect(montar({ conectado: false }).ia.ejecutar('chrome_instantanea', {})).rejects.toThrow(/no está conectado/)
  })

  it('pregunta por cada sitio nuevo; «sesión» vale para las siguientes; lo leído lleva el aviso de contenido web', async () => {
    const m = montar({ decision: 'sesion' })
    const r = await m.ia.ejecutar('chrome_instantanea', {}, { cliente: 'claude-code' })
    expect(m.preguntarSitio).toHaveBeenCalledWith('https://banco.example', 'claude-code')
    expect(r.texto.startsWith(AVISO_CONTENIDO_WEB)).toBe(true)
    expect(r.texto).toContain('Tu banco')
    await m.ia.ejecutar('chrome_instantanea', {})
    expect(m.preguntarSitio).toHaveBeenCalledTimes(1)
    expect(m.datos.sitios).toEqual([])
  })

  it('«siempre» se guarda; «no» corta y no vuelve a preguntar en la sesión', async () => {
    const s = montar({ decision: 'siempre' })
    await s.ia.ejecutar('chrome_instantanea', {})
    expect(s.datos.sitios).toEqual(['https://banco.example'])

    const n = montar({ decision: 'no' })
    await expect(n.ia.ejecutar('chrome_instantanea', {})).rejects.toThrow(/no autorizó/)
    await expect(n.ia.ejecutar('chrome_instantanea', {})).rejects.toThrow(/no autorizó/)
    expect(n.preguntarSitio).toHaveBeenCalledTimes(1)
    expect(n.pedidos.some((p) => p.op === 'aislado')).toBe(false)
  })

  it('localhost no pregunta; abrir autoriza el destino antes de crear la pestaña', async () => {
    const l = montar({ url: 'http://localhost:5173/' })
    await l.ia.ejecutar('chrome_instantanea', {})
    expect(l.preguntarSitio).not.toHaveBeenCalled()

    const a = montar({ decision: 'no' })
    await expect(a.ia.ejecutar('chrome_abrir', { url: 'tienda.example' })).rejects.toThrow(/no autorizó/)
    expect(a.pedidos.some((p) => p.op === 'abrir')).toBe(false)
  })

  it('JavaScript siempre se confirma; un clic de compra se confirma y uno normal no', async () => {
    const e = montar({ confirma: false })
    await expect(e.ia.ejecutar('chrome_evaluar', { codigo: 'document.cookie' })).rejects.toThrow(/no autorizó/)
    expect(e.pedidos.some((p) => p.datos.metodo === 'Runtime.evaluate')).toBe(false)

    const compra = montar({ desc: 'botón «Comprar ahora»', confirma: false })
    await expect(compra.ia.ejecutar('chrome_clic', { ref: 'e3' })).rejects.toThrow(/no autorizó el clic/)
    expect(compra.pedidos.some((p) => p.datos.metodo === 'Input.dispatchMouseEvent')).toBe(false)

    const normal = montar({ desc: 'botón «Ver más»' })
    await normal.ia.ejecutar('chrome_clic', { ref: 'e3' })
    expect(normal.confirmar).not.toHaveBeenCalled()
    expect(normal.pedidos.filter((p) => p.datos.metodo === 'Input.dispatchMouseEvent').length).toBeGreaterThanOrEqual(3)
  })

  it('los confirm() de la página se rechazan (los alert se aceptan) y quedan en la consola', async () => {
    const m = montar()
    m.puente.alEvento!({ pestana: 5, metodo: 'Page.javascriptDialogOpening', params: { type: 'confirm', message: '¿Eliminar cuenta?' } })
    m.puente.alEvento!({ pestana: 5, metodo: 'Page.javascriptDialogOpening', params: { type: 'alert', message: 'Hola' } })
    await vi.waitFor(() => expect(m.pedidos.filter((p) => p.datos.metodo === 'Page.handleJavaScriptDialog')).toHaveLength(2))
    const [confirm, alert] = m.pedidos.filter((p) => p.datos.metodo === 'Page.handleJavaScriptDialog')
    expect(confirm!.datos.params).toEqual({ accept: false })
    expect(alert!.datos.params).toEqual({ accept: true })
    m.puente.alEvento!({ pestana: 5, metodo: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ value: 'falló' }] } })
    const r = await m.ia.ejecutar('chrome_consola', {})
    expect(r.texto).toContain('RECHAZADO')
    expect(r.texto).toContain('[error] falló')
  })

  it('red: junta petición y respuesta, sin cabeceras', async () => {
    const m = montar()
    m.puente.alEvento!({ pestana: 5, metodo: 'Network.requestWillBeSent', params: { requestId: '1', type: 'Fetch', request: { method: 'POST', url: 'https://banco.example/api' } } })
    m.puente.alEvento!({ pestana: 5, metodo: 'Network.responseReceived', params: { requestId: '1', response: { status: 500 } } })
    const r = await m.ia.ejecutar('chrome_red', { solo_fallos: true })
    expect(r.texto).toContain('POST 500 Fetch https://banco.example/api')
  })
})
