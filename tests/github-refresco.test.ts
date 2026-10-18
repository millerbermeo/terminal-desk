import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServicioGitHub } from '../src/main/github/servicio'
import { AlmacenToken, type Cifrador } from '../src/main/github/token'
import { seccionesSecretas } from '../src/main/servidor/secretos'

/**
 * GitHub falso con tokens que caducan: `access_token` con su `refresh_token` (que se usa una sola vez: cada renovación entrega otro).
 * `/user` y `/user/repos` solo aceptan los tokens de acceso vigentes.
 */
let http: Server
let url = ''
let validos: Set<string>
let refrescos: Set<string>
let contador = 0
let llamadasRefresh: URLSearchParams[] = []
let alRefrescar: (() => Promise<void>) | undefined
let respuestaRefresh: Record<string, unknown> | undefined
let respuestaCodigo: Record<string, unknown> = {}

const nuevoPar = (): { access_token: string; refresh_token: string; expires_in: number; refresh_token_expires_in: number } => {
  contador++
  const par = { access_token: `ghu_acceso_${contador}`, refresh_token: `ghr_refresco_${contador}`, expires_in: 28_800, refresh_token_expires_in: 15_811_200 }
  validos.add(par.access_token)
  refrescos.add(par.refresh_token)
  return par
}

beforeAll(async () => {
  http = createServer((req, res) => {
    const trozos: Buffer[] = []
    req.on('data', (t: Buffer) => trozos.push(t))
    req.on('end', () => {
      void (async () => {
        const cuerpo = new URLSearchParams(Buffer.concat(trozos).toString())
        const json = (c: unknown, estado = 200): void => {
          res.writeHead(estado, { 'content-type': 'application/json' })
          res.end(JSON.stringify(c))
        }
        if (req.url === '/login/device/code') return json(respuestaCodigo)
        if (req.url === '/login/oauth/access_token') {
          if (cuerpo.get('grant_type') === 'refresh_token') {
            llamadasRefresh.push(cuerpo)
            await alRefrescar?.()
            if (respuestaRefresh) return json(respuestaRefresh)
            const r = cuerpo.get('refresh_token') ?? ''
            if (!refrescos.delete(r)) return json({ error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' })
            return json(nuevoPar())
          }
          return json(nuevoPar()) // consulta del flujo de dispositivo: autorizado
        }
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
        if (req.url === '/user') return validos.has(bearer) ? json({ login: 'ana' }) : json({ message: 'Bad credentials' }, 401)
        if (req.url?.startsWith('/user/repos')) return validos.has(bearer) ? json([]) : json({ message: 'Bad credentials' }, 401)
        json({ message: 'no' }, 404)
      })()
    })
  })
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((ok) => http.close(() => ok())))
beforeEach(() => {
  validos = new Set()
  refrescos = new Set()
  contador = 0
  llamadasRefresh = []
  alRefrescar = undefined
  respuestaRefresh = undefined
  respuestaCodigo = { device_code: 'dev', user_code: 'AAAA-1111', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 }
  vi.unstubAllEnvs()
})

const cifrador: Cifrador = { disponible: () => true, cifrar: (t) => Buffer.from(t).toString('base64'), descifrar: (c) => Buffer.from(c, 'base64').toString() }

async function nuevo(oauth = url) {
  const datos = await mkdtemp(join(tmpdir(), 'gh-refresco-'))
  const token = new AlmacenToken(join(datos, 'github.json'), cifrador)
  const s = new ServicioGitHub({ token, api: url, oauth, host: 'github.test', dirDatos: datos, carpetaDe: async () => '', agregarProyecto: async () => ({ id: 'x' }), esperar: async () => undefined })
  await s.configurarOauth('Iv1.cliente123')
  return { s, token, datos }
}

/** Deja guardado un token de acceso (válido en el servidor falso) con su refresh y la hora a la que caduca. */
async function conSesion(token: AlmacenToken, caducaEnMs: number): Promise<{ acceso: string; refresh: string }> {
  const par = nuevoPar()
  await token.guardar(par.access_token, 'ana', { refresh: par.refresh_token, expira: Date.now() + caducaEnMs, refrescaHasta: Date.now() + 1e9 })
  return { acceso: par.access_token, refresh: par.refresh_token }
}

describe('el token que caduca se guarda con su refresh (siempre cifrado)', () => {
  it('el refresh no se escribe nunca en claro y se recupera con sus fechas', async () => {
    const datos = await mkdtemp(join(tmpdir(), 'gh-refresco-'))
    const archivo = join(datos, 'github.json')
    const t = new AlmacenToken(archivo, cifrador)
    await t.guardar('acceso-secreto', 'ana', { refresh: 'refresh-secreto', expira: 1_800_000_000_000, refrescaHasta: 1_900_000_000_000 })
    const crudo = await readFile(archivo, 'utf8')
    expect(crudo).not.toContain('acceso-secreto')
    expect(crudo).not.toContain('refresh-secreto')
    expect(await new AlmacenToken(archivo, cifrador).leer()).toEqual({ token: 'acceso-secreto', usuario: 'ana', refresh: 'refresh-secreto', expira: 1_800_000_000_000, refrescaHasta: 1_900_000_000_000, persistente: true })
    // un token pegado a mano no lleva refresh: guardarlo lo limpia
    await t.guardar('otro', 'ana')
    expect(await t.leer()).toEqual({ token: 'otro', usuario: 'ana', persistente: true })
  })

  it('sin llavero seguro viven solo en memoria', async () => {
    const t = new AlmacenToken(join(await mkdtemp(join(tmpdir(), 'gh-refresco-')), 'g.json'), { ...cifrador, disponible: () => false })
    await t.guardar('a', 'ana', { refresh: 'r', expira: 5 })
    expect(await t.leer()).toEqual({ token: 'a', usuario: 'ana', refresh: 'r', expira: 5, persistente: false })
  })

  it('al iniciar sesión por código guarda el refresh y cuándo caduca, y el estado dice que se renueva sola', async () => {
    const { s, token } = await nuevo()
    await s.dispositivoIniciar()
    const antes = Date.now()
    const e = await s.dispositivoEsperar()
    expect(e).toMatchObject({ conectado: true, renovable: true, usuario: { usuario: 'ana' } })
    const t = (await token.leer())!
    expect(t.refresh).toBe('ghr_refresco_1')
    expect(t.expira).toBeGreaterThanOrEqual(antes + 28_800_000)
    expect(t.expira).toBeLessThan(antes + 28_800_000 + 5000)
    expect(t.refrescaHasta).toBeGreaterThan(antes + 15_000_000_000)
  })

  it('un token que no caduca (sin refresh) no es «renovable»', async () => {
    const { s, token } = await nuevo()
    await token.guardar('gho_eterno', 'ana')
    validos.add('gho_eterno')
    expect((await s.estado()).renovable).toBeUndefined()
  })
})

describe('renovación automática', () => {
  it('poco antes de caducar pide uno nuevo, lo guarda y lo usa (el anterior ya no vale)', async () => {
    const { s, token } = await nuevo()
    const viejo = await conSesion(token, 60_000) // caduca en 1 min: dentro del margen de 5
    expect(await s.repos()).toEqual([])
    expect(llamadasRefresh).toHaveLength(1)
    expect(llamadasRefresh[0]!.get('grant_type')).toBe('refresh_token')
    expect(llamadasRefresh[0]!.get('refresh_token')).toBe(viejo.refresh)
    expect(llamadasRefresh[0]!.get('client_id')).toBe('Iv1.cliente123')
    expect(llamadasRefresh[0]!.has('client_secret')).toBe(false)
    const t = (await token.leer())!
    expect(t.token).not.toBe(viejo.acceso)
    expect(t.refresh).not.toBe(viejo.refresh) // el refresh también rota
    expect(t.usuario).toBe('ana')
    expect(t.expira).toBeGreaterThan(Date.now() + 28_000_000)
  })

  it('si falta mucho para caducar no pregunta nada a GitHub', async () => {
    const { s, token } = await nuevo()
    await conSesion(token, 3 * 3_600_000)
    await s.repos()
    await s.repos()
    expect(llamadasRefresh).toHaveLength(0)
  })

  it('varias peticiones a la vez comparten una sola renovación (cada refresh sirve una vez)', async () => {
    const { s, token } = await nuevo()
    await conSesion(token, 1000)
    await Promise.all([s.repos(), s.repos(), s.repos(), s.estado(), s.credencialesPara('https://github.test/ana/x.git')])
    expect(llamadasRefresh).toHaveLength(1)
    expect(refrescos.size).toBe(1)
  })

  it('si GitHub responde 401 aunque la hora no haya pasado (token revocado o caducado antes), renueva y repite la petición', async () => {
    const { s, token } = await nuevo()
    const viejo = await conSesion(token, 3 * 3_600_000)
    validos.delete(viejo.acceso) // GitHub ya no lo acepta
    expect(await s.repos()).toEqual([])
    expect(llamadasRefresh).toHaveLength(1)
    expect((await token.leer())!.token).not.toBe(viejo.acceso)
  })

  it('también renueva antes de dar credenciales a git, para que enviar y traer no fallen de madrugada', async () => {
    const { s, token } = await nuevo()
    const viejo = await conSesion(token, 1000)
    const env = await s.credencialesPara('https://github.test/ana/x.git')
    expect(env?.ODESK_GITHUB_TOKEN).toBeDefined()
    expect(env?.ODESK_GITHUB_TOKEN).not.toBe(viejo.acceso)
  })

  it('manda el secreto del cliente solo si se define', async () => {
    vi.stubEnv('ODESK_GITHUB_CLIENT_SECRET', 'secreto-de-la-app')
    const { s, token } = await nuevo()
    await conSesion(token, 1000)
    await s.repos()
    expect(llamadasRefresh[0]!.get('client_secret')).toBe('secreto-de-la-app')
  })
})

describe('cuando la renovación no se puede', () => {
  it('con un refresh que ya no vale se desconecta (hay que volver a iniciar sesión)', async () => {
    const { s, token } = await nuevo()
    const viejo = await conSesion(token, 1000)
    refrescos.delete(viejo.refresh)
    expect((await s.estado()).conectado).toBe(false)
    expect(await token.leer()).toBeUndefined()
    await expect(s.repos()).rejects.toThrow(/Conecta tu cuenta/)
  })

  it('si otro equipo ya renovó y dejó el token nuevo, se usa ese en vez de desconectar', async () => {
    const { s, token } = await nuevo()
    const viejo = await conSesion(token, 1000)
    refrescos.delete(viejo.refresh) // el otro equipo gastó este refresh…
    alRefrescar = async () => {
      const par = nuevoPar() // …y lo que dejó en la bóveda llega justo ahora
      await token.guardar(par.access_token, 'ana', { refresh: par.refresh_token, expira: Date.now() + 28_800_000 })
    }
    expect(await s.repos()).toEqual([])
    expect((await token.leer())!.token).toBe('ghu_acceso_2')
  })

  it('sin conexión con GitHub sigue con el token que hay: no borra nada', async () => {
    const { s, token } = await nuevo('http://127.0.0.1:1')
    const viejo = await conSesion(token, 1000)
    expect((await s.estado()).conectado).toBe(true)
    expect((await token.leer())!.token).toBe(viejo.acceso)
  })

  it('si la app exige el secreto, el fallo se queda en el aviso y no se pierde la sesión', async () => {
    respuestaRefresh = { error: 'incorrect_client_credentials' }
    const { s, token } = await nuevo()
    const viejo = await conSesion(token, 1000)
    expect((await s.estado()).conectado).toBe(true)
    expect((await token.leer())!.refresh).toBe(viejo.refresh)
  })
})

describe('el token renovable viaja a tus otros equipos por la bóveda', () => {
  it('se sube con su refresh y fechas, y al aplicarlo en otro equipo queda guardado igual', async () => {
    const origen = new AlmacenToken(join(await mkdtemp(join(tmpdir(), 'gh-refresco-')), 'g.json'), cifrador)
    await origen.guardar('acceso', 'ana', { refresh: 'refresh', expira: 111, refrescaHasta: 222 })
    const dir = await mkdtemp(join(tmpdir(), 'gh-boveda-'))
    const subido = (await seccionesSecretas(dir, origen).leer()).github
    expect(subido).toEqual({ token: 'acceso', usuario: 'ana', refresh: 'refresh', expira: 111, refrescaHasta: 222 })
    const destino = new AlmacenToken(join(await mkdtemp(join(tmpdir(), 'gh-refresco-')), 'g.json'), cifrador)
    await seccionesSecretas(dir, destino).aplicar('github', subido)
    expect(await destino.leer()).toEqual({ token: 'acceso', usuario: 'ana', refresh: 'refresh', expira: 111, refrescaHasta: 222, persistente: true })
  })

  it('un token pegado a mano sigue subiendo solo token y usuario', async () => {
    const t = new AlmacenToken(join(await mkdtemp(join(tmpdir(), 'gh-refresco-')), 'g.json'), cifrador)
    await t.guardar('gho_manual', 'ana')
    expect((await seccionesSecretas(await mkdtemp(join(tmpdir(), 'gh-boveda-')), t).leer()).github).toEqual({ token: 'gho_manual', usuario: 'ana' })
  })
})
