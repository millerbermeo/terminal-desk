import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import { Cuentas, llevarSesion } from '../src/main/core/cuentas'
import { ejecutarSuscripcion, esErrorDeLimite } from '../src/main/core/suscripcion'

// `claude` falso por carpeta de configuración: hay sesión si existe `<config>/sesion`; está en el límite si existe `<config>/limite`;
// `--resume <id>` solo funciona si existe `<config>/projects/*/<id>.jsonl`. Cada ejecución se anota en FALSO_VOLCADO.
const FALSO = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const a = process.argv.slice(2)
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude')
const hay = (f) => fs.existsSync(path.join(dir, f))
if (a[0] === 'auth' && a[1] === 'status') {
  const si = hay('sesion')
  console.log(JSON.stringify(si ? { loggedIn: true, authMethod: 'claude.ai', email: path.basename(dir) + '@x.com' } : { loggedIn: false }))
  process.exit(si ? 0 : 1)
}
let entrada = ''
process.stdin.on('data', (d) => (entrada += d))
process.stdin.on('end', () => {
  const i = a.indexOf('--resume')
  const reanuda = i >= 0 ? a[i + 1] : null
  const sesionOk = !reanuda || (fs.existsSync(path.join(dir, 'projects')) && fs.readdirSync(path.join(dir, 'projects')).some((p) => fs.existsSync(path.join(dir, 'projects', p, reanuda + '.jsonl'))))
  fs.appendFileSync(process.env.FALSO_VOLCADO, JSON.stringify({ dir, reanuda, sesionOk, clave: process.env.ANTHROPIC_API_KEY ?? null }) + '\\n')
  const l = (o) => console.log(JSON.stringify(o))
  l({ type: 'system', subtype: 'init', session_id: 'cli-1', model: 'claude-sonnet-5-5' })
  if (hay('limite')) {
    l({ type: 'rate_limit_event', session_id: 'cli-1', rate_limit_info: { status: 'rejected', resetsAt: 4102444800, rateLimitType: 'five_hour' } })
    l({ type: 'result', subtype: 'success', is_error: true, session_id: 'cli-1', result: "You've hit your limit", api_error_status: 429 })
    process.exit(1)
  }
  if (!sesionOk) {
    l({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'cli-1', result: 'No conversation found with session ID: ' + reanuda })
    process.exit(1)
  }
  l({ type: 'assistant', session_id: 'cli-1', parent_tool_use_id: null, message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, output_tokens: 2 }, content: [{ type: 'text', text: 'hola desde ' + path.basename(dir) }] } })
  l({ type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', result: 'hola desde ' + path.basename(dir), usage: { input_tokens: 5, output_tokens: 2 } })
})
`

let home: string
let volcado: string
let Nucleo: new () => TipoNucleo

const tocar = async (ruta: string, contenido = ''): Promise<void> => {
  await mkdir(join(ruta, '..'), { recursive: true })
  await writeFile(ruta, contenido)
}
const lineasVolcado = async (): Promise<{ dir: string; reanuda: string | null; sesionOk: boolean; clave: string | null }[]> =>
  (await readFile(volcado, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'home-cuentas-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  const bin = join(home, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'claude'), FALSO)
  await chmod(join(bin, 'claude'), 0o755)
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  volcado = join(home, 'volcado.jsonl')
  vi.stubEnv('FALSO_VOLCADO', volcado)
  const proyecto = join(home, 'proyecto')
  await mkdir(proyecto)
  await mkdir(join(home, '.centro-proyectos'))
  await writeFile(join(home, '.centro-proyectos', 'proyectos.json'), JSON.stringify({ grupos: [], proyectos: [{ id: 'p1', nombre: 'P', ruta: proyecto }] }))
  ;({ Nucleo } = await import('../src/main/core/index'))
})

describe('almacén de cuentas', () => {
  it('siempre tiene la principal, añade, activa, marca límites y quita', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuentas-'))
    const c = new Cuentas(join(dir, 'cuentas.json'), join(dir, 'carpetas'))
    expect((await c.listar()).map((x) => x.id)).toEqual(['principal'])
    expect(c.carpetaDe('principal')).toBeUndefined()

    const id = await c.agregar('  Trabajo  ')
    expect(await c.activa()).toBe(id)
    expect((await stat(join(dir, 'carpetas', id))).isDirectory()).toBe(true)
    await expect(c.agregar('trabajo')).rejects.toThrow(/Ya hay/)
    await expect(c.agregar('Principal')).rejects.toThrow(/Ya hay/)
    await expect(c.agregar('   ')).rejects.toThrow(/nombre/)

    await c.marcarLimite(id, Date.now() + 60_000)
    expect((await c.listar()).find((x) => x.id === id)?.limiteHasta).toBeGreaterThan(Date.now())
    expect(await c.candidatas(new Set())).toEqual(['principal'])
    // Un límite ya vencido deja de contar
    await c.marcarLimite(id, Date.now() - 1)
    expect(await c.candidatas(new Set(['principal']))).toEqual([id])

    // Se recuerda entre arranques
    await c.fijarAutomatico(true)
    const otra = new Cuentas(join(dir, 'cuentas.json'), join(dir, 'carpetas'))
    expect(await otra.automatico()).toBe(true)
    expect(await otra.activa()).toBe(id)

    await expect(c.quitar('principal')).rejects.toThrow(/principal/)
    await c.quitar(id)
    expect(await c.activa()).toBe('principal')
    await expect(stat(join(dir, 'carpetas', id))).rejects.toThrow()
  })

  it('activar a mano una cuenta agotada la vuelve a intentar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuentas-'))
    const c = new Cuentas(join(dir, 'cuentas.json'), join(dir, 'carpetas'))
    const id = await c.agregar('B')
    await c.marcarLimite(id, Date.now() + 60_000)
    await c.activar(id)
    expect((await c.listar()).find((x) => x.id === id)?.limiteHasta).toBeUndefined()
  })
})

describe('llevarSesion', () => {
  it('copia el archivo de la conversación (y su carpeta) a la otra cuenta, y es idempotente', async () => {
    const a = await mkdtemp(join(tmpdir(), 'cfg-a-'))
    const b = await mkdtemp(join(tmpdir(), 'cfg-b-'))
    await tocar(join(a, 'projects', '-proy', 's1.jsonl'), '{"x":1}\n')
    await tocar(join(a, 'projects', '-proy', 's1', 'tool-results', 'r.txt'), 'r')
    expect(await llevarSesion('s1', b, [a, b])).toBe(true)
    expect(await readFile(join(b, 'projects', '-proy', 's1.jsonl'), 'utf8')).toBe('{"x":1}\n')
    expect(await readFile(join(b, 'projects', '-proy', 's1', 'tool-results', 'r.txt'), 'utf8')).toBe('r')
    expect(await llevarSesion('s1', b, [a])).toBe(true)
    expect(await llevarSesion('no-existe', b, [a])).toBe(false)
    expect(await llevarSesion('../escapa', b, [a])).toBe(false)
  })
})

describe('detección de límite', () => {
  it('reconoce los textos de límite de uso y no los de contexto', () => {
    expect(esErrorDeLimite("5-hour limit reached ∙ resets 3pm")).toBe(true)
    expect(esErrorDeLimite('Claude usage limit reached')).toBe(true)
    expect(esErrorDeLimite("You've hit your limit")).toBe(true)
    expect(esErrorDeLimite('Context limit reached')).toBe(false)
    expect(esErrorDeLimite('Budget limit reached')).toBe(false)
    expect(esErrorDeLimite('Error de sintaxis')).toBe(false)
  })

  it('el CLI rechazado por límite se informa con su fecha y no emite `fin` si se retiene', async () => {
    const cfg = join(home, 'cfg-limite')
    await tocar(join(cfg, 'sesion'))
    await tocar(join(cfg, 'limite'))
    const eventos: string[] = []
    const r = await ejecutarSuscripcion({ prompt: 'x', cwd: home, autonomia: 'preguntar', verificaciones: [], senal: new AbortController().signal, carpetaCuenta: cfg, retenerFin: true, omitirInicio: true, alEvento: (e) => void eventos.push(e.tipo) })
    expect(r.limite).toEqual({ hasta: 4102444800 * 1000 })
    expect(r.herramientas).toBe(0)
    expect(r.resultado.estado).toBe('error')
    expect(eventos).not.toContain('fin')
    expect(eventos).not.toContain('inicio')
  })
})

describe('Nucleo: varias cuentas de suscripción', () => {
  const ejecutar = async (nucleo: TipoNucleo): Promise<EventoAgente[]> => {
    const eventos: EventoAgente[] = []
    await new Promise<void>((resolver) => {
      void nucleo.ejecutar({ prompt: 'hola', proyectoId: 'p1', sesionId: 's1' }, (e) => {
        eventos.push(e)
        if (e.tipo === 'fin') resolver()
      })
    })
    return eventos
  }

  it('al llegar al límite pasa a otra cuenta con sesión, lleva la conversación y recuerda el límite', async () => {
    await writeFile(volcado, '')
    const nucleo = new Nucleo()
    const principal = join(home, '.claude')
    await tocar(join(principal, 'sesion'))
    await tocar(join(principal, 'limite'))
    await tocar(join(principal, 'projects', '-proy', 'prev.jsonl'), '{}\n')
    await writeFile(join(home, '.centro-proyectos', 'sesiones-cli.json'), JSON.stringify({ s1: 'prev' }))

    await nucleo.cuentaAgregar('Trabajo')
    const trabajo = (await nucleo.cuentaEstado()).cuentas.find((c) => c.nombre === 'Trabajo')!
    await tocar(join(home, '.centro-proyectos', 'cuentas', trabajo.id, 'sesion'))
    await nucleo.cuentaActivar('principal')
    await nucleo.cuentaCambioAutomatico(true)

    const eventos = await ejecutar(nucleo)
    expect(eventos.filter((e) => e.tipo === 'inicio')).toHaveLength(1)
    expect(eventos.find((e) => e.tipo === 'cuenta_cambiada')).toMatchObject({ de: 'Principal', a: 'Trabajo' })
    expect(eventos.find((e) => e.tipo === 'fin')).toMatchObject({ resultado: { estado: 'completado', texto: `hola desde ${trabajo.id}` } })

    const llamadas = await lineasVolcado()
    expect(llamadas).toHaveLength(2)
    expect(llamadas[0]).toMatchObject({ dir: principal, reanuda: 'prev' })
    // La conversación se copió a la otra cuenta y su --resume funcionó
    expect(llamadas[1]).toMatchObject({ dir: join(home, '.centro-proyectos', 'cuentas', trabajo.id), reanuda: 'prev', sesionOk: true, clave: null })

    const estado = await nucleo.cuentaEstado()
    expect(estado.cuentaActivaId).toBe(trabajo.id)
    expect(estado.cuentas.find((c) => c.id === 'principal')?.limiteHasta).toBeGreaterThan(Date.now())

    // Siguiente mensaje: la cuenta activa ya es la buena, no se vuelve a la agotada
    const otra = await ejecutar(nucleo)
    expect(otra.some((e) => e.tipo === 'cuenta_cambiada')).toBe(false)
    expect((await lineasVolcado()).at(-1)?.dir).toContain(trabajo.id)
  })

  it('sin cambio automático el límite se muestra como error y no se cambia de cuenta', async () => {
    const nucleo = new Nucleo()
    await nucleo.cuentaActivar('principal')
    await nucleo.cuentaCambioAutomatico(false)
    const antes = (await lineasVolcado()).length
    const eventos = await ejecutar(nucleo)
    expect(eventos.some((e) => e.tipo === 'cuenta_cambiada')).toBe(false)
    expect(eventos.find((e) => e.tipo === 'fin')).toMatchObject({ resultado: { estado: 'error' } })
    expect((await lineasVolcado()).length).toBe(antes + 1)
    expect((await nucleo.cuentaEstado()).cuentaActivaId).toBe('principal')
  })

  it('si no hay otra cuenta disponible, termina con el error real del CLI', async () => {
    const nucleo = new Nucleo()
    await nucleo.cuentaActivar('principal')
    await nucleo.cuentaCambioAutomatico(true)
    // La otra cuenta está agotada (marcada) y no se usa
    const trabajo = (await nucleo.cuentaEstado()).cuentas.find((c) => c.nombre === 'Trabajo')!
    await nucleo.cuentas.marcarLimite(trabajo.id, Date.now() + 60_000)
    const antes = (await lineasVolcado()).length
    const eventos = await ejecutar(nucleo)
    expect(eventos.some((e) => e.tipo === 'cuenta_cambiada')).toBe(false)
    expect(eventos.find((e) => e.tipo === 'fin')).toMatchObject({ resultado: { estado: 'error' } })
    expect((await lineasVolcado()).length).toBe(antes + 1)
  })
})
