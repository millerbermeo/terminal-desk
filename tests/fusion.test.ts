import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { contarConflictos, fusion3, textoFusionado, type Decision } from '@shared/fusion'
import { Repositorio } from '../src/main/core/git/repositorio'

const L = (...l: string[]): string => l.join('\n')

describe('fusion3', () => {
  it('sin cambios en ninguna rama todo es común', () => {
    expect(fusion3(L('a', 'b'), L('a', 'b'), L('a', 'b'))).toEqual([{ tipo: 'comun', lineas: ['a', 'b'] }])
  })
  it('cambios en sitios distintos se integran solos', () => {
    const base = L('1', '2', '3', '4', '5', '6', '7')
    const t = fusion3(base, L('1', 'A', '3', '4', '5', '6', '7'), L('1', '2', '3', '4', '5', 'B', '7'))
    expect(contarConflictos(t)).toBe(0)
    expect(textoFusionado(t, new Map())).toBe(L('1', 'A', '3', '4', '5', 'B', '7'))
  })
  it('el mismo cambio en las dos ramas no es conflicto', () => {
    const t = fusion3(L('a', 'b', 'c'), L('a', 'X', 'c'), L('a', 'X', 'c'))
    expect(contarConflictos(t)).toBe(0)
    expect(t.some((x) => x.tipo === 'auto' && x.de === 'ambos')).toBe(true)
  })
  it('cambios distintos en la misma línea son un conflicto que se resuelve eligiendo', () => {
    const t = fusion3(L('a', 'b', 'c'), L('a', 'MIO', 'c'), L('a', 'SUYO', 'c'))
    expect(contarConflictos(t)).toBe(1)
    const i = t.findIndex((x) => x.tipo === 'conflicto')
    const con = (d: Decision): string => textoFusionado(t, new Map([[i, d]]))
    expect(con('actual')).toBe(L('a', 'MIO', 'c'))
    expect(con('origen')).toBe(L('a', 'SUYO', 'c'))
    expect(con('base')).toBe(L('a', 'b', 'c'))
    expect(con('actual-origen')).toBe(L('a', 'MIO', 'SUYO', 'c'))
    expect(con('origen-actual')).toBe(L('a', 'SUYO', 'MIO', 'c'))
    expect(con({ texto: 'a mano' })).toBe(L('a', 'a mano', 'c'))
  })
  it('borrar en una rama y editar en otra es conflicto; añadir en el mismo punto también', () => {
    expect(contarConflictos(fusion3(L('a', 'b', 'c'), L('a', 'c'), L('a', 'B', 'c')))).toBe(1)
    expect(contarConflictos(fusion3(L('a', 'c'), L('a', 'x', 'c'), L('a', 'y', 'c')))).toBe(1)
  })
  it('un archivo nuevo en una rama (base vacía) se integra', () => {
    const t = fusion3('', '', L('hola', 'mundo'))
    expect(contarConflictos(t)).toBe(0)
    expect(textoFusionado(t, new Map())).toBe(L('hola', 'mundo'))
  })
})

beforeAll(async () => {
  const casa = await mkdtemp(join(tmpdir(), 'fusion-casa-'))
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env } }).trim()
const poner = async (dir: string, f: string, t: string): Promise<void> => {
  await mkdir(join(dir, f, '..'), { recursive: true })
  await writeFile(join(dir, f), t)
}

/** main y «otra» divergen: conflicto en `a.txt`, cambio solo de «otra» en `solo.txt` y cambios que se fusionan solos en `auto.txt`. */
async function repo(): Promise<{ dir: string; r: Repositorio }> {
  const dir = await mkdtemp(join(tmpdir(), 'fusion-'))
  const r = new Repositorio(dir)
  await r.iniciar('main')
  sh(dir, 'config', 'user.name', 'T')
  sh(dir, 'config', 'user.email', 't@t')
  await poner(dir, 'a.txt', L('uno', 'dos', 'tres'))
  await poner(dir, 'auto.txt', L('1', '2', '3', '4', '5', '6', '7'))
  await poner(dir, 'solo.txt', 'x\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-m', 'base')
  sh(dir, 'checkout', '-q', '-b', 'otra')
  await poner(dir, 'a.txt', L('uno', 'SUYO', 'tres'))
  await poner(dir, 'auto.txt', L('1', '2', '3', '4', '5', 'B', '7'))
  await poner(dir, 'solo.txt', 'y\n')
  await poner(dir, 'nuevo.txt', 'nuevo\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-m', 'otra')
  sh(dir, 'checkout', '-q', 'main')
  await poner(dir, 'a.txt', L('uno', 'MIO', 'tres'))
  await poner(dir, 'auto.txt', L('1', 'A', '3', '4', '5', '6', '7'))
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-m', 'main')
  return { dir, r }
}

describe('fusión asistida (git real)', () => {
  it('la vista previa clasifica los archivos sin tocar nada', async () => {
    const { dir, r } = await repo()
    const p = await r.fusionPrevia('otra')
    expect(p).toMatchObject({ actual: 'main', origen: 'otra', commits: 1 })
    const por = Object.fromEntries(p.archivos.map((a) => [a.ruta, a]))
    expect(por['a.txt']).toMatchObject({ estado: 'conflicto', conflictos: 1 })
    expect(por['auto.txt']).toMatchObject({ estado: 'ambos', conflictos: 0 })
    expect(por['solo.txt']).toMatchObject({ estado: 'origen' })
    expect(por['nuevo.txt']).toMatchObject({ estado: 'origen', enOrigen: 'A' })
    expect(sh(dir, 'status', '--porcelain')).toBe('')
    expect(await r.fusionArchivo('otra', 'a.txt')).toMatchObject({ actual: L('uno', 'MIO', 'tres'), origen: L('uno', 'SUYO', 'tres'), base: L('uno', 'dos', 'tres') })
  })

  it('aplica la resolución elegida y crea el commit de fusión', async () => {
    const { dir, r } = await repo()
    const res = await r.fusionAplicar('otra', { 'a.txt': { tipo: 'texto', texto: L('uno', 'MIO y SUYO', 'tres') } })
    expect(res.hash).toBeTruthy()
    expect(res.estado.operacion).toBeUndefined()
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe(L('uno', 'MIO y SUYO', 'tres'))
    expect(await readFile(join(dir, 'auto.txt'), 'utf8')).toBe(L('1', 'A', '3', '4', '5', 'B', '7'))
    expect(await readFile(join(dir, 'solo.txt'), 'utf8')).toBe('y\n')
    expect(sh(dir, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3) // commit de fusión: dos padres
    expect(sh(dir, 'log', '-1', '--format=%s')).toBe("Merge branch 'otra' into main")
  })

  it('«versión entera» de una rama y sin confirmar deja la fusión lista para el commit', async () => {
    const { dir, r } = await repo()
    const res = await r.fusionAplicar('otra', { 'a.txt': { tipo: 'origen' } }, undefined, false)
    expect(res.hash).toBeUndefined()
    expect(res.estado.operacion).toBe('fusion')
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe(L('uno', 'SUYO', 'tres'))
  })

  it('si falta resolver un conflicto no se toca nada', async () => {
    const { dir, r } = await repo()
    await expect(r.fusionAplicar('otra', {})).rejects.toThrow(/a\.txt/)
    expect(sh(dir, 'status', '--porcelain')).toBe('')
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe(L('uno', 'MIO', 'tres'))
  })

  it('rechaza cambios sin confirmar, la misma rama y rutas fuera del repositorio', async () => {
    const { dir, r } = await repo()
    await expect(r.fusionPrevia('main')).rejects.toThrow(/consigo misma/)
    await expect(r.fusionPrevia('no-existe')).rejects.toThrow(/No existe/)
    await expect(r.fusionArchivo('otra', '../x')).rejects.toThrow(/salir/)
    await expect(r.fusionAplicar('otra', { '../x': { tipo: 'texto', texto: 'x' } })).rejects.toThrow(/salir/)
    await poner(dir, 'a.txt', 'sucio')
    await expect(r.fusionAplicar('otra', { 'a.txt': { tipo: 'actual' } })).rejects.toThrow(/sin confirmar/)
  })
})
