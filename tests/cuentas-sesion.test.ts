import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClienteServidor, ErrorServidor } from '../src/main/servidor/cliente'

const cifrador = { disponible: () => true, cifrar: (t: string) => `c:${t}`, descifrar: (t: string) => t.slice(2) }
const USUARIOS: Record<string, string> = { 'a@x.co': 'id-a', 'b@x.co': 'id-b' }
const vencidos = new Set<string>()

let api: Server
let url: string
beforeAll(async () => {
  delete process.env.ODESK_API_URL
  api = createServer((req, res) => {
    const json = (c: number, o: unknown): void => void res.writeHead(c, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    const token = (req.headers.authorization ?? '').replace('Bearer ', '')
    if (req.url === '/auth/login') {
      let cuerpo = ''
      req.on('data', (d) => (cuerpo += d))
      req.on('end', () => {
        const email = (JSON.parse(cuerpo) as { email: string }).email
        json(200, { token: `jwt-${email}`, usuario: { id: USUARIOS[email], email } })
      })
      return
    }
    if (req.url === '/auth/me') {
      const email = token.replace('jwt-', '')
      if (vencidos.has(token) || !USUARIOS[email]) return json(401, { message: 'Unauthorized' })
      return json(200, { id: USUARIOS[email], email })
    }
    if (req.url === '/auth/logout') return void res.writeHead(204).end()
    json(404, {})
  })
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((ok) => api.close(() => ok())))

async function cliente(): Promise<ClienteServidor> {
  const c = new ClienteServidor(url)
  c.configurar(join(await mkdtemp(join(tmpdir(), 'ses-')), 'sesion.json'), cifrador)
  return c
}

describe('varias cuentas con sesión en el mismo equipo', () => {
  it('entrar con otra cuenta conserva la anterior y se puede volver a ella', async () => {
    const c = await cliente()
    await c.iniciar('a@x.co', 'p')
    await c.iniciar('b@x.co', 'p')
    expect((await c.estado()).email).toBe('b@x.co')
    expect(await c.cuentasGuardadas()).toEqual([
      { email: 'a@x.co', activa: false },
      { email: 'b@x.co', activa: true }
    ])
    const e = await c.cambiarA('A@X.co')
    expect(e).toMatchObject({ activa: true, email: 'a@x.co', usuarioId: 'id-a' })
    expect((await c.cuentasGuardadas()).find((x) => x.activa)?.email).toBe('a@x.co')
  })

  it('una cuenta con la sesión vencida se quita y la actual no cambia', async () => {
    const c = await cliente()
    await c.iniciar('a@x.co', 'p')
    await c.iniciar('b@x.co', 'p')
    vencidos.add('jwt-a@x.co')
    await expect(c.cambiarA('a@x.co')).rejects.toBeInstanceOf(ErrorServidor)
    expect((await c.estado()).email).toBe('b@x.co')
    expect(await c.cuentasGuardadas()).toEqual([{ email: 'b@x.co', activa: true }])
    vencidos.clear()
  })

  it('cambiar a una cuenta que no existe no toca nada', async () => {
    const c = await cliente()
    await c.iniciar('a@x.co', 'p')
    await expect(c.cambiarA('z@x.co')).rejects.toThrow(/ya no está guardada/)
    expect((await c.estado()).email).toBe('a@x.co')
  })

  it('quitar la activa cierra sesión y deja la otra guardada; quitar otra solo la olvida', async () => {
    const c = await cliente()
    await c.iniciar('a@x.co', 'p')
    await c.iniciar('b@x.co', 'p')
    await c.quitarGuardada('a@x.co')
    expect(await c.cuentasGuardadas()).toEqual([{ email: 'b@x.co', activa: true }])
    await c.iniciar('a@x.co', 'p')
    const s = await c.quitarGuardada('a@x.co') // la activa
    expect(s.activa).toBe(false)
    expect(await c.cuentasGuardadas()).toEqual([{ email: 'b@x.co', activa: false }])
  })
})
