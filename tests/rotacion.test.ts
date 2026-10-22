import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { TurnoGuardado } from '@shared/core/sesion'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import { ServidorFalso } from './servidor-falso'

// `claude` falso: con `--no-session-persistence` (la consulta de resumen) devuelve JSON; en `-p` emite un stream cuyo contexto sale de FALSO_CTX y cuyo
// `modelUsage` ACUMULA por sesión, como el CLI real. Cada invocación se anota en FALSO_VOLCADO.
const FALSO = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const a = process.argv.slice(2)
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude')
if (a[0] === 'auth' && a[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: fs.existsSync(path.join(dir, 'sesion')), authMethod: 'claude.ai', email: 'a@x.com' }))
  process.exit(0)
}
let entrada = ''
let hecho = false
process.stdin.on('data', (d) => { entrada += d; if (entrada.includes('\\n')) arrancar() })
process.stdin.on('end', arrancar)
function arrancar() {
  if (hecho) return
  hecho = true
  const i = a.indexOf('--resume')
  let texto = entrada
  try { texto = JSON.parse(entrada.split('\\n')[0]).message.content } catch {}
  const resumen = a.includes('--no-session-persistence')
  fs.appendFileSync(process.env.FALSO_VOLCADO, JSON.stringify({ resumen, reanuda: i >= 0 ? a[i + 1] : null, texto, args: a, env: { ventana: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW } }) + '\\n')
  if (resumen) {
    console.log(JSON.stringify({ is_error: false, result: process.env.FALSO_RESUMEN_FALLA ? '' : 'RESUMEN-FALSO: objetivo X', modelUsage: { 'claude-haiku-5-5': { inputTokens: 50, outputTokens: 20, costUSD: 0.001 } } }))
    process.exit(process.env.FALSO_RESUMEN_FALLA ? 1 : 0)
  }
  const sid = process.env.FALSO_SID || 'cli-1'
  const ctx = Number(process.env.FALSO_CTX || 1000)
  const archivo = process.env.FALSO_VOLCADO + '.acc'
  const acc = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : {}
  const m = (acc[sid] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 })
  m.inputTokens += 5; m.outputTokens += 2; m.cacheReadInputTokens += ctx; m.costUSD += 0.1
  fs.writeFileSync(archivo, JSON.stringify(acc))
  const l = (o) => console.log(JSON.stringify(o))
  l({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-sonnet-5-5' })
  const imagen = process.env.FALSO_IMAGENES ? Number(process.env.FALSO_IMAGENES) : 0
  l({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: ctx, output_tokens: 2 }, content: [{ type: 'text', text: 'ok' }, ...(imagen ? [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'x.png' } }] : [])] } })
  if (imagen) l({ type: 'user', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: Array.from({ length: imagen }, () => ({ type: 'image', source: {} })) }] } })
  l({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'ok', usage: { input_tokens: 5, cache_read_input_tokens: ctx, output_tokens: 2 }, modelUsage: { 'claude-sonnet-5-5': { ...m, contextWindow: 1000000 } } })
  process.exit(0)
}
`

let home: string
let volcado: string
let Nucleo: new () => TipoNucleo

const invocaciones = async (): Promise<{ resumen: boolean; reanuda: string | null; texto: string; args: string[]; env: { ventana?: string } }[]> =>
  (await readFile(volcado, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

const turno = (prompt: string): TurnoGuardado => ({ prompt, modo: 'chat', destino: 'P', raiz: 'asistente', estado: 'completado', eventos: [{ ejecucionId: 'e', agente: 'asistente', profundidad: 0, tipo: 'texto', texto: `respuesta a ${prompt}` }] })

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'home-rotacion-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('ODESK_PROCESO_POR_TURNO', '1') // el `claude` falso atiende un solo mensaje: aquí se prueba la lógica por turno
  vi.stubEnv('ODESK_SIN_TITULO', '1')
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  vi.stubEnv('ODESK_SIN_CAVEMAN', '1')
  const bin = join(home, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'claude'), FALSO)
  await chmod(join(bin, 'claude'), 0o755)
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  volcado = join(home, 'volcado.jsonl')
  vi.stubEnv('FALSO_VOLCADO', volcado)
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(join(home, '.claude', 'sesion'), '')
  const proyecto = join(home, 'proyecto')
  await mkdir(proyecto)
  await mkdir(join(home, '.odesk-agent'))
  const srv = await new ServidorFalso([{ id: 'p1', nombre: 'P', ruta: proyecto }]).iniciar()
  srv.apuntar()
  ;({ Nucleo } = await import('../src/main/core/index'))
  await srv.entrar()
})

describe('Nucleo: rotación de sesión para no arrastrar contexto enorme', () => {
  const ejecutar = async (nucleo: TipoNucleo, sesionId: string, prompt: string): Promise<EventoAgente[]> => {
    const eventos: EventoAgente[] = []
    await new Promise<void>((resolver) => {
      void nucleo.ejecutar({ prompt, proyectoId: 'p1', sesionId }, (e) => {
        eventos.push(e)
        if (e.tipo === 'fin') resolver()
      })
    })
    return eventos
  }

  it('con el contexto grande abre una sesión nueva con un resumen; luego vuelve a reanudar', async () => {
    await writeFile(volcado, '')
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('suscripcion')

    // Turno 1: sesión nueva cuyo contexto ya llega a 180 k.
    vi.stubEnv('FALSO_CTX', '180000')
    vi.stubEnv('FALSO_SID', 'cli-A')
    const e1 = await ejecutar(nucleo, 's-rot', 'primera petición')
    expect(e1.find((e) => e.tipo === 'contexto_compactado')).toBeUndefined()
    expect(e1.find((e) => e.tipo === 'aviso_consumo')).toMatchObject({ motivo: 'contexto', tokens: 180005 })
    // El renderer guarda la transcripción al terminar cada turno: de ahí sale el resumen.
    await nucleo.sesiones.guardarTranscripcion('s-rot', [turno('primera petición')], 'p1')

    // Turno 2: antes de reanudar, resume y arranca otra sesión sin --resume.
    vi.stubEnv('FALSO_CTX', '5000')
    vi.stubEnv('FALSO_SID', 'cli-B')
    const e2 = await ejecutar(nucleo, 's-rot', 'segunda petición')
    expect(e2.find((e) => e.tipo === 'contexto_compactado')).toMatchObject({ motivo: 'contexto', tokensAntes: 180005, conModelo: true })
    expect(e2.find((e) => e.tipo === 'inicio')).toMatchObject({ prompt: 'segunda petición' }) // el usuario no ve el bloque de contexto
    const l = await invocaciones()
    expect(l.map((x) => x.resumen)).toEqual([false, true, false])
    expect(l[1]!.texto).toContain('primera petición') // el digest de lo hablado
    expect(l[1]!.args).toEqual(expect.arrayContaining(['--tools', '--no-session-persistence', '--model', 'haiku']))
    expect(l[2]!.reanuda).toBeNull()
    expect(l[2]!.texto).toContain('<contexto_previo motivo="contexto">')
    expect(l[2]!.texto).toContain('RESUMEN-FALSO: objetivo X')
    expect(l[2]!.texto).toContain('segunda petición')

    // Turno 3: contexto chico: se reanuda la sesión NUEVA, sin reenviar el resumen.
    const e3 = await ejecutar(nucleo, 's-rot', 'tercera petición')
    expect(e3.find((e) => e.tipo === 'contexto_compactado')).toBeUndefined()
    const l3 = (await invocaciones()).at(-1)!
    expect(l3.reanuda).toBe('cli-B')
    expect(l3.texto).toBe('tercera petición')
    expect(l3.env.ventana).toBe('200000')
  })

  it('el medidor suma lo de cada ejecución, no el acumulado de la sesión cada vez', async () => {
    await writeFile(volcado, '')
    await writeFile(`${volcado}.acc`, '{}')
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('suscripcion')
    const antes = (await nucleo.medidor.resumen()).total.entrada
    vi.stubEnv('FALSO_CTX', '1000')
    vi.stubEnv('FALSO_SID', 'cli-M')
    for (const p of ['uno', 'dos', 'tres']) await ejecutar(nucleo, 's-med', p)
    const despues = (await nucleo.medidor.resumen()).total.entrada
    // Cada ejecución real: 5 de entrada + 1000 leídos de caché = 1005. Con el acumulado sin restar saldría 1005 + 2010 + 3015.
    expect(despues - antes).toBe(3 * 1005)
  })

  it('con muchas imágenes en el contexto también rota', async () => {
    await writeFile(volcado, '')
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('suscripcion')
    vi.stubEnv('FALSO_CTX', '3000')
    vi.stubEnv('FALSO_SID', 'cli-I1')
    vi.stubEnv('FALSO_IMAGENES', '12')
    await ejecutar(nucleo, 's-img', 'mira las capturas')
    await nucleo.sesiones.guardarTranscripcion('s-img', [turno('mira las capturas')], 'p1')
    vi.stubEnv('FALSO_IMAGENES', '0')
    vi.stubEnv('FALSO_SID', 'cli-I2')
    const e = await ejecutar(nucleo, 's-img', 'sigue')
    expect(e.find((x) => x.tipo === 'contexto_compactado')).toMatchObject({ motivo: 'imagenes', imagenes: 12 })
  })

  it('si el resumen falla usa la cola del digest y no bloquea', async () => {
    await writeFile(volcado, '')
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('suscripcion')
    vi.stubEnv('FALSO_CTX', '190000')
    vi.stubEnv('FALSO_SID', 'cli-F1')
    vi.stubEnv('FALSO_IMAGENES', '0')
    await ejecutar(nucleo, 's-fall', 'trabajo importante')
    await nucleo.sesiones.guardarTranscripcion('s-fall', [turno('trabajo importante')], 'p1')
    vi.stubEnv('FALSO_RESUMEN_FALLA', '1')
    vi.stubEnv('FALSO_SID', 'cli-F2')
    vi.stubEnv('FALSO_CTX', '2000')
    const e = await ejecutar(nucleo, 's-fall', 'sigue')
    expect(e.find((x) => x.tipo === 'contexto_compactado')).toMatchObject({ conModelo: false })
    const ultima = (await invocaciones()).at(-1)!
    expect(ultima.reanuda).toBeNull()
    expect(ultima.texto).toContain('trabajo importante')
    vi.stubEnv('FALSO_RESUMEN_FALLA', '')
  })

  it('sin transcripción guardada no rota (se perdería todo) y sigue reanudando', async () => {
    await writeFile(volcado, '')
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('suscripcion')
    vi.stubEnv('FALSO_CTX', '190000')
    vi.stubEnv('FALSO_SID', 'cli-S1')
    await ejecutar(nucleo, 's-sin', 'uno')
    const e = await ejecutar(nucleo, 's-sin', 'dos')
    expect(e.find((x) => x.tipo === 'contexto_compactado')).toBeUndefined()
    expect((await invocaciones()).at(-1)!.reanuda).toBe('cli-S1')
  })
})
