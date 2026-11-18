import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Proyectos from '../src/main/proyectos'
import { leerVinculo, vincularProyectoLocal } from '../src/main/servidor/vinculo'
import { ServidorFalso } from './servidor-falso'

const GRUPO = '2b3c4d5e-0000-4000-8000-000000000001'
const MOTOS = '2b3c4d5e-0000-4000-8000-000000000002'
const COBROS = '2b3c4d5e-0000-4000-8000-000000000003'
const SUELTO = '2b3c4d5e-0000-4000-8000-000000000004'
const FUERA = '2b3c4d5e-0000-4000-8000-000000000005'

let srv: ServidorFalso
let proyectos: typeof Proyectos
let casa: string

beforeAll(async () => {
  casa = await mkdtemp(join(tmpdir(), 'home-modo-'))
  vi.stubEnv('HOME', casa)
  for (const d of ['motos', 'cobros', 'suelto']) await mkdir(join(casa, d))
  srv = await new ServidorFalso([
    { id: MOTOS, nombre: 'Motos', ruta: join(casa, 'motos'), grupo: GRUPO },
    { id: COBROS, nombre: 'Cobros', ruta: join(casa, 'cobros'), grupo: GRUPO },
    { id: SUELTO, nombre: 'Suelto', ruta: join(casa, 'suelto') }
  ]).iniciar()
  srv.grupos.push({ id: GRUPO, nombre: 'German Dev' })
  srv.apuntar()
  proyectos = await import('../src/main/proyectos')
  await srv.entrar()
  await vincularProyectoLocal(join(casa, 'motos'), MOTOS)
})
afterAll(() => srv.cerrar())

describe('cambiarModo: grupo local / remoto', () => {
  it('a local: borra proyectos y grupo de la cuenta, los deja en este equipo con id local- y suelta el enlace', async () => {
    const r = await proyectos.cambiarModo(GRUPO, 'local')
    expect(srv.grupos).toEqual([])
    expect(srv.proyectos.map((p) => p.id)).toEqual([SUELTO])
    expect(r.proyectos.map((c) => c.viejo).sort()).toEqual([COBROS, MOTOS].sort())
    expect(r.grupo?.viejo).toBe(GRUPO)
    const g = r.datos.grupos.find((x) => x.nombre === 'German Dev')!
    expect(g.local).toBe(true)
    expect(r.datos.proyectos.filter((p) => p.grupo === g.id).every((p) => p.local && p.id.startsWith('local-'))).toBe(true)
    expect(await leerVinculo(join(casa, 'motos'))).toBeUndefined()
    expect(existsSync(join(casa, 'motos', '.odesk', 'project.json'))).toBe(false)
  })

  it('un proyecto de la cuenta no entra en un grupo local', async () => {
    const g = (await proyectos.leerProyectos()).grupos.find((x) => x.local)!
    await expect(proyectos.moverProyectoAGrupo(SUELTO, g.id)).rejects.toThrow(/local/)
  })

  it('a remoto: crea el grupo en la cuenta, registra los proyectos con su enlace y quita el grupo local', async () => {
    const local = (await proyectos.leerProyectos()).grupos.find((x) => x.local)!
    const r = await proyectos.cambiarModo(local.id, 'remoto')
    expect(srv.grupos.map((g) => g.nombre)).toEqual(['German Dev'])
    const nuevo = srv.grupos[0]!.id
    expect(r.grupo).toEqual({ viejo: local.id, nuevo })
    expect(srv.proyectos.filter((p) => p.grupo === nuevo).map((p) => p.nombre).sort()).toEqual(['Cobros', 'Motos'])
    expect(r.datos.grupos.some((g) => g.local)).toBe(false)
    expect(r.datos.proyectos.every((p) => !p.local)).toBe(true)
    const motos = r.datos.proyectos.find((p) => p.nombre === 'Motos')!
    expect(await leerVinculo(join(casa, 'motos'))).toBe(motos.id)
  })

  it('sin grupo: pasa a local y vuelve a remoto', async () => {
    const a = await proyectos.cambiarModo(null, 'local')
    expect(srv.proyectos.some((p) => p.id === SUELTO)).toBe(false)
    expect(a.datos.proyectos.find((p) => p.nombre === 'Suelto')?.local).toBe(true)
    const b = await proyectos.cambiarModo(null, 'remoto')
    expect(b.datos.proyectos.find((p) => p.nombre === 'Suelto')?.local).toBeUndefined()
    expect(srv.proyectos.some((p) => p.nombre === 'Suelto' && !p.grupo)).toBe(true)
  })

  it('no pasa a local un grupo con proyectos de la cuenta sin carpeta aquí', async () => {
    const g = srv.grupos[0]!.id
    srv.proyectos.push({ id: FUERA, nombre: 'En otro equipo', ruta: '', grupo: g })
    await expect(proyectos.cambiarModo(g, 'local')).rejects.toThrow(/sin carpeta en este equipo/)
    expect(srv.grupos.some((x) => x.id === g)).toBe(true)
  })
})
