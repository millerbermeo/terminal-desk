import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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
const ESTE_PC = '9a9a9a9a-0000-4000-8000-000000000001'
const OTRO_PC = '9a9a9a9a-0000-4000-8000-000000000002'

let srv: ServidorFalso
let proyectos: typeof Proyectos
let casa: string

beforeAll(async () => {
  casa = await mkdtemp(join(tmpdir(), 'home-modo-'))
  vi.stubEnv('HOME', casa)
  for (const d of ['motos', 'cobros', 'suelto', 'nuevo', 'antiguo']) await mkdir(join(casa, d))
  srv = await new ServidorFalso([
    { id: MOTOS, nombre: 'Motos', ruta: join(casa, 'motos'), grupo: GRUPO },
    { id: COBROS, nombre: 'Cobros', ruta: join(casa, 'cobros'), grupo: GRUPO },
    { id: SUELTO, nombre: 'Suelto', ruta: join(casa, 'suelto') }
  ]).iniciar()
  srv.grupos.push({ id: GRUPO, nombre: 'German Dev' })
  srv.apuntar()
  proyectos = await import('../src/main/proyectos')
  proyectos.fijarEquipoActual(async () => ESTE_PC)
  await srv.entrar()
  await vincularProyectoLocal(join(casa, 'motos'), MOTOS)
})
afterAll(() => srv.cerrar())

describe('cambiarModo: grupo local / remoto (mismo id, solo cambia quién lo ve)', () => {
  it('a local: el grupo y sus proyectos quedan atados a este equipo con el MISMO id y se suelta el enlace', async () => {
    const r = await proyectos.cambiarModo(GRUPO, 'local')
    expect(r.proyectos).toEqual([]) // nada cambia de id
    expect(srv.grupos.find((g) => g.id === GRUPO)?.equipo).toBe(ESTE_PC)
    expect(srv.proyectos.filter((p) => p.equipo === ESTE_PC).map((p) => p.id).sort()).toEqual([COBROS, MOTOS].sort())
    expect(r.datos.grupos.find((g) => g.id === GRUPO)?.local).toBe(true)
    expect(r.datos.proyectos.filter((p) => p.grupo === GRUPO).every((p) => p.local)).toBe(true)
    expect(await leerVinculo(join(casa, 'motos'))).toBeUndefined()
    expect(existsSync(join(casa, 'motos', '.odesk', 'project.json'))).toBe(false)
  })

  it('otro equipo de la misma cuenta no ve lo local', async () => {
    proyectos.fijarEquipoActual(async () => OTRO_PC)
    try {
      expect((await proyectos.proyectosSinCarpeta()).map((p) => p.id)).not.toContain(MOTOS)
      const peticion = srv.peticiones.filter((x) => x.startsWith('GET /projects?')).at(-1)
      expect(peticion).toContain(`device=${OTRO_PC}`)
    } finally {
      proyectos.fijarEquipoActual(async () => ESTE_PC)
    }
  })

  it('un proyecto de la cuenta no entra en un grupo local', async () => {
    await expect(proyectos.moverProyectoAGrupo(SUELTO, GRUPO)).rejects.toThrow(/local/)
  })

  it('a remoto: vuelve a la cuenta con el mismo id y su enlace', async () => {
    const r = await proyectos.cambiarModo(GRUPO, 'remoto')
    expect(r.proyectos).toEqual([])
    expect(srv.grupos.find((g) => g.id === GRUPO)?.equipo).toBeUndefined()
    expect(srv.proyectos.filter((p) => p.grupo === GRUPO).every((p) => !p.equipo)).toBe(true)
    expect(r.datos.grupos.some((g) => g.local)).toBe(false)
    expect(await leerVinculo(join(casa, 'motos'))).toBe(MOTOS)
  })

  it('sin grupo: pasa a local y vuelve a remoto', async () => {
    const a = await proyectos.cambiarModo(null, 'local')
    expect(srv.proyectos.find((p) => p.id === SUELTO)?.equipo).toBe(ESTE_PC)
    expect(a.datos.proyectos.find((p) => p.id === SUELTO)?.local).toBe(true)
    const b = await proyectos.cambiarModo(null, 'remoto')
    expect(b.datos.proyectos.find((p) => p.id === SUELTO)?.local).toBeUndefined()
    expect(srv.proyectos.find((p) => p.id === SUELTO)?.equipo).toBeUndefined()
  })

  it('no pasa a local un grupo con proyectos de la cuenta sin carpeta aquí', async () => {
    srv.proyectos.push({ id: FUERA, nombre: 'En otro equipo', ruta: '', grupo: GRUPO })
    await expect(proyectos.cambiarModo(GRUPO, 'local')).rejects.toThrow(/sin carpeta en este equipo/)
    expect(srv.grupos.find((x) => x.id === GRUPO)?.equipo).toBeUndefined()
    srv.proyectos.splice(srv.proyectos.findIndex((p) => p.id === FUERA), 1)
  })
})

describe('agregar como local', () => {
  it('se registra en la cuenta atado a este equipo (con grupo local nuevo) y sin .odesk/project.json', async () => {
    const r = await proyectos.agregarProyectos({ modo: 'local', grupoNuevo: 'Pruebas', proyectos: [{ nombre: 'Nuevo', ruta: join(casa, 'nuevo') }] })
    expect(r.errores).toEqual([])
    const p = r.datos.proyectos.find((x) => x.nombre === 'Nuevo')!
    expect(p.local).toBe(true)
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/) // UUID de la cuenta: agentes y skills funcionan
    expect(srv.proyectos.find((x) => x.id === p.id)?.equipo).toBe(ESTE_PC)
    expect(r.datos.grupos.find((g) => g.id === p.grupo)).toMatchObject({ nombre: 'Pruebas', local: true })
    expect(existsSync(join(casa, 'nuevo', '.odesk', 'project.json'))).toBe(false)
  })
})

describe('migración de los locales antiguos (local-…)', () => {
  it('sube proyecto y grupo antiguos atados a este equipo y devuelve los ids para reasignar', async () => {
    const dir = join(casa, '.odesk-agent')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'proyectos-locales.json'),
      JSON.stringify({ version: 2, grupos: [{ id: 'local-g1', nombre: 'Viejo' }], proyectos: [{ id: 'local-p1', nombre: 'Antiguo', ruta: join(casa, 'antiguo'), grupo: 'local-g1' }] })
    )
    proyectos.olvidarProyectos()
    expect((await proyectos.leerProyectos()).proyectos.some((p) => p.id === 'local-p1')).toBe(true) // se ve mientras no se sube
    const r = await proyectos.migrarProyectosLocales()
    expect(r.proyectos).toHaveLength(1)
    expect(r.grupos).toHaveLength(1)
    const datos = await proyectos.leerProyectos()
    const p = datos.proyectos.find((x) => x.nombre === 'Antiguo')!
    expect(p.id).toBe(r.proyectos[0]!.nuevo)
    expect(p).toMatchObject({ local: true, grupo: r.grupos[0]!.nuevo, ruta: join(casa, 'antiguo') })
    expect(srv.proyectos.find((x) => x.id === p.id)?.equipo).toBe(ESTE_PC)
    expect(datos.proyectos.some((x) => x.id.startsWith('local-'))).toBe(false)
    expect((await proyectos.migrarProyectosLocales()).proyectos).toEqual([]) // idempotente
  })
})
