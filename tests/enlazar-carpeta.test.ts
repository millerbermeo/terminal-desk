import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Proyectos from '../src/main/proyectos'
import { leerVinculo, vincularProyectoLocal } from '../src/main/servidor/vinculo'
import { ServidorFalso } from './servidor-falso'

const id = (n: number): string => `2b3c4d5e-0000-4000-8000-${String(n).padStart(12, '0')}`
const P_OK = id(1)
const P_OTRO_REPO = id(2)
const P_AJENO = id(3)
const P_DUENO = id(4)
const P_YA_AQUI = id(5)
const P_NUEVO = id(6)
const ID_MUERTO = id(99) // un id que ya no existe en la cuenta (p. ej. se vació la base)

let srv: ServidorFalso
let proyectos: typeof Proyectos
let casa: string

async function carpetaGit(nombre: string, origen?: string): Promise<string> {
  const dir = join(casa, nombre)
  await mkdir(dir)
  if (origen) {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', origen], { cwd: dir })
  }
  return dir
}

beforeAll(async () => {
  casa = await mkdtemp(join(tmpdir(), 'home-enlazar-'))
  vi.stubEnv('HOME', casa)
  srv = await new ServidorFalso([
    { id: P_OK, nombre: 'Web', ruta: '', repo: 'git@github-ana:Ana/Web.git' },
    { id: P_OTRO_REPO, nombre: 'Api', ruta: '', repo: 'https://github.com/ana/api.git' },
    { id: P_AJENO, nombre: 'Ajeno', ruta: '', repo: 'https://github.com/ana/ajeno.git' },
    { id: P_DUENO, nombre: 'Dueño', ruta: '', repo: 'https://github.com/ana/dueno.git' },
    { id: P_YA_AQUI, nombre: 'Ya aquí', ruta: '', repo: 'https://github.com/ana/ya-aqui.git' },
    { id: P_NUEVO, nombre: 'Nuevo', ruta: '', repo: 'https://github.com/ana/nuevo.git' }
  ]).iniciar()
  srv.apuntar()
  proyectos = await import('../src/main/proyectos')
  await srv.entrar()
})
afterAll(() => srv.cerrar())

describe('enlazar una carpeta que ya existe con un proyecto de la cuenta (sin clonar)', () => {
  it('enlaza: escribe .odesk/project.json con el id, lo registra en este equipo y deja de estar «pendiente»', async () => {
    const dir = await carpetaGit('web', 'https://github.com/ana/web.git')
    expect((await proyectos.proyectosSinCarpeta()).map((p) => p.id)).toContain(P_OK)
    const r = await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_OK, repo: 'git@github-ana:Ana/Web.git' })
    expect(r.ruta).toBe(dir)
    expect(await leerVinculo(dir)).toBe(P_OK)
    expect(JSON.parse(await readFile(join(dir, '.odesk', 'project.json'), 'utf8'))).toEqual({ projectId: P_OK })
    expect((await proyectos.leerProyectos()).proyectos.find((p) => p.id === P_OK)?.ruta).toBe(dir)
    expect((await proyectos.proyectosSinCarpeta()).map((p) => p.id)).not.toContain(P_OK)
  })

  it('si el remoto de la carpeta es otro repositorio, no enlaza hasta que se confirme', async () => {
    const dir = await carpetaGit('otra-cosa', 'https://github.com/ana/otra-cosa.git')
    await expect(proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_OTRO_REPO, repo: 'https://github.com/ana/api.git' })).rejects.toThrow(proyectos.REPO_DISTINTO)
    expect(await leerVinculo(dir)).toBeUndefined() // no se escribió nada
    const r = await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_OTRO_REPO, repo: 'https://github.com/ana/api.git', confirmar: true })
    expect(r.ruta).toBe(dir)
    expect(await leerVinculo(dir)).toBe(P_OTRO_REPO)
  })

  it('una carpeta sin git (o sin remoto) se enlaza sin preguntar', async () => {
    const dir = await carpetaGit('sin-git')
    await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_NUEVO, repo: 'https://github.com/ana/nuevo.git' })
    expect(await leerVinculo(dir)).toBe(P_NUEVO)
  })

  it('no enlaza una carpeta que ya está enlazada a OTRO proyecto vivo de la cuenta', async () => {
    const dir = await carpetaGit('de-otro', 'https://github.com/ana/ajeno.git')
    await vincularProyectoLocal(dir, P_DUENO) // el repo trae el enlace de «Dueño», que existe en la cuenta
    await expect(proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_AJENO, repo: 'https://github.com/ana/ajeno.git' })).rejects.toThrow(/ya está enlazada a otro proyecto.*Dueño/)
    expect(await leerVinculo(dir)).toBe(P_DUENO) // sigue como estaba
  })

  it('si el id que trae la carpeta ya no existe en la cuenta (se vació la base), se sustituye', async () => {
    const dir = await carpetaGit('id-muerto', 'https://github.com/ana/ya-aqui.git')
    await vincularProyectoLocal(dir, ID_MUERTO)
    await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_YA_AQUI, repo: 'https://github.com/ana/ya-aqui.git' })
    expect(await leerVinculo(dir)).toBe(P_YA_AQUI)
  })

  it('rechaza una carpeta que no existe, un archivo y una carpeta que ya es otro proyecto de este equipo', async () => {
    await expect(proyectos.enlazarCarpetaExistente({ ruta: join(casa, 'no-existe'), proyectoId: P_AJENO })).rejects.toThrow(/no existe/i)
    const ocupada = join(casa, 'web') // ya enlazada a «Web» en el primer test
    await expect(proyectos.enlazarCarpetaExistente({ ruta: ocupada, proyectoId: P_AJENO })).rejects.toThrow(/Ya agregado como «Web»/)
  })

  it('un proyecto que no es de la cuenta no se puede enlazar (404 del servidor)', async () => {
    const dir = await carpetaGit('sin-proyecto')
    await expect(proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: ID_MUERTO })).rejects.toThrow()
    expect(await leerVinculo(dir)).toBeUndefined()
  })
})
