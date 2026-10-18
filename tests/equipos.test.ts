import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { situacionDe, trabajandoAhora, type PendienteClonar } from '@shared/equipos'
import { analizarNumstat } from '../src/main/core/git/analisis'
import { Repositorio } from '../src/main/core/git/repositorio'
import { ServicioGitHub } from '../src/main/github/servicio'
import { AlmacenToken, type Cifrador } from '../src/main/github/token'
import { ServicioEquipos, ejecutarOperacionEquipos, estadoDeArchivo, type DepsEquipos, type RepoEquipos } from '../src/main/servidor/equipos'
import { RutasLocales } from '../src/main/servidor/rutas'
import { leerVinculo, vincularProyectoLocal } from '../src/main/servidor/vinculo'

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const carpeta = (p = 'eq-'): Promise<string> => mkdtemp(join(tmpdir(), p))
const P1 = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const P2 = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

beforeAll(async () => {
  const casa = await carpeta('eq-casa-')
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})

/** Servidor en memoria con lo que usa el servicio: proyectos y estado por equipo. */
function servidorFalso() {
  const dispositivos = new Map<string, Record<string, unknown>>()
  const puts: string[] = []
  const proyectos: { id: string; name: string; repo: string | null; groupId: string | null }[] = []
  return {
    dispositivos,
    puts,
    proyectos,
    get: async <T>(ruta: string): Promise<T> => {
      if (ruta === '/projects') return { groups: [], projects: proyectos } as T
      if (ruta === '/devices') return { devices: [...dispositivos.values()] } as T
      const m = /^\/projects\/([^/]+)\/devices$/.exec(ruta)
      if (m) return { devices: [...dispositivos.entries()].filter(([k]) => k.startsWith(`${m[1]}|`)).map(([, v]) => v) } as T
      throw Object.assign(new Error('no'), { estado: 404 })
    },
    put: async <T>(ruta: string, c: unknown): Promise<T> => {
      const m = /^\/projects\/([^/]+)\/devices\/([^/]+)$/.exec(ruta)!
      puts.push(ruta)
      const b = c as Record<string, unknown>
      dispositivos.set(`${m[1]}|${m[2]}`, {
        projectId: m[1],
        deviceId: m[2],
        deviceName: b.name,
        branch: b.branch,
        commit: b.commit,
        subject: b.subject,
        ahead: b.ahead,
        behind: b.behind,
        hasUpstream: b.upstream,
        dirty: b.dirty,
        files: b.files,
        insertions: b.insertions,
        deletions: b.deletions,
        lastActivity: b.activity,
        commitDate: b.commitDate,
        history: b.history,
        historyTotal: b.historyTotal,
        updatedAt: new Date().toISOString()
      })
      return { ok: true } as T
    },
    delete: async (ruta: string): Promise<void> => {
      const m = /^\/projects\/([^/]+)\/devices\/([^/]+)$/.exec(ruta)!
      dispositivos.delete(`${m[1]}|${m[2]}`)
    }
  }
}

/** Remoto «bare» + una copia de trabajo clonada de él, con identidad y un commit ya enviado. */
async function repoConRemoto(): Promise<{ bare: string; dir: string }> {
  const bare = await carpeta('eq-bare-')
  sh(bare, 'init', '--bare', '-q', '-b', 'main')
  const dir = await carpeta('eq-copia-')
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.name', 'Ana')
  sh(dir, 'config', 'user.email', 'ana@example.com')
  await writeFile(join(dir, 'a.txt'), 'uno\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'Primero')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  return { bare, dir }
}

async function nuevo(extra: Partial<DepsEquipos> = {}) {
  const srv = servidorFalso()
  const datos = await carpeta('eq-datos-')
  const proyectos = [] as { id: string; ruta: string }[]
  const deps: DepsEquipos = {
    servidor: srv,
    archivo: join(datos, 'equipo.json'),
    nombreSistema: 'portatil-ana',
    proyectos: async () => proyectos,
    repositorio: (ruta) => new Repositorio(ruta),
    pendientes: async () => [],
    clonarProyecto: async () => ({ ruta: '' }),
    ...extra
  }
  return { s: new ServicioEquipos(deps), srv, proyectos, deps, datos }
}

describe('estado de git de este equipo', () => {
  it('informa rama, último commit, cambios sin guardar y si sigue un remoto', async () => {
    const { s, srv, proyectos } = await nuevo()
    const { dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    await writeFile(join(dir, 'a.txt'), 'uno cambiado\n') // archivo versionado modificado
    await writeFile(join(dir, 'nuevo.txt'), 'x') // sin seguimiento: se cuenta (en un repo enorme se deja de mirar, ver más abajo)
    expect(await s.informar()).toBe(1)
    const yo = (await s.equipo()).id
    expect(srv.dispositivos.get(`${P1}|${yo}`)).toMatchObject({ deviceName: 'portatil-ana', branch: 'main', subject: 'Primero', commit: sh(dir, 'rev-parse', 'HEAD'), ahead: 0, behind: 0, hasUpstream: true, dirty: 2 })
  })

  it('informa QUÉ cambió: archivos con su estado y líneas, última actividad y fecha del commit (sin contenido)', async () => {
    const { s, srv, proyectos } = await nuevo()
    const { dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    await writeFile(join(dir, 'a.txt'), 'uno\ndos\ntres\n') // +2 líneas
    await writeFile(join(dir, 'nuevo.txt'), 'x')
    await writeFile(join(dir, 'b.txt'), 'b\n')
    sh(dir, 'add', 'b.txt') // añadido al índice
    // a.txt tocado hace poco; nuevo.txt y b.txt, antes
    const reciente = new Date('2026-10-17T20:00:00.000Z')
    await utimes(join(dir, 'a.txt'), reciente, reciente)
    await utimes(join(dir, 'nuevo.txt'), new Date('2026-10-16T08:00:00.000Z'), new Date('2026-10-16T08:00:00.000Z'))
    await utimes(join(dir, 'b.txt'), new Date('2026-10-16T09:00:00.000Z'), new Date('2026-10-16T09:00:00.000Z'))
    await s.informar()
    const fila = srv.dispositivos.get(`${P1}|${(await s.equipo()).id}`) as { files: { path: string; status: string; add: number; del: number }[]; [k: string]: unknown }
    expect(fila.files).toEqual([
      { path: 'a.txt', status: 'M', add: 2, del: 0 },
      { path: 'b.txt', status: 'A', add: 1, del: 0 },
      { path: 'nuevo.txt', status: 'N', add: 0, del: 0 }
    ])
    expect(fila).toMatchObject({ dirty: 3, insertions: 3, deletions: 0, lastActivity: '2026-10-17T20:00:00.000Z' })
    expect(Date.parse(fila.commitDate as string)).toBeGreaterThan(Date.parse('2025-01-01'))
    expect(JSON.stringify(fila)).not.toContain('tres') // nunca el contenido
  })

  it('una modificación nueva (cambia la hora de un archivo) se vuelve a informar enseguida; sin cambios, no', async () => {
    const { s, srv, proyectos } = await nuevo()
    const { dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    await writeFile(join(dir, 'a.txt'), 'cambio 1\n')
    await utimes(join(dir, 'a.txt'), new Date('2026-10-17T10:00:00Z'), new Date('2026-10-17T10:00:00Z'))
    expect(await s.informar()).toBe(1)
    expect(await s.informar()).toBe(0)
    await utimes(join(dir, 'a.txt'), new Date('2026-10-17T10:05:00Z'), new Date('2026-10-17T10:05:00Z'))
    expect(await s.informar()).toBe(1)
    const yo = (await s.equipo()).id
    expect((srv.dispositivos.get(`${P1}|${yo}`) as { lastActivity: string }).lastActivity).toBe('2026-10-17T10:05:00.000Z')
  })

  it('un repositorio lento (millones de archivos) pasa a mirarse solo en lo versionado y con menos frecuencia', async () => {
    let t = 5_000_000
    const llamadas: (string | undefined)[] = []
    const lento: RepoEquipos = {
      estado: async (modo) => {
        llamadas.push(modo)
        if (modo !== 'ligero') await new Promise((r) => setTimeout(r, 1100))
        return { repo: true, raiz: '/no/existe', rama: 'main', sinCommits: false, upstream: 'origin/main', adelante: 0, atras: 0, archivos: [], remotos: ['origin'] }
      },
      historial: async () => ({ commits: [] }),
      lineasCambiadas: async () => new Map(),
      obtener: async () => undefined
    }
    const { s, proyectos } = await nuevo({ repositorio: () => lento, ahora: () => t })
    proyectos.push({ id: P1, ruta: '/no/existe' })
    expect(await s.informar()).toBe(1)
    expect(llamadas).toEqual(['agrupado']) // la primera vez tardó más de 1 s
    expect(await s.informar()).toBe(0) // y se espera antes de volver a mirarlo
    expect(llamadas).toHaveLength(1)
    t += 3_600_000
    await s.informar()
    expect(llamadas).toEqual(['agrupado', 'ligero']) // a partir de ahí, solo lo versionado (rápido)
  }, 15000)

  it('cuenta lo que va adelante y lo que va atrás; atrás solo se sabe tras consultar el remoto', async () => {
    const { s, srv, proyectos } = await nuevo({ cadaTraerMs: 0 })
    const { bare, dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    // otro equipo sube un commit al remoto
    const otro = await carpeta('eq-otro-')
    sh(otro, 'clone', '-q', bare, '.')
    sh(otro, 'config', 'user.name', 'Beto')
    sh(otro, 'config', 'user.email', 'b@example.com')
    await writeFile(join(otro, 'b.txt'), 'dos\n')
    sh(otro, 'add', '-A')
    sh(otro, 'commit', '-q', '-m', 'Del otro equipo')
    sh(otro, 'push', '-q')
    // y este equipo hace dos commits sin enviar
    for (const n of ['c1', 'c2']) {
      await writeFile(join(dir, `${n}.txt`), n)
      sh(dir, 'add', '-A')
      sh(dir, 'commit', '-q', '-m', n)
    }
    await s.informar(true, true)
    const yo = (await s.equipo()).id
    expect(srv.dispositivos.get(`${P1}|${yo}`)).toMatchObject({ ahead: 2, behind: 1, hasUpstream: true, subject: 'c2' })
    expect(situacionDe({ adelante: 2, atras: 1, seguimiento: true })).toBe('divergido')
  })

  it('sin remoto no hay adelante/atrás; sin repositorio o sin commits no se informa nada', async () => {
    const { s, srv, proyectos } = await nuevo()
    const solo = await carpeta('eq-solo-')
    sh(solo, 'init', '-q', '-b', 'rama-x')
    sh(solo, 'config', 'user.name', 'Ana')
    sh(solo, 'config', 'user.email', 'a@e.com')
    const vacia = await carpeta('eq-vacia-')
    const sinGit = await carpeta('eq-singit-')
    proyectos.push({ id: P1, ruta: solo }, { id: P2, ruta: vacia }, { id: 'p3', ruta: sinGit })
    expect(await s.informar()).toBe(0) // el repo de `solo` aún no tiene commits
    await writeFile(join(solo, 'a'), 'a')
    sh(solo, 'add', '-A')
    sh(solo, 'commit', '-q', '-m', 'uno')
    expect(await s.informar()).toBe(1)
    const yo = (await s.equipo()).id
    expect(srv.dispositivos.get(`${P1}|${yo}`)).toMatchObject({ branch: 'rama-x', hasUpstream: false, ahead: 0, behind: 0 })
    expect(srv.dispositivos.size).toBe(1)
    expect(situacionDe({ adelante: 0, atras: 0, seguimiento: false })).toBe('sin-remoto')
  })

  it('no repite lo que no cambió (salvo el latido), vuelve a informar si cambia y «forzar» siempre sube', async () => {
    let t = 1_000_000
    const { s, srv, proyectos } = await nuevo({ ahora: () => t, cadaLatidoMs: 60_000 })
    const { dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    expect(await s.informar()).toBe(1)
    expect(await s.informar()).toBe(0)
    t += 30_000
    expect(await s.informar()).toBe(0)
    t += 40_000 // pasó el latido: se sube aunque todo siga igual (para ver que el equipo sigue encendido)
    expect(await s.informar()).toBe(1)
    await writeFile(join(dir, 'a.txt'), 'cambio\n')
    expect(await s.informar()).toBe(1)
    expect(await s.informar(false, true)).toBe(1)
    expect(srv.puts).toHaveLength(4)
  })

  it('un proyecto que ya no existe en la cuenta (404) no frena a los demás', async () => {
    const { s, srv, proyectos } = await nuevo()
    const a = (await repoConRemoto()).dir
    const b = (await repoConRemoto()).dir
    proyectos.push({ id: P1, ruta: a }, { id: P2, ruta: b })
    const put = srv.put
    srv.put = async (ruta: string, c: unknown) => {
      if (ruta.includes(P1)) throw Object.assign(new Error('no existe'), { estado: 404 })
      return put(ruta, c)
    }
    expect(await s.informar()).toBe(1)
    srv.put = async () => {
      throw Object.assign(new Error('sin conexión'), { estado: undefined })
    }
    await expect(s.informar(false, true)).rejects.toThrow(/sin conexión/)
  })

  it('un proyecto que ya tiene el máximo de equipos (409) tampoco frena a los demás', async () => {
    const { s, srv, proyectos } = await nuevo()
    const a = (await repoConRemoto()).dir
    const b = (await repoConRemoto()).dir
    proyectos.push({ id: P1, ruta: a }, { id: P2, ruta: b })
    const put = srv.put
    srv.put = async (ruta: string, c: unknown) => {
      if (ruta.includes(P1)) throw Object.assign(new Error('Demasiados equipos para este proyecto'), { estado: 409 })
      return put(ruta, c)
    }
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await s.informar()).toBe(1)
    expect(aviso.mock.calls.join(' ')).toMatch(/Demasiados equipos/)
    aviso.mockRestore()
  })
})

describe('mis equipos', () => {
  it('el id del equipo se conserva entre arranques y se puede renombrar', async () => {
    const { s, deps } = await nuevo()
    const e1 = await s.equipo()
    expect(e1).toMatchObject({ nombre: 'portatil-ana' })
    expect(e1.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await new ServicioEquipos(deps).equipo()).toEqual(e1)
    const r = await s.renombrar('  Escritorio de la oficina ')
    expect(r).toEqual({ id: e1.id, nombre: 'Escritorio de la oficina' })
    expect(await new ServicioEquipos(deps).equipo()).toEqual(r)
    expect(JSON.parse(await readFile(deps.archivo, 'utf8'))).toEqual(r)
    await expect(s.renombrar('   ')).rejects.toThrow(/nombre/)
    await expect(s.renombrar('a\nb')).rejects.toThrow(/no válido/)
  })

  it('lista este equipo primero y luego los demás por actividad, con lo último de este equipo', async () => {
    const { s, srv, proyectos } = await nuevo()
    const { dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    srv.dispositivos.set(`${P1}|otro-viejo`, { deviceId: 'otro-viejo', deviceName: 'Oficina', branch: 'dev', commit: 'c'.repeat(40), subject: 'WIP', ahead: 0, behind: 3, hasUpstream: true, dirty: 0, updatedAt: '2026-10-01T10:00:00.000Z' }) // equipo con la versión anterior: sin archivos
    srv.dispositivos.set(`${P1}|otro-nuevo`, { deviceId: 'otro-nuevo', deviceName: 'Casa', branch: null, commit: null, subject: null, ahead: 2, behind: 0, hasUpstream: false, dirty: 4, files: [{ path: 'src/a.ts', status: 'M', add: 5, del: 1 }], insertions: 5, deletions: 1, lastActivity: '2026-10-10T09:58:00.000Z', commitDate: '2026-10-09T12:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z' })
    const { equipos, equipo } = await s.listar(P1)
    expect(equipos.map((e) => e.nombre)).toEqual(['portatil-ana', 'Casa', 'Oficina'])
    expect(equipos[0]).toMatchObject({ esteEquipo: true, rama: 'main', asunto: 'Primero', adelante: 0, atras: 0, seguimiento: true })
    expect(equipos[0]!.idEquipo).toBe(equipo.id)
    expect(equipos[1]).toMatchObject({ esteEquipo: false, cambios: 4, adelante: 2, lineasMas: 5, lineasMenos: 1, ultimaActividad: '2026-10-10T09:58:00.000Z', fechaCommit: '2026-10-09T12:00:00.000Z', archivos: [{ ruta: 'src/a.ts', estado: 'M', mas: 5, menos: 1 }] })
    expect(equipos[2]).toMatchObject({ archivos: [], lineasMas: 0, lineasMenos: 0 }) // sin datos de la versión anterior
    expect(equipos[2]).not.toHaveProperty('ultimaActividad')
    expect(equipos[1]).not.toHaveProperty('rama') // cabeza suelta
    expect(equipos[2]).toMatchObject({ rama: 'dev', atras: 3, asunto: 'WIP' })
    expect(situacionDe({ adelante: 0, atras: 3, seguimiento: true })).toBe('atrasado')
    expect(situacionDe({ adelante: 2, atras: 0, seguimiento: true })).toBe('adelantado')
    expect(situacionDe({ adelante: 0, atras: 0, seguimiento: true })).toBe('al-dia')
  })

  it('olvidar quita a otro equipo pero nunca al propio', async () => {
    const { s, srv } = await nuevo()
    const yo = (await s.equipo()).id
    srv.dispositivos.set(`${P1}|viejo`, { deviceId: 'viejo' })
    await expect(s.olvidar(P1, yo)).rejects.toThrow(/tu equipo actual/)
    expect(await s.olvidar(P1, 'viejo')).toEqual({ ok: true })
    expect(srv.dispositivos.has(`${P1}|viejo`)).toBe(false)
  })

  it('por la interfaz valida los ids y rechaza operaciones desconocidas', async () => {
    const { s, deps } = await nuevo()
    await expect(ejecutarOperacionEquipos(s, deps, 'listar', {})).rejects.toThrow(/Falta el proyecto/)
    await expect(ejecutarOperacionEquipos(s, deps, 'olvidar', { proyectoId: P1 })).rejects.toThrow(/Falta el equipo/)
    await expect(ejecutarOperacionEquipos(s, deps, 'inventada', {})).rejects.toThrow(/desconocida/)
    expect(await ejecutarOperacionEquipos(s, deps, 'pendientes', {})).toEqual([])
  })
})

describe('clonar automático: proyectos de la cuenta que faltan en este equipo', () => {
  const cifrador: Cifrador = { disponible: () => true, cifrar: (t) => t, descifrar: (c) => c }

  /** Un ServicioGitHub real (clona con git de verdad) enlazado con las mismas rutas y vínculo que usa la app. */
  async function entorno(pendientes: PendienteClonar[]) {
    const datos = await carpeta('eq-gh-')
    const rutas = new RutasLocales(join(datos, 'rutas.json'))
    const vinculados: { ruta: string; id: string }[] = []
    const gh = new ServicioGitHub({
      token: new AlmacenToken(join(datos, 'github.json'), cifrador),
      dirDatos: datos,
      host: 'github.test',
      resolverHost: async (h) => h,
      carpetaDe: async () => '',
      agregarProyecto: async () => {
        throw new Error('no debe crear un proyecto nuevo')
      },
      vincular: async (ruta, id) => {
        if ((await leerVinculo(ruta)) !== id) await vincularProyectoLocal(ruta, id)
        await rutas.fijar(id, ruta)
        vinculados.push({ ruta, id })
      }
    })
    const e = await nuevo({ pendientes: async () => pendientes, clonarProyecto: (x) => gh.clonarProyecto(x) })
    return { ...e, gh, rutas, vinculados }
  }

  it('clona el repositorio y lo enlaza al MISMO proyecto de la cuenta (no crea uno nuevo)', async () => {
    const { bare } = await repoConRemoto()
    const { s, rutas, vinculados } = await entorno([{ id: P1, nombre: 'Tienda', repo: bare }])
    const padre = await carpeta('eq-padre-')
    const { ruta } = await s.clonarPendiente({ proyectoId: P1, carpetaPadre: padre })
    expect(ruta).toBe(join(padre, bare.split('/').pop()!))
    expect(sh(ruta, 'log', '-1', '--format=%s')).toBe('Primero')
    expect(vinculados).toEqual([{ ruta, id: P1 }])
    expect(await leerVinculo(ruta)).toBe(P1)
    expect(await rutas.obtener(P1)).toBe(ruta)
    expect((await stat(join(ruta, '.odesk', 'project.json'))).isFile()).toBe(true)
  })

  it('si el repositorio ya trae su .odesk/project.json con ese id, no lo toca', async () => {
    const { bare, dir } = await repoConRemoto()
    await vincularProyectoLocal(dir, P1)
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'Enlace')
    sh(dir, 'push', '-q')
    const { s } = await entorno([{ id: P1, nombre: 'Tienda', repo: bare }])
    const { ruta } = await s.clonarPendiente({ proyectoId: P1, carpetaPadre: await carpeta('eq-padre-') })
    expect(await leerVinculo(ruta)).toBe(P1)
    expect(sh(ruta, 'status', '--porcelain')).toBe('') // sin cambios: el archivo versionado quedó como venía
  })

  it('rechaza proyectos que no están pendientes, carpetas inexistentes o con contenido, y avisa al terminar', async () => {
    const { bare } = await repoConRemoto()
    const { s } = await entorno([{ id: P1, nombre: 'Tienda', repo: bare }])
    await expect(s.clonarPendiente({ proyectoId: P2, carpetaPadre: '/tmp' })).rejects.toThrow(/ya está en este equipo/)
    await expect(s.clonarPendiente({ proyectoId: P1, carpetaPadre: '/no/existe/jamas' })).rejects.toThrow(/no existe/)
    await expect(s.clonarPendiente({ proyectoId: P1, carpetaPadre: 'relativa' })).rejects.toThrow(/ruta completa/)
    const padre = await carpeta('eq-padre-')
    const destino = join(padre, bare.split('/').pop()!)
    await writeFile(join(padre, 'x'), 'x')
    await s.clonarPendiente({ proyectoId: P1, carpetaPadre: padre })
    await expect(s.clonarPendiente({ proyectoId: P1, carpetaPadre: padre })).rejects.toThrow(new RegExp(`Ya existe.*${destino.split('/').pop()}`))
  })

  it('al terminar avisa para bajar el contexto del proyecto (y un fallo ahí no deshace el clon)', async () => {
    const { bare } = await repoConRemoto()
    const avisos: string[] = []
    const e = await entorno([{ id: P1, nombre: 'Tienda', repo: bare }])
    const conAviso = new ServicioEquipos({ ...e.deps, alClonar: async (id) => { avisos.push(id); throw new Error('sin red') } })
    const { ruta } = await conAviso.clonarPendiente({ proyectoId: P1, carpetaPadre: await carpeta('eq-padre-') })
    expect(avisos).toEqual([P1])
    expect(await leerVinculo(ruta)).toBe(P1)
  })

  it('el remoto de la cuenta puede ser un alias SSH de otro equipo: se clona por propietario/repo', async () => {
    const { gh } = await entorno([])
    expect(await gh.repoParaClonar('git@github-miller:millerbermeo/terminal-desk.git')).toBe('millerbermeo/terminal-desk') // alias sin punto: GitHub
    expect(await gh.repoParaClonar('https://github.test/ana/tienda.git')).toBe('ana/tienda')
    expect(await gh.repoParaClonar('git@github.test:ana/tienda.git')).toBe('ana/tienda')
    expect(await gh.repoParaClonar('git@git.empresa.com:equipo/api.git')).toBe('git@git.empresa.com:equipo/api.git') // otro servidor: tal cual
    expect(await gh.repoParaClonar('/srv/git/repo.git')).toBe('/srv/git/repo.git') // ruta local: tal cual
  })
})

describe('qué cambió y quién está trabajando', () => {
  it('la letra de cada archivo: conflicto, nuevo, y lo del árbol de trabajo manda sobre el índice', () => {
    const f = (indice: string, trabajo: string, extra: object = {}) => estadoDeArchivo({ indice, trabajo, conflicto: false, sinSeguimiento: false, ...extra } as Parameters<typeof estadoDeArchivo>[0])
    expect(f('.', 'M')).toBe('M')
    expect(f('A', '.')).toBe('A')
    expect(f('D', '.')).toBe('D')
    expect(f('R', '.')).toBe('R')
    expect(f('A', 'M')).toBe('M')
    expect(f('.', '.', { sinSeguimiento: true })).toBe('N')
    expect(f('U', 'U', { conflicto: true })).toBe('U')
  })

  it('analiza `git diff --numstat -z`: líneas, binarios y renombrados', () => {
    const salida = ['3\t1\tsrc/a.ts', '-\t-\timagen.png', '0\t0\t', 'viejo.txt', 'nuevo.txt', '10\t0\tcon espacios y ñ.md', ''].join('\0')
    expect([...analizarNumstat(salida)]).toEqual([
      ['src/a.ts', { mas: 3, menos: 1 }],
      ['imagen.png', { mas: 0, menos: 0 }],
      ['nuevo.txt', { mas: 0, menos: 0 }],
      ['con espacios y ñ.md', { mas: 10, menos: 0 }]
    ])
    expect(analizarNumstat('').size).toBe(0)
  })

  it('«trabajando ahora»: archivos tocados hace menos de 3 min en un equipo encendido', () => {
    const ahora = Date.parse('2026-10-17T20:00:00Z')
    const hace = (ms: number): string => new Date(ahora - ms).toISOString()
    expect(trabajandoAhora({ ultimaActividad: hace(60_000), actualizado: hace(10_000) }, ahora)).toBe(true)
    expect(trabajandoAhora({ ultimaActividad: hace(4 * 60_000), actualizado: hace(10_000) }, ahora)).toBe(false) // hace rato que no toca nada
    expect(trabajandoAhora({ ultimaActividad: hace(60_000), actualizado: hace(30 * 60_000) }, ahora)).toBe(false) // el equipo ya no informa
    expect(trabajandoAhora({ actualizado: hace(1000) }, ahora)).toBe(false) // sin actividad
  })

  it('el resumen avisa de otros equipos con trabajo pendiente: sin guardar o sin enviar, recientes y de proyectos de este equipo', async () => {
    let t = Date.parse('2026-10-17T20:00:00Z')
    const { s, srv, proyectos } = await nuevo({ ahora: () => t })
    proyectos.push({ id: P1, ruta: '/x/a' })
    const yo = (await s.equipo()).id
    const fila = (proyectoId: string, deviceId: string, extra: object) => srv.dispositivos.set(`${proyectoId}|${deviceId}`, { projectId: proyectoId, deviceId, deviceName: deviceId, branch: 'dev', dirty: 0, ahead: 0, behind: 0, insertions: 0, deletions: 0, updatedAt: '2026-10-17T19:59:00.000Z', ...extra })
    fila(P1, yo, { dirty: 9 }) // este mismo equipo: no es un aviso
    fila(P1, 'casa', { dirty: 5, insertions: 40, deletions: 7, lastActivity: '2026-10-17T19:57:00.000Z' })
    fila(P1, 'oficina', { ahead: 2, lastActivity: '2026-10-17T15:00:00.000Z', updatedAt: '2026-10-17T15:10:00.000Z' })
    fila(P1, 'limpio', {}) // nada pendiente
    fila(P1, 'abandonado', { dirty: 3, updatedAt: '2026-08-01T10:00:00.000Z' }) // hace más de 30 días
    fila(P2, 'casa', { dirty: 1 }) // proyecto que no está en este equipo
    const avisos = await s.resumen()
    expect(avisos.map((a) => a.idEquipo)).toEqual(['casa', 'oficina'])
    expect(avisos[0]).toEqual({ proyectoId: P1, idEquipo: 'casa', equipo: 'casa', rama: 'dev', cambios: 5, adelante: 0, lineasMas: 40, lineasMenos: 7, ultimaActividad: '2026-10-17T19:57:00.000Z', actualizado: '2026-10-17T19:59:00.000Z' })
    expect(avisos[1]).toMatchObject({ adelante: 2, cambios: 0 })
    t += 1
    expect(await ejecutarOperacionEquipos(s, (await nuevo()).deps, 'resumen', {})).toHaveLength(2)
  })
})

describe('el historial local de este equipo se resume para los demás', () => {
  it('sube nombres de archivo, cuántas versiones y la última fecha (nunca contenido); si el historial falla, el resto se informa igual', async () => {
    const { s, srv, proyectos, deps } = await nuevo({ historial: async () => ({ total: 15, archivos: [{ ruta: 'src/app.ts', versiones: 12, ultima: '2026-10-17T20:00:00.000Z' }, { ruta: 'README.md', versiones: 3, ultima: '2026-10-16T08:00:00.000Z' }] }) })
    const { dir } = await repoConRemoto()
    proyectos.push({ id: P1, ruta: dir })
    await s.informar()
    const yo = (await s.equipo()).id
    const fila = srv.dispositivos.get(`${P1}|${yo}`) as { history: unknown; historyTotal: number }
    expect(fila.history).toEqual([{ path: 'src/app.ts', count: 12, last: '2026-10-17T20:00:00.000Z' }, { path: 'README.md', count: 3, last: '2026-10-16T08:00:00.000Z' }])
    expect(fila.historyTotal).toBe(15)

    const { equipos } = await s.listar(P1)
    expect(equipos[0]).toMatchObject({ versionesHistorial: 15, historial: [{ ruta: 'src/app.ts', versiones: 12, ultima: '2026-10-17T20:00:00.000Z' }, { ruta: 'README.md', versiones: 3 }] })

    const roto = new ServicioEquipos({ ...deps, archivo: join(await carpeta('eq-datos-'), 'e.json'), historial: async () => { throw new Error('sin historial') } })
    expect(await roto.informar()).toBe(1)
    const otro = srv.dispositivos.get(`${P1}|${(await roto.equipo()).id}`) as { history: unknown; historyTotal: number }
    expect(otro).toMatchObject({ history: [], historyTotal: 0, branch: 'main' })
  })
})
