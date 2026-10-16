import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CambioArchivo } from '@shared/archivos'
import { GestorArchivos, Vigilante } from '../src/main/archivos'

let dir: string
let papelera: string[]
let g: GestorArchivos

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edit-'))
  papelera = []
  g = new GestorArchivos({ raiz: async () => dir, papelera: async (r) => void papelera.push(r) })
  await mkdir(join(dir, 'src/util'), { recursive: true })
  await mkdir(join(dir, '.git'))
  await mkdir(join(dir, 'node_modules/x'), { recursive: true })
  await writeFile(join(dir, 'README.md'), '# hola\n')
  await writeFile(join(dir, 'src/index.ts'), 'export const a = 1\n')
  await writeFile(join(dir, 'src/util/b.ts'), 'export const b = 2\n')
  await writeFile(join(dir, 'Zeta.txt'), 'z')
  await writeFile(join(dir, 'alfa.txt'), 'a')
})

describe('listar', () => {
  it('carpetas primero, orden natural, sin .git ni node_modules, con rutas relativas', async () => {
    expect((await g.listar('p')).map((e) => `${e.tipo}:${e.nombre}`)).toEqual(['carpeta:src', 'archivo:alfa.txt', 'archivo:README.md', 'archivo:Zeta.txt'])
    expect((await g.listar('p', 'src')).map((e) => e.ruta)).toEqual(['src/util', 'src/index.ts'])
    expect((await g.listar('p', 'src/util'))[0]).toMatchObject({ ruta: 'src/util/b.ts', bytes: 19 })
  })
  it('queda confinado al proyecto (.., rutas absolutas y enlaces que escapan)', async () => {
    const fuera = await mkdtemp(join(tmpdir(), 'fuera-'))
    await writeFile(join(fuera, 'secreto.txt'), 'x')
    await symlink(fuera, join(dir, 'enlace'))
    await expect(g.listar('p', '..')).rejects.toThrow(/sale del proyecto/)
    await expect(g.listar('p', '/etc')).rejects.toThrow(/sale del proyecto/)
    await expect(g.leer('p', 'enlace/secreto.txt')).rejects.toThrow(/sale del proyecto/)
    expect((await g.listar('p')).find((e) => e.nombre === 'enlace')?.tipo).toBe('enlace')
  })
})

describe('leer', () => {
  it('devuelve el texto con su fecha, y explica por qué no abre lo demás', async () => {
    const r = await g.leer('p', 'src/index.ts')
    expect(r).toMatchObject({ ok: true, contenido: 'export const a = 1\n', bytes: 19 })
    await writeFile(join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]))
    await writeFile(join(dir, 'latin1.txt'), Buffer.from([0xe9, 0xe8, 0xff]))
    await writeFile(join(dir, 'grande.txt'), Buffer.alloc(1024 * 1024 + 1, 97))
    expect(await g.leer('p', 'bin.dat')).toMatchObject({ ok: false, motivo: 'binario' })
    expect(await g.leer('p', 'latin1.txt')).toMatchObject({ ok: false, motivo: 'no-utf8' })
    expect(await g.leer('p', 'grande.txt')).toMatchObject({ ok: false, motivo: 'demasiado-grande' })
    expect(await g.leer('p', 'src')).toMatchObject({ ok: false, motivo: 'no-es-archivo' })
    expect(await g.leer('p', 'no-existe.ts')).toMatchObject({ ok: false, motivo: 'no-existe' })
  })
})

describe('guardar', () => {
  it('escribe de forma atómica (sin temporales), conserva permisos y crea carpetas que falten', async () => {
    await chmod(join(dir, 'src/index.ts'), 0o755)
    const r = await g.guardar('p', 'src/index.ts', 'nuevo\n')
    expect(r.ok).toBe(true)
    expect(await readFile(join(dir, 'src/index.ts'), 'utf8')).toBe('nuevo\n')
    expect((await stat(join(dir, 'src/index.ts'))).mode & 0o777).toBe(0o755)
    expect((await readdir(join(dir, 'src'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect((await g.guardar('p', 'nueva/carpeta/x.ts', 'x')).ok).toBe(true)
    expect(await readFile(join(dir, 'nueva/carpeta/x.ts'), 'utf8')).toBe('x')
  })
  it('no pisa lo que cambió en disco desde que se abrió (conflicto) y sí lo propio', async () => {
    const abierto = (await g.leer('p', 'README.md')) as { mtimeMs: number }
    const ok = await g.guardar('p', 'README.md', 'mío\n', abierto.mtimeMs)
    expect(ok.ok).toBe(true)
    const nuevoMtime = (ok as { mtimeMs: number }).mtimeMs
    await writeFile(join(dir, 'README.md'), 'del agente\n')
    const futuro = new Date(Date.now() + 5000)
    await utimes(join(dir, 'README.md'), futuro, futuro)
    const c = await g.guardar('p', 'README.md', 'mío otra vez\n', nuevoMtime)
    expect(c).toMatchObject({ ok: false, motivo: 'conflicto' })
    expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe('del agente\n')
    // «conservar mis cambios»: se guarda sabiendo la fecha actual del disco
    expect((await g.guardar('p', 'README.md', 'mío otra vez\n', (c as { mtimeMs: number }).mtimeMs)).ok).toBe(true)
  })
  it('rechaza .git, node_modules, tamaños excesivos y rutas fuera del proyecto', async () => {
    expect(await g.guardar('p', '.git/config', 'x')).toMatchObject({ ok: false, motivo: 'protegido' })
    expect(await g.guardar('p', 'node_modules/x/i.js', 'x')).toMatchObject({ ok: false, motivo: 'protegido' })
    expect(await g.guardar('p', 'grande.txt', 'a'.repeat(5 * 1024 * 1024 + 1))).toMatchObject({ ok: false, motivo: 'demasiado-grande' })
    await expect(g.guardar('p', '../fuera.txt', 'x')).rejects.toThrow(/sale del proyecto/)
  })
})

describe('crear, renombrar y borrar', () => {
  it('crea archivos y carpetas (con padres), sin pisar lo que existe', async () => {
    await g.crear('p', 'src/nuevo/uno.ts', 'archivo')
    await g.crear('p', 'docs/guias', 'carpeta')
    expect(await readFile(join(dir, 'src/nuevo/uno.ts'), 'utf8')).toBe('')
    expect((await stat(join(dir, 'docs/guias'))).isDirectory()).toBe(true)
    await expect(g.crear('p', 'README.md', 'archivo')).rejects.toThrow(/ya existe/)
    await expect(g.crear('p', '.git/x', 'archivo')).rejects.toThrow(/metadatos de git/)
    await expect(g.crear('p', '../x', 'archivo')).rejects.toThrow(/sale del proyecto/)
    await expect(g.crear('p', '', 'archivo')).rejects.toThrow(/no válido/)
  })
  it('renombra y mueve, sin pisar ni tocar la raíz ni zonas protegidas', async () => {
    await g.renombrar('p', 'alfa.txt', 'src/beta.txt')
    expect(await readFile(join(dir, 'src/beta.txt'), 'utf8')).toBe('a')
    await expect(g.renombrar('p', 'Zeta.txt', 'README.md')).rejects.toThrow(/ya existe/)
    await expect(g.renombrar('p', '', 'otra')).rejects.toThrow()
    await expect(g.renombrar('p', 'README.md', '.git/README.md')).rejects.toThrow(/git/)
    await expect(g.renombrar('p', 'README.md', '../README.md')).rejects.toThrow(/sale del proyecto/)
  })
  it('borrar manda a la papelera (nunca la raíz ni .git)', async () => {
    await g.borrar('p', 'src/util/b.ts')
    expect(papelera).toEqual([join(dir, 'src/util/b.ts')])
    await expect(g.borrar('p', '')).rejects.toThrow(/raíz/)
    await expect(g.borrar('p', '.git/HEAD')).rejects.toThrow(/git/)
    await expect(g.borrar('p', '../x')).rejects.toThrow(/sale del proyecto/)
    expect(papelera).toHaveLength(1)
  })
})

describe('estadoGit', () => {
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  it('marca modificados, añadidos, borrados, renombrados y sin seguimiento; vacío si no es repo', async () => {
    expect(await g.estadoGit('p')).toEqual({})
    await execFileSync('rm', ['-rf', join(dir, '.git')])
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@e.com')
    git('config', 'user.name', 'T')
    git('add', '-A')
    git('commit', '-q', '-m', 'i')
    await writeFile(join(dir, 'README.md'), 'cambiado')
    await writeFile(join(dir, 'nuevo.ts'), 'x')
    await mkdir(join(dir, 'carpeta-nueva'))
    await writeFile(join(dir, 'carpeta-nueva/a.ts'), 'x')
    git('mv', 'alfa.txt', 'beta.txt')
    await execFileSync('rm', [join(dir, 'Zeta.txt')])
    const m = await g.estadoGit('p')
    expect(m['README.md']).toBe('M')
    expect(m['nuevo.ts']).toBe('U')
    expect(m['carpeta-nueva']).toBe('U')
    expect(m['beta.txt']).toBe('R')
    expect(m['Zeta.txt']).toBe('D')
    expect(Object.keys(m).some((k) => k.endsWith('alfa.txt'))).toBe(false) // la ruta anterior del renombrado no se cuela como entrada
  })
})

describe('Vigilante', () => {
  it('avisa de los cambios de las carpetas vigiladas (agrupados), ignora temporales y deja de avisar al cerrar', async () => {
    const v = new Vigilante(async () => dir)
    const avisos: CambioArchivo[] = []
    await v.establecer(1, 'p', ['', 'src'], (c) => avisos.push(c))
    await writeFile(join(dir, 'src/index.ts'), 'cambio 1')
    await writeFile(join(dir, 'src/index.ts'), 'cambio 2')
    await vi.waitFor(() => expect(avisos.some((a) => a.carpeta === 'src' && a.nombre === 'index.ts')).toBe(true))
    expect(avisos.filter((a) => a.carpeta === 'src')).toHaveLength(1) // dos escrituras seguidas, un solo aviso
    await writeFile(join(dir, '.x.123.tmp'), 'temporal')
    await writeFile(join(dir, 'visible.txt'), 'v')
    await vi.waitFor(() => expect(avisos.some((a) => a.nombre === 'visible.txt')).toBe(true))
    expect(avisos.some((a) => a.nombre === '.x.123.tmp')).toBe(false)
    // al sustituir el conjunto se cierran las que sobran
    await v.establecer(1, 'p', [''], (c) => avisos.push(c))
    const antes = avisos.length
    await writeFile(join(dir, 'src/util/b.ts'), 'otro')
    await new Promise((r) => setTimeout(r, 400))
    expect(avisos.length).toBe(antes)
    v.cerrar(1)
    await writeFile(join(dir, 'otro.txt'), 'o')
    await new Promise((r) => setTimeout(r, 400))
    expect(avisos.length).toBe(antes)
  })
})
