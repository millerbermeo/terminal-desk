import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Agentes from '../src/main/agentes'
import type * as Proyectos from '../src/main/proyectos'
import { sugerirPorStack, tecnologiasDe } from '../src/shared/sugerencias-agentes'
import type { Recurso } from '../src/shared/modelos'
import { ServidorFalso } from './servidor-falso'

const COMPARTIDO = '2b3c4d5e-0000-4000-8000-0000000000a1'
let srv: ServidorFalso
let agentes: typeof Agentes
let proyectos: typeof Proyectos
let casa: string
let localId = ''

beforeAll(async () => {
  casa = await mkdtemp(join(tmpdir(), 'home-agentes-'))
  vi.stubEnv('HOME', casa)
  await mkdir(join(casa, 'app'))
  srv = await new ServidorFalso().iniciar()
  srv.recursos.push({ id: COMPARTIDO, kind: 'skill', name: 'laravel-review', description: 'Revisa código Laravel', content: 'x', tools: null, model: null, scope: 'compartido', projectId: null })
  srv.apuntar()
  agentes = await import('../src/main/agentes')
  proyectos = await import('../src/main/proyectos')
  proyectos.fijarEquipoActual(async () => '9a9a9a9a-0000-4000-8000-0000000000e1')
  await srv.entrar()
  const r = await proyectos.agregarProyectos({ modo: 'local', proyectos: [{ nombre: 'App local', ruta: join(casa, 'app') }] })
  localId = (await proyectos.leerProyectos()).proyectos.find((p) => p.nombre === 'App local')!.id
  expect(r.errores).toEqual([])
})
afterAll(() => srv.cerrar())

describe('agentes y skills en proyectos locales', () => {
  it('un proyecto local es de la cuenta (UUID atado a este equipo): usa la biblioteca del servidor como los demás', async () => {
    expect(localId).toMatch(/^[0-9a-f-]{36}$/)
    expect(srv.proyectos.find((p) => p.id === localId)?.equipo).toBe('9a9a9a9a-0000-4000-8000-0000000000e1')
    expect((await agentes.leerBiblioteca()).recursos.map((x) => x.id)).toContain(COMPARTIDO)
  })

  it('(antiguo, id local-…) activar un compartido se guarda en este equipo y no llama al servidor', async () => {
    const antiguo = 'local-antiguo'
    const b = await agentes.activarRecurso({ tipo: 'proyecto', id: antiguo }, COMPARTIDO, true)
    expect(b.activaciones.proyectos[antiguo]).toEqual([COMPARTIDO])
    expect(srv.peticiones.some((x) => x.includes('/agentes/activaciones'))).toBe(false)
    expect(existsSync(join(casa, '.odesk-agent', 'agentes-locales.json'))).toBe(true)
    const b2 = await agentes.activarRecurso({ tipo: 'proyecto', id: antiguo }, COMPARTIDO, false)
    expect(b2.activaciones.proyectos[antiguo]).toBeUndefined()
  })

  it('(antiguo) al subir el proyecto, sus agentes propios y activaciones pasan al servidor con el id nuevo', async () => {
    await writeFile(
      join(casa, '.odesk-agent', 'agentes-locales.json'),
      JSON.stringify({
        recursos: [{ id: 'local-r1', tipo: 'agente', nombre: 'Revisor', descripcion: 'Revisa', contenido: 'Revisa el código', ambito: 'proyecto', proyectoId: 'local-viejo', herramientas: [], modelo: '' }],
        activaciones: { proyectos: { 'local-viejo': [COMPARTIDO] }, grupos: {} }
      })
    )
    await agentes.migrarRecursosLocales([{ viejo: 'local-viejo', nuevo: localId }])
    const b = await agentes.leerBiblioteca()
    const revisor = b.recursos.find((x) => x.nombre === 'Revisor')!
    expect(revisor.id.startsWith('local-')).toBe(false) // ya está en el servidor
    expect(revisor.proyectoId).toBe(localId)
    expect(b.activaciones.proyectos[localId]).toEqual([COMPARTIDO])
    expect(b.activaciones.proyectos['local-viejo']).toBeUndefined()
    expect(b.recursos.filter((x) => x.nombre === 'Revisor')).toHaveLength(1)
  })

  it('un archivo local ilegible no rompe la biblioteca', async () => {
    await writeFile(join(casa, '.odesk-agent', 'agentes-locales.json'), '{ roto')
    const ids = (await agentes.leerBiblioteca()).recursos.map((x) => x.id)
    expect(ids).toContain(COMPARTIDO)
    expect(ids.some((id) => id.startsWith('local-'))).toBe(false)
  })
})

describe('sugerencias por stack', () => {
  const rec = (id: string, nombre: string, descripcion: string): Recurso => ({ id, tipo: 'skill', nombre, descripcion, contenido: 'x', ambito: 'compartido' })
  it('detecta tecnologías de los archivos de dependencias', () => {
    expect(tecnologiasDe({ 'package.json': '{"name":"a","dependencies":{"react":"1","electron":"2"}}', 'composer.json': '{"require":{"laravel/framework":"11"}}' })).toEqual(expect.arrayContaining(['react', 'electron', 'node', 'php', 'laravel']))
    expect(tecnologiasDe({})).toEqual([])
  })
  it('sugiere por palabra entera, ordena por coincidencias y salta lo ya activo', () => {
    const lista = [rec('a', 'laravel-review', 'Revisa código Laravel y PHP'), rec('b', 'algoritmos', 'Estructuras de datos'), rec('c', 'react-tsx', 'Componentes React'), rec('d', 'php-estilo', 'Estilo PHP')]
    const s = sugerirPorStack(lista, ['laravel', 'php', 'go'], new Set(['d']))
    expect(s.map((x) => x.recursoId)).toEqual(['a'])
    expect(s[0]!.motivos).toEqual(['laravel', 'php'])
  })
})
