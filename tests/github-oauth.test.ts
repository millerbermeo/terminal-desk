import { readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorDispositivo, esperarToken, pedirCodigo } from '../src/main/github/dispositivo'
import { ejecutarOperacionGitHub } from '../src/main/github/operaciones'
import { ServicioGitHub } from '../src/main/github/servicio'
import { AlmacenToken, type Cifrador } from '../src/main/github/token'

/** GitHub falso: el flujo de dispositivo (código + consulta del token) y `/user`. Las respuestas de la consulta se guionizan. */
let http: Server
let url = ''
let guion: Record<string, unknown>[] = []
let cuerpos: URLSearchParams[] = []
let codigo: Record<string, unknown> = {}

beforeAll(async () => {
  http = createServer((req, res) => {
    const trozos: Buffer[] = []
    req.on('data', (t: Buffer) => trozos.push(t))
    req.on('end', () => {
      const cuerpo = new URLSearchParams(Buffer.concat(trozos).toString())
      cuerpos.push(cuerpo)
      const json = (c: unknown, estado = 200): void => {
        res.writeHead(estado, { 'content-type': 'application/json' })
        res.end(JSON.stringify(c))
      }
      if (req.url === '/login/device/code') return json(codigo)
      if (req.url === '/login/oauth/access_token') return json(guion.shift() ?? { error: 'authorization_pending' })
      if (req.url === '/user') return req.headers.authorization === 'Bearer gho_token_oauth' ? json({ login: 'ana', name: 'Ana Pérez' }) : json({ message: 'Bad credentials' }, 401)
      json({ message: 'no' }, 404)
    })
  })
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((ok) => http.close(() => ok())))
beforeEach(() => {
  guion = []
  cuerpos = []
  codigo = { device_code: 'dev123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 }
  vi.unstubAllEnvs()
})

const rapido = { esperar: async (): Promise<void> => undefined }

describe('flujo de dispositivo de GitHub', () => {
  it('pide el código con el Client ID y los permisos que usa la app', async () => {
    const c = await pedirCodigo(url, 'Iv1.cliente123')
    expect(c).toEqual({ deviceCode: 'dev123', codigoUsuario: 'ABCD-1234', urlVerificacion: 'https://github.com/login/device', intervalo: 5, expiraEn: 900 })
    expect(cuerpos[0]!.get('client_id')).toBe('Iv1.cliente123')
    expect(cuerpos[0]!.get('scope')).toBe('repo workflow read:user')
  })

  it('explica los errores de configuración (Device Flow apagado, Client ID desconocido)', async () => {
    codigo = { error: 'device_flow_disabled' }
    await expect(pedirCodigo(url, 'Iv1.cliente123')).rejects.toThrow(/Device Flow/)
    codigo = { error: 'incorrect_client_credentials' }
    await expect(pedirCodigo(url, 'Iv1.cliente123')).rejects.toThrow(/no reconoce ese Client ID/)
    await expect(pedirCodigo('http://127.0.0.1:1', 'Iv1.cliente123')).rejects.toMatchObject({ motivo: 'red' })
  })

  it('consulta hasta que se autoriza; respeta «slow_down» subiendo el intervalo', async () => {
    guion = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { error: 'authorization_pending' }, { access_token: 'gho_token_oauth' }]
    const pausas: number[] = []
    const token = await esperarToken(url, 'Iv1.cliente123', { deviceCode: 'dev123', intervalo: 5, expiraEn: 900 }, { esperar: async (ms) => void pausas.push(ms) })
    expect(token).toEqual({ token: 'gho_token_oauth' })
    expect(pausas).toEqual([5000, 5000, 10_000, 10_000])
    expect(cuerpos.at(-1)!.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(cuerpos.at(-1)!.get('device_code')).toBe('dev123')
  })

  it('termina con un mensaje claro si se rechaza, caduca o se cancela', async () => {
    guion = [{ error: 'access_denied' }]
    await expect(esperarToken(url, 'Iv1.cliente123', { deviceCode: 'd', intervalo: 1, expiraEn: 60 }, rapido)).rejects.toMatchObject({ motivo: 'denegado' })
    guion = [{ error: 'expired_token' }]
    await expect(esperarToken(url, 'Iv1.cliente123', { deviceCode: 'd', intervalo: 1, expiraEn: 60 }, rapido)).rejects.toMatchObject({ motivo: 'expirado' })
    // sin respuesta definitiva hasta agotar el tiempo del código
    await expect(esperarToken(url, 'Iv1.cliente123', { deviceCode: 'd', intervalo: 30, expiraEn: 90 }, rapido)).rejects.toMatchObject({ motivo: 'expirado' })
    // cancelación real (sin pausas simuladas): la espera se corta de inmediato
    const parar = new AbortController()
    const espera = esperarToken(url, 'Iv1.cliente123', { deviceCode: 'd', intervalo: 30, expiraEn: 900 }, { señal: parar.signal })
    setTimeout(() => parar.abort(), 20)
    await expect(espera).rejects.toBeInstanceOf(ErrorDispositivo)
    await expect(espera).rejects.toMatchObject({ motivo: 'cancelado' })
  })
})

describe('ServicioGitHub: iniciar sesión con código', () => {
  const cifrador: Cifrador = { disponible: () => true, cifrar: (t) => Buffer.from(t).toString('base64'), descifrar: (c) => Buffer.from(c, 'base64').toString() }
  const nuevo = async (): Promise<{ s: ServicioGitHub; datos: string; token: AlmacenToken }> => {
    const datos = await mkdtemp(join(tmpdir(), 'gh-oauth-'))
    const token = new AlmacenToken(join(datos, 'github.json'), cifrador)
    const s = new ServicioGitHub({ token, api: url, oauth: url, host: 'github.test', dirDatos: datos, carpetaDe: async () => '', agregarProyecto: async () => ({ id: 'x' }), ...rapido })
    return { s, datos, token }
  }

  it('sin Client ID no se puede; configurarlo valida el formato, se guarda y lo muestra el estado', async () => {
    const { s, datos } = await nuevo()
    expect((await s.estado()).oauth).toBe(false)
    await expect(s.dispositivoIniciar()).rejects.toThrow(/Client ID/)
    await expect(s.configurarOauth('corto')).rejects.toThrow(/no es válido/)
    await expect(s.configurarOauth('con espacios y cosas raras!')).rejects.toThrow(/no es válido/)
    expect((await s.configurarOauth('  Iv1.cliente123 ')).oauth).toBe(true)
    expect(JSON.parse(await readFile(join(datos, 'github-oauth.json'), 'utf8'))).toEqual({ clientId: 'Iv1.cliente123' })
    expect((await s.configurarOauth('')).oauth).toBe(false)
  })

  it('el Client ID también puede venir del entorno', async () => {
    const { s } = await nuevo()
    vi.stubEnv('ODESK_GITHUB_CLIENT_ID', 'Iv1.desdeentorno')
    expect((await s.estado()).oauth).toBe(true)
  })

  it('flujo completo: pide el código, espera, guarda el token cifrado y queda conectado', async () => {
    const { s, token } = await nuevo()
    await s.configurarOauth('Iv1.cliente123')
    const c = await s.dispositivoIniciar()
    expect(c).toEqual({ codigoUsuario: 'ABCD-1234', urlVerificacion: 'https://github.com/login/device', expiraEn: 900 })
    expect(c).not.toHaveProperty('deviceCode') // el código interno no llega a la interfaz
    guion = [{ error: 'authorization_pending' }, { access_token: 'gho_token_oauth' }]
    const e = await s.dispositivoEsperar()
    expect(e).toMatchObject({ conectado: true, usuario: { usuario: 'ana', nombre: 'Ana Pérez' }, persistente: true })
    expect(await token.leer()).toMatchObject({ token: 'gho_token_oauth', usuario: 'ana' })
    await expect(s.dispositivoEsperar()).rejects.toThrow(/No hay un inicio de sesión en curso/)
  })

  it('cancelar corta la espera y no guarda nada; un rechazo deja un error legible', async () => {
    const { s, token } = await nuevo()
    await s.configurarOauth('Iv1.cliente123')
    const lento = new ServicioGitHub({ token, api: url, oauth: url, host: 'github.test', dirDatos: (await nuevo()).datos, carpetaDe: async () => '', agregarProyecto: async () => ({ id: 'x' }) })
    await lento.configurarOauth('Iv1.cliente123')
    await lento.dispositivoIniciar()
    const espera = lento.dispositivoEsperar()
    setTimeout(() => lento.dispositivoCancelar(), 20)
    await expect(espera).rejects.toThrow(/cancelado/)
    expect(await token.leer()).toBeUndefined()

    await s.dispositivoIniciar()
    guion = [{ error: 'access_denied' }]
    await expect(s.dispositivoEsperar()).rejects.toThrow(/Cancelaste la autorización/)
    expect(await token.leer()).toBeUndefined()
  })

  it('por la interfaz: las operaciones están disponibles y rechazan nombres desconocidos', async () => {
    const { s } = await nuevo()
    expect(await ejecutarOperacionGitHub(s, 'dispositivoCancelar', {})).toEqual({ ok: true })
    await expect(ejecutarOperacionGitHub(s, 'dispositivoIniciar', {})).rejects.toThrow(/Client ID/)
    await expect(ejecutarOperacionGitHub(s, 'inventada', {})).rejects.toThrow(/desconocida/)
  })
})
