import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { GestorWorktrees } from '../src/main/core/git/worktree'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
let repo: string
let gestor: GestorWorktrees

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'repo-'))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.txt'), 'uno\n')
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n')
  await mkdir(join(repo, 'node_modules'))
  await writeFile(join(repo, 'node_modules', 'dep.js'), 'x')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'inicial')
  gestor = new GestorWorktrees(await mkdtemp(join(tmpdir(), 'wt-')))
})

describe('GestorWorktrees', () => {
  it('detecta repos sin commits', async () => {
    const vacio = await mkdtemp(join(tmpdir(), 'vacio-'))
    git(vacio, 'init', '-q')
    expect(await gestor.esRepoConCommits(vacio)).toBe(false)
    expect(await gestor.esRepoConCommits(await mkdtemp(join(tmpdir(), 'nogit-')))).toBe(false)
    expect(await gestor.esRepoConCommits(repo)).toBe(true)
  })

  it('aísla los cambios: el repo original no se toca hasta que se integra', async () => {
    const wt = await gestor.crear(repo, 'p1', 'Añadir función de sumar')
    expect(wt.rama).toMatch(/^agente\/anadir-funcion-de-sumar-[0-9a-f]{8}$/)
    expect(existsSync(join(wt.ruta, 'node_modules', 'dep.js'))).toBe(true) // dependencias enlazadas
    expect(await gestor.listar(repo, 'p1')).toEqual([wt])
    expect(await gestor.listar(repo, 'p2')).toEqual([])

    expect((await gestor.cambios(wt)).hayCambios).toBe(false) // el enlace a node_modules no cuenta como cambio
    await writeFile(join(wt.ruta, 'a.txt'), 'uno\ndos\n')
    await writeFile(join(wt.ruta, 'nuevo.txt'), 'archivo nuevo')
    const c = await gestor.cambios(wt)
    expect(c.hayCambios).toBe(true)
    expect(c.texto).toContain('+dos')
    expect(c.texto).toContain('archivo nuevo')
    expect(c.texto).not.toContain('node_modules')
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('uno\n')
    expect(git(repo, 'status', '--short')).toBe('')

    const commit = await gestor.confirmar(wt, 'agente: añadir función\ncon varias líneas')
    expect(commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(git(repo, 'log', '-1', '--format=%s', wt.rama)).toBe('agente: añadir función con varias líneas')
    expect(git(repo, 'ls-tree', '-r', '--name-only', wt.rama)).not.toContain('node_modules')
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('uno\n') // main sigue igual
    expect(await gestor.confirmar(wt, 'otra vez')).toBeNull() // nada que confirmar

    await gestor.descartar(repo, wt)
    expect(existsSync(wt.ruta)).toBe(false)
    expect(git(repo, 'branch', '--list', wt.rama)).toBe('')
    expect(await gestor.listar(repo, 'p1')).toEqual([])
  })

  it('no descarta rutas ajenas y valida el id del proyecto', async () => {
    await expect(gestor.descartar(repo, { id: 'x', proyectoId: 'p1', rama: 'main', ruta: repo })).rejects.toThrow(/no pertenece/)
    await expect(gestor.crear(repo, '../fuera', 't')).rejects.toThrow(/inválido/)
  })

  it('publicar falla con claridad si no hay remoto', async () => {
    const wt = await gestor.crear(repo, 'p1', 'sin remoto')
    await expect(gestor.publicar(wt)).rejects.toThrow()
    await gestor.descartar(repo, wt)
  })
})
