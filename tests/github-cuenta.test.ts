import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { aItemActividad, aPerfil, aRepo, metodoDeToken } from '../src/main/github/cliente'
import { ejecutarOperacionGitHub } from '../src/main/github/operaciones'
import { ServicioGitHub } from '../src/main/github/servicio'
import { AlmacenToken, type Cifrador } from '../src/main/github/token'

const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
const carpeta = (p = 'gc-'): Promise<string> => mkdtemp(join(tmpdir(), p))

/** GitHub falso con lo que usa la sección de la cuenta. `scopes` es lo que informa en la cabecera de `/user` (null = sin cabecera, como un token de acceso fino). */
let http: Server
let url = ''
let scopes: string | null = 'repo, workflow, read:user'
let peticiones: { ruta: string; q?: string; page?: string; auth?: string }[] = []
let fallar: Record<string, number> = {}

const PERFIL = { login: 'ana', name: 'Ana Pérez', avatar_url: 'https://avatars.test/ana.png', email: 'ana@example.com', bio: 'Hago cosas', company: '@empresa', location: 'Bogotá', blog: 'https://ana.dev', html_url: 'https://github.com/ana', followers: 12, following: 3, public_repos: 20, owned_private_repos: 5, created_at: '2019-03-01T10:00:00Z', type: 'User' }
const repo = (n: number, extra: object = {}) => ({ id: n, name: `repo${n}`, full_name: `ana/repo${n}`, owner: { login: 'ana' }, description: `desc ${n}`, private: n % 2 === 0, html_url: `https://github.com/ana/repo${n}`, clone_url: `https://github.com/ana/repo${n}.git`, ssh_url: `git@github.com:ana/repo${n}.git`, default_branch: 'main', pushed_at: '2026-10-17T10:00:00Z', language: 'TypeScript', stargazers_count: n, forks_count: 1, open_issues_count: 2, fork: false, archived: false, ...extra })
const issue = (n: number, extra: object = {}) => ({ number: n, title: `Asunto ${n}`, repository_url: 'https://api.github.com/repos/ana/web', html_url: `https://github.com/ana/web/pull/${n}`, updated_at: '2026-10-17T10:00:00Z', draft: false, comments: 2, labels: [{ name: 'bug' }, { name: 'urgente' }], ...extra })

beforeAll(async () => {
  http = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    peticiones.push({ ruta: u.pathname, ...(u.searchParams.get('q') ? { q: u.searchParams.get('q')! } : {}), ...(u.searchParams.get('page') ? { page: u.searchParams.get('page')! } : {}), auth: req.headers.authorization })
    const json = (c: unknown, estado = 200, cab: Record<string, string> = {}): void => {
      res.writeHead(estado, { 'content-type': 'application/json', ...cab })
      res.end(JSON.stringify(c))
    }
    if (fallar[u.pathname]) return json({ message: 'Fallo simulado' }, fallar[u.pathname])
    if (!/^Bearer .+/.test(req.headers.authorization ?? '')) return json({ message: 'Bad credentials' }, 401)
    if (u.pathname === '/user') return json(PERFIL, 200, scopes === null ? {} : { 'x-oauth-scopes': scopes })
    if (u.pathname === '/rate_limit') return json({ resources: { core: { limit: 5000, remaining: 4321, reset: 1_900_000_000 } } })
    if (u.pathname === '/user/orgs') return json([{ login: 'empresa', description: 'Mi empresa', avatar_url: 'https://avatars.test/e.png' }, { login: 'oss', avatar_url: 'https://avatars.test/o.png' }])
    if (u.pathname === '/search/issues') {
      const q = u.searchParams.get('q') ?? ''
      if (q.includes('review-requested')) return json({ items: [issue(7, { draft: true })] })
      if (q.includes('is:issue')) return json({ items: [issue(3, { html_url: 'https://github.com/ana/web/issues/3' })] })
      return json({ items: [issue(1), issue(2)] })
    }
    if (u.pathname === '/user/repos') return json(u.searchParams.get('page') === '2' ? [repo(101)] : [repo(1), repo(2, { fork: true, language: null }), repo(3, { archived: true })])
    json({ message: 'no' }, 404)
  })
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  const casa = await carpeta('gc-casa-')
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterAll(() => new Promise<void>((ok) => http.close(() => ok())))
beforeEach(() => {
  scopes = 'repo, workflow, read:user'
  peticiones = []
  fallar = {}
})

const cifrador: Cifrador = { disponible: () => true, cifrar: (t) => Buffer.from(t).toString('base64'), descifrar: (c) => Buffer.from(c, 'base64').toString() }

async function nuevo(token: string | null = 'gho_secreto_de_prueba', proyectos: Map<string, { nombre: string; ruta: string }> = new Map()) {
  const datos = await carpeta('gc-datos-')
  const almacen = new AlmacenToken(join(datos, 'github.json'), cifrador)
  if (token) await almacen.guardar(token, 'ana')
  let consultasCarpeta = 0
  const s = new ServicioGitHub({
    token: almacen,
    api: url,
    host: 'github.test',
    dirDatos: datos,
    resolverHost: async (h) => h,
    carpetaDe: async (id) => {
      consultasCarpeta++
      const p = proyectos.get(id)
      if (!p) throw new Error('El proyecto ya no existe.')
      return p.ruta
    },
    agregarProyecto: async () => ({ id: 'x' }),
    proyectos: async () => [...proyectos].map(([id, p]) => ({ id, nombre: p.nombre }))
  })
  return { s, almacen, consultas: () => consultasCarpeta }
}

describe('mapeos', () => {
  it('perfil: omite lo vacío y toma los repositorios privados de donde GitHub los informe', () => {
    expect(aPerfil(PERFIL)).toEqual({ usuario: 'ana', nombre: 'Ana Pérez', avatar: 'https://avatars.test/ana.png', correo: 'ana@example.com', bio: 'Hago cosas', empresa: '@empresa', ubicacion: 'Bogotá', sitio: 'https://ana.dev', url: 'https://github.com/ana', seguidores: 12, siguiendo: 3, reposPublicos: 20, reposPrivados: 5, creada: '2019-03-01T10:00:00Z', tipoCuenta: 'User' })
    const minimo = aPerfil({ login: 'bea', name: '  ', email: null, bio: '', company: null, public_repos: 1, created_at: '2020-01-01T00:00:00Z' })
    expect(minimo).toMatchObject({ usuario: 'bea', reposPublicos: 1, seguidores: 0, tipoCuenta: 'User' })
    for (const k of ['nombre', 'correo', 'bio', 'empresa', 'ubicacion', 'sitio', 'reposPrivados']) expect(minimo).not.toHaveProperty(k)
    expect(aPerfil({ login: 'x', total_private_repos: 9 })).toMatchObject({ reposPrivados: 9 })
  })

  it('repositorio con propietario, lenguaje, estrellas y estado; elemento de actividad con su repo y etiquetas', () => {
    expect(aRepo(repo(4))).toMatchObject({ propietario: 'ana', lenguaje: 'TypeScript', estrellas: 4, forks: 1, incidenciasAbiertas: 2, fork: false, archivado: false, completo: 'ana/repo4' })
    expect(aRepo(repo(5, { language: null }))).not.toHaveProperty('lenguaje')
    expect(aItemActividad(issue(9, { draft: true }))).toEqual({ numero: 9, titulo: 'Asunto 9', repo: 'ana/web', url: 'https://github.com/ana/web/pull/9', actualizada: '2026-10-17T10:00:00Z', borrador: true, comentarios: 2, etiquetas: ['bug', 'urgente'] })
  })

  it('el método de conexión se reconoce por el prefijo del token', () => {
    expect(metodoDeToken('gho_x')).toBe('oauth')
    expect(metodoDeToken('ghp_x')).toBe('token-clasico')
    expect(metodoDeToken('github_pat_x')).toBe('token-fino')
    expect(metodoDeToken('ghu_x')).toBe('app')
    expect(metodoDeToken('otro')).toBe('desconocido')
  })
})

describe('cuenta conectada', () => {
  it('perfil, método, permisos y límite de peticiones; el token nunca aparece', async () => {
    const { s } = await nuevo('gho_secreto_de_prueba')
    const c = await s.cuenta()
    expect(c.perfil).toMatchObject({ usuario: 'ana', nombre: 'Ana Pérez', seguidores: 12, reposPrivados: 5 })
    expect(c.conexion).toMatchObject({ metodo: 'oauth', host: 'github.test', persistente: true, renovable: false, permisos: ['repo', 'workflow', 'read:user'], oauth: false, limite: { restantes: 4321, total: 5000, reinicia: new Date(1_900_000_000_000).toISOString() } })
    expect(JSON.stringify(c)).not.toContain('secreto_de_prueba')
    expect(peticiones.every((p) => p.auth === 'Bearer gho_secreto_de_prueba')).toBe(true)
  })

  it('un token de acceso fino no informa permisos (null); uno clásico, sí', async () => {
    scopes = null
    expect((await (await nuevo('github_pat_abc')).s.cuenta()).conexion).toMatchObject({ metodo: 'token-fino', permisos: null })
    scopes = ''
    expect((await (await nuevo('ghp_abc')).s.cuenta()).conexion).toMatchObject({ metodo: 'token-clasico', permisos: [] })
  })

  it('una sesión que se renueva muestra cuándo caduca el token y el refresh', async () => {
    const { s, almacen } = await nuevo(null)
    await almacen.guardar('gho_a', 'ana', { refresh: 'ghr_r', expira: Date.parse('2030-01-01T08:00:00Z'), refrescaHasta: Date.parse('2030-07-01T00:00:00Z') })
    expect((await s.cuenta()).conexion).toMatchObject({ renovable: true, expira: '2030-01-01T08:00:00.000Z', refrescaHasta: '2030-07-01T00:00:00.000Z' })
  })

  it('si el límite de peticiones no se puede leer, el resto sigue mostrándose', async () => {
    fallar['/rate_limit'] = 500
    const c = (await (await nuevo()).s.cuenta()).conexion
    expect(c).not.toHaveProperty('limite')
    expect(c.metodo).toBe('oauth')
  })

  it('sin conexión o con un token inválido da un mensaje claro', async () => {
    await expect((await nuevo(null)).s.cuenta()).rejects.toThrow(/Conecta tu cuenta/)
    fallar['/user'] = 401
    await expect((await nuevo()).s.cuenta()).rejects.toThrow(/token de GitHub no es válido/)
  })

  it('organizaciones', async () => {
    expect(await (await nuevo()).s.orgs()).toEqual([
      { login: 'empresa', descripcion: 'Mi empresa', avatar: 'https://avatars.test/e.png', url: 'https://github.com/empresa' },
      { login: 'oss', avatar: 'https://avatars.test/o.png', url: 'https://github.com/oss' }
    ])
  })
})

describe('actividad pendiente', () => {
  it('tus pull requests, las revisiones que te piden y tus incidencias, con las búsquedas correctas', async () => {
    const a = await (await nuevo()).s.actividad()
    expect(a.misPrs.map((i) => i.numero)).toEqual([1, 2])
    expect(a.revisiones).toMatchObject([{ numero: 7, borrador: true }])
    expect(a.incidencias).toMatchObject([{ numero: 3, repo: 'ana/web', etiquetas: ['bug', 'urgente'] }])
    const consultas = peticiones.filter((p) => p.ruta === '/search/issues').map((p) => p.q!)
    expect(consultas).toHaveLength(3)
    expect(consultas.some((q) => q.includes('is:pr') && q.includes('author:@me') && q.includes('is:open'))).toBe(true)
    expect(consultas.some((q) => q.includes('review-requested:@me'))).toBe(true)
    expect(consultas.some((q) => q.includes('is:issue') && q.includes('assignee:@me'))).toBe(true)
  })

  it('si la búsqueda falla (límite, permisos) el error llega claro', async () => {
    fallar['/search/issues'] = 403
    await expect((await nuevo()).s.actividad()).rejects.toThrow(/permiso|limit/i)
  })
})

describe('repositorios de la cuenta', () => {
  it('lista con sus detalles, filtra por texto y pagina', async () => {
    const { s } = await nuevo()
    const p1 = await s.repos()
    expect(p1.map((r) => r.completo)).toEqual(['ana/repo1', 'ana/repo2', 'ana/repo3'])
    expect(p1[1]).toMatchObject({ fork: true, privado: true })
    expect(p1[1]).not.toHaveProperty('lenguaje')
    expect(p1[2]).toMatchObject({ archivado: true })
    expect((await s.repos('REPO2')).map((r) => r.completo)).toEqual(['ana/repo2'])
    expect((await s.repos(undefined, 2)).map((r) => r.completo)).toEqual(['ana/repo101'])
    await s.repos(undefined, 'x' as never)
    await s.repos(undefined, 9999)
    const paginas = peticiones.filter((p) => p.ruta === '/user/repos').map((p) => p.page)
    expect(paginas).toEqual(['1', '1', '2', '1', '1'])
  })
})

describe('qué repositorios ya están en este equipo', () => {
  async function entorno() {
    const conGitHub = await carpeta('gc-a-')
    sh(conGitHub, 'init', '-q', '-b', 'main')
    sh(conGitHub, 'remote', 'add', 'origin', 'https://github.test/Ana/Tienda.git')
    const porSsh = await carpeta('gc-b-')
    sh(porSsh, 'init', '-q', '-b', 'main')
    sh(porSsh, 'remote', 'add', 'origin', 'git@github.test:ana/api.git')
    const otroServidor = await carpeta('gc-c-')
    sh(otroServidor, 'init', '-q', '-b', 'main')
    sh(otroServidor, 'remote', 'add', 'origin', 'https://gitlab.com/ana/x.git')
    const sinRemoto = await carpeta('gc-d-')
    sh(sinRemoto, 'init', '-q', '-b', 'main')
    const noRepo = await carpeta('gc-e-')
    await writeFile(join(noRepo, 'a.txt'), 'x')
    const proyectos = new Map([
      ['p1', { nombre: 'Tienda', ruta: conGitHub }],
      ['p2', { nombre: 'API', ruta: porSsh }],
      ['p3', { nombre: 'Otro', ruta: otroServidor }],
      ['p4', { nombre: 'Sin remoto', ruta: sinRemoto }],
      ['p5', { nombre: 'No es repo', ruta: noRepo }],
      ['p6', { nombre: 'Desaparecido', ruta: '/no/existe/jamas' }]
    ])
    return { proyectos, ...(await nuevo('gho_x', proyectos)) }
  }

  it('reconoce por el remoto (https o ssh, sin distinguir mayúsculas) y deja fuera lo que no es de GitHub', async () => {
    const { s } = await entorno()
    const l = await s.reposLocales()
    expect(l.sort((a, b) => a.proyectoId.localeCompare(b.proyectoId))).toEqual([
      { completo: 'ana/tienda', proyectoId: 'p1', proyecto: 'Tienda' },
      { completo: 'ana/api', proyectoId: 'p2', proyecto: 'API' }
    ])
  })

  it('se recuerda un minuto y se olvida al desconectar', async () => {
    const { s, consultas } = await entorno()
    await s.reposLocales()
    const antes = consultas()
    await s.reposLocales()
    expect(consultas()).toBe(antes) // sin volver a mirar las carpetas
    await s.desconectar()
    await s.conectar('gho_otro').catch(() => undefined)
    await s.reposLocales()
    expect(consultas()).toBeGreaterThan(antes)
  })

  it('sin proyectos devuelve una lista vacía', async () => {
    expect(await (await nuevo()).s.reposLocales()).toEqual([])
  })
})

describe('por la interfaz', () => {
  it('las operaciones nuevas están disponibles', async () => {
    const { s } = await nuevo()
    expect(await ejecutarOperacionGitHub(s, 'cuenta', {})).toMatchObject({ perfil: { usuario: 'ana' } })
    expect(await ejecutarOperacionGitHub(s, 'orgs', {})).toHaveLength(2)
    expect(await ejecutarOperacionGitHub(s, 'actividad', {})).toMatchObject({ misPrs: [{}, {}] })
    expect(await ejecutarOperacionGitHub(s, 'reposLocales', {})).toEqual([])
    expect(await ejecutarOperacionGitHub(s, 'repos', { pagina: 2 })).toHaveLength(1)
  })
})
