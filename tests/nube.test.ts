import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EstadoTarea, Tarea } from '@shared/tareas'
import { ESTADOS_POR_DEFECTO } from '@shared/tareas'
import { AlmacenJson } from '../src/main/core/memory/almacen'
import { ServicioTareas, type Documento } from '../src/main/core/tareas/servicio'
import { ErrorServidor, type ClienteServidor } from '../src/main/servidor/cliente'
import { Boveda, descifrar } from '../src/main/servidor/boveda'
import { seccionesSecretas } from '../src/main/servidor/secretos'
import { FuenteArchivos, FuenteTareas, SincronizadorCuenta } from '../src/main/servidor/sync-cuenta'
import { AlmacenToken } from '../src/main/github/token'

/** Servidor en memoria con la lógica de /me/docs y /me/vault (último cambio gana, marcas de borrado, concurrencia de la bóveda). */
type Cuerpo = { id: string; data: Record<string, unknown>; updatedAt: number; base?: number; blob?: string }

class NubeFalsa {
  docs = new Map<string, { data: Record<string, unknown> | null; deleted: boolean; updatedAt: number; syncedAt?: number }>()
  reloj = 1_000_000
  pedidos: string[] = []
  vault?: Record<string, unknown> & { updatedAt: number; blob?: string }
  cliente(): ClienteServidor {
    const yo = this as NubeFalsa
    return {
      async get(ruta: string) {
        if (ruta.startsWith('/me/docs')) {
          yo.pedidos.push(ruta)
          const desde = Number(new URL(ruta, 'http://x').searchParams.get('since') ?? -1)
          const docs = [...yo.docs].filter(([, d]) => (d.syncedAt ?? 0) > desde).map(([id, { syncedAt: _s, ...d }]) => ({ id, ...d }))
          return { cursor: yo.reloj, docs }
        }
        if (ruta === '/me/vault') {
          if (!yo.vault) throw new ErrorServidor('no', 404)
          return structuredClone(yo.vault)
        }
        throw new Error(ruta)
      },
      async put(ruta: string, c: Cuerpo) {
        if (ruta === '/me/docs') {
          const a = yo.docs.get(c.id)
          if (a && a.updatedAt > c.updatedAt) return { aplicado: false }
          yo.docs.set(c.id, { data: c.data, deleted: false, updatedAt: c.updatedAt, syncedAt: ++yo.reloj })
          return { aplicado: true }
        }
        const { base, updatedAt, ...data } = c
        if (yo.vault && base !== yo.vault.updatedAt) throw new ErrorServidor('cambió', 409)
        yo.vault = { ...data, updatedAt }
        return { updatedAt }
      },
      async delete(ruta: string, c: Cuerpo) {
        if (ruta === '/me/vault') {
          yo.vault = undefined
          return undefined
        }
        const a = yo.docs.get(c.id)
        if (a && a.updatedAt > c.updatedAt) return { aplicado: false }
        yo.docs.set(c.id, { data: null, deleted: true, updatedAt: c.updatedAt, syncedAt: ++yo.reloj })
        return { aplicado: true }
      }
    } as unknown as ClienteServidor
  }
}

const carpeta = (): Promise<string> => mkdtemp(join(tmpdir(), 'nube-'))
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON leído del disco en los tests
const json = async (ruta: string): Promise<any> => JSON.parse(await readFile(ruta, 'utf8'))
async function escribir(ruta: string, v: unknown, mtime?: number): Promise<void> {
  await mkdir(join(ruta, '..'), { recursive: true })
  await writeFile(ruta, JSON.stringify(v))
  if (mtime) await utimes(ruta, mtime / 1000, mtime / 1000)
}

/** Un «equipo»: su carpeta de datos, su servicio de tareas y su sincronizador. */
async function equipo(nube: NubeFalsa, confirmar?: (cambios: string[]) => Promise<boolean>) {
  const dir = await carpeta()
  const tareas = new ServicioTareas(new AlmacenJson<Documento>(join(dir, 'tareas'), 0o600), { proyectos: async () => ({ grupos: [], proyectos: [] }) })
  const sync = new SincronizadorCuenta(nube.cliente(), join(dir, 'sync-cuenta.json'), [new FuenteArchivos(dir, undefined, confirmar), new FuenteTareas(tareas)])
  return { dir, tareas, sync }
}

const tarea = (p: Partial<Tarea>): Tarea => ({
  id: 'x', numero: 1, titulo: 't', descripcion: '', estado: 'pendiente', prioridad: 'media', etiquetas: [], creada: 1, actualizada: 10,
  criterios: [], checklist: [], dependeDe: [], referencias: [], comentarios: [], notasTecnicas: '', orden: 10, ...p
})

describe('datos de la cuenta en la nube', () => {
  let nube: NubeFalsa
  beforeEach(() => {
    nube = new NubeFalsa()
  })

  it('un comando nuevo que llega de la cuenta (proveedor o MCP) pide confirmación; si se rechaza no se aplica ni se vuelve a preguntar', async () => {
    const a = await equipo(nube)
    const preguntas: string[][] = []
    let responde = false
    const b = await equipo(nube, async (c) => (preguntas.push(c), responde))
    await escribir(join(a.dir, 'proveedores.json'), [{ id: 'p1', nombre: 'Propio', comando: 'mi-ia --rapido', env: {} }])
    await escribir(join(a.dir, 'mcp.json'), { servidores: { s: { comando: 'node', args: ['x.js'], env: {}, deshabilitado: false, riesgo: 'ejecucion' } } })
    await escribir(join(b.dir, 'proveedores.json'), [{ id: 'p1', nombre: 'Propio', comando: 'claude', env: {} }])
    await a.sync.sincronizar()
    await b.sync.sincronizar()
    expect(preguntas.flat().sort()).toEqual(['Proveedor «Propio»: mi-ia --rapido', 'Servidor MCP «s»: node x.js'])
    expect((await json(join(b.dir, 'proveedores.json')))[0].comando).toBe('claude') // rechazado: queda lo local
    await expect(readFile(join(b.dir, 'mcp.json'))).rejects.toThrow()
    await b.sync.sincronizar()
    expect(preguntas).toHaveLength(2) // no insiste con lo mismo
    responde = true
    await escribir(join(a.dir, 'proveedores.json'), [{ id: 'p1', nombre: 'Propio', comando: 'mi-ia --lento', env: {} }], Date.now() + 5000)
    await a.sync.sincronizar()
    await b.sync.sincronizar()
    expect((await json(join(b.dir, 'proveedores.json')))[0].comando).toBe('mi-ia --lento')
  })

  it('memoria, permisos y preferencias de un equipo llegan al otro; los borrados también', async () => {
    const a = await equipo(nube)
    const b = await equipo(nube)
    await escribir(join(a.dir, 'memoria', 'global.json'), { entradas: [{ titulo: 'usa pnpm' }] })
    await escribir(join(a.dir, 'permisos', 'global.json'), { reglas: [1] })
    await escribir(join(a.dir, 'preferencias.json'), { proveedor: 'api' })
    expect((await a.sync.sincronizar()).subidos).toBeGreaterThanOrEqual(3)
    await b.sync.sincronizar()
    expect(await json(join(b.dir, 'memoria', 'global.json'))).toEqual({ entradas: [{ titulo: 'usa pnpm' }] })
    expect(await json(join(b.dir, 'preferencias.json'))).toEqual({ proveedor: 'api' })
    expect(await json(join(b.dir, 'permisos', 'global.json'))).toEqual({ reglas: [1] })

    await rm(join(b.dir, 'permisos', 'global.json')) // se borra en B
    await b.sync.sincronizar()
    expect((await a.sync.sincronizar()).borrados).toBe(1)
    await expect(readFile(join(a.dir, 'permisos', 'global.json'))).rejects.toThrow()
    await a.sync.sincronizar() // el borrado no vuelve a subirse ni resucita
    expect(nube.docs.get('permisos/global.json')?.deleted).toBe(true)
  })

  it('si cambió en los dos equipos gana lo más reciente; un equipo nuevo no pisa la cuenta con sus valores por defecto', async () => {
    const a = await equipo(nube)
    await escribir(join(a.dir, 'preferencias.json'), { proveedor: 'api' })
    await a.sync.sincronizar()
    const b = await equipo(nube)
    await escribir(join(b.dir, 'preferencias.json'), { proveedor: 'suscripcion' }, Date.now() + 60_000) // «por defecto», incluso más nuevo
    await b.sync.sincronizar()
    expect(await json(join(b.dir, 'preferencias.json'))).toEqual({ proveedor: 'api' }) // primera vez: manda la cuenta

    await escribir(join(a.dir, 'preferencias.json'), { proveedor: 'suscripcion' }, Date.now() - 60_000) // cambio viejo en A
    await escribir(join(b.dir, 'preferencias.json'), { proveedor: 'otro' }, Date.now() + 120_000) // cambio nuevo en B
    await a.sync.sincronizar()
    await b.sync.sincronizar()
    await a.sync.sincronizar()
    expect(await json(join(a.dir, 'preferencias.json'))).toEqual({ proveedor: 'otro' })
  })

  it('proveedores y servidores MCP viajan SIN sus claves, y quien los recibe conserva las suyas', async () => {
    const a = await equipo(nube)
    const b = await equipo(nube)
    await escribir(join(a.dir, 'proveedores.json'), [{ id: 'claude', nombre: 'Claude', comando: 'claude', env: { ANTHROPIC_API_KEY: 'sk-ant-secreta' } }])
    await escribir(join(a.dir, 'mcp.json'), { servidores: { gh: { comando: 'gh-mcp', args: [], env: { TOKEN: 'ghp_secreto' } } } })
    await a.sync.sincronizar()
    expect(JSON.stringify([...nube.docs.values()])).not.toMatch(/secret/) // nada de claves en el servidor
    await escribir(join(b.dir, 'proveedores.json'), [{ id: 'claude', nombre: 'Viejo', comando: 'claude', env: { ANTHROPIC_API_KEY: 'clave-de-b' } }], 1000)
    await b.sync.sincronizar()
    const pb = await json(join(b.dir, 'proveedores.json'))
    expect(pb).toEqual([{ id: 'claude', nombre: 'Claude', comando: 'claude', env: { ANTHROPIC_API_KEY: 'clave-de-b' } }])
    expect((await json(join(b.dir, 'mcp.json'))).servidores.gh).toMatchObject({ comando: 'gh-mcp', env: {} })
  })

  it('tareas sin proyecto y columnas del tablero viajan; las de proyecto no van por aquí', async () => {
    const a = await equipo(nube)
    const b = await equipo(nube)
    await a.tareas.fusionar([tarea({ id: 'suelta', titulo: 'Sin proyecto' }), tarea({ id: 'deproy', numero: 2, titulo: 'De proyecto', proyectoId: 'p1' })])
    const estados: EstadoTarea[] = [...ESTADOS_POR_DEFECTO.map((e) => ({ ...e })), { id: 'qa', nombre: 'QA', categoria: 'en_curso' }]
    await a.tareas.fijarEstados(estados)
    await a.sync.sincronizar()
    expect([...nube.docs.keys()].sort()).toEqual(['tareas-estados', 'tareas/suelta'])
    await b.sync.sincronizar()
    const db = await b.tareas.leer()
    expect(db.tareas.map((t) => t.titulo)).toEqual(['Sin proyecto'])
    expect(db.estados.some((e) => e.id === 'qa')).toBe(true)
    // borrar en B la quita en A
    await b.tareas.quitarRemotas([{ id: 'suelta', hasta: Number.MAX_SAFE_INTEGER }])
    await b.sync.sincronizar()
    await a.sync.sincronizar()
    expect((await a.tareas.leer()).tareas.map((t) => t.id)).toEqual(['deproy'])
  })

  it('tras la primera pasada solo pide lo que cambió desde su cursor', async () => {
    const a = await equipo(nube)
    await a.sync.sincronizar()
    await a.sync.sincronizar()
    expect(nube.pedidos[0]).toBe('/me/docs')
    expect(nube.pedidos[1]).toMatch(/^\/me\/docs\?since=\d+$/)
  })

  it('no aplica ids que el servidor no debería tener (ni rutas fuera de la carpeta)', async () => {
    const a = await equipo(nube)
    nube.docs.set('../fuera.json', { data: { x: 1 }, deleted: false, updatedAt: 5, syncedAt: 1 })
    nube.docs.set('sesion.json', { data: { x: 1 }, deleted: false, updatedAt: 5, syncedAt: 1 })
    await a.sync.sincronizar()
    await expect(readFile(join(a.dir, '..', 'fuera.json'))).rejects.toThrow()
    await expect(readFile(join(a.dir, 'sesion.json'))).rejects.toThrow()
  })
})

describe('bóveda de claves', () => {
  const cifrador = { disponible: () => true, cifrar: (t: string) => Buffer.from(t).toString('hex'), descifrar: (t: string) => Buffer.from(t, 'hex').toString() }

  async function equipoConClaves(nube: NubeFalsa) {
    const dir = await carpeta()
    const github = new AlmacenToken(join(dir, 'github.json'), cifrador)
    const b = new Boveda(nube.cliente(), join(dir, 'boveda-clave.json'), join(dir, 'boveda-estado.json'), cifrador, seccionesSecretas(dir, github))
    return { dir, github, boveda: b }
  }

  it('cifra en el equipo: el servidor nunca ve claves ni la frase; otro equipo las recibe con la frase', async () => {
    const nube = new NubeFalsa()
    const a = await equipoConClaves(nube)
    await escribir(join(a.dir, 'proveedores.json'), [{ id: 'claude', nombre: 'C', comando: 'claude', env: { ANTHROPIC_API_KEY: 'sk-ant-muy-secreta' } }])
    await escribir(join(a.dir, 'mcp.json'), { servidores: { gh: { comando: 'x', env: { TOKEN: 'ghp_tok' } } } })
    await escribir(join(a.dir, 'api', 'datos.json'), { colecciones: [{ nombre: 'Mi API' }], entornos: [{ vars: { token: 'abc' } }], historial: [] })
    await a.github.guardar('ghp_githubtoken', 'yo')
    await expect(a.boveda.crear('corta')).rejects.toThrow(/10 caracteres/)
    await a.boveda.crear('frase muy larga y secreta')
    const texto = JSON.stringify(nube.vault)
    for (const s of ['sk-ant-muy-secreta', 'ghp_tok', 'ghp_githubtoken', 'Mi API', 'frase muy larga']) expect(texto).not.toContain(s)

    const b = await equipoConClaves(nube)
    await escribir(join(b.dir, 'proveedores.json'), [{ id: 'claude', nombre: 'C', comando: 'claude', env: {} }])
    await escribir(join(b.dir, 'mcp.json'), { servidores: { gh: { comando: 'x', env: {} } } })
    expect(await b.boveda.estado()).toMatchObject({ configurada: true, desbloqueada: false })
    await expect(b.boveda.desbloquear('frase equivocada!!')).rejects.toThrow(/no es correcta/)
    await b.boveda.desbloquear('frase muy larga y secreta')
    expect((await json(join(b.dir, 'proveedores.json')))[0].env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-muy-secreta' })
    expect((await json(join(b.dir, 'mcp.json'))).servidores.gh.env).toEqual({ TOKEN: 'ghp_tok' })
    expect((await json(join(b.dir, 'api', 'datos.json'))).colecciones[0].nombre).toBe('Mi API')
    expect((await b.github.leer())?.token).toBe('ghp_githubtoken')
  })

  it('cambios por sección en dos equipos se suman (no se pisan), y un proveedor que un equipo no tiene no pierde su clave', async () => {
    const nube = new NubeFalsa()
    const a = await equipoConClaves(nube)
    await escribir(join(a.dir, 'proveedores.json'), [{ id: 'claude', env: { K: 'a' }, nombre: 'C', comando: 'claude' }])
    await a.boveda.crear('frase muy larga y secreta')
    const b = await equipoConClaves(nube)
    await escribir(join(b.dir, 'proveedores.json'), [{ id: 'gemini', env: { G: 'b' }, nombre: 'G', comando: 'gemini' }])
    await b.boveda.desbloquear('frase muy larga y secreta')
    await b.github.guardar('tok-b')
    await b.boveda.sincronizar()
    await a.boveda.sincronizar()
    const contenido = descifrar((a.boveda as unknown as { clave: Buffer }).clave, nube.vault!.blob!)
    expect(contenido.secciones.proveedores!.data).toEqual({ claude: { K: 'a' }, gemini: { G: 'b' } })
    expect((await a.github.leer())?.token).toBe('tok-b')
  })

  it('cambiar la frase deja fuera a los equipos con la clave vieja; «olvidé la frase» borra la bóveda', async () => {
    const nube = new NubeFalsa()
    const a = await equipoConClaves(nube)
    await a.boveda.crear('frase muy larga y secreta')
    const b = await equipoConClaves(nube)
    await b.boveda.desbloquear('frase muy larga y secreta')
    await a.boveda.cambiarFrase('frase muy larga y secreta', 'otra frase distinta y larga')
    await b.boveda.sincronizar()
    expect((await b.boveda.estado()).desbloqueada).toBe(false)
    await b.boveda.desbloquear('otra frase distinta y larga')
    expect((await b.boveda.estado()).desbloqueada).toBe(true)
    await b.boveda.reiniciar()
    expect(nube.vault).toBeUndefined()
  })
})
