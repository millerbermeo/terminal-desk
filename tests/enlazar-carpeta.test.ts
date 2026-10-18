import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Proyectos from '../src/main/proyectos'
import { leerVinculo, quitarVinculoLocal, vincularProyectoLocal } from '../src/main/servidor/vinculo'
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
    await expect(proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_OTRO_REPO, repo: 'https://github.com/ana/api.git' })).rejects.toThrow(proyectos.REQUIERE_CONFIRMACION)
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

  it('si el id que trae la carpeta ya no existe en la cuenta (se vació la base), pide confirmación y entonces lo sustituye', async () => {
    const dir = await carpetaGit('id-muerto', 'https://github.com/ana/ya-aqui.git')
    await vincularProyectoLocal(dir, ID_MUERTO)
    await expect(proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_YA_AQUI, repo: 'https://github.com/ana/ya-aqui.git' })).rejects.toThrow(proyectos.REQUIERE_CONFIRMACION)
    expect(await leerVinculo(dir)).toBe(ID_MUERTO) // sin confirmar no se tocó
    await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_YA_AQUI, repo: 'https://github.com/ana/ya-aqui.git', confirmar: true })
    expect(await leerVinculo(dir)).toBe(P_YA_AQUI)
  })

  it('si la carpeta ya trae el MISMO id que el proyecto, es la correcta: se enlaza sin preguntar', async () => {
    const dir = await carpetaGit('mismo-id', 'https://github.com/ana/ajeno.git')
    await vincularProyectoLocal(dir, P_AJENO)
    await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_AJENO, repo: 'https://github.com/ana/ajeno.git' })
    expect(await leerVinculo(dir)).toBe(P_AJENO)
  })

  it('id de otro proyecto vivo + remoto distinto: avisa de todo a la vez al pedir confirmación', async () => {
    const dir = await carpetaGit('doble', 'https://github.com/ana/cualquiera.git')
    await vincularProyectoLocal(dir, ID_MUERTO)
    const e = await proyectos.enlazarCarpetaExistente({ ruta: dir, proyectoId: P_OTRO_REPO, repo: 'https://github.com/ana/api.git' }).catch((x: Error) => x)
    expect((e as Error).message).toMatch(/ya no existe en tu cuenta/)
    expect((e as Error).message).toMatch(/apunta a «ana\/cualquiera»/)
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

const existe = (r: string): Promise<boolean> => stat(r).then(() => true, () => false)

describe('cambiar la carpeta de un proyecto (te equivocaste al enlazarlo)', () => {
  const P_CAMBIO = id(10)
  beforeAll(() => void srv.proyectos.push({ id: P_CAMBIO, nombre: 'Cambio', ruta: '', repo: 'https://github.com/ana/cambio.git' }))

  it('enlaza la carpeta correcta y borra el .odesk de la equivocada (si es suyo y no está en git)', async () => {
    const mala = await carpetaGit('cambio-mala', 'https://github.com/ana/cambio.git')
    const buena = await carpetaGit('cambio-buena', 'https://github.com/ana/cambio.git')
    await proyectos.enlazarCarpetaExistente({ ruta: mala, proyectoId: P_CAMBIO, repo: 'https://github.com/ana/cambio.git' })
    expect(await leerVinculo(mala)).toBe(P_CAMBIO)
    const r = await proyectos.cambiarCarpetaProyecto({ proyectoId: P_CAMBIO, ruta: buena })
    expect(r).toEqual({ ruta: buena })
    expect(await leerVinculo(buena)).toBe(P_CAMBIO)
    expect(await existe(join(mala, '.odesk'))).toBe(false) // ya no apunta al proyecto
    expect((await proyectos.leerProyectos()).proyectos.find((p) => p.id === P_CAMBIO)?.ruta).toBe(buena)
    // la carpeta equivocada vuelve a estar libre para otro proyecto
    expect(await leerVinculo(mala)).toBeUndefined()
  })

  it('si el .odesk de la carpeta anterior está subido a git, no lo borra y lo avisa', async () => {
    const vieja = (await proyectos.leerProyectos()).proyectos.find((p) => p.id === P_CAMBIO)!.ruta
    execFileSync('git', ['add', '-A'], { cwd: vieja })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'enlace'], { cwd: vieja })
    const nueva = await carpetaGit('cambio-tercera', 'https://github.com/ana/cambio.git')
    const r = await proyectos.cambiarCarpetaProyecto({ proyectoId: P_CAMBIO, ruta: nueva })
    expect(r.aviso).toMatch(/subido a git.*git rm/)
    expect(await leerVinculo(vieja)).toBe(P_CAMBIO) // se dejó como estaba
    expect((await proyectos.leerProyectos()).proyectos.find((p) => p.id === P_CAMBIO)?.ruta).toBe(nueva)
  })

  it('rechaza la misma carpeta, un proyecto que no está en este equipo y una carpeta enlazada a otro proyecto vivo', async () => {
    const actual = (await proyectos.leerProyectos()).proyectos.find((p) => p.id === P_CAMBIO)!.ruta
    await expect(proyectos.cambiarCarpetaProyecto({ proyectoId: P_CAMBIO, ruta: actual })).rejects.toThrow(/ya es la carpeta/)
    await expect(proyectos.cambiarCarpetaProyecto({ proyectoId: id(77), ruta: actual })).rejects.toThrow(/no está en este equipo/)
    const ajena = await carpetaGit('cambio-ajena', 'https://github.com/ana/cambio.git')
    await vincularProyectoLocal(ajena, P_DUENO)
    await expect(proyectos.cambiarCarpetaProyecto({ proyectoId: P_CAMBIO, ruta: ajena })).rejects.toThrow(/otro proyecto de tu cuenta.*Dueño/)
    expect((await proyectos.leerProyectos()).proyectos.find((p) => p.id === P_CAMBIO)?.ruta).toBe(actual) // no cambió nada
  })
})

describe('quitarVinculoLocal', () => {
  it('solo borra el enlace si es de ese proyecto y no está versionado; devuelve qué pasó', async () => {
    const dir = await carpetaGit('quitar')
    expect(await quitarVinculoLocal(dir, P_OK)).toBe('sin-enlace')
    await vincularProyectoLocal(dir, P_OK)
    expect(await quitarVinculoLocal(dir, P_DUENO)).toBe('otro-proyecto')
    expect(await existe(join(dir, '.odesk', 'project.json'))).toBe(true)
    expect(await quitarVinculoLocal(dir, P_OK)).toBe('quitado')
    expect(await existe(join(dir, '.odesk'))).toBe(false)
  })
})
