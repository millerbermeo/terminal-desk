import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOLO_CHROME } from '../src/shared/chrome'
import { origenExtension, PuenteChrome } from '../src/main/chrome/puente'
import { claveAceptacion, LectorTramas, trama } from '../src/main/chrome/ws'

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const OTRA = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba'

describe('WebSocket mínimo', () => {
  it('Sec-WebSocket-Accept del ejemplo del RFC 6455', () => {
    expect(claveAceptacion('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })

  it('lee tramas de cliente enmascaradas, de cualquier tamaño y troceadas', () => {
    const enmascarar = (t: Buffer): Buffer => {
      const sin = trama(0x1, t)
      const cab = sin.subarray(0, sin.length - t.length)
      cab[1] = cab[1]! | 0x80
      const m = Buffer.from([1, 2, 3, 4])
      return Buffer.concat([cab, m, Buffer.from(t.map((b, i) => b ^ m[i & 3]!))])
    }
    for (const n of [5, 300, 70_000]) {
      const datos = Buffer.alloc(n, 'x')
      const bytes = enmascarar(datos)
      const l = new LectorTramas()
      expect(l.leer(bytes.subarray(0, 3))).toEqual([])
      const [t] = l.leer(bytes.subarray(3))
      expect(t!.datos.equals(datos)).toBe(true)
      expect(t!.fin).toBe(true)
    }
  })

  it('rechaza tramas sin máscara', () => {
    expect(() => new LectorTramas().leer(trama(0x1, Buffer.from('hola')))).toThrow(/máscara/)
  })
})

describe('origen de la extensión', () => {
  it('solo acepta chrome-extension:// con un id válido', () => {
    expect(origenExtension(EXT)).toBe(true)
    expect(origenExtension('https://pagina-mala.com')).toBe(false)
    expect(origenExtension('chrome-extension://corto')).toBe(false)
    expect(origenExtension('')).toBe(false)
  })
})

describe('puente con la extensión', () => {
  let dir = ''
  let puente: PuenteChrome | undefined
  const abiertos: WebSocket[] = []
  afterEach(async () => {
    for (const w of abiertos.splice(0)) w.close()
    await puente?.detener()
    puente = undefined
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  const montar = async (): Promise<PuenteChrome> => {
    dir = await mkdtemp(join(tmpdir(), 'chrome-puente-'))
    puente = new PuenteChrome({ archivo: join(dir, 'chrome.json'), puertos: [0] })
    await puente.iniciar()
    return puente
  }

  /** Cliente que se comporta como la extensión: cola de mensajes recibidos. */
  const cliente = async (p: PuenteChrome, origen = EXT) => {
    const ws = new WebSocket(`ws://127.0.0.1:${p.puerto}`, { headers: { origin: origen } } as never)
    abiertos.push(ws)
    const cola: Record<string, unknown>[] = []
    const esperando: ((m: Record<string, unknown>) => void)[] = []
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as Record<string, unknown>
      const f = esperando.shift()
      if (f) f(m)
      else cola.push(m)
    }
    const cerrado = new Promise<void>((r) => (ws.onclose = () => r()))
    await new Promise<void>((resolver, rechazar) => {
      ws.onopen = () => resolver()
      ws.onerror = () => rechazar(new Error('no conecta'))
    })
    return {
      ws,
      cerrado,
      enviar: (m: object) => ws.send(JSON.stringify(m)),
      siguiente: () => new Promise<Record<string, unknown>>((r) => (cola.length ? r(cola.shift()!) : esperando.push(r)))
    }
  }

  const emparejar = async (p: PuenteChrome, origen = EXT) => {
    const { codigo } = p.nuevoCodigo()
    const c = await cliente(p, origen)
    c.enviar({ t: 'emparejar', codigo, protocolo: PROTOCOLO_CHROME, navegador: 'Chrome 157 · Linux', version: '1.0.0' })
    const m = await c.siguiente()
    expect(m.t).toBe('bienvenida')
    return { c, token: String(m.token) }
  }

  it('rechaza la conexión de una página web (origen https://)', async () => {
    const p = await montar()
    await expect(cliente(p, 'https://pagina-mala.com')).rejects.toThrow()
  })

  it('empareja con el código una vez; guarda solo el hash del token; luego entra con el token', async () => {
    const p = await montar()
    const { c, token } = await emparejar(p)
    expect(token.length).toBeGreaterThan(30)
    expect(p.conectado).toBe(true)
    expect(p.codigoVigente).toBeUndefined() // el código es de un solo uso
    const archivo = await readFile(join(dir, 'chrome.json'), 'utf8')
    expect(archivo).not.toContain(token)
    expect(p.emparejadas()).toMatchObject([{ nombre: 'Chrome 157 · Linux', origen: EXT }])
    c.ws.close()
    await c.cerrado

    const c2 = await cliente(p)
    c2.enviar({ t: 'hola', token, protocolo: PROTOCOLO_CHROME, navegador: 'Chrome 157 · Linux' })
    expect((await c2.siguiente()).t).toBe('bienvenida')
  })

  it('el token no vale desde otra extensión, sin código no se empareja y el código tiene intentos limitados', async () => {
    const p = await montar()
    const { c, token } = await emparejar(p)
    c.ws.close()
    const otra = await cliente(p, OTRA)
    otra.enviar({ t: 'hola', token, protocolo: PROTOCOLO_CHROME })
    expect(await otra.siguiente()).toMatchObject({ t: 'rechazo', motivo: 'token' })

    const sin = await cliente(p)
    sin.enviar({ t: 'emparejar', codigo: '000000', protocolo: PROTOCOLO_CHROME })
    expect(await sin.siguiente()).toMatchObject({ motivo: 'sin-codigo' })

    const { codigo } = p.nuevoCodigo()
    const malo = codigo === '111111' ? '222222' : '111111'
    for (let i = 0; i < 5; i++) {
      const x = await cliente(p)
      x.enviar({ t: 'emparejar', codigo: malo, protocolo: PROTOCOLO_CHROME })
      expect(await x.siguiente()).toMatchObject({ motivo: 'codigo' })
    }
    const ultimo = await cliente(p)
    ultimo.enviar({ t: 'emparejar', codigo, protocolo: PROTOCOLO_CHROME })
    expect(await ultimo.siguiente()).toMatchObject({ motivo: 'intentos' })
  })

  it('pide a la extensión y recibe respuestas, errores, pestañas y eventos; al cortarse falla lo pendiente', async () => {
    const p = await montar()
    const eventos: unknown[] = []
    p.alEvento = (e) => void eventos.push(e)
    const { c } = await emparejar(p)

    const r = p.pedir<number>('abrir', { url: 'https://ejemplo.com' })
    const m = await c.siguiente()
    expect(m).toMatchObject({ t: 'pedir', op: 'abrir', url: 'https://ejemplo.com' })
    c.enviar({ t: 'respuesta', id: m.id, ok: true, valor: 42 })
    expect(await r).toBe(42)

    const fallo = p.pedir('cdp', { pestana: 1, metodo: 'Network.getCookies' })
    const m2 = await c.siguiente()
    c.enviar({ t: 'respuesta', id: m2.id, ok: false, error: 'La extensión no permite «Network.getCookies».' })
    await expect(fallo).rejects.toThrow(/no permite/)

    c.enviar({ t: 'pestanas', lista: [{ id: 7, url: 'https://ejemplo.com', titulo: 'Ejemplo', cargando: false, activa: true }], pausado: true })
    c.enviar({ t: 'evento', pestana: 7, metodo: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ value: 'x' }] } })
    c.enviar({ t: 'latido' })
    expect(await c.siguiente()).toEqual({ t: 'latido' })
    expect(p.pestanas).toHaveLength(1)
    expect(p.pausado).toBe(true)
    expect(eventos).toHaveLength(1)

    const colgada = p.pedir('estado', { pestana: 7 })
    await c.siguiente()
    c.ws.close()
    await expect(colgada).rejects.toThrow(/conexión/)
    await expect(p.pedir('estado')).rejects.toThrow(/no está conectado/)
  })

  it('olvidar corta la conexión y el token deja de valer', async () => {
    const p = await montar()
    const { c, token } = await emparejar(p)
    await p.olvidar()
    expect(await c.siguiente()).toMatchObject({ t: 'rechazo', motivo: 'olvidada' })
    await c.cerrado
    const c2 = await cliente(p)
    c2.enviar({ t: 'hola', token, protocolo: PROTOCOLO_CHROME })
    expect(await c2.siguiente()).toMatchObject({ motivo: 'token' })
  })
})
