import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import type { ejecutarEnProceso as TipoEjecutarEnProceso, ProcesosCli as TipoProcesosCli } from '../src/main/core/proceso-cli'
import type { OpcionesEjecucion } from '../src/main/core/suscripcion'
import { ServidorFalso } from './servidor-falso'

// `claude` falso MULTI-TURNO (como el real con entrada stream-json): atiende todos los mensajes del usuario y las peticiones de control
// mientras su stdin siga abierto. El texto del mensaje decide qué hace: LENTO (tarda 4 s, se puede interrumpir) y BUCLE (muchos pasos).
// Cada línea recibida se anota en FALSO_VOLCADO con el pid, para comprobar qué proceso atendió qué.
const FALSO = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const a = process.argv.slice(2)
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude')
if (a[0] === 'auth' && a[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: fs.existsSync(path.join(dir, 'sesion')), authMethod: 'claude.ai', email: 'a@x.com' }))
  process.exit(0)
}
const anota = (o) => fs.appendFileSync(process.env.FALSO_VOLCADO, JSON.stringify({ pid: process.pid, ...o }) + '\n')
const l = (o) => console.log(JSON.stringify(o))
const i = a.indexOf('--resume')
const reanuda = i >= 0 ? a[i + 1] : null
const sid = reanuda || process.env.FALSO_SID || 'cli-' + process.pid
let entrada = ''
let pendiente = null // turno en marcha: { temporizador }
let acum = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 }
let iniciado = false
anota({ arranque: true, reanuda, args: a, env: { checkpoints: process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING } })

// Consulta de un solo uso (resumen/título): JSON y fin.
if (a.includes('--no-session-persistence')) {
  let t = ''
  process.stdin.on('data', (d) => (t += d))
  process.stdin.on('end', () => {
    anota({ consulta: true, texto: t.slice(0, 80) })
    console.log(JSON.stringify({ is_error: false, result: 'Título de prueba.', modelUsage: { 'claude-haiku-5-5': { inputTokens: 10, outputTokens: 5, costUSD: 0.0001 } } }))
    process.exit(0)
  })
} else {
  process.stdin.on('data', (d) => {
    entrada += d
    let n
    while ((n = entrada.indexOf('\n')) >= 0) {
      const linea = entrada.slice(0, n)
      entrada = entrada.slice(n + 1)
      if (linea.trim()) recibir(JSON.parse(linea))
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

function resultado(error) {
  acum.inputTokens += 5; acum.outputTokens += 2; acum.cacheReadInputTokens += 1000; acum.costUSD += 0.01
  l({ type: 'result', subtype: error ? 'error_during_execution' : 'success', is_error: Boolean(error), session_id: sid, ...(error ? {} : { result: 'ok' }), usage: { input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 2 }, modelUsage: { 'claude-sonnet-5-5': { ...acum, contextWindow: 1000000 } } })
}
function paso(texto) {
  l({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 2 }, content: [{ type: 'text', text: texto }] } })
}
function recibir(m) {
  if (!iniciado) { iniciado = true; l({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-sonnet-5-5' }) }
  if (m.type === 'user') {
    const texto = typeof m.message.content === 'string' ? m.message.content : ''
    anota({ usuario: texto, uuid: m.uuid ?? null })
    if (texto.includes('LENTO')) {
      paso('empiezo')
      pendiente = setTimeout(() => { pendiente = null; paso('terminé'); resultado(false) }, 4000)
    } else if (texto.includes('BUCLE')) {
      for (let k = 0; k < 10; k++) paso('paso ' + k)
      resultado(false)
    } else {
      paso('hecho: ' + texto.slice(-20)); resultado(false)
    }
    return
  }
  if (m.type === 'control_request') {
    const sub = m.request.subtype
    anota({ control: sub })
    const ok = (response) => l({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } })
    if (sub === 'interrupt') {
      if (pendiente) { clearTimeout(pendiente); pendiente = null; resultado(true) }
      ok({ still_queued: [] })
    } else if (sub === 'side_question') ok({ response: 'RESP-LATERAL: ' + m.request.question, synthetic: false })
    else if (sub === 'get_context_usage') ok({ totalTokens: 30000, maxTokens: 1000000, percentage: 3, categories: [{ name: 'System prompt', tokens: 3600, kind: 'used' }, { name: 'Messages', tokens: 400, kind: 'used' }, { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' }, { name: 'Free space', tokens: 900000, kind: 'free' }] })
    else if (sub === 'rewind_files') ok({ canRewind: true, filesChanged: ['/p/a.txt', '/p/b.txt'] })
    else ok({})
  }
}
`

let home: string
let volcado: string
let Nucleo: new () => TipoNucleo
let ejecutarEnProceso: typeof TipoEjecutarEnProceso
let ProcesosCli: typeof TipoProcesosCli
const nucleos: TipoNucleo[] = []

type Linea = { pid: number; arranque?: boolean; reanuda?: string | null; args?: string[]; usuario?: string; uuid?: string | null; control?: string; consulta?: boolean; env?: { checkpoints?: string } }
const lineas = async (): Promise<Linea[]> =>
  (await readFile(volcado, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((x) => JSON.parse(x))
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const opciones = (extra: Partial<OpcionesEjecucion> = {}, senal = new AbortController().signal): { o: OpcionesEjecucion; eventos: EventoAgente['tipo'][] } => {
  const eventos: EventoAgente['tipo'][] = []
  const o: OpcionesEjecucion = { prompt: 'hola', cwd: home, autonomia: 'preguntar', verificaciones: [], senal, alEvento: (e) => void eventos.push(e.tipo), ...extra }
  return { o, eventos }
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'home-persistente-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  vi.stubEnv('ODESK_SIN_CAVEMAN', '1')
  const bin = join(home, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'claude'), FALSO)
  await chmod(join(bin, 'claude'), 0o755)
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  volcado = join(home, 'volcado.jsonl')
  vi.stubEnv('FALSO_VOLCADO', volcado)
  vi.stubEnv('ODESK_MAX_PASOS', '4')
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(join(home, '.claude', 'sesion'), '')
  const proyecto = join(home, 'proyecto')
  await mkdir(proyecto)
  await mkdir(join(home, '.odesk-agent'))
  const srv = await new ServidorFalso([{ id: 'p1', nombre: 'P', ruta: proyecto }]).iniciar()
  srv.apuntar()
  ;({ Nucleo } = await import('../src/main/core/index'))
  ;({ ejecutarEnProceso, ProcesosCli } = await import('../src/main/core/proceso-cli'))
  await srv.entrar()
})

afterAll(() => {
  for (const n of nucleos) n.cerrar()
})

describe('proceso persistente del CLI', () => {
  it('atiende varios mensajes con el mismo proceso, sin --resume ni nuevo arranque', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(4, 60_000)
    const a = await ejecutarEnProceso(pool, 'c1', opciones({ prompt: 'uno', mensajeId: '11111111-1111-4111-8111-111111111111' }).o)
    const b = await ejecutarEnProceso(pool, 'c1', opciones({ prompt: 'dos' }).o)
    expect(a.resultado).toMatchObject({ estado: 'completado' })
    expect(b.resultado).toMatchObject({ estado: 'completado' })
    const l = await lineas()
    expect(l.filter((x) => x.arranque)).toHaveLength(1)
    expect(l.filter((x) => x.usuario).map((x) => x.pid)).toEqual([l[0]!.pid, l[0]!.pid])
    expect(l.find((x) => x.usuario === 'uno')?.uuid).toBe('11111111-1111-4111-8111-111111111111') // el CLI conoce el id (para deshacer cambios)
    expect(l[0]!.env?.checkpoints).toBe('true')
    expect(l[0]!.args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio', '--tools']))
    pool.cerrarTodos()
  })

  it('un cambio de configuración lanza otro proceso y reanuda la sesión', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(4, 60_000)
    const a = await ejecutarEnProceso(pool, 'c2', opciones({ prompt: 'uno', modelo: 'haiku' }).o)
    await ejecutarEnProceso(pool, 'c2', opciones({ prompt: 'dos', modelo: 'opus', reanudar: a.sesionCli }).o)
    const l = await lineas()
    const arranques = l.filter((x) => x.arranque)
    expect(arranques).toHaveLength(2)
    expect(arranques[0]!.pid).not.toBe(arranques[1]!.pid)
    expect(arranques[1]!.reanuda).toBe(a.sesionCli)
    pool.cerrarTodos()
  })

  it('si el proceso murió entre mensajes, lanza otro y el mensaje no se pierde', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(4, 60_000)
    const a = await ejecutarEnProceso(pool, 'c3', opciones({ prompt: 'uno' }).o)
    pool.get('c3')!.matar()
    await esperar(300)
    const b = await ejecutarEnProceso(pool, 'c3', opciones({ prompt: 'dos', reanudar: a.sesionCli }).o)
    expect(b.resultado).toMatchObject({ estado: 'completado' })
    const l = await lineas()
    expect(l.filter((x) => x.arranque)).toHaveLength(2)
    expect(l.find((x) => x.usuario === 'dos')?.pid).toBe(l.filter((x) => x.arranque)[1]!.pid)
    pool.cerrarTodos()
  })

  it('cancelar interrumpe el turno sin matar el proceso, que sigue atendiendo', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(4, 60_000)
    const ctl = new AbortController()
    const t0 = Date.now()
    const p = ejecutarEnProceso(pool, 'c4', opciones({ prompt: 'LENTO' }, ctl.signal).o)
    await esperar(400)
    ctl.abort()
    const r = await p
    expect(r.resultado.estado).toBe('cancelado')
    expect(Date.now() - t0).toBeLessThan(3500) // no esperó los 4 s del turno
    const siguiente = await ejecutarEnProceso(pool, 'c4', opciones({ prompt: 'otra' }).o)
    expect(siguiente.resultado.estado).toBe('completado')
    const l = await lineas()
    expect(l.filter((x) => x.arranque)).toHaveLength(1) // el mismo proceso
    expect(l.some((x) => x.control === 'interrupt')).toBe(true)
    pool.cerrarTodos()
  })

  it('corta un turno que pasa del tope de pasos', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(4, 60_000)
    const r = await ejecutarEnProceso(pool, 'c5', opciones({ prompt: 'BUCLE' }).o)
    expect(r.resultado.estado).toBe('error')
    expect(r.resultado.error).toMatch(/pasó de 4 pasos/)
    pool.cerrarTodos()
  })

  it('con demasiados procesos cierra el más antiguo sin uso', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(2, 60_000)
    for (const c of ['x1', 'x2', 'x3']) {
      await ejecutarEnProceso(pool, c, opciones({ prompt: c }).o)
      await esperar(20)
    }
    await esperar(200)
    expect(pool.tamano).toBe(2)
    expect(pool.get('x1')).toBeUndefined()
    expect(pool.get('x3')).toBeDefined()
    pool.cerrarTodos()
  })

  it('las peticiones de control (side_question, get_context_usage) llegan al mismo proceso', async () => {
    await writeFile(volcado, '')
    const pool = new ProcesosCli(4, 60_000)
    await ejecutarEnProceso(pool, 'c6', opciones({ prompt: 'uno' }).o)
    const p = pool.get('c6')!
    expect(await p.control({ subtype: 'side_question', question: '¿cómo vas?' })).toMatchObject({ response: 'RESP-LATERAL: ¿cómo vas?' })
    expect(await p.control({ subtype: 'get_context_usage' })).toMatchObject({ totalTokens: 30000 })
    pool.cerrarTodos()
  })

  it('se cierra solo tras un rato sin uso', async () => {
    const pool = new ProcesosCli(4, 150)
    await ejecutarEnProceso(pool, 'c7', opciones({ prompt: 'uno' }).o)
    expect(pool.get('c7')).toBeDefined()
    await esperar(700)
    expect(pool.get('c7')).toBeUndefined()
  })
})

describe('Nucleo con proceso persistente', () => {
  const ejecutar = async (nucleo: TipoNucleo, sesionId: string, prompt: string, alEvento: (e: EventoAgente) => void = () => undefined): Promise<EventoAgente[]> => {
    const eventos: EventoAgente[] = []
    await new Promise<void>((resolver) => {
      void nucleo.ejecutar({ prompt, proyectoId: 'p1', sesionId }, (e) => {
        eventos.push(e)
        alEvento(e)
        if (e.tipo === 'fin') resolver()
      })
    })
    return eventos
  }
  const nuevo = async (): Promise<TipoNucleo> => {
    const n = new Nucleo()
    nucleos.push(n)
    await n.preferencias.fijar('suscripcion')
    return n
  }

  it('reutiliza el proceso entre mensajes y la traza guarda el consumo real y el estado', async () => {
    await writeFile(volcado, '')
    vi.stubEnv('ODESK_SIN_TITULO', '1')
    const n = await nuevo()
    const e1 = await ejecutar(n, 's-a', 'primero')
    await ejecutar(n, 's-a', 'segundo')
    const l = await lineas()
    expect(l.filter((x) => x.arranque)).toHaveLength(1)
    expect(e1.find((e) => e.tipo === 'inicio')).toMatchObject({ prompt: 'primero', mensajeId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    const trazas = await n.trazas.listar(5)
    expect(trazas[0]).toMatchObject({ estado: 'completado' })
    expect((await n.trazas.obtener(trazas[0]!.id))?.uso.tokensEntrada).toBeGreaterThan(0)
  })

  it('«Preguntar ahora» usa side_question del proceso en marcha, sin tocar la tarea', async () => {
    await writeFile(volcado, '')
    vi.stubEnv('ODESK_SIN_TITULO', '1')
    const n = await nuevo()
    let ejecucionId = ''
    const principal = ejecutar(n, 's-b', 'LENTO', (e) => void (ejecucionId = e.ejecucionId))
    await esperar(700)
    const lateral: EventoAgente[] = []
    await new Promise<void>((res) => {
      void n.preguntarLateral(ejecucionId, '¿qué haces ahora?', (e) => {
        lateral.push(e)
        if (e.tipo === 'fin') res()
      })
    })
    expect(lateral.find((e) => e.tipo === 'texto')).toMatchObject({ texto: 'RESP-LATERAL: ¿qué haces ahora?' })
    expect(lateral.find((e) => e.tipo === 'fin')).toMatchObject({ resultado: { estado: 'completado' } })
    const fin = (await principal).find((e) => e.tipo === 'fin')
    expect(fin).toMatchObject({ resultado: { estado: 'completado' } }) // la tarea siguió y terminó
    expect((await lineas()).some((x) => x.control === 'side_question')).toBe(true)
  })

  it('informa el uso real del contexto y deshace los cambios de archivos avisando al modelo', async () => {
    await writeFile(volcado, '')
    vi.stubEnv('ODESK_SIN_TITULO', '1')
    const n = await nuevo()
    const eventos = await ejecutar(n, 's-c', 'edita algo')
    const mensajeId = (eventos.find((e) => e.tipo === 'inicio') as Extract<EventoAgente, { tipo: 'inicio' }>).mensajeId!
    expect(await n.contextoUso('s-c')).toMatchObject({ total: 30000, maximo: 1000000, porcentaje: 3, categorias: [{ nombre: 'System prompt', tokens: 3600, reservado: false }, { nombre: 'Messages', tokens: 400, reservado: false }, { nombre: 'Autocompact buffer', tokens: 33000, reservado: true }] })

    expect(await n.rebobinar('s-c', mensajeId, true)).toEqual({ puede: true, archivos: ['/p/a.txt', '/p/b.txt'] })
    expect((await lineas()).filter((x) => x.control === 'rewind_files')).toHaveLength(1)
    await expect(n.rebobinar('s-c', 'no-es-un-id', false)).rejects.toThrow(/no válido/)
    expect(await n.rebobinar('s-c', mensajeId, false)).toMatchObject({ puede: true })
    await ejecutar(n, 's-c', 'sigue')
    const ultimo = (await lineas()).filter((x) => x.usuario).at(-1)!
    expect(ultimo.usuario).toContain('<aviso>El usuario deshizo los cambios de archivos')
    expect(ultimo.usuario).toContain('a.txt, b.txt')
    // El aviso se da una sola vez
    await ejecutar(n, 's-c', 'otra más')
    expect((await lineas()).filter((x) => x.usuario).at(-1)!.usuario).not.toContain('<aviso>')
  })

  it('titula la conversación con el modelo barato y respeta un título puesto a mano', async () => {
    await writeFile(volcado, '')
    vi.stubEnv('ODESK_SIN_TITULO', '')
    const n = await nuevo()
    await ejecutar(n, 's-t', 'arregla el login que falla con el token')
    await esperar(600)
    // El renderer guarda la transcripción al terminar el turno; el título pendiente se aplica entonces.
    await n.sesiones.guardarTranscripcion('s-t', [{ prompt: 'arregla el login que falla con el token', modo: 'chat', destino: 'P', raiz: 'asistente', estado: 'completado', eventos: [] }], 'p1')
    await n.aplicarTitulo('s-t')
    expect((await n.sesiones.obtener('s-t'))?.titulo).toBe('Título de prueba')
    expect((await lineas()).some((x) => x.consulta)).toBe(true)
    // Un título puesto a mano no se pisa
    await n.sesiones.guardarTranscripcion('s-t2', [{ prompt: 'otra cosa', modo: 'chat', destino: 'P', raiz: 'asistente', estado: 'completado', eventos: [] }], 'p1')
    await n.sesiones.fijarTituloAuto('s-t2', 'Primer título')
    expect((await n.sesiones.obtener('s-t2'))?.titulo).toBe('Primer título')
  })

  it('una conversación sin guardar no se crea al anotar su uso ni su título', async () => {
    const n = await nuevo()
    await n.sesiones.anotarUso('no-existe', { tokensEntrada: 1, tokensSalida: 1 })
    expect(await n.sesiones.fijarTituloAuto('no-existe', 'x')).toBe(false)
    expect(await n.sesiones.obtener('no-existe')).toBeUndefined()
  })
})
