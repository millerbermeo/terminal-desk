import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { ejecutarSuscripcion, estadoSesion, permisosCli, Preferencias, SesionesCli } from '../src/main/core/suscripcion'

// `claude` falso: responde a `auth status` y, en modo `-p`, emite un stream-json fijo y vuelca sus argumentos y stdin.
const FALSO = `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
if (a[0] === 'auth' && a[1] === 'status') {
  const estado = process.env.FALSO_SESION
  console.log(JSON.stringify(estado === 'no' ? { loggedIn: false } : { loggedIn: true, authMethod: estado === 'consola' ? 'console' : 'claude.ai', email: 'a@b.c' }))
  process.exit(estado === 'no' ? 1 : 0)
}
let entrada = ''
process.stdin.on('data', (d) => (entrada += d))
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FALSO_VOLCADO, JSON.stringify({ args: a, entrada, clave: process.env.ANTHROPIC_API_KEY ?? null }))
  const l = (o) => console.log(JSON.stringify(o))
  l({ type: 'system', subtype: 'init', session_id: 'cli-1', model: 'claude-sonnet-5-5' })
  l({ type: 'stream_event', session_id: 'cli-1', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ho' } } })
  l({ type: 'assistant', session_id: 'cli-1', parent_tool_use_id: null, message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }, content: [{ type: 'text', text: 'hola' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x' } }] } })
  l({ type: 'user', session_id: 'cli-1', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'contenido', is_error: false }] } })
  l({ type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', result: 'listo', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 7 } })
})
`

let dir: string
let volcado: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-falso-'))
  volcado = join(dir, 'volcado.json')
  await writeFile(join(dir, 'claude'), FALSO)
  await chmod(join(dir, 'claude'), 0o755)
  process.env.PATH = `${dir}:${process.env.PATH}`
  process.env.FALSO_VOLCADO = volcado
})

describe('suscripción (CLI claude)', () => {
  it('distingue sin sesión, sesión de consola y sesión de suscripción', async () => {
    process.env.FALSO_SESION = 'no'
    expect(await estadoSesion()).toMatchObject({ cli: true, sesion: false })
    process.env.FALSO_SESION = 'consola'
    expect(await estadoSesion()).toMatchObject({ sesion: false, metodo: 'console' })
    process.env.FALSO_SESION = 'si'
    expect(await estadoSesion()).toMatchObject({ sesion: true, email: 'a@b.c' })
  })

  it('traduce el stream a eventos, no pasa la clave de API y reanuda la sesión', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-no-debe-llegar'
    const eventos: EventoAgente['tipo'][] = []
    const r = await ejecutarSuscripcion({
      prompt: 'di hola',
      cwd: dir,
      modelo: 'claude-opus-5-5',
      reanudar: 'previa',
      autonomia: 'preguntar',
      verificaciones: [],
      sistemaExtra: 'memoria',
      senal: new AbortController().signal,
      alEvento: (e) => eventos.push(e.tipo)
    })
    delete process.env.ANTHROPIC_API_KEY
    expect(r.sesionCli).toBe('cli-1')
    expect(r.resultado).toMatchObject({ estado: 'completado', texto: 'listo', pasos: 1, uso: { tokensEntrada: 100, tokensSalida: 7 } })
    expect(eventos).toEqual(['inicio', 'texto_delta', 'paso', 'texto', 'herramienta_inicio', 'herramienta_fin', 'uso_contexto', 'fin'])
    const v = JSON.parse(await (await import('node:fs/promises')).readFile(volcado, 'utf8'))
    expect(v.entrada).toBe('di hola')
    expect(v.clave).toBeNull()
    expect(v.args).toEqual(expect.arrayContaining(['--resume', 'previa', '--model', 'claude-opus-5-5', '--append-system-prompt', 'memoria', '--permission-mode', 'default']))
  })

  it('traduce la autonomía a permisos del CLI', () => {
    expect(permisosCli('preguntar', [])).toEqual(['--permission-mode', 'default', '--allowedTools', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'])
    expect(permisosCli('ediciones', [])[1]).toBe('acceptEdits')
    const autonomo = permisosCli('autonomo', [])
    expect(autonomo).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', '--disallowedTools', 'Bash(sudo:*)']))
    expect(autonomo.indexOf('--disallowedTools')).toBeGreaterThan(autonomo.indexOf('Bash'))
    for (const modo of ['preguntar', 'ediciones'] as const) expect(permisosCli(modo, [])).not.toContain('Bash')
  })

  it('la preferencia es suscripción por defecto y se recuerda; las sesiones del CLI se guardan', async () => {
    const p = new Preferencias(join(dir, 'pref', 'preferencias.json'))
    expect(await p.proveedor()).toBe('suscripcion')
    await p.fijar('api')
    expect(await new Preferencias(join(dir, 'pref', 'preferencias.json')).proveedor()).toBe('api')
    const s = new SesionesCli(join(dir, 'pref', 'sesiones-cli.json'))
    await s.guardar('a', 'x')
    expect(await s.obtener('a')).toBe('x')
    expect(await s.obtener('b')).toBeUndefined()
  })
})

describe('subagentes integrados', () => {
  it('se bloquean sin tocar los permisos propios (añadiéndose a --disallowedTools si ya existe)', async () => {
    const { sinSubagentesIntegrados, SUBAGENTES_INTEGRADOS } = await import('../src/main/core/suscripcion')
    const pre = sinSubagentesIntegrados(permisosCli('preguntar', []))
    expect(pre.slice(-SUBAGENTES_INTEGRADOS.length - 1)).toEqual(['--disallowedTools', ...SUBAGENTES_INTEGRADOS])
    const auto = sinSubagentesIntegrados(permisosCli('autonomo', []))
    expect(auto.filter((a) => a === '--disallowedTools')).toHaveLength(1)
    expect(auto).toContain('Agent(Explore)')
    expect(auto).toContain('Bash(sudo:*)')
  })
})
