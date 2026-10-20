import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { ejecutarSuscripcion } from '../src/main/core/suscripcion'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { LlmFalso, texto } from './ayudas'

// Cambiar de modelo a mitad de una conversación: cada mensaje debe ir al modelo elegido en ese momento y conservar el historial.

describe('cambio de modelo en una conversación activa (API)', () => {
  it('cada turno usa el modelo pedido y el historial se mantiene', async () => {
    const llm = new LlmFalso([texto('uno'), texto('dos'), texto('tres')])
    const harness = new Harness({ llm, registro: new RegistroHerramientas() })
    const agente = new Agente({ nombre: 'a', descripcion: '', sistema: 's', herramientas: [] })

    const r1 = await harness.ejecutar(agente, { prompt: 'primero', cwd: '.', modelo: 'claude-sonnet-5-5' })
    const r2 = await harness.ejecutar(agente, { prompt: 'segundo', cwd: '.', modelo: 'claude-opus-5-5', historial: r1.mensajes })
    const r3 = await harness.ejecutar(agente, { prompt: 'tercero', cwd: '.', modelo: 'claude-haiku-5-5', historial: r2.mensajes })

    expect(llm.peticiones.map((p) => p.modelo)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])
    expect(JSON.stringify(llm.peticiones[2]!.mensajes)).toContain('primero')
    expect(JSON.stringify(llm.peticiones[2]!.mensajes)).toContain('segundo')
    expect(r3.mensajes).toHaveLength(6)
  })

  it('volver a «automático» (sin modelo) no arrastra el modelo anterior', async () => {
    const llm = new LlmFalso([texto('uno'), texto('dos')])
    const harness = new Harness({ llm, registro: new RegistroHerramientas() })
    const agente = new Agente({ nombre: 'a', descripcion: '', sistema: 's', herramientas: [] })
    const r1 = await harness.ejecutar(agente, { prompt: 'a', cwd: '.', modelo: 'claude-opus-5-5' })
    await harness.ejecutar(agente, { prompt: 'b', cwd: '.', historial: r1.mensajes })
    expect(llm.peticiones[0]!.modelo).toBe('claude-opus-5-5')
    expect(llm.peticiones[1]!.modelo).toBeUndefined()
  })
})

const FALSO = `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
let entrada = ''
process.stdin.on('data', (d) => (entrada += d))
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FALSO_VOLCADO, JSON.stringify({ args: a }) + '\\n')
  const m = a.includes('--model') ? a[a.indexOf('--model') + 1] : 'por-defecto'
  const l = (o) => console.log(JSON.stringify(o))
  l({ type: 'system', subtype: 'init', session_id: 'cli-1', model: m })
  l({ type: 'assistant', session_id: 'cli-1', parent_tool_use_id: null, message: { model: m, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'ok ' + m }] } })
  l({ type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', result: 'ok ' + m, usage: { input_tokens: 1, output_tokens: 1 } })
})
`

describe('cambio de modelo en una conversación activa (suscripción)', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'claude-modelo-'))
    await writeFile(join(dir, 'claude'), FALSO)
    await chmod(join(dir, 'claude'), 0o755)
    process.env.PATH = `${dir}:${process.env.PATH}`
    process.env.FALSO_VOLCADO = join(dir, 'volcado.jsonl')
  })

  it('reanuda la misma sesión con el --model de cada mensaje; sin modelo no pasa --model', async () => {
    const base = { cwd: dir, autonomia: 'preguntar' as const, verificaciones: [], senal: new AbortController().signal, alEvento: () => undefined }
    const eventos: string[] = []
    const r1 = await ejecutarSuscripcion({ ...base, prompt: 'uno', modelo: 'claude-sonnet-5-5', alEvento: (e) => e.tipo === 'uso_contexto' && eventos.push(String(e.modelo)) })
    const r2 = await ejecutarSuscripcion({ ...base, prompt: 'dos', modelo: 'claude-opus-5-5', reanudar: r1.sesionCli!, alEvento: (e) => e.tipo === 'uso_contexto' && eventos.push(String(e.modelo)) })
    await ejecutarSuscripcion({ ...base, prompt: 'tres', reanudar: r2.sesionCli! })

    const lineas = (await readFile(process.env.FALSO_VOLCADO!, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { args: string[] })
    const modeloDe = (a: string[]): string | undefined => (a.includes('--model') ? a[a.indexOf('--model') + 1] : undefined)
    expect(lineas.map((l) => modeloDe(l.args))).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', undefined])
    expect(lineas[1]!.args).toEqual(expect.arrayContaining(['--resume', 'cli-1']))
    expect(lineas[0]!.args).not.toContain('--resume')
    expect(eventos).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
  })
})
