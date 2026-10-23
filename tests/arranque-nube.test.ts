import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServidorFalso } from './servidor-falso'

// Un solo servidor falso para todo el archivo: el cliente del escritorio lee su dirección al importarse.
const home = await mkdtemp(join(tmpdir(), 'home-'))
vi.stubEnv('HOME', home)
const srv = await new ServidorFalso([]).iniciar()
srv.apuntar()
const { ArranqueNube, aCuerpo, deFila } = await import('../src/main/arranque/nube')
await srv.entrar()

const P1 = '00000000-0000-4000-8000-0000000000a1'
const P2 = '00000000-0000-4000-8000-0000000000a2'
const entrada = (nombre: string, comando: string, extra: Record<string, unknown> = {}) => ({ nombre, comando, ...extra })

describe('comandos de arranque en la nube (cliente del escritorio)', () => {
  let dir: string
  let s: InstanceType<typeof ArranqueNube>
  beforeEach(async () => {
    srv.caido = false
    dir = await mkdtemp(join(tmpdir(), 'arranque-nube-'))
    srv.arranque.length = 0
    srv.peticiones.length = 0
    s = new ArranqueNube(dir)
  })

  it('guarda en el servidor y lo lee de vuelta con el formato del escritorio', async () => {
    const r = await s.guardar(P1, entrada('API', 'pnpm dev', { cwd: './api/', puerto: 3000, esperar: 'texto', textoListo: 'listening on', esperaMs: 20_000, siempre: true }))
    expect(r).toMatchObject({ ok: true, comando: { nombre: 'API', comando: 'pnpm dev', cwd: 'api', puerto: 3000, esperar: 'texto', textoListo: 'listening on', esperaMs: 20_000, siempre: true, orden: 0 } })
    expect(srv.arranque).toHaveLength(1)
    expect(srv.arranque[0]).toMatchObject({ projectId: P1, name: 'API', command: 'pnpm dev', cwd: 'api', port: 3000, waitFor: 'texto', readyText: 'listening on', waitMs: 20_000, always: true })
    expect((await s.listar(P1))[0]).toEqual(r.ok ? r.comando : undefined)
    expect(await s.listar(P2)).toEqual([])
  })

  it('el cuerpo y la fila se corresponden en los dos sentidos (sin perder campos)', () => {
    const c = { id: 'x', nombre: 'N', comando: 'c', cwd: 'a', puerto: 1, orden: 4, esperar: 'texto' as const, textoListo: 't', esperaMs: 5, siempre: true }
    const cuerpo = aCuerpo(P1, c, 'x')
    expect(cuerpo).toEqual({ projectId: P1, id: 'x', name: 'N', command: 'c', cwd: 'a', port: 1, waitFor: 'texto', readyText: 't', waitMs: 5, always: true })
    expect(deFila({ id: 'x', projectId: P1, name: 'N', command: 'c', cwd: 'a', port: 1, position: 4, waitFor: 'texto', readyText: 't', waitMs: 5, always: true })).toEqual(c)
    expect(aCuerpo(P1, { ...c, esperar: 'nada', puerto: undefined, cwd: undefined, textoListo: 'sobra' })).toMatchObject({ cwd: '', port: null, readyText: null })
  })

  it('un repetido se rechaza en el cliente, sin molestar al servidor', async () => {
    await s.guardar(P1, entrada('API', 'pnpm dev', { cwd: 'api', puerto: 3000 }))
    srv.peticiones.length = 0
    for (const e of [entrada('Otra', ' PNPM  dev ', { cwd: 'api/' }), entrada('api', 'otra cosa'), entrada('X', 'vite', { puerto: 3000 })]) {
      expect(await s.guardar(P1, e)).toMatchObject({ ok: false })
    }
    expect(srv.peticiones.filter((p) => p.startsWith('PUT'))).toEqual([])
    expect(await s.guardar(P1, entrada('Web', 'pnpm dev', { cwd: 'web' }))).toMatchObject({ ok: true }) // otra carpeta: válido
  })

  it('si otro equipo guardó lo mismo a la vez, el conflicto del servidor llega como mensaje, no como excepción', async () => {
    await s.listar(P1) // llena la caché: este equipo aún no sabe lo que hace el otro
    srv.arranque.push({ id: '11111111-1111-4111-8111-111111111111', projectId: P1, name: 'Base', command: 'docker compose up', cwd: '', port: null, position: 0, waitFor: 'nada', readyText: null, waitMs: 0, always: false })
    const r = await s.guardar(P1, entrada('Base', 'docker compose up'))
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringContaining('Ya existe «Base»') })
    expect(srv.arranque).toHaveLength(1)
  })

  it('edita por id sin crear otro, y reordena', async () => {
    const a = await s.guardar(P1, entrada('A', 'a'))
    const b = await s.guardar(P1, entrada('B', 'b'))
    const c = await s.guardar(P1, entrada('C', 'c'))
    if (!a.ok || !b.ok || !c.ok) throw new Error('no se guardó')
    const e = await s.guardar(P1, { ...b.comando, nombre: 'B2', comando: 'b --x' })
    expect(e).toMatchObject({ ok: true, comando: { id: b.comando.id, nombre: 'B2', orden: 1 } })
    expect(srv.arranque).toHaveLength(3)
    expect((await s.mover(P1, c.comando.id, 0)).map((x) => [x.nombre, x.orden])).toEqual([['C', 0], ['A', 1], ['B2', 2]])
    expect((await s.mover(P1, a.comando.id, 99)).map((x) => x.nombre)).toEqual(['C', 'B2', 'A'])
    expect((srv.arranque as { name: string; position: number }[]).sort((x, y) => x.position - y.position).map((x) => x.name)).toEqual(['C', 'B2', 'A'])
  })

  it('elimina; borrar uno que ya no existe no falla', async () => {
    const a = await s.guardar(P1, entrada('A', 'a'))
    if (!a.ok) throw new Error('no se guardó')
    expect(await s.eliminar(P1, a.comando.id)).toEqual([])
    expect(srv.arranque).toHaveLength(0)
    expect(await s.eliminar(P1, a.comando.id)).toEqual([]) // 404 del servidor: ya estaba
    expect(await s.eliminar(P1, 'no-uuid')).toEqual([])
  })

  it('`todos` agrupa por proyecto', async () => {
    await s.guardar(P1, entrada('A', 'a'))
    await s.guardar(P2, entrada('B', 'b'))
    await s.guardar(P2, entrada('C', 'c'))
    const t = await s.todos()
    expect(t.map((x) => [x.proyectoId, x.comandos.map((c) => c.nombre)]).sort()).toEqual([[P1, ['A']], [P2, ['B', 'C']]])
  })

  it('un proyecto que no es de la cuenta (sin UUID) no se puede guardar, y los ids raros no pasan', async () => {
    expect(await s.guardar('proyecto-antiguo', entrada('A', 'a'))).toMatchObject({ ok: false, mensaje: expect.stringContaining('aún no está en la cuenta') })
    await expect(s.listar('../etc')).rejects.toThrow('proyecto no válido')
  })

  it('usa la caché unos segundos y la descarta al escribir', async () => {
    await s.listar(P1)
    await s.listar(P1)
    await s.todos()
    expect(srv.peticiones.filter((p) => p === 'GET /arranque')).toHaveLength(1)
    await s.guardar(P1, entrada('A', 'a'))
    await s.listar(P1)
    expect(srv.peticiones.filter((p) => p === 'GET /arranque').length).toBeGreaterThan(1)
  })

  it('sin servidor sigue pudiendo leer lo último que supo (espejo 0600) pero no editar', async () => {
    await s.guardar(P1, entrada('API', 'pnpm dev', { puerto: 3000 }))
    await s.guardar(P1, entrada('Base', 'docker compose up -d'))
    await s.listar(P1) // deja el espejo
    expect((await stat(join(dir, 'espejo.json'))).mode & 0o777).toBe(0o600)

    srv.caido = true
    try {
      const nuevo = new ArranqueNube(dir) // otra sesión de la app, sin caché
      expect((await nuevo.listar(P1)).map((c) => c.nombre)).toEqual(['API', 'Base'])
      expect((await nuevo.todos())[0]!.comandos).toHaveLength(2)
      expect(await nuevo.guardar(P1, entrada('Web', 'pnpm web'))).toMatchObject({ ok: false, mensaje: expect.stringContaining('sin conexión') })
      await expect(nuevo.mover(P1, (await nuevo.listar(P1))[0]!.id, 1)).rejects.toThrow('No se pudo conectar')
    } finally {
      srv.caido = false
    }
  })

  it('sube una vez los comandos del formato local anterior y aparta el archivo', async () => {
    srv.arranque.push({ id: '22222222-2222-4222-8222-222222222222', projectId: P1, name: 'API', command: 'pnpm dev', cwd: '', port: null, position: 0, waitFor: 'nada', readyText: null, waitMs: 0, always: false })
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `${P1}.json`),
      JSON.stringify({ version: 1, comandos: [
        { id: 'viejo-1', nombre: 'API repetida', comando: 'PNPM dev', orden: 0, esperar: 'nada', esperaMs: 0, siempre: false },
        { id: 'viejo-2', nombre: 'Base', comando: 'docker compose up -d', orden: 1, esperar: 'tiempo', esperaMs: 2000, siempre: true }
      ] })
    )
    await writeFile(join(dir, 'proyecto-sin-uuid.json'), JSON.stringify({ version: 1, comandos: [{ id: 'a', nombre: 'X', comando: 'x', orden: 0, esperar: 'nada', esperaMs: 0, siempre: false }] }))
    const lista = await s.listar(P1)
    expect(lista.map((c) => c.nombre)).toEqual(['API', 'Base']) // el repetido no se sube
    expect(lista[1]).toMatchObject({ esperar: 'tiempo', esperaMs: 2000, siempre: true })
    expect(srv.arranque).toHaveLength(2)
    const archivos = await readdir(dir)
    expect(archivos).toContain(`${P1}.json.migrado`)
    expect(archivos).not.toContain(`${P1}.json`)
    expect(archivos).toContain('proyecto-sin-uuid.json') // sin UUID no hay a dónde subirlo: se deja
    srv.peticiones.length = 0
    await new ArranqueNube(dir).listar(P1) // no vuelve a subir nada
    expect(srv.peticiones.filter((p) => p.startsWith('PUT'))).toEqual([])
    expect(JSON.parse(await readFile(join(dir, 'espejo.json'), 'utf8')).filas).toHaveLength(2)
  })
})
