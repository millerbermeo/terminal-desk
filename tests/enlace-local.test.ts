import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ESTADOS_POR_DEFECTO, type Tarea } from '@shared/tareas'
import { AlmacenJson } from '../src/main/core/memory/almacen'
import { ServicioTareas, type Documento } from '../src/main/core/tareas/servicio'
import { ErrorServidor, type ClienteServidor } from '../src/main/servidor/cliente'
import { RutasLocales } from '../src/main/servidor/rutas'
import { Sincronizador } from '../src/main/servidor/sincronizador'
import { leerVinculo, repoDe, vincularProyectoLocal } from '../src/main/servidor/vinculo'

const ID = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const carpeta = (): Promise<string> => mkdtemp(join(tmpdir(), 'ctx-'))
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('enlace local (.odesk/project.json)', () => {
  it('escribe solo el projectId y se lee de vuelta; ignora archivos ajenos o inválidos', async () => {
    const dir = await carpeta()
    expect(await leerVinculo(dir)).toBeUndefined()
    await vincularProyectoLocal(dir, ID)
    expect(JSON.parse(await readFile(join(dir, '.odesk', 'project.json'), 'utf8'))).toEqual({ projectId: ID })
    expect(await leerVinculo(dir)).toBe(ID)
    await expect(vincularProyectoLocal(dir, '../../etc')).rejects.toThrow(/no es válido/)
    await mkdir(join(dir, 'otra', '.odesk'), { recursive: true })
    await import('node:fs/promises').then((f) => f.writeFile(join(dir, 'otra', '.odesk', 'project.json'), '{"projectId":"no-uuid"}'))
    expect(await leerVinculo(join(dir, 'otra'))).toBeUndefined()
  })

  it('repoDe devuelve el origin sin credenciales y undefined sin repo', async () => {
    const dir = await carpeta()
    expect(await repoDe(dir)).toBeUndefined()
    execFileSync('git', ['init', '-q'], { cwd: dir })
    expect(await repoDe(dir)).toBeUndefined()
    execFileSync('git', ['remote', 'add', 'origin', 'https://usuario:ghp_secreto@github.com/x/demo.git'], { cwd: dir })
    expect(await repoDe(dir)).toBe('https://github.com/x/demo.git')
  })
})

describe('rutas locales', () => {
  it('guarda la carpeta de cada proyecto en este equipo y una carpeta solo pertenece a un proyecto', async () => {
    const archivo = join(await carpeta(), 'rutas.json')
    const r = new RutasLocales(archivo)
    await r.fijar('a', '/x/a')
    await r.fijar('b', '/x/b')
    await r.fijar('c', '/x/a') // misma carpeta con otro id: suelta al anterior
    expect(await new RutasLocales(archivo).todas()).toEqual({ b: '/x/b', c: '/x/a' })
    await r.quitar('b')
    expect(await r.obtener('b')).toBeUndefined()
  })
})

describe('sincronizador', () => {
  type Llamada = { m: string; ruta: string; cuerpo?: unknown }
  let llamadas: Llamada[]
  let fallo: ErrorServidor | undefined
  let sync: Sincronizador
  const avisos: string[] = []

  beforeEach(() => {
    llamadas = []
    fallo = undefined
    avisos.length = 0
    const registrar =
      (m: string) =>
      async (ruta: string, cuerpo?: unknown): Promise<unknown> => {
        llamadas.push({ m, ruta, cuerpo })
        if (fallo) throw fallo
        return {}
      }
    const cliente = { get: registrar('GET'), put: registrar('PUT'), post: registrar('POST'), delete: registrar('DELETE') } as unknown as ClienteServidor
    sync = new Sincronizador(cliente, 15, (m) => avisos.push(m))
  })

  const tarea = (p: Partial<Tarea>): Tarea => ({
    id: 't1', numero: 1, titulo: 'x', descripcion: '', estado: 'pendiente', prioridad: 'media', etiquetas: [], creada: 1, actualizada: 100,
    criterios: [], checklist: [], dependeDe: [], referencias: [], comentarios: [], notasTecnicas: '', orden: 10, proyectoId: ID, ...p
  })

  it('agrupa ráfagas del mismo documento y no reenvía lo que no cambió', async () => {
    const t = tarea({})
    sync.encolar(ID, 'chat', 's1', { id: 's1', v: 1 }, 1)
    sync.encolar(ID, 'chat', 's1', { id: 's1', v: 2 }, 2)
    await dormir(80)
    expect(llamadas).toEqual([{ m: 'PUT', ruta: `/projects/${ID}/docs/chat/s1`, cuerpo: { data: { id: 's1', v: 2 }, updatedAt: 2 } }])
    sync.encolar(ID, 'chat', 's1', { id: 's1', v: 2 }, 3)
    sync.tareasCambiadas({ tareas: [t] }, undefined)
    await dormir(80)
    expect(llamadas.map((l) => l.ruta)).toEqual([`/projects/${ID}/docs/chat/s1`, `/projects/${ID}/docs/task/t1`])
  })

  it('ignora proyectos que no son del servidor (ids locales antiguos o sin proyecto)', async () => {
    sync.encolar('p1', 'chat', 's1', { a: 1 })
    sync.encolar(undefined, 'chat', 's2', { a: 1 })
    sync.tareasCambiadas({ tareas: [tarea({ proyectoId: 'p1' }), tarea({ id: 't2', proyectoId: undefined })] }, undefined)
    await dormir(60)
    expect(llamadas).toEqual([])
  })

  it('una tarea que desaparece se borra en el servidor; una que solo perdió el proyecto no', async () => {
    sync.tareasCambiadas({ tareas: [] }, { tareas: [tarea({ id: 'borrada' })] })
    sync.tareasCambiadas({ tareas: [tarea({ id: 'suelta', proyectoId: undefined })] }, { tareas: [tarea({ id: 'suelta' })] })
    await dormir(80)
    expect(llamadas).toEqual([{ m: 'DELETE', ruta: `/projects/${ID}/docs/task/borrada`, cuerpo: { updatedAt: expect.any(Number) } }])
  })

  it('registra eventos de archivos y deja lo que bajó del servidor sin rebotar', async () => {
    sync.evento(ID, 'archivo_modificado', { ruta: 'src/a.ts' })
    sync.recordar(ID, 'task', 't1', tarea({}))
    sync.tareasCambiadas({ tareas: [tarea({})] }, undefined) // idéntica a la bajada: no se reenvía
    await dormir(80)
    expect(llamadas).toEqual([{ m: 'POST', ruta: `/projects/${ID}/events`, cuerpo: { kind: 'archivo_modificado', data: { ruta: 'src/a.ts' } } }])
  })

  it('un error 4xx se descarta con aviso; un error de red se reintenta', async () => {
    fallo = new ErrorServidor('no existe', 404)
    sync.encolar(ID, 'chat', 's1', { a: 1 })
    await dormir(80)
    expect(llamadas).toHaveLength(1)
    expect(avisos[0]).toMatch(/no existe/)

    llamadas.length = 0
    fallo = new ErrorServidor('sin conexión')
    sync.encolar(ID, 'chat', 's2', { a: 1 })
    await dormir(80)
    expect(llamadas).toHaveLength(1) // el reintento espera ≥ 2 s
    fallo = undefined
    await sync.vaciar()
  })
})

describe('ServicioTareas.fusionar (tareas de otra computadora)', () => {
  let s: ServicioTareas
  beforeEach(async () => {
    const dir = await carpeta()
    s = new ServicioTareas(new AlmacenJson<Documento>(join(dir, 'tareas'), 0o600), { proyectos: async () => ({ grupos: [], proyectos: [] }) })
  })
  const t = (p: Partial<Tarea>): Tarea => ({
    id: 'x', numero: 1, titulo: 't', descripcion: '', estado: 'pendiente', prioridad: 'media', etiquetas: [], creada: 0, actualizada: 10,
    criterios: [], checklist: [], dependeDe: [], referencias: [], comentarios: [], notasTecnicas: '', orden: 10, proyectoId: ID, ...p
  })

  it('añade las nuevas, renumera si el #n choca, reemplaza solo si la remota es más nueva y arregla estados desconocidos', async () => {
    expect(ESTADOS_POR_DEFECTO.some((e) => e.id === 'pendiente')).toBe(true)
    expect(await s.fusionar([t({ id: 'a', numero: 1, titulo: 'remota A' })])).toBe(1)
    // otra tarea remota con el mismo #1, y una con estado que aquí no existe
    expect(await s.fusionar([t({ id: 'b', numero: 1, titulo: 'remota B' }), t({ id: 'c', numero: 5, estado: 'inventado' })])).toBe(2)
    let d = await s.leer()
    const num = (id: string) => d.tareas.find((x) => x.id === id)!
    expect(new Set(d.tareas.map((x) => x.numero)).size).toBe(3)
    expect(num('a').numero).toBe(1)
    expect(num('b').numero).not.toBe(1)
    expect(num('c').estado).toBe('pendiente')

    // la local ya es igual o más nueva: no cambia
    expect(await s.fusionar([t({ id: 'a', titulo: 'vieja', actualizada: 5 })])).toBe(0)
    expect(await s.fusionar([t({ id: 'a', titulo: 'nueva', actualizada: 99 })])).toBe(1)
    d = await s.leer()
    expect(num('a').titulo).toBe('nueva')
    expect(num('a').numero).toBe(1) // conserva su número local
  })
})
