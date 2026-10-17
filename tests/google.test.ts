import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClienteServidor } from '../src/main/servidor/cliente'
import { iniciarSesionGoogle } from '../src/main/servidor/google'

let api: Server
let cliente: ClienteServidor
let disponible = true
const canjeados: string[] = []

beforeAll(async () => {
  api = createServer((req, res) => {
    const json = (c: number, o: unknown): void => void res.writeHead(c, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (req.url === '/auth/google/disponible') return json(200, { disponible })
    if (req.url === '/auth/google/exchange' && req.method === 'POST') {
      let cuerpo = ''
      req.on('data', (d) => (cuerpo += d))
      req.on('end', () => {
        const { code } = JSON.parse(cuerpo) as { code: string }
        canjeados.push(code)
        json(200, { token: 'jwt-google', usuario: { id: 'u', email: 'g@desk.local' } })
      })
      return
    }
    json(404, {})
  })
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok))
  cliente = new ClienteServidor(`http://127.0.0.1:${(api.address() as AddressInfo).port}`)
})
afterAll(() => new Promise<void>((ok) => api.close(() => ok())))

/** Hace de «navegador + backend»: lee port y nonce de la URL y redirige al puerto local como el servidor real. */
const navegador = (opciones: { nonce?: string; code?: string } = {}) => async (url: string): Promise<void> => {
  const u = new URL(url)
  expect(u.pathname).toBe('/auth/google')
  const port = u.searchParams.get('port')
  const nonce = opciones.nonce ?? u.searchParams.get('nonce')
  setTimeout(() => void fetch(`http://127.0.0.1:${port}/callback?code=${opciones.code ?? 'codigo-de-un-solo-uso-123'}&nonce=${nonce}`), 20)
}

describe('login con Google', () => {
  it('abre el navegador, recibe el código en el puerto local y lo cambia por la sesión', async () => {
    const estado = await iniciarSesionGoogle(cliente, navegador())
    expect(estado).toMatchObject({ activa: true, email: 'g@desk.local' })
    expect(canjeados).toEqual(['codigo-de-un-solo-uso-123'])
  })

  it('con el servidor sin credenciales de Google avisa sin abrir el navegador', async () => {
    disponible = false
    let abierto = false
    await expect(iniciarSesionGoogle(cliente, () => void (abierto = true))).rejects.toThrow(/GOOGLE_CLIENT_ID/)
    expect(abierto).toBe(false)
    disponible = true
  })

  it('una redirección con otro nonce no se acepta: no se canjea nada y termina por tiempo', async () => {
    canjeados.length = 0
    await expect(iniciarSesionGoogle(cliente, navegador({ nonce: 'otro-nonce-que-no-es-el-nuestro' }), 400)).rejects.toThrow(/tiempo/)
    expect(canjeados).toEqual([])
  })
})
