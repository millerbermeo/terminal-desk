import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Proyectos from '../src/main/proyectos'
import { leerVinculo, vincularProyectoLocal } from '../src/main/servidor/vinculo'
import { ServidorFalso } from './servidor-falso'

const ANTIGUO = '1a2b3c4d-0000-4000-8000-000000000001'
const RECIENTE = '1a2b3c4d-0000-4000-8000-000000000002'
const POR_REPO = '1a2b3c4d-0000-4000-8000-000000000003'
const MONO_A = '1a2b3c4d-0000-4000-8000-000000000004'
const MONO_B = '1a2b3c4d-0000-4000-8000-000000000005'

async function repoGit(nombre: string, origen: string): Promise<string> {
  const dir = join(casa, nombre)
  await mkdir(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', origen], { cwd: dir })
  return dir
}

let srv: ServidorFalso
let proyectos: typeof Proyectos
let casa: string

beforeAll(async () => {
  casa = await mkdtemp(join(tmpdir(), 'home-registrar-'))
  vi.stubEnv('HOME', casa)
  await mkdir(join(casa, 'reciente'))
  // ANTIGUO es de la cuenta pero aún no tiene carpeta en este equipo; RECIENTE (creado después) sí.
  srv = await new ServidorFalso([
    { id: ANTIGUO, nombre: 'Antiguo', ruta: '' },
    { id: RECIENTE, nombre: 'Reciente', ruta: join(casa, 'reciente') },
    { id: POR_REPO, nombre: 'Por repo', ruta: '', repo: 'git@github-ana:Ana/Web.git' },
    { id: MONO_A, nombre: 'Mono A', ruta: '', repo: 'https://github.com/ana/mono.git' },
    { id: MONO_B, nombre: 'Mono B', ruta: '', repo: 'https://github.com/ana/mono' }
  ]).iniciar()
  srv.apuntar()
  proyectos = await import('../src/main/proyectos')
  await srv.entrar()
})
afterAll(() => srv.cerrar())

describe('registrarProyecto (lo usa «Clonar»)', () => {
  it('una carpeta que ya trae .odesk/project.json de un proyecto de la cuenta devuelve ESE proyecto, no el último de la lista', async () => {
    const clonada = join(casa, 'clonada')
    await mkdir(clonada)
    await vincularProyectoLocal(clonada, ANTIGUO) // el repo trae el enlace subido a git desde otro equipo
    const r = await proyectos.registrarProyecto(clonada, 'antiguo')
    expect(r.id).toBe(ANTIGUO)
    expect((await proyectos.leerProyectos()).proyectos.find((p) => p.id === ANTIGUO)?.ruta).toBe(clonada)
  })

  it('una carpeta nueva registra un proyecto nuevo y devuelve su id', async () => {
    const nueva = join(casa, 'nueva')
    await mkdir(nueva)
    const r = await proyectos.registrarProyecto(nueva, 'Nueva')
    expect([ANTIGUO, RECIENTE]).not.toContain(r.id)
    expect((await proyectos.leerProyectos()).proyectos.find((p) => p.id === r.id)?.ruta).toBe(nueva)
  })

  it('sin .odesk/project.json, un remoto que coincide con un proyecto de la cuenta lo reanuda (aunque el alias SSH o el .git difieran) y deja el enlace escrito', async () => {
    const dir = await repoGit('por-repo', 'https://github.com/ana/web.git')
    const r = await proyectos.registrarProyecto(dir, 'Web')
    expect(r.id).toBe(POR_REPO)
    expect(await leerVinculo(dir)).toBe(POR_REPO)
  })

  it('si el proyecto con ese repo ya tiene carpeta en este equipo, no se reutiliza: se crea uno nuevo', async () => {
    const otra = await repoGit('por-repo-2', 'git@github.com:ana/web.git')
    const r = await proyectos.registrarProyecto(otra, 'Web 2')
    expect(r.id).not.toBe(POR_REPO)
  })

  it('con varios proyectos del mismo repo (monorepo) no adivina: crea uno nuevo', async () => {
    const dir = await repoGit('mono', 'https://github.com/ana/mono.git')
    const r = await proyectos.registrarProyecto(dir, 'Mono')
    expect([MONO_A, MONO_B]).not.toContain(r.id)
  })
})

describe('claveRepo', () => {
  it('iguala https, ssh y alias SSH del mismo repositorio', () => {
    const k = 'ana/web'
    for (const u of ['https://github.com/Ana/Web.git', 'git@github.com:ana/web.git', 'git@github-miller:ana/web', 'ssh://git@github.com/ana/web.git/', 'https://github.com/ana/web']) expect(proyectos.claveRepo(u), u).toBe(k)
    expect(proyectos.claveRepo('')).toBeUndefined()
    expect(proyectos.claveRepo('solo-un-nombre')).toBeUndefined()
  })
})
