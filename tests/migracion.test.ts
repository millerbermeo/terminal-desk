import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { repararWorktrees } from '../src/main/core/git/reparar'
import { GestorWorktrees } from '../src/main/core/git/worktree'
import { CARPETA_DATOS, CARPETA_DATOS_ANTIGUA, migrarCarpeta, resolverDirDatos, resolverPerfil } from '../src/main/migracion'

const carpeta = (): Promise<string> => mkdtemp(join(tmpdir(), 'mig-'))
const escribir = async (ruta: string, texto: string, modo?: number): Promise<void> => {
  await mkdir(join(ruta, '..'), { recursive: true })
  await writeFile(ruta, texto, modo ? { mode: modo } : undefined)
}
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

beforeAll(() => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'T'
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@example.com'
})

describe('migrarCarpeta', () => {
  it('no hace nada sin origen, no pisa un destino y mueve todo con sus permisos', async () => {
    const base = await carpeta()
    expect(migrarCarpeta(join(base, 'a'), join(base, 'b'))).toEqual({ estado: 'nada' })

    await escribir(join(base, 'a', 'x.json'), '{"x":1}', 0o600)
    await escribir(join(base, 'a', 'hondo', 'y.txt'), 'y')
    await mkdir(join(base, 'b'))
    expect(migrarCarpeta(join(base, 'a'), join(base, 'b'))).toEqual({ estado: 'conflicto' })
    expect(existsSync(join(base, 'a', 'x.json'))).toBe(true) // el origen sigue intacto

    expect(migrarCarpeta(join(base, 'a'), join(base, 'nueva'))).toEqual({ estado: 'migrado' })
    expect(existsSync(join(base, 'a'))).toBe(false)
    expect(readFileSync(join(base, 'nueva', 'x.json'), 'utf8')).toBe('{"x":1}')
    expect(readFileSync(join(base, 'nueva', 'hondo', 'y.txt'), 'utf8')).toBe('y')
    expect(statSync(join(base, 'nueva', 'x.json')).mode & 0o777).toBe(0o600)
  })

  it('si no puede mover ni copiar, avisa del error y deja el origen y el destino como estaban', async () => {
    const base = await carpeta()
    await escribir(join(base, 'a', 'x.json'), 'datos')
    await escribir(join(base, 'archivo'), 'soy un archivo, no una carpeta')
    const r = migrarCarpeta(join(base, 'a'), join(base, 'archivo', 'dentro')) // el «padre» del destino es un archivo
    expect(r.estado).toBe('error')
    expect(r.error).toBeTruthy()
    expect(readFileSync(join(base, 'a', 'x.json'), 'utf8')).toBe('datos')
    expect(existsSync(join(base, 'archivo', 'dentro'))).toBe(false)
  })
})

describe('resolverDirDatos (~/.centro-proyectos → ~/.odesk-agent)', () => {
  it('mueve la carpeta antigua una sola vez y conserva todo', async () => {
    const casa = await carpeta()
    const viejo = join(casa, CARPETA_DATOS_ANTIGUA)
    await escribir(join(viejo, 'proyectos.json'), '{"grupos":[],"proyectos":[]}', 0o600)
    await escribir(join(viejo, 'tareas', 'tareas.json'), '{"tareas":[1]}', 0o600)
    await escribir(join(viejo, 'cuentas.json'), '{"activa":"principal"}')
    const r = resolverDirDatos(casa)
    expect(r).toEqual({ dir: join(casa, CARPETA_DATOS), migrado: true })
    expect(existsSync(viejo)).toBe(false)
    expect(readFileSync(join(r.dir, 'tareas', 'tareas.json'), 'utf8')).toBe('{"tareas":[1]}')
    expect(statSync(join(r.dir, 'proyectos.json')).mode & 0o777).toBe(0o600)
    // en los arranques siguientes no hay nada que migrar
    expect(resolverDirDatos(casa)).toEqual({ dir: join(casa, CARPETA_DATOS), migrado: false })
  })

  it('una instalación nueva usa la carpeta nueva y no crea la antigua', async () => {
    const casa = await carpeta()
    expect(resolverDirDatos(casa)).toEqual({ dir: join(casa, CARPETA_DATOS), migrado: false })
    expect(existsSync(join(casa, CARPETA_DATOS_ANTIGUA))).toBe(false)
  })

  it('si existen las dos manda la nueva, salvo que esté vacía y los proyectos estén en la antigua', async () => {
    const a = await carpeta()
    await escribir(join(a, CARPETA_DATOS, 'proyectos.json'), '{}')
    await escribir(join(a, CARPETA_DATOS_ANTIGUA, 'proyectos.json'), '{}')
    expect(resolverDirDatos(a)).toEqual({ dir: join(a, CARPETA_DATOS), migrado: false })

    const b = await carpeta()
    await mkdir(join(b, CARPETA_DATOS))
    await escribir(join(b, CARPETA_DATOS_ANTIGUA, 'proyectos.json'), '{}')
    const r = resolverDirDatos(b)
    expect(r.dir).toBe(join(b, CARPETA_DATOS_ANTIGUA))
    expect(r.migrado).toBe(false)
    expect(r.aviso).toMatch(/siguen? usando|se sigue usando/)
  })

  it('si la migración falla sigue usando la carpeta antigua (nunca arranca «vacía»)', async () => {
    const casa = await carpeta()
    await escribir(join(casa, CARPETA_DATOS_ANTIGUA, 'proyectos.json'), '{"p":1}')
    await chmod(casa, 0o555) // sin permiso para crear la carpeta nueva
    try {
      const r = resolverDirDatos(casa)
      expect(r.dir).toBe(join(casa, CARPETA_DATOS_ANTIGUA))
      expect(r.migrado).toBe(false)
      expect(r.aviso).toMatch(/No se pudieron mover/)
      expect(readFileSync(join(r.dir, 'proyectos.json'), 'utf8')).toBe('{"p":1}')
    } finally {
      chmodSync(casa, 0o755)
    }
  })
})

describe('resolverPerfil (perfil de Electron)', () => {
  it('toma el perfil del nombre anterior si solo existe ese', async () => {
    const appData = await carpeta()
    await escribir(join(appData, 'ODESK AI', 'Local Storage', 'x'), 'conv')
    const r = resolverPerfil(appData, 'Odesk Agent')
    expect(r).toBe(join(appData, 'Odesk Agent'))
    expect(readFileSync(join(r, 'Local Storage', 'x'), 'utf8')).toBe('conv')
    expect(existsSync(join(appData, 'ODESK AI'))).toBe(false)
  })
  it('sin perfiles, o con el nuevo ya creado, no toca nada', async () => {
    const vacio = await carpeta()
    expect(resolverPerfil(vacio, 'Odesk Agent')).toBe(join(vacio, 'Odesk Agent'))
    expect(existsSync(join(vacio, 'Odesk Agent'))).toBe(false)
    const ambos = await carpeta()
    await escribir(join(ambos, 'Odesk Agent', 'a'), 'nuevo')
    await escribir(join(ambos, 'ODESK AI', 'a'), 'viejo')
    expect(resolverPerfil(ambos, 'Odesk Agent')).toBe(join(ambos, 'Odesk Agent'))
    expect(readFileSync(join(ambos, 'ODESK AI', 'a'), 'utf8')).toBe('viejo')
  })
})

describe('los worktrees de los agentes sobreviven a la migración', () => {
  it('git worktree repair rehace las rutas tras mover la carpeta de datos', async () => {
    const casa = await carpeta()
    const repo = await carpeta()
    git(repo, 'init', '-q', '-b', 'main')
    await writeFile(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'inicial')

    const viejo = join(casa, CARPETA_DATOS_ANTIGUA)
    const wt = await new GestorWorktrees(join(viejo, 'worktrees')).crear(repo, 'p1', 'mi tarea')
    await writeFile(join(wt.ruta, 'trabajo.txt'), 'sin confirmar\n') // trabajo del agente que no se puede perder

    const r = resolverDirDatos(casa)
    expect(r.migrado).toBe(true)
    const nuevaRuta = join(r.dir, 'worktrees', 'p1', wt.id)
    expect(existsSync(nuevaRuta)).toBe(true)
    // Sin reparar, el repositorio sigue registrando la ruta antigua (git la daría por perdida y un `worktree prune` borraría el registro).
    const antes = git(repo, 'worktree', 'list', '--porcelain')
    expect(antes).toContain(wt.ruta)
    expect(antes).not.toContain(nuevaRuta)
    expect(antes).toMatch(/prunable/)

    expect(await repararWorktrees(r.dir, [{ id: 'p1', ruta: repo }, { id: 'otro', ruta: repo }])).toBe(1)
    expect(git(nuevaRuta, 'status', '--short')).toBe('?? trabajo.txt')
    const despues = git(repo, 'worktree', 'list', '--porcelain')
    expect(despues).toContain(nuevaRuta)
    expect(despues).not.toMatch(/prunable/)
    expect(readFileSync(join(nuevaRuta, 'trabajo.txt'), 'utf8')).toBe('sin confirmar\n')
    expect(await repararWorktrees(join(casa, 'no-hay'), [])).toBe(0)
  })
})

describe('DIR de la aplicación', () => {
  it('al cargar, mueve los datos antiguos y la app los lee desde la carpeta nueva', async () => {
    const casa = await carpeta()
    await escribir(join(casa, CARPETA_DATOS_ANTIGUA, 'proyectos.json'), JSON.stringify({ grupos: [], proyectos: [{ id: 'p1', nombre: 'Heredado', ruta: casa }] }))
    vi.resetModules()
    vi.stubEnv('HOME', casa)
    const m = await import('../src/main/proyectos')
    expect(m.DIR).toBe(join(casa, CARPETA_DATOS))
    expect(m.MIGRACION_DATOS.migrado).toBe(true)
    expect((await m.leerProyectosLocales()).proyectos.map((p) => p.nombre)).toEqual(['Heredado'])
    vi.unstubAllEnvs()
  })
})
