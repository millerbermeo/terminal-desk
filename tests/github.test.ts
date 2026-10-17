import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HERRAMIENTAS_GIT } from '@shared/git-herramientas'
import { HERRAMIENTAS_GITHUB } from '@shared/github-herramientas'
import { HERRAMIENTAS_ODESK } from '@shared/herramientas-odesk'
import { analizarRemoto, analizarRepoEscrito, esArchivoSensible, nombreRepoValido, urlHttps, urlSsh } from '@shared/github'
import { explicarErrorGitHub, resumirCI, aPr, aIssue } from '../src/main/github/cliente'
import { asegurarAskpass } from '../src/main/github/askpass'
import { ServicioGitHub } from '../src/main/github/servicio'
import { AlmacenToken, type Cifrador } from '../src/main/github/token'
import { ejecutarOperacionGitHub } from '../src/main/github/operaciones'
import { esDestructiva } from '../src/main/core/guardrails/destructivo'
import { crearEjecutorOdesk } from '../src/main/core/herramientas-odesk'
import { Repositorio } from '../src/main/core/git/repositorio'
import { permisosCli } from '../src/main/core/suscripcion'
import { AlmacenJson } from '../src/main/core/memory/almacen'
import { ServicioTareas, type Documento } from '../src/main/core/tareas/servicio'

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const carpeta = (p = 'gh-'): Promise<string> => mkdtemp(join(tmpdir(), p))
const escribir = async (dir: string, archivo: string, texto: string): Promise<void> => {
  await mkdir(join(dir, archivo, '..'), { recursive: true })
  await writeFile(join(dir, archivo), texto)
}

beforeAll(async () => {
  const casa = await carpeta('gh-casa-')
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  for (const v of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[v]
})

describe('lógica pura de GitHub', () => {
  it('analiza los remotos: https, ssh, forma corta con alias y rutas locales', () => {
    const ok = (u: string): string => JSON.stringify(analizarRemoto(u))
    expect(analizarRemoto('https://github.com/ana/tienda.git')).toEqual({ host: 'github.com', propietario: 'ana', repo: 'tienda' })
    expect(analizarRemoto('https://usuario:tok@github.com/ana/tienda')).toMatchObject({ propietario: 'ana', repo: 'tienda' })
    expect(analizarRemoto('https://***@github.com/ana/tienda.git/')).toMatchObject({ repo: 'tienda' })
    expect(analizarRemoto('git@github.com:ana/mi.repo.git')).toEqual({ host: 'github.com', propietario: 'ana', repo: 'mi.repo' })
    expect(analizarRemoto('git@github-miller:millerbermeo/terminal-desk.git')).toEqual({ host: 'github-miller', propietario: 'millerbermeo', repo: 'terminal-desk' })
    expect(analizarRemoto('ssh://git@git.empresa.com:2222/equipo/api.git')).toEqual({ host: 'git.empresa.com', propietario: 'equipo', repo: 'api' })
    for (const local of ['/tmp/repo.git', 'file:///tmp/repo.git', 'C:/proyectos/repo', '../repo', 'repo.git']) expect(ok(local), local).toBe(undefined)
    expect(analizarRepoEscrito('ana/tienda')).toEqual({ host: 'github.com', propietario: 'ana', repo: 'tienda' })
    expect(analizarRepoEscrito('ana/tienda.git')).toMatchObject({ repo: 'tienda' })
    expect(analizarRepoEscrito('https://github.com/ana/tienda')).toMatchObject({ propietario: 'ana' })
    expect(analizarRepoEscrito('solo-un-nombre')).toBeUndefined()
    expect(urlHttps({ propietario: 'a', repo: 'b' })).toBe('https://github.com/a/b.git')
    expect(urlSsh({ propietario: 'a', repo: 'b' })).toBe('git@github.com:a/b.git')
  })

  it('nombres de repositorio y archivos sensibles', () => {
    expect(nombreRepoValido('Mi Tienda Ñandú')).toBe('Mi-Tienda-Nandu')
    expect(nombreRepoValido('  ..  ')).toBe('proyecto')
    expect(nombreRepoValido('a'.repeat(200))).toHaveLength(100)
    for (const s of ['.env', '.env.local', 'config/.env.production', 'clave.pem', 'a/id_rsa', 'server.key', '.npmrc', 'credentials.json', 'x.p12']) expect(esArchivoSensible(s), s).toBe(true)
    for (const n of ['.env.example', '.env.sample', 'id_rsa.pub', 'README.md', 'src/env.ts', 'clave-publica.txt', 'package.json']) expect(esArchivoSensible(n), n).toBe(false)
  })

  it('traduce los errores de la API y resume el CI', () => {
    const cab = (h: Record<string, string>) => ({ get: (n: string): string | null => h[n.toLowerCase()] ?? null })
    expect(explicarErrorGitHub(401, { message: 'Bad credentials' }, cab({}))).toMatch(/token.*no es válido/)
    expect(explicarErrorGitHub(404, { message: 'Not Found' }, cab({}))).toMatch(/permiso «repo»/)
    expect(explicarErrorGitHub(403, {}, cab({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' }))).toMatch(/limitó/)
    expect(explicarErrorGitHub(403, { message: 'Resource not accessible' }, cab({ 'x-accepted-oauth-scopes': 'repo' }))).toMatch(/necesita: repo/)
    expect(explicarErrorGitHub(422, { message: 'Validation Failed', errors: [{ message: 'name already exists on this account' }] }, cab({}))).toMatch(/Ya existe/)
    expect(explicarErrorGitHub(422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for ana:feat.' }] }, cab({}))).toMatch(/pull request abierto/)
    expect(explicarErrorGitHub(500, { message: 'boom' }, cab({}))).toMatch(/respondió 500: boom/)
    expect(resumirCI({ check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'skipped' }] }, { statuses: [] }).estado).toBe('exito')
    expect(resumirCI({ check_runs: [{ name: 'a', status: 'completed', conclusion: 'success' }, { name: 'b', status: 'in_progress' }] }, {}).estado).toBe('pendiente')
    expect(resumirCI({ check_runs: [{ name: 'a', status: 'completed', conclusion: 'success' }] }, { statuses: [{ context: 'ci/x', state: 'failure', target_url: 'http://x' }] })).toMatchObject({ estado: 'fallo', checks: [expect.anything(), { nombre: 'ci/x', estado: 'fallo', url: 'http://x' }] })
    expect(resumirCI({ check_runs: [] }, { statuses: [] })).toEqual({ estado: 'ninguno', checks: [] })
    expect(aPr({ number: 3, title: 'T', state: 'closed', merged_at: '2026-01-01', head: { ref: 'f' }, base: { ref: 'main' }, user: { login: 'a' }, draft: false })).toMatchObject({ estado: 'fusionada', rama: 'f', base: 'main', autor: 'a' })
    expect(aIssue({ number: 1, title: 'x', state: 'open', labels: [{ name: 'bug' }, 'ui'], comments: 2, user: { login: 'b' } })).toMatchObject({ etiquetas: ['bug', 'ui'], comentarios: 2 })
  })
})

describe('almacén del token', () => {
  const falso = (disponible: boolean): Cifrador => ({ disponible: () => disponible, cifrar: (t) => Buffer.from([...t].reverse().join('')).toString('base64'), descifrar: (c) => [...Buffer.from(c, 'base64').toString()].reverse().join('') })

  it('con cifrado: se guarda cifrado en un archivo 0600 y se recupera; nunca en claro', async () => {
    const dir = await carpeta()
    const archivo = join(dir, 'github.json')
    const a = new AlmacenToken(archivo, falso(true))
    expect(await a.leer()).toBeUndefined()
    expect(await a.guardar('ghp_secretisimo', 'ana')).toBe(true)
    expect(readFileSync(archivo, 'utf8')).not.toContain('ghp_secretisimo')
    expect(statSync(archivo).mode & 0o777).toBe(0o600)
    expect(await new AlmacenToken(archivo, falso(true)).leer()).toEqual({ token: 'ghp_secretisimo', usuario: 'ana', persistente: true })
    await a.borrar()
    expect(existsSync(archivo)).toBe(false)
    expect(await a.leer()).toBeUndefined()
  })

  it('sin cifrado seguro: el token solo vive en memoria y no se escribe nunca', async () => {
    const dir = await carpeta()
    const archivo = join(dir, 'github.json')
    const a = new AlmacenToken(archivo, falso(false))
    expect(await a.guardar('ghp_x', 'ana')).toBe(false)
    expect(existsSync(archivo)).toBe(false)
    expect(await a.leer()).toEqual({ token: 'ghp_x', usuario: 'ana', persistente: false })
    expect(await new AlmacenToken(archivo, falso(false)).leer()).toBeUndefined() // «reiniciar» la app
  })

  it('un archivo ilegible o cifrado con otra clave equivale a no tener token', async () => {
    const dir = await carpeta()
    const archivo = join(dir, 'github.json')
    await writeFile(archivo, '{no es json')
    expect(await new AlmacenToken(archivo, falso(true)).leer()).toBeUndefined()
    const roto: Cifrador = { disponible: () => true, cifrar: () => 'x', descifrar: () => { throw new Error('clave distinta') } }
    await new AlmacenToken(archivo, roto).guardar('t')
    expect(await new AlmacenToken(archivo, roto).leer()).toBeUndefined()
  })
})

// ------------------------------------------------------------------ servidor GitHub simulado

interface Peticion { metodo: string; ruta: string; consulta: URLSearchParams; auth?: string; cuerpo: unknown }
let gh: Server
let api = ''
let peticiones: Peticion[] = []
const respuestas = { remotoCreado: '' }

const json = (res: ServerResponse, estado: number, cuerpo: unknown): void => {
  res.statusCode = estado
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(cuerpo))
}
const repoJson = (propietario: string, nombre: string, urlClone = `https://github.test/${propietario}/${nombre}.git`): Record<string, unknown> => ({
  id: 7, name: nombre, full_name: `${propietario}/${nombre}`, description: 'Una tienda', private: true, html_url: `https://github.test/${propietario}/${nombre}`, clone_url: urlClone, ssh_url: `git@github.test:${propietario}/${nombre}.git`, default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z'
})

beforeAll(async () => {
  gh = createServer((req: IncomingMessage, res: ServerResponse) => {
    let texto = ''
    req.on('data', (d) => (texto += d))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      const cuerpo = texto ? JSON.parse(texto) : undefined
      peticiones.push({ metodo: req.method ?? '', ruta: url.pathname, consulta: url.searchParams, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}), cuerpo })
      if (req.headers.authorization !== 'Bearer tok-ok') return json(res, 401, { message: 'Bad credentials' })
      const r = url.pathname
      if (r === '/user') return json(res, 200, { login: 'ana', name: 'Ana Pérez' })
      if (r === '/user/repos' && req.method === 'GET') return json(res, 200, [repoJson('ana', 'tienda'), repoJson('ana', 'blog'), repoJson('equipo', 'api')])
      if (r === '/user/repos' && req.method === 'POST') {
        if ((cuerpo as { name: string }).name === 'existente') return json(res, 422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] })
        return json(res, 201, repoJson('ana', (cuerpo as { name: string }).name, respuestas.remotoCreado))
      }
      if (r === '/repos/ana/tienda' && req.method === 'GET') return json(res, 200, repoJson('ana', 'tienda'))
      if (r === '/repos/ana/secreto') return json(res, 404, { message: 'Not Found' })
      if (r === '/repos/ana/tienda/pulls' && req.method === 'GET') {
        if (url.searchParams.get('head') === 'ana:feat/login') return json(res, 200, [{ number: 5, title: 'Login', state: 'open', draft: false, user: { login: 'ana' }, head: { ref: 'feat/login' }, base: { ref: 'main' }, html_url: 'https://github.test/ana/tienda/pull/5', updated_at: '2026-01-02T00:00:00Z' }])
        if (url.searchParams.get('head')) return json(res, 200, [])
        return json(res, 200, [{ number: 5, title: 'Login', state: 'open', draft: true, user: { login: 'ana' }, head: { ref: 'feat/login' }, base: { ref: 'main' }, html_url: 'u', updated_at: 'x', body: 'cuerpo largo' }, { number: 4, title: 'Viejo', state: 'closed', merged_at: 'x', user: { login: 'beto' }, head: { ref: 'a' }, base: { ref: 'main' }, html_url: 'u', updated_at: 'x' }])
      }
      if (r === '/repos/ana/tienda/pulls' && req.method === 'POST') {
        if ((cuerpo as { title: string }).title === 'duplicada') return json(res, 422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for ana:feat.' }] })
        const c = cuerpo as { title: string; head: string; base: string; draft: boolean }
        return json(res, 201, { number: 9, title: c.title, state: 'open', draft: c.draft, user: { login: 'ana' }, head: { ref: c.head }, base: { ref: c.base }, html_url: 'https://github.test/ana/tienda/pull/9', updated_at: 'x' })
      }
      if (r === '/repos/ana/tienda/pulls/9/merge') return json(res, 200, { merged: true, message: 'Pull Request successfully merged' })
      if (r === '/repos/ana/tienda/issues' && req.method === 'GET') return json(res, 200, [{ number: 1, title: 'Bug', state: 'open', user: { login: 'a' }, labels: [{ name: 'bug' }], html_url: 'u', updated_at: 'x', comments: 0 }, { number: 5, title: 'Login', state: 'open', pull_request: {}, user: { login: 'ana' }, labels: [], html_url: 'u', updated_at: 'x', comments: 0 }])
      if (r === '/repos/ana/tienda/issues' && req.method === 'POST') return json(res, 201, { number: 11, title: (cuerpo as { title: string }).title, state: 'open', user: { login: 'ana' }, labels: ((cuerpo as { labels?: string[] }).labels ?? []).map((name) => ({ name })), html_url: 'https://github.test/ana/tienda/issues/11', updated_at: 'x', comments: 0 })
      if (r === '/repos/ana/tienda/issues/11/comments') return json(res, 201, { html_url: 'https://github.test/ana/tienda/issues/11#c1' })
      const ref = /^\/repos\/ana\/tienda\/commits\/(.+)\/(check-runs|status)$/.exec(r)
      if (ref) {
        if (decodeURIComponent(ref[1]!) === 'sin-subir') return json(res, 422, { message: 'No commit found for SHA: sin-subir' })
        return json(res, 200, ref[2] === 'status' ? { state: 'pending', statuses: [] } : { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', html_url: 'https://ci/1' }, { name: 'test', status: 'completed', conclusion: 'failure', html_url: 'https://ci/2' }] })
      }
      json(res, 404, { message: 'Not Found' })
    })
  })
  await new Promise<void>((ok) => gh.listen(0, '127.0.0.1', ok))
  api = `http://127.0.0.1:${(gh.address() as AddressInfo).port}`
})
afterAll(async () => {
  gh.closeAllConnections()
  await new Promise((ok) => gh.close(ok))
})
beforeEach(() => {
  peticiones = []
})

const cifrador: Cifrador = { disponible: () => true, cifrar: (t) => Buffer.from(t).toString('base64'), descifrar: (c) => Buffer.from(c, 'base64').toString() }

interface Entorno {
  s: ServicioGitHub
  datos: string
  proyectos: Map<string, string>
  registrados: { ruta: string; nombre: string; grupoId?: string }[]
  token: AlmacenToken
}
async function nuevoEntorno(resolverHost?: (h: string) => Promise<string>): Promise<Entorno> {
  const datos = await carpeta('gh-datos-')
  const proyectos = new Map<string, string>()
  const registrados: Entorno['registrados'] = []
  const token = new AlmacenToken(join(datos, 'github.json'), cifrador)
  const s = new ServicioGitHub({
    token,
    api,
    host: 'github.test',
    dirDatos: datos,
    carpetaDe: async (id) => {
      const r = proyectos.get(id)
      if (!r) throw new Error('El proyecto ya no existe.')
      return r
    },
    agregarProyecto: async (ruta, nombre, grupoId) => {
      registrados.push({ ruta, nombre, ...(grupoId ? { grupoId } : {}) })
      const id = `p${proyectos.size + 1}`
      proyectos.set(id, ruta)
      return { id }
    },
    ...(resolverHost ? { resolverHost } : {})
  })
  return { s, datos, proyectos, registrados, token }
}

/** Repositorio con identidad, un commit y, si se pide, `origin` apuntando a un remoto «bare» local. */
async function repoCon(origen?: string): Promise<{ dir: string; bare?: string }> {
  const dir = await carpeta('gh-repo-')
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.name', 'Ana')
  sh(dir, 'config', 'user.email', 'ana@example.com')
  await escribir(dir, 'a.txt', 'uno\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'Primero')
  if (origen) sh(dir, 'remote', 'add', 'origin', origen)
  return { dir }
}
const bareVacio = async (): Promise<string> => {
  const b = await carpeta('gh-bare-')
  sh(b, 'init', '--bare', '-q', '-b', 'main')
  return b
}

describe('ServicioGitHub: cuenta y repositorio del proyecto', () => {
  it('conectar valida el token, guarda cifrado y desconectar lo borra', async () => {
    const { s, datos } = await nuevoEntorno()
    expect(await s.estado()).toMatchObject({ conectado: false, host: 'github.test' })
    await expect(s.conectar('malo')).rejects.toThrow(/no es válido/)
    await expect(s.conectar('tiene espacios')).rejects.toThrow(/sin espacios/)
    const e = await s.conectar('tok-ok')
    expect(e).toMatchObject({ conectado: true, persistente: true, usuario: { usuario: 'ana', nombre: 'Ana Pérez' } })
    expect(readFileSync(join(datos, 'github.json'), 'utf8')).not.toContain('tok-ok')
    expect((await s.estado()).usuario?.usuario).toBe('ana')
    expect(peticiones.every((p) => p.auth === 'Bearer tok-ok' || p.auth === 'Bearer malo' || p.auth === 'Bearer tiene espacios')).toBe(true)
    expect(await s.desconectar()).toMatchObject({ conectado: false })
    await expect(s.repos()).rejects.toThrow(/Conecta tu cuenta/)
  })

  it('detecta el remoto de GitHub (también con alias SSH) y lee el repositorio', async () => {
    const e = await nuevoEntorno(async (h) => (h === 'github-miller' ? 'github.test' : h))
    await e.s.conectar('tok-ok')
    const a = await repoCon('https://github.test/ana/tienda.git')
    e.proyectos.set('p-https', a.dir)
    expect(await e.s.estado('p-https')).toMatchObject({ remoto: { nombre: 'origin', propietario: 'ana', repo: 'tienda', esGitHub: true }, repo: { completo: 'ana/tienda', privado: true, ramaPorDefecto: 'main' } })

    const alias = await repoCon('git@github-miller:ana/tienda.git')
    e.proyectos.set('p-alias', alias.dir)
    expect((await e.s.estado('p-alias')).remoto).toMatchObject({ host: 'github.test', esGitHub: true })

    // El alias de ~/.ssh/config de GitHub por el puerto 443 resuelve a ssh.<servidor>: sigue siendo GitHub.
    const puerto443 = await nuevoEntorno(async () => 'ssh.github.test')
    await puerto443.s.conectar('tok-ok')
    const p443 = await repoCon('git@github-miller:ana/tienda.git')
    puerto443.proyectos.set('p443', p443.dir)
    expect((await puerto443.s.estado('p443')).remoto).toMatchObject({ host: 'github.test', esGitHub: true })

    const otro = await repoCon('git@gitlab.com:ana/tienda.git')
    e.proyectos.set('p-otro', otro.dir)
    const eo = await e.s.estado('p-otro')
    expect(eo.remoto).toMatchObject({ esGitHub: false })
    expect(eo.repo).toBeUndefined()

    const sin = await repoCon()
    e.proyectos.set('p-sin', sin.dir)
    expect((await e.s.estado('p-sin')).remoto).toBeUndefined()

    const privado = await repoCon('https://github.test/ana/secreto.git')
    e.proyectos.set('p-priv', privado.dir)
    expect((await e.s.estado('p-priv')).errorRepo).toMatch(/permiso «repo»/)
  })

  it('lista los repositorios de la cuenta, con filtro', async () => {
    const { s } = await nuevoEntorno()
    await s.conectar('tok-ok')
    expect((await s.repos()).map((r) => r.completo)).toEqual(['ana/tienda', 'ana/blog', 'equipo/api'])
    expect((await s.repos('API')).map((r) => r.completo)).toEqual(['equipo/api'])
    expect((await s.repos())[0]).toMatchObject({ urlHttps: 'https://github.test/ana/tienda.git', urlSsh: 'git@github.test:ana/tienda.git' })
  })
})

describe('credenciales para git (GIT_ASKPASS)', () => {
  it('solo da el token a https del servidor de GitHub; a ningún otro remoto', async () => {
    const e = await nuevoEntorno()
    expect(await e.s.credencialesPara('https://github.test/ana/tienda.git')).toBeUndefined() // sin token
    await e.s.conectar('tok-ok')
    const env = await e.s.credencialesPara('https://github.test/ana/tienda.git')
    expect(env).toMatchObject({ ODESK_GITHUB_TOKEN: 'tok-ok' })
    expect(existsSync(env!.GIT_ASKPASS!)).toBe(true)
    expect((await e.s.credencialesPara('https://ana@github.test/ana/tienda.git'))?.ODESK_GITHUB_TOKEN).toBe('tok-ok')
    for (const url of ['git@github.test:ana/tienda.git', 'ssh://git@github.test/a/b.git', 'https://gitlab.com/a/b.git', 'https://github.test.evil.com/a/b.git', 'http://github.test/a/b.git', '/tmp/bare.git']) expect(await e.s.credencialesPara(url), url).toBeUndefined()
  })

  it('el script responde usuario y token según lo que pregunta git, y el token no está en el archivo', async () => {
    const dir = await carpeta()
    const ruta = await asegurarAskpass(dir)
    if (process.platform !== 'win32') {
      expect(statSync(ruta).mode & 0o777).toBe(0o700)
      const pregunta = (p: string): string => execFileSync(ruta, [p], { encoding: 'utf8', env: { ...process.env, ODESK_GITHUB_TOKEN: 'ghp_abc' } }).trim()
      expect(pregunta("Username for 'https://github.com': ")).toBe('x-access-token')
      expect(pregunta("Password for 'https://x-access-token@github.com': ")).toBe('ghp_abc')
    }
    expect(readFileSync(ruta, 'utf8')).not.toContain('ghp_')
    expect(await asegurarAskpass(dir)).toBe(ruta) // idempotente
  })

  it('Repositorio pasa las credenciales a git en las operaciones de red', async () => {
    const bare = await bareVacio()
    const { dir } = await repoCon(bare)
    const traza = join(await carpeta(), 'traza.log')
    const proveedor = vi.fn(async (url: string) => (url === bare ? { GIT_TRACE: traza } : undefined))
    const r = new Repositorio(dir, proveedor)
    await r.enviar()
    expect(proveedor).toHaveBeenCalledWith(bare)
    expect(existsSync(traza)).toBe(true) // la variable llegó al proceso de git
    expect(readFileSync(traza, 'utf8')).toContain('push')
    proveedor.mockClear()
    await r.obtener()
    expect(proveedor).toHaveBeenCalledWith(bare)
  })
})

describe('ServicioGitHub: clonar y publicar', () => {
  it('clona un repositorio, lo registra como proyecto y no pisa carpetas con contenido', async () => {
    const e = await nuevoEntorno()
    const origen = await repoCon()
    const bare = await bareVacio()
    sh(origen.dir, 'push', '-q', bare, 'main')
    const padre = await carpeta('gh-padre-')
    const r = await e.s.clonar({ repo: bare, carpetaPadre: padre, grupoId: 'g1' })
    expect(await readdir(padre)).toEqual([expect.stringMatching(/^gh-bare-/)]) // la carpeta toma el nombre del repositorio
    expect(r.ruta).toBe(join(padre, (await readdir(padre))[0]!))
    expect(existsSync(join(r.ruta, 'a.txt'))).toBe(true)
    expect(e.registrados).toEqual([{ ruta: r.ruta, nombre: expect.any(String), grupoId: 'g1' }])
    expect(e.proyectos.get(r.proyectoId)).toBe(r.ruta)
    await expect(e.s.clonar({ repo: bare, carpetaPadre: padre })).rejects.toThrow(/no está vacía/)
    await expect(e.s.clonar({ repo: 'no es un repo', carpetaPadre: padre })).rejects.toThrow(/propietario\/repo/)
    await expect(e.s.clonar({ repo: bare, carpetaPadre: 'relativa' })).rejects.toThrow(/ruta completa/)
    await expect(e.s.clonar({ repo: bare, carpetaPadre: join(padre, 'no-existe') })).rejects.toThrow(/no existe/)
    await expect(e.s.clonar({ repo: '--upload-pack=x', carpetaPadre: padre })).rejects.toThrow()
  })

  it('crea el repositorio en GitHub, lo enlaza como origin y envía el código', async () => {
    const e = await nuevoEntorno()
    await e.s.conectar('tok-ok')
    const bare = await bareVacio()
    respuestas.remotoCreado = bare
    const { dir } = await repoCon()
    e.proyectos.set('p1', dir)
    const estado = await e.s.crearRepo({ proyectoId: 'p1', nombre: 'Mi Tienda Nueva', descripcion: 'Demo', privado: true })
    const post = peticiones.find((p) => p.metodo === 'POST' && p.ruta === '/user/repos')!
    expect(post.cuerpo).toMatchObject({ name: 'Mi-Tienda-Nueva', description: 'Demo', private: true, auto_init: false })
    expect(sh(dir, 'remote', 'get-url', 'origin')).toBe(bare)
    expect(sh(bare, 'branch', '--list', 'main')).toContain('main') // se envió la rama
    expect(estado.conectado).toBe(true)
    expect(sh(dir, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/main')
  })

  it('en una organización usa su ruta, y valida antes de crear nada en GitHub', async () => {
    const e = await nuevoEntorno()
    await e.s.conectar('tok-ok')
    const sinCommits = await carpeta()
    sh(sinCommits, 'init', '-q')
    e.proyectos.set('vacio', sinCommits)
    await expect(e.s.crearRepo({ proyectoId: 'vacio', nombre: 'x' })).rejects.toThrow(/primero un commit/)
    const noGit = await carpeta()
    e.proyectos.set('nogit', noGit)
    await expect(e.s.crearRepo({ proyectoId: 'nogit', nombre: 'x' })).rejects.toThrow(/no usa git/)
    const conOrigin = await repoCon('https://github.test/ana/tienda.git')
    e.proyectos.set('conorigin', conOrigin.dir)
    peticiones = []
    await expect(e.s.crearRepo({ proyectoId: 'conorigin', nombre: 'x' })).rejects.toThrow(/ya tiene un remoto/)
    await expect(e.s.crearRepo({ proyectoId: 'conorigin', nombre: 'x', organizacion: 'mala org!' })).rejects.toThrow()
    expect(peticiones.filter((p) => p.metodo === 'POST')).toEqual([]) // nada se creó en GitHub
    const normal = await repoCon()
    e.proyectos.set('normal', normal.dir)
    await expect(e.s.crearRepo({ proyectoId: 'normal', nombre: 'existente' })).rejects.toThrow(/Ya existe/)
    expect(() => sh(normal.dir, 'remote', 'get-url', 'origin')).toThrow() // y tampoco quedó un remoto a medias
  })
})

describe('ServicioGitHub: pull requests, incidencias y CI', () => {
  let e: Entorno
  let dir: string
  let bare: string
  beforeEach(async () => {
    e = await nuevoEntorno()
    await e.s.conectar('tok-ok')
    bare = await bareVacio()
    const r = await repoCon(bare)
    dir = r.dir
    sh(dir, 'remote', 'set-url', 'origin', bare)
    sh(dir, 'push', '-q', '-u', 'origin', 'main')
    // El remoto es local, pero GitHub lo ve como ana/tienda: se enlaza por la URL que lee `remotos()`.
    e.proyectos.set('p1', dir)
    vi.spyOn(Repositorio.prototype, 'remotos').mockResolvedValue([{ nombre: 'origin', url: 'https://github.test/ana/tienda.git' }])
  })
  afterAll(() => vi.restoreAllMocks())

  it('lista los pull requests y cuenta cuál es de la rama actual con su CI', async () => {
    const lista = await e.s.prs('p1')
    expect(lista).toMatchObject([{ numero: 5, estado: 'abierta', borrador: true, rama: 'feat/login', autor: 'ana' }, { numero: 4, estado: 'fusionada' }])
    expect(peticiones.find((p) => p.ruta.endsWith('/pulls'))!.consulta.get('state')).toBe('open')
    expect(await e.s.prActual('p1')).toEqual({ pr: null })
    sh(dir, 'switch', '-q', '-c', 'feat/login')
    const actual = await e.s.prActual('p1')
    expect(actual.pr).toMatchObject({ numero: 5, titulo: 'Login' })
    expect(actual.ci).toMatchObject({ estado: 'fallo', checks: [{ nombre: 'build', estado: 'exito' }, { nombre: 'test', estado: 'fallo' }] })
  })

  it('crea el pull request enviando antes la rama, y explica los rechazos', async () => {
    await expect(e.s.crearPr({ proyectoId: 'p1', titulo: 'Algo' })).rejects.toThrow(/rama de destino/)
    sh(dir, 'switch', '-q', '-c', 'feat/nueva')
    await escribir(dir, 'b.txt', 'b\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'Nuevo')
    const pr = await e.s.crearPr({ proyectoId: 'p1', titulo: 'Añade b', cuerpo: 'Detalle', borrador: true })
    expect(pr).toMatchObject({ numero: 9, rama: 'feat/nueva', base: 'main', borrador: true })
    const post = peticiones.find((p) => p.metodo === 'POST' && p.ruta.endsWith('/pulls'))!
    expect(post.cuerpo).toEqual({ title: 'Añade b', head: 'feat/nueva', base: 'main', body: 'Detalle', draft: true })
    expect(sh(bare, 'branch', '--list', 'feat/nueva')).toContain('feat/nueva') // se envió antes de abrirlo
    await expect(e.s.crearPr({ proyectoId: 'p1', titulo: 'duplicada' })).rejects.toThrow(/pull request abierto/)
    await expect(e.s.crearPr({ proyectoId: 'p1', titulo: '   ' })).rejects.toThrow(/título/)
    expect(await e.s.fusionarPr('p1', 9, 'squash')).toEqual({ mensaje: 'Pull Request successfully merged' })
    expect(peticiones.find((p) => p.metodo === 'PUT')!.cuerpo).toEqual({ merge_method: 'squash' })
    await expect(e.s.fusionarPr('p1', 'x', 'merge')).rejects.toThrow(/no válido/)
  })

  it('trae la rama de un pull request y cambia a ella', async () => {
    sh(dir, 'switch', '-q', '-c', 'otra')
    await escribir(dir, 'pr.txt', 'del pr\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'Del PR')
    sh(dir, 'push', '-q', 'origin', 'otra:refs/pull/3/head') // GitHub publica así la cabeza de cada pull request
    sh(dir, 'switch', '-q', 'main')
    expect(existsSync(join(dir, 'pr.txt'))).toBe(false)
    expect(await e.s.traerPr('p1', 3)).toEqual({ rama: 'pr/3' })
    expect(existsSync(join(dir, 'pr.txt'))).toBe(true)
    expect(sh(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('pr/3')
    await expect(e.s.traerPr('p1', 0)).rejects.toThrow(/no válido/)
  })

  it('incidencias (sin los pull requests), crear, comentar y CI', async () => {
    expect((await e.s.issues('p1')).map((i) => i.numero)).toEqual([1])
    const nueva = await e.s.crearIssue({ proyectoId: 'p1', titulo: 'Falla el login', cuerpo: 'Pasos…', etiquetas: ['bug', '', 5] })
    expect(nueva).toMatchObject({ numero: 11, etiquetas: ['bug'] })
    expect(peticiones.find((p) => p.metodo === 'POST' && p.ruta.endsWith('/issues'))!.cuerpo).toEqual({ title: 'Falla el login', body: 'Pasos…', labels: ['bug'] })
    expect(await e.s.comentar('p1', 11, 'Gracias')).toEqual({ url: 'https://github.test/ana/tienda/issues/11#c1' })
    await expect(e.s.comentar('p1', 11, '  ')).rejects.toThrow(/comentario/)
    expect((await e.s.ci('p1')).estado).toBe('fallo')
    expect(await e.s.ci('p1', 'sin-subir')).toEqual({ estado: 'ninguno', checks: [] })
  })

  it('sin remoto de GitHub o sin conexión lo explica', async () => {
    vi.spyOn(Repositorio.prototype, 'remotos').mockResolvedValue([{ nombre: 'origin', url: 'git@gitlab.com:a/b.git' }])
    await expect(e.s.prs('p1')).rejects.toThrow(/no tiene un remoto de GitHub/)
    await e.s.desconectar()
    await expect(e.s.issues('p1')).rejects.toThrow(/Conecta tu cuenta/)
  })

  it('la interfaz usa las mismas operaciones y rechaza las desconocidas', async () => {
    expect((await ejecutarOperacionGitHub(e.s, 'prs', { proyectoId: 'p1' })) as unknown[]).toHaveLength(2)
    await expect(ejecutarOperacionGitHub(e.s, 'borrarRepo', {})).rejects.toThrow(/desconocida/)
    await expect(ejecutarOperacionGitHub(e.s, '__proto__', {})).rejects.toThrow(/desconocida/)
  })
})

describe('herramientas de la IA: git y GitHub', () => {
  let e: Entorno
  let dir: string
  let bare: string
  let ejecutar: ReturnType<typeof crearEjecutorOdesk>
  beforeEach(async () => {
    e = await nuevoEntorno()
    await e.s.conectar('tok-ok')
    bare = await bareVacio()
    dir = (await repoCon(bare)).dir
    e.proyectos.set('p1', dir)
    const tareas = new ServicioTareas(new AlmacenJson<Documento>(join(await carpeta('gh-tareas-'), 't')), { proyectos: async () => ({ grupos: [], proyectos: [] }) })
    ejecutar = crearEjecutorOdesk({ tareas, github: e.s, carpetaDe: async (id) => e.proyectos.get(id) ?? Promise.reject(new Error('El proyecto ya no existe.')) })
  })

  it('git_estado, git_diff, git_historial y git_ramas informan sin tocar nada', async () => {
    await escribir(dir, 'a.txt', 'uno\ndos\n')
    await escribir(dir, 'nuevo.txt', 'n\n')
    const est = JSON.parse((await ejecutar('git_estado', {}, { proyectoId: 'p1' })).texto)
    expect(est).toMatchObject({ rama: 'main', sin_preparar: [{ ruta: 'a.txt', estado: 'modificado' }], nuevos_sin_seguimiento: ['nuevo.txt'], preparados: [], remotos: ['origin'] })
    expect((await ejecutar('git_diff', {}, { proyectoId: 'p1' })).texto).toMatch(/\+dos/)
    expect((await ejecutar('git_diff', { ruta: 'nuevo.txt' }, { proyectoId: 'p1' })).texto).toMatch(/\+n/)
    expect((await ejecutar('git_diff', { preparado: true }, { proyectoId: 'p1' })).texto).toMatch(/nada preparado/)
    expect(JSON.parse((await ejecutar('git_historial', { limite: 5 }, { proyectoId: 'p1' })).texto)).toMatchObject([{ asunto: 'Primero', autor: 'Ana' }])
    expect(JSON.parse((await ejecutar('git_ramas', {}, { proyectoId: 'p1' })).texto)).toMatchObject([{ nombre: 'main', actual: true }])
  })

  it('prepara y confirma, pero se niega con archivos que parecen secretos', async () => {
    await escribir(dir, '.env', 'TOKEN=abc\n')
    await escribir(dir, 'src/app.ts', 'export {}\n')
    const r1 = await ejecutar('git_preparar', { todo: true }, { proyectoId: 'p1' })
    expect(r1.error).toBe(true)
    expect(r1.texto).toMatch(/\.env/)
    const r2 = await ejecutar('git_preparar', { rutas: ['.env'] }, { proyectoId: 'p1' })
    expect(r2).toMatchObject({ error: true })
    expect((await ejecutar('git_preparar', {}, { proyectoId: 'p1' })).texto).toMatch(/rutas/)
    expect((await ejecutar('git_preparar', { rutas: ['src/app.ts'] }, { proyectoId: 'p1' })).error).toBeUndefined()
    // Aunque alguien lo prepare por otro lado, el commit lo vuelve a comprobar
    sh(dir, 'add', '.env')
    const c1 = await ejecutar('git_commit', { mensaje: 'Añade app' }, { proyectoId: 'p1' })
    expect(c1.error).toBe(true)
    expect(c1.texto).toMatch(/secretos/)
    sh(dir, 'reset', '-q', '.env')
    const c2 = await ejecutar('git_commit', { mensaje: 'Añade app' }, { proyectoId: 'p1' })
    expect(c2.error).toBeUndefined()
    expect(JSON.parse(c2.texto)).toMatchObject({ archivos: 1, rama: 'main' })
    expect(sh(dir, 'log', '-1', '--format=%s')).toBe('Añade app')
    expect((await ejecutar('git_commit', { mensaje: 'otro' }, { proyectoId: 'p1' })).texto).toMatch(/No hay cambios preparados/)
  })

  it('ramas, enviar y traer; todo sobre el proyecto de la conversación o el indicado', async () => {
    expect(JSON.parse((await ejecutar('git_crear_rama', { nombre: 'feat/x' }, { proyectoId: 'p1' })).texto)).toEqual({ rama_actual: 'feat/x' })
    expect((await ejecutar('git_crear_rama', { nombre: 'mala rama' }, { proyectoId: 'p1' })).error).toBe(true)
    expect(JSON.parse((await ejecutar('git_cambiar_rama', { nombre: 'main' }, { proyectoId: 'p1' })).texto)).toEqual({ rama_actual: 'main' })
    expect(JSON.parse((await ejecutar('git_enviar', {}, { proyectoId: 'p1' })).texto)).toMatchObject({ rama: 'main' })
    expect(sh(bare, 'branch', '--list', 'main')).toContain('main')
    expect(JSON.parse((await ejecutar('git_traer', {}, { proyectoId: 'p1' })).texto)).toMatchObject({ conflictos: false, por_traer: 0 })
    // proyecto indicado por parámetro, sin proyecto de conversación
    expect(JSON.parse((await ejecutar('git_estado', { proyecto_id: 'p1' })).texto).rama).toBe('main')
    expect((await ejecutar('git_estado', {})).texto).toMatch(/proyecto_id/)
    expect((await ejecutar('git_estado', { proyecto_id: 'otro' })).texto).toMatch(/ya no existe/)
  })

  it('las herramientas de GitHub usan el servicio y devuelven los errores sin lanzar', async () => {
    vi.spyOn(Repositorio.prototype, 'remotos').mockResolvedValue([{ nombre: 'origin', url: 'https://github.test/ana/tienda.git' }])
    expect(JSON.parse((await ejecutar('github_estado', {}, { proyectoId: 'p1' })).texto)).toMatchObject({ conectado: true, repo: { completo: 'ana/tienda' } })
    const prs = JSON.parse((await ejecutar('github_listar_prs', {}, { proyectoId: 'p1' })).texto)
    expect(prs).toHaveLength(2)
    expect(JSON.stringify(prs)).not.toContain('cuerpo largo') // el cuerpo no se vuelca al modelo en los listados
    expect(JSON.parse((await ejecutar('github_listar_issues', {}, { proyectoId: 'p1' })).texto)).toHaveLength(1)
    expect(JSON.parse((await ejecutar('github_estado_ci', {}, { proyectoId: 'p1' })).texto).estado).toBe('fallo')
    expect(JSON.parse((await ejecutar('github_crear_issue', { titulo: 'Hola' }, { proyectoId: 'p1' })).texto)).toMatchObject({ numero: 11 })
    expect(JSON.parse((await ejecutar('github_comentar', { numero: 11, texto: 'ok' }, { proyectoId: 'p1' })).texto).url).toMatch(/#c1/)
    const ent = await ejecutar('github_crear_pr', {}, { proyectoId: 'p1' })
    expect(ent.texto).toMatch(/titulo/)
    expect((await ejecutar('github_crear_pr', { titulo: 'x' }, { proyectoId: 'p1' })).texto).toMatch(/rama de destino/)
    await e.s.desconectar()
    expect((await ejecutar('github_listar_prs', {}, { proyectoId: 'p1' })).texto).toMatch(/Conecta tu cuenta/)
    expect((await ejecutar('herramienta_inexistente', {})).error).toBe(true)
  })
})

describe('seguridad de las herramientas', () => {
  it('lo que publica fuera de la máquina siempre es «destructivo» (confirmación explícita, nunca recordada)', () => {
    for (const n of ['git_enviar', 'github_crear_repo', 'github_crear_pr', 'github_crear_issue', 'github_comentar']) expect(esDestructiva(n, {}), n).toBeTruthy()
    for (const n of ['git_estado', 'git_commit', 'git_preparar', 'github_listar_prs']) expect(esDestructiva(n, {}), n).toBeNull()
  })

  it('en suscripción: consultar siempre; cambiar desde «ediciones»; publicar solo en «autónomo»', () => {
    const preguntar = permisosCli('preguntar', [], true)
    const ediciones = permisosCli('ediciones', [], true)
    const autonomo = permisosCli('autonomo', [], true)
    for (const n of ['git_estado', 'git_diff', 'github_listar_prs', 'github_estado_ci']) expect(preguntar).toContain(`mcp__odesk__${n}`)
    for (const n of ['git_commit', 'git_preparar', 'git_crear_rama']) {
      expect(preguntar).not.toContain(`mcp__odesk__${n}`)
      expect(ediciones).toContain(`mcp__odesk__${n}`)
    }
    for (const n of ['git_enviar', 'git_traer', 'github_crear_pr', 'github_crear_repo', 'github_comentar']) {
      expect(ediciones, n).not.toContain(`mcp__odesk__${n}`)
      expect(autonomo, n).toContain(`mcp__odesk__${n}`)
    }
  })

  it('no hay herramientas para borrar, descartar, forzar ni fusionar pull requests', () => {
    const nombres = HERRAMIENTAS_ODESK.map((h) => h.nombre)
    expect(nombres.filter((n) => /borrar|eliminar|descartar|forzar|reset|fusionar|merge|delete/i.test(n))).toEqual([])
    expect(new Set(nombres).size).toBe(nombres.length)
    for (const h of [...HERRAMIENTAS_GIT, ...HERRAMIENTAS_GITHUB]) expect(['lectura', 'escritura', 'ejecucion']).toContain(h.riesgo)
    expect(HERRAMIENTAS_GIT.filter((h) => h.riesgo === 'ejecucion').map((h) => h.nombre).sort()).toEqual(['git_enviar', 'git_traer'])
  })
})
