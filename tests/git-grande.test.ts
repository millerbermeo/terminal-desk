import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { explicarError, limpiarStderr } from '../src/main/core/git/analisis'
import type * as ModuloGit from '../src/main/core/git/git'
import { Repositorio } from '../src/main/core/git/repositorio'

/** Las consultas de `status` que se hicieron, y si hay que simular que `--untracked-files=all` no cabe en memoria. */
const hechas: string[] = []
let desbordar = false
vi.mock('../src/main/core/git/git', async (original) => {
  const real = await original<typeof ModuloGit>()
  return {
    ...real,
    git: async (cwd: string, args: readonly string[], o?: Parameters<typeof real.git>[2]) => {
      const modo = args.find((a) => a.startsWith('--untracked-files='))
      if (args[0] === 'status' && modo) hechas.push(modo.split('=')[1]!)
      if (desbordar && modo === '--untracked-files=all') return { ok: false, stdout: '', stderr: 'stdout maxBuffer length exceeded', desbordado: true }
      return real.git(cwd, args, o)
    }
  }
})

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

beforeAll(async () => {
  const casa = await mkdtemp(join(tmpdir(), 'gg-casa-'))
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
beforeEach(() => {
  hechas.length = 0
  desbordar = false
})

async function repoConSueltos(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gg-repo-'))
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.name', 'Ana')
  sh(dir, 'config', 'user.email', 'a@e.com')
  await writeFile(join(dir, 'a.txt'), 'uno\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'Primero')
  await mkdir(join(dir, 'datos', 'sub'), { recursive: true })
  await writeFile(join(dir, 'datos', 'x.txt'), 'x')
  await writeFile(join(dir, 'datos', 'sub', 'y.txt'), 'y')
  await writeFile(join(dir, 'a.txt'), 'uno cambiado\n')
  return dir
}

describe('git() avisa cuando la salida no cabe', () => {
  it('marca «desbordado» en vez de confundirlo con un fallo de autenticación', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-buf-'))
    sh(dir, 'init', '-q')
    await writeFile(join(dir, 'grande.bin'), Buffer.alloc(40 * 1024 * 1024, 97))
    const blob = execFileSync('git', ['hash-object', '-w', 'grande.bin'], { cwd: dir, encoding: 'utf8' }).trim()
    const real = await vi.importActual<typeof ModuloGit>('../src/main/core/git/git')
    const r = await real.git(dir, ['cat-file', '-p', blob])
    expect(r.ok).toBe(false)
    expect(r.desbordado).toBe(true)
    expect(explicarError(r.stderr, 'status')).not.toMatch(/autenticar/)
    // una salida normal no se marca
    expect((await real.git(dir, ['rev-parse', '--git-dir'])).desbordado).toBeUndefined()
  })
})

describe('status en repositorios enormes (p. ej. una carpeta personal convertida en repo)', () => {
  it('lista los sin seguimiento uno a uno cuando caben', async () => {
    const dir = await repoConSueltos()
    const e = await new Repositorio(dir).estado()
    expect(e.archivos.map((a) => a.ruta).sort()).toEqual(['a.txt', 'datos/sub/y.txt', 'datos/x.txt'])
    expect(e.truncado).toBeUndefined()
    expect(hechas).toEqual(['all'])
  })

  it('si no caben, pasa a agruparlos por carpeta, avisa de que la lista es parcial y lo recuerda', async () => {
    const dir = await repoConSueltos()
    desbordar = true
    const e = await new Repositorio(dir).estado()
    expect(e.archivos.map((a) => a.ruta).sort()).toEqual(['a.txt', 'datos/'])
    expect(e.truncado).toBe(true)
    expect(hechas).toEqual(['all', 'normal'])
    hechas.length = 0
    await new Repositorio(dir).estado() // la segunda vez ya no pierde tiempo con «all»
    expect(hechas).toEqual(['normal'])
  })

  it('el estado «ligero» no recorre los archivos sin seguimiento', async () => {
    const dir = await repoConSueltos()
    const e = await new Repositorio(dir).estado('ligero')
    expect(e.archivos.map((a) => a.ruta)).toEqual(['a.txt']) // solo lo versionado
    expect(e.rama).toBe('main')
    expect(hechas).toEqual(['no'])
  })
})

describe('mensajes de error de git', () => {
  const avisos = ["warning: could not open directory '.local/share/waydroid/data/mediadrm/': Permission denied", "warning: could not open directory '.local/share/waydroid/data/drm/': Permission denied"]

  it('los avisos de carpetas sin permiso no se toman por un fallo de autenticación y se resumen', () => {
    const msg = explicarError([...avisos, 'fatal: algo raro'].join('\n'), 'status')
    expect(msg).not.toMatch(/autenticar/)
    expect(msg).toContain('git status falló.')
    expect(msg).toContain('fatal: algo raro')
    expect(msg).toContain('(2 carpetas sin permiso de lectura omitidas)')
    expect(msg).not.toContain('mediadrm')
    expect(limpiarStderr(avisos[0]!)).toBe('(1 carpeta sin permiso de lectura omitida)')
  })

  it('los errores reales de autenticación se siguen reconociendo', () => {
    for (const t of ['git@github.com: Permission denied (publickey).', 'fatal: Authentication failed for', 'Permission denied, please try again.', 'Host key verification failed.']) {
      expect(explicarError(t, 'push'), t).toMatch(/No se pudo autenticar/)
    }
  })

  it('un mensaje larguísimo se recorta', () => {
    expect(limpiarStderr('x'.repeat(5000)).length).toBeLessThan(1300)
  })
})
