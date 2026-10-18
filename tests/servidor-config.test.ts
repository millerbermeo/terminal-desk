import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { servidorSeguro, URL_SERVIDOR_PRODUCCION } from '@shared/sesion'
import { ClienteServidor, ErrorServidor, ErrorSesion } from '../src/main/servidor/cliente'
import { avisoDeGit, vincularProyectoLocal } from '../src/main/servidor/vinculo'

const cifradorFalso = { disponible: () => false, cifrar: (t: string) => t, descifrar: (t: string) => t }
const carpeta = (): Promise<string> => mkdtemp(join(tmpdir(), 'cfg-'))
const ID = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'

let api: Server
let url: string
const cerradas: string[] = []
beforeAll(async () => {
  delete process.env.ODESK_API_URL
  api = createServer((req, res) => {
    const json = (c: number, o: unknown): void => void res.writeHead(c, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (req.url === '/auth/login') {
      let cuerpo = ''
      req.on('data', (d) => (cuerpo += d))
      req.on('end', () => {
        if (cuerpo.includes('sin-activar')) return json(403, { statusCode: 403, message: 'Activa tu cuenta', codigo: 'VERIFICACION_PENDIENTE' })
        json(200, { token: 'jwt', usuario: { id: 'u', email: 'a@b.c' } })
      })
      return
    }
    if (req.url === '/auth/logout') {
      cerradas.push(req.headers.authorization ?? '')
      return void res.writeHead(204).end()
    }
    if (req.url === '/projects') return json(401, { message: 'Unauthorized' }) // el servidor rechaza el token
    json(404, {})
  })
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((ok) => api.close(() => ok())))

describe('dirección del servidor', () => {
  it('https siempre vale; http solo hacia esta máquina', () => {
    expect(servidorSeguro('https://api.midominio.com')).toBe(true)
    expect(servidorSeguro('http://localhost:3000')).toBe(true)
    expect(servidorSeguro('http://127.0.0.1:3000')).toBe(true)
    expect(servidorSeguro('http://api.midominio.com')).toBe(false)
    expect(servidorSeguro('ftp://x')).toBe(false)
    expect(servidorSeguro('no es url')).toBe(false)
  })

  it('se lee de servidor.json, se puede cambiar, se valida y al cambiar cierra la sesión', async () => {
    const dir = await carpeta()
    const archivoUrl = join(dir, 'servidor.json')
    await writeFile(archivoUrl, JSON.stringify({ url: `${url}/` }))
    const c = new ClienteServidor()
    c.configurar(join(dir, 'sesion.json'), cifradorFalso, archivoUrl)
    expect(c.url).toBe(url) // sin barra final
    await c.iniciar('a@b.c', 'x')
    expect((await c.estado()).activa).toBe(true)

    await expect(c.fijarUrl('esto no es una url')).rejects.toThrow(ErrorServidor)
    await expect(c.fijarUrl('ftp://servidor')).rejects.toThrow(/http/)
    expect((await c.estado()).activa).toBe(true) // un intento inválido no toca nada

    const mismo = await c.fijarUrl(url)
    expect(mismo.activa).toBe(true) // misma dirección: la sesión sigue
    const otro = await c.fijarUrl('https://api.midominio.com/')
    expect(otro).toMatchObject({ activa: false, servidor: 'https://api.midominio.com' })
    expect(JSON.parse(await readFile(archivoUrl, 'utf8'))).toEqual({ url: 'https://api.midominio.com' })

    const reabierto = new ClienteServidor()
    reabierto.configurar(join(dir, 'sesion.json'), cifradorFalso, archivoUrl)
    expect(reabierto.url).toBe('https://api.midominio.com') // persiste entre arranques
  })

  it('la dirección por defecto de la app instalada: sin nada guardado vale, y servidor.json o ODESK_API_URL mandan sobre ella', async () => {
    const dir = await carpeta()
    const archivoUrl = join(dir, 'servidor.json')
    const sola = new ClienteServidor()
    sola.usarPorDefecto(URL_SERVIDOR_PRODUCCION)
    sola.configurar(join(dir, 's.json'), cifradorFalso, archivoUrl) // no hay servidor.json
    expect(sola.url).toBe('https://odesk.millerrivera.com')
    expect(servidorSeguro(sola.url)).toBe(true) // https: la app acepta mandar la sesión

    await writeFile(archivoUrl, JSON.stringify({ url: 'https://elegido-por-el-usuario.com' }))
    const guardado = new ClienteServidor()
    guardado.usarPorDefecto(URL_SERVIDOR_PRODUCCION)
    guardado.configurar(join(dir, 's.json'), cifradorFalso, archivoUrl)
    expect(guardado.url).toBe('https://elegido-por-el-usuario.com')

    process.env.ODESK_API_URL = 'http://localhost:4000'
    try {
      const entorno = new ClienteServidor()
      entorno.usarPorDefecto(URL_SERVIDOR_PRODUCCION)
      expect(entorno.url).toBe('http://localhost:4000')
    } finally {
      delete process.env.ODESK_API_URL
    }
  })

  it('la variable ODESK_API_URL manda sobre el archivo', async () => {
    const dir = await carpeta()
    await writeFile(join(dir, 'servidor.json'), JSON.stringify({ url: 'https://del-archivo.com' }))
    process.env.ODESK_API_URL = 'https://del-entorno.com'
    try {
      const c = new ClienteServidor()
      c.configurar(join(dir, 's.json'), cifradorFalso, join(dir, 'servidor.json'))
      expect(c.url).toBe('https://del-entorno.com')
    } finally {
      delete process.env.ODESK_API_URL
    }
  })
})

describe('sesión que vence', () => {
  it('un 401 con sesión cierra la sesión, avisa a la interfaz y lanza ErrorSesion', async () => {
    const dir = await carpeta()
    const c = new ClienteServidor(url)
    c.configurar(join(dir, 'sesion.json'), cifradorFalso)
    let avisos = 0
    c.alPerderSesion = () => void avisos++
    await c.iniciar('a@b.c', 'x')
    await expect(c.get('/projects')).rejects.toBeInstanceOf(ErrorSesion)
    expect(avisos).toBe(1)
    expect((await c.estado()).activa).toBe(false)
    await expect(c.get('/projects')).rejects.toBeInstanceOf(ErrorSesion) // sin sesión ni siquiera sale la petición
    expect(avisos).toBe(1)
  })
})

describe('aviso de subir .odesk a git', () => {
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore' })

  it('no avisa fuera de un repositorio; avisa si falta versionar el archivo y deja de avisar al commitearlo', async () => {
    const plano = await carpeta()
    await vincularProyectoLocal(plano, ID)
    expect(await avisoDeGit(plano)).toBeUndefined()

    const repo = await carpeta()
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.email', 't@example.com')
    git(repo, 'config', 'user.name', 'T')
    await vincularProyectoLocal(repo, ID)
    expect(await avisoDeGit(repo)).toMatch(/Falta subir \.odesk\/project\.json a git/)
    git(repo, 'add', '.odesk/project.json')
    git(repo, 'commit', '-q', '-m', 'enlace')
    expect(await avisoDeGit(repo)).toBeUndefined()
  })

  it('si el archivo está en .gitignore lo dice con más fuerza', async () => {
    const repo = await carpeta()
    git(repo, 'init', '-q')
    await writeFile(join(repo, '.gitignore'), '.odesk/\n')
    await vincularProyectoLocal(repo, ID)
    expect(await avisoDeGit(repo)).toMatch(/\.gitignore/)
  })
})

describe('sesión en el servidor', () => {
  it('cerrar sesión la revoca en el servidor (no solo olvida el token aquí)', async () => {
    const c = new ClienteServidor(url)
    c.configurar(join(await carpeta(), 'sesion.json'), cifradorFalso)
    await c.iniciar('a@b.c', 'x')
    cerradas.length = 0
    expect((await c.cerrar()).activa).toBe(false)
    expect(cerradas).toEqual(['Bearer jwt'])
  })

  it('una cuenta sin activar llega con su código para que la interfaz pida el del correo', async () => {
    const c = new ClienteServidor(url)
    const err = await c.iniciar('a@b.c', 'sin-activar').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ErrorServidor)
    expect((err as ErrorServidor).codigo).toBe('VERIFICACION_PENDIENTE')
  })

  it('nunca manda credenciales por http a otra máquina (salvo ODESK_PERMITIR_HTTP=1)', async () => {
    const c = new ClienteServidor('http://api.ejemplo.invalid')
    await expect(c.iniciar('a@b.c', 'x')).rejects.toThrow(/no usa https/)
    process.env.ODESK_PERMITIR_HTTP = '1'
    try {
      await expect(c.iniciar('a@b.c', 'x')).rejects.toThrow(/No se pudo conectar/) // ahora sí lo intenta
    } finally {
      delete process.env.ODESK_PERMITIR_HTTP
    }
  })
})
