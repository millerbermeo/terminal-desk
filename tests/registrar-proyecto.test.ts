import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Proyectos from '../src/main/proyectos'
import { vincularProyectoLocal } from '../src/main/servidor/vinculo'
import { ServidorFalso } from './servidor-falso'

const ANTIGUO = '1a2b3c4d-0000-4000-8000-000000000001'
const RECIENTE = '1a2b3c4d-0000-4000-8000-000000000002'

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
    { id: RECIENTE, nombre: 'Reciente', ruta: join(casa, 'reciente') }
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
})
