import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAVE_AJUSTES, limpiarAjustes } from '../src/shared/ajustes'
import type * as AjustesMod from '../src/main/ajustes'
import { FuenteArchivos, SincronizadorCuenta, FuenteTareas } from '../src/main/servidor/sync-cuenta'

const P1 = '1a2b3c4d-0000-4000-8000-000000000001'

describe('ajustes del Asistente: validación', () => {
  it('solo acepta «global» o un UUID como clave', () => {
    expect(CLAVE_AJUSTES.test('global')).toBe(true)
    expect(CLAVE_AJUSTES.test(P1)).toBe(true)
    for (const m of ['', '../x', 'proyecto', `${P1}/x`, 'global.json']) expect(CLAVE_AJUSTES.test(m), m).toBe(false)
  })
  it('limpia lo que no es válido', () => {
    expect(limpiarAjustes({ modelo: 'claude-sonnet-5-5', autonomia: 'ediciones', otro: 1 })).toEqual({ modelo: 'claude-sonnet-5-5', autonomia: 'ediciones' })
    expect(limpiarAjustes({ modelo: 5, autonomia: 'loca' })).toEqual({})
    expect(limpiarAjustes({ modelo: 'x'.repeat(101) })).toEqual({})
    expect(limpiarAjustes(null)).toEqual({})
  })
})

describe('ajustes del Asistente: archivo local', () => {
  let ajustes: typeof AjustesMod
  let casa: string
  beforeAll(async () => {
    casa = await mkdtemp(join(tmpdir(), 'home-ajustes-'))
    vi.stubEnv('HOME', casa)
    ajustes = await import('../src/main/ajustes')
  })
  beforeEach(() => undefined)

  it('lee vacío al principio y guarda solo los campos dados; null vuelve al valor por defecto', async () => {
    expect(await ajustes.leerAjustes(P1)).toEqual({})
    expect(await ajustes.fijarAjustes(P1, { modelo: 'claude-opus-5-5' })).toEqual({ modelo: 'claude-opus-5-5' })
    expect(await ajustes.fijarAjustes(P1, { autonomia: 'ediciones' })).toEqual({ modelo: 'claude-opus-5-5', autonomia: 'ediciones' })
    expect(await ajustes.fijarAjustes(P1, { modelo: null })).toEqual({ autonomia: 'ediciones' })
    expect(JSON.parse(await readFile(join(casa, '.odesk-agent', 'ajustes', `${P1}.json`), 'utf8'))).toEqual({ autonomia: 'ediciones' })
  })
  it('cada proyecto tiene los suyos y «global» aparte', async () => {
    await ajustes.fijarAjustes('global', { autonomia: 'preguntar', modelo: 'a' })
    expect((await ajustes.leerAjustes('global')).modelo).toBe('a')
    expect((await ajustes.leerAjustes(P1)).modelo).toBeUndefined()
  })
  it('rechaza claves peligrosas y descarta valores inválidos', async () => {
    await expect(ajustes.leerAjustes('../../etc/passwd')).rejects.toThrow('Ajustes')
    await expect(ajustes.fijarAjustes('..', { modelo: 'x' })).rejects.toThrow('Ajustes')
    expect(await ajustes.fijarAjustes(P1, { autonomia: 'loca' })).toEqual({ autonomia: 'ediciones' }) // lo inválido no cambia nada
  })
  it('un archivo corrupto se lee como vacío', async () => {
    const q = '1a2b3c4d-0000-4000-8000-000000000009'
    await ajustes.fijarAjustes(q, { modelo: 'z' })
    await writeFile(join(casa, '.odesk-agent', 'ajustes', `${q}.json`), '{no es json')
    expect(await ajustes.leerAjustes(q)).toEqual({})
  })
})

describe('ajustes del Asistente: sincronización con la cuenta', () => {
  const nube = new Map<string, { data: Record<string, unknown> | null; deleted: boolean; updatedAt: number }>()
  const cliente = {
    get: async () => ({ cursor: Date.now(), docs: [...nube].map(([id, d]) => ({ id, ...d })) }),
    put: async (_r: string, c: { id: string; data: Record<string, unknown>; updatedAt: number }) => (nube.set(c.id, { data: c.data, deleted: false, updatedAt: c.updatedAt }), { aplicado: true }),
    delete: async () => ({ aplicado: true })
  }
  const equipo = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ajustes-eq-'))
    const tareas = { leer: async () => ({ tareas: [], estados: [] }), fusionar: async () => 0, quitarRemotas: async () => 0, fijarEstados: async () => false }
    return { dir, sync: new SincronizadorCuenta(cliente as never, join(dir, 'sync-cuenta.json'), [new FuenteArchivos(dir), new FuenteTareas(tareas)]) }
  }
  const archivo = (dir: string) => join(dir, 'ajustes', `${P1}.json`)
  const escribir = async (dir: string, v: unknown) => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'ajustes'), { recursive: true })
    await writeFile(archivo(dir), JSON.stringify(v))
  }

  it('el modelo y la autonomía de un equipo llegan al otro', async () => {
    nube.clear()
    const a = await equipo()
    const b = await equipo()
    await escribir(a.dir, { modelo: 'claude-sonnet-5-5', autonomia: 'ediciones' })
    await a.sync.sincronizar()
    expect(nube.get(`ajustes/${P1}.json`)?.data).toEqual({ modelo: 'claude-sonnet-5-5', autonomia: 'ediciones' })
    await b.sync.sincronizar()
    expect(JSON.parse(await readFile(archivo(b.dir), 'utf8'))).toEqual({ modelo: 'claude-sonnet-5-5', autonomia: 'ediciones' })
  })

  it('«autónomo» nunca se sube a la cuenta y no pisa al otro equipo', async () => {
    nube.clear()
    const a = await equipo()
    const b = await equipo()
    await escribir(a.dir, { modelo: 'm1', autonomia: 'autonomo' })
    await a.sync.sincronizar()
    expect(nube.get(`ajustes/${P1}.json`)?.data).toEqual({ modelo: 'm1' }) // sin autonomía
    await escribir(b.dir, { autonomia: 'ediciones' })
    await b.sync.sincronizar() // b recibe m1 y conserva lo suyo
    expect(JSON.parse(await readFile(archivo(b.dir), 'utf8'))).toMatchObject({ modelo: 'm1', autonomia: 'ediciones' })
    expect(JSON.parse(await readFile(archivo(a.dir), 'utf8')).autonomia).toBe('autonomo') // a sigue autónomo
  })
})
