import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComandoUsuario } from '@shared/core/comandos'
import type { EventoAgente } from '@shared/core/agente'
import { ComandosStore, dividirArgumentos, expandirPlantilla, validarComando } from '../src/main/core/comandos/store'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'

const ejecutable = (nombre: string, comando: string[], extra: Partial<ComandoUsuario> = {}): ComandoUsuario => ({ nombre, descripcion: 'd', tipo: 'ejecutable', comando, ...extra })
const prompt = (nombre: string, plantilla: string): ComandoUsuario => ({ nombre, descripcion: 'd', tipo: 'prompt', plantilla })

describe('validación y utilidades', () => {
  it('valida nombres, tipos y la combinación permitido + destructivo/intérprete', () => {
    expect(validarComando(prompt('revisar', 'Revisa $ARGUMENTOS'))).toBeNull()
    expect(validarComando(ejecutable('test', ['pnpm', 'test'], { permitido: true }))).toBeNull()
    expect(validarComando(prompt('Mal Nombre', 'x'))).toMatch(/nombre/i)
    expect(validarComando(prompt('flujo', 'x'))).toMatch(/aplicación/)
    expect(validarComando(prompt('vacio', '  '))).toMatch(/plantilla/i)
    expect(validarComando(ejecutable('x', []))).toMatch(/programa/)
    expect(validarComando(ejecutable('x', ['git push']))).toMatch(/espacios/)
    expect(validarComando(ejecutable('subir', ['git', 'push'], { permitido: true }))).toMatch(/destructiva/)
    expect(validarComando(ejecutable('subir', ['git', 'push']))).toBeNull() // sin «permitido»: siempre pregunta
    expect(validarComando(ejecutable('js', ['node'], { permitido: true, argumentos: true }))).toMatch(/arbitrario/)
    expect(validarComando(ejecutable('seed', ['node', 'seed.js'], { permitido: true }))).toBeNull()
    expect(validarComando({ ...prompt('ok', 'x'), descripcion: '' })).toMatch(/descripción/)
  })
  it('expande plantillas y divide argumentos sin shell', () => {
    expect(expandirPlantilla('Explica $ARGUMENTOS con ejemplos', ' el módulo X ')).toBe('Explica el módulo X con ejemplos')
    expect(expandirPlantilla('Revisa los cambios', '')).toBe('Revisa los cambios')
    expect(expandirPlantilla('Revisa', 'src/a.ts')).toBe('Revisa\n\nsrc/a.ts')
    expect(dividirArgumentos('hola "dos palabras" \'otra cosa\' fin')).toEqual(['hola', 'dos palabras', 'otra cosa', 'fin'])
    expect(dividirArgumentos('a && rm -rf /')).toEqual(['a', '&&', 'rm', '-rf', '/']) // literales, nunca se interpretan
  })
})

describe('ComandosStore', () => {
  it('persiste por proyecto, el del proyecto manda sobre el global, y valida', async () => {
    const s = new ComandosStore(await mkdtemp(join(tmpdir(), 'cmd-')))
    await s.guardar(ejecutable('build', ['npm', 'run', 'build']))
    await s.guardar(ejecutable('build', ['pnpm', 'build']), 'p1')
    await s.guardar(prompt('revisar', 'Revisa'), 'p1')
    expect((await s.efectivos('p1')).map((c) => [c.nombre, c.comando?.[0] ?? 'prompt'])).toEqual([['build', 'pnpm'], ['revisar', 'prompt']].sort())
    expect((await s.efectivos('otro')).map((c) => c.comando?.[0])).toEqual(['npm'])
    await expect(s.guardar(prompt('flujo', 'x'))).rejects.toThrow(/aplicación/)
    await expect(s.guardar(prompt('ok', 'x'), '../x')).rejects.toThrow(/inválido/)
    expect((await s.eliminar('revisar', 'p1')).map((c) => c.nombre)).toEqual(['build'])
  })
})

describe('Nucleo.ejecutarComando', () => {
  let Nucleo: new () => TipoNucleo
  let ruta: string

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    vi.stubEnv('HOME', home)
    ruta = join(home, 'proy')
    await mkdir(ruta)
    await writeFile(join(ruta, '.env'), 'X=1')
    await mkdir(join(home, '.centro-proyectos'))
    await writeFile(join(home, '.centro-proyectos', 'proyectos.json'), JSON.stringify({ grupos: [], proyectos: [{ id: 'p1', nombre: 'P', ruta }] }))
    ;({ Nucleo } = await import('../src/main/core/index'))
  })

  async function correr(n: TipoNucleo, nombre: string, argumentos = '', decidir?: (e: Extract<EventoAgente, { tipo: 'solicitud_humana' }>) => { aprobado: boolean }) {
    const eventos: EventoAgente[] = []
    const fin = new Promise<Extract<EventoAgente, { tipo: 'comando_salida' }>>((resolver) => {
      void n.ejecutarComando('p1', nombre, argumentos, (e) => {
        eventos.push(e)
        if (e.tipo === 'solicitud_humana') queueMicrotask(() => n.responder(e.solicitudId, decidir?.(e) ?? { aprobado: false }))
        if (e.tipo === 'comando_salida') resolver(e)
      })
    })
    return { salida: await fin, eventos }
  }
  const preguntas = (eventos: EventoAgente[]) => eventos.filter((e): e is Extract<EventoAgente, { tipo: 'solicitud_humana' }> => e.tipo === 'solicitud_humana')

  it('un comando «permitido» corre sin preguntar y devuelve su salida; con argumentos opcionales', async () => {
    const n = new Nucleo()
    await n.comandos.guardar(ejecutable('saludo', ['echo', 'hola'], { permitido: true }), 'p1')
    await n.comandos.guardar(ejecutable('eco', ['echo'], { permitido: true, argumentos: true }), 'p1')
    const a = await correr(n, 'saludo')
    expect(a.salida).toMatchObject({ ok: true, salida: 'hola', linea: 'echo hola', nombre: 'saludo' })
    expect(preguntas(a.eventos)).toHaveLength(0)
    expect((await correr(n, 'eco', 'dos "palabras juntas"')).salida.salida).toBe('dos palabras juntas')
    await expect(n.ejecutarComando('p1', 'saludo', 'sobra', () => undefined)).rejects.toThrow(/no admite argumentos/)
    await expect(n.ejecutarComando('p1', 'noexiste', '', () => undefined)).rejects.toThrow(/No existe/)
  })

  it('sin «permitido» pregunta, y respeta la respuesta', async () => {
    const n = new Nucleo()
    await n.comandos.guardar(ejecutable('hola', ['echo', 'hecho']), 'p1')
    const si = await correr(n, 'hola', '', () => ({ aprobado: true }))
    expect(preguntas(si.eventos)).toHaveLength(1)
    expect(si.salida).toMatchObject({ ok: true, salida: 'hecho' })
    const no = await correr(n, 'hola')
    expect(no.salida).toMatchObject({ ok: false })
    expect(no.salida.salida).toMatch(/no fue aprobada/)
  })

  it('lo destructivo siempre pregunta (marcado) y una regla permitir no lo evita', async () => {
    const n = new Nucleo()
    await n.comandos.guardar(ejecutable('subir', ['git', 'push', '--dry-run']), 'p1')
    const r = await correr(n, 'subir')
    expect(preguntas(r.eventos)[0]).toMatchObject({ destructivo: true })
    expect(r.salida.ok).toBe(false)
  })

  it('los guardrails y las reglas de denegación bloquean antes de preguntar', async () => {
    const n = new Nucleo()
    await n.comandos.guardar(ejecutable('secreto', ['cat', '.env'], { permitido: true }), 'p1')
    const g = await correr(n, 'secreto')
    expect(g.salida.salida).toMatch(/Bloqueado/)
    expect(preguntas(g.eventos)).toHaveLength(0)
    await n.comandos.guardar(ejecutable('saludo2', ['echo', 'x'], { permitido: true }), 'p1')
    await n.permisos.agregar({ tipo: 'comando', patron: 'echo *', accion: 'denegar' }, 'p1')
    const d = await correr(n, 'saludo2')
    expect(d.salida.salida).toMatch(/regla de permisos/)
  })
})
