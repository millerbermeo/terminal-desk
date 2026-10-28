import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { MODELOS_CONOCIDOS } from '@shared/core/uso'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { ProveedorAnthropic } from '../src/main/core/agents/llm/anthropic'
import { MemoriaCortoPlazo } from '../src/main/core/memory/sesion'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { diaLocal, leerLimites, LlmMedido, Medidor } from '../src/main/core/uso/medidor'
import { consultarUsoPlan, interpretarUsoPlan } from '../src/main/core/uso/plan'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import { LlmFalso, texto, usar } from './ayudas'
import { ServidorFalso } from './servidor-falso'

const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'uso-'))
const uso = (e: number, s: number) => ({ tokensEntrada: e, tokensSalida: s })

describe('leerLimites', () => {
  it('lee las cabeceras de límites de tasa de la API', () => {
    const h = new Headers({
      'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49', 'anthropic-ratelimit-requests-reset': '2026-10-16T20:00:30Z',
      'anthropic-ratelimit-tokens-limit': '40000', 'anthropic-ratelimit-tokens-remaining': '31000',
      'anthropic-ratelimit-input-tokens-limit': '30000', 'anthropic-ratelimit-input-tokens-remaining': 'basura'
    })
    expect(leerLimites(h, 123)).toEqual({
      actualizado: 123,
      solicitudes: { limite: 50, restante: 49, reinicio: '2026-10-16T20:00:30Z' },
      tokens: { limite: 40000, restante: 31000 }
    })
    expect(leerLimites(new Headers({ 'content-type': 'application/json' }))).toBeUndefined()
  })
})

describe('Medidor', () => {
  it('suma por modelo y día, persiste, acumula 7 días y descarta lo antiguo', async () => {
    const dir = await tmp()
    let ahora = new Date(2026, 9, 16, 12).getTime()
    const m = new Medidor(dir, () => ahora)
    await m.registrar('claude-sonnet-5-5', uso(1000, 200))
    await m.registrar('claude-sonnet-5-5', uso(500, 100))
    await m.registrar('claude-haiku-5-5', uso(50, 5))
    let r = await m.resumen()
    expect(r.dia).toBe('2026-10-16')
    expect(r.hoy['claude-sonnet-5-5']).toEqual({ entrada: 1500, salida: 300, llamadas: 2 })
    expect(r.total).toEqual({ entrada: 1550, salida: 305, llamadas: 3 })
    ahora += 3 * 86_400_000
    await m.registrar('claude-opus-5-5', uso(10, 1))
    r = await m.resumen()
    expect(r.total).toEqual({ entrada: 10, salida: 1, llamadas: 1 }) // «hoy» es otro día
    expect(r.ultimos7Dias.entrada).toBe(1560)
    ahora += 40 * 86_400_000
    await m.registrar('claude-opus-5-5', uso(1, 1))
    expect((await m.resumen()).ultimos7Dias.entrada).toBe(1) // lo de hace más de 35 días se descartó
    // otra instancia lee lo guardado
    const otra = new Medidor(dir, () => ahora)
    expect((await otra.resumen()).total.entrada).toBe(1)
  })

  it('suma caché y coste por modelo (consumo real de suscripción, subagentes incluidos)', async () => {
    const m = new Medidor(await tmp())
    await m.registrar('claude-sonnet-5-5', uso(30_000, 200), { cache: 24_000, costo: 0.05 })
    await m.registrar('claude-haiku-5-5', uso(5_000, 50), { cache: 4_000, costo: 0.001 })
    await m.registrar('claude-sonnet-5-5', uso(1_000, 10), { cache: 0, costo: 0.01 })
    const r = await m.resumen()
    expect(r.hoy['claude-sonnet-5-5']).toMatchObject({ entrada: 31_000, salida: 210, llamadas: 2, cache: 24_000 })
    expect(r.hoy['claude-sonnet-5-5']!.costo).toBeCloseTo(0.06)
    expect(r.total.cache).toBe(28_000)
    expect(r.total.costo).toBeCloseTo(0.061)
  })

  it('avisa a los suscriptores (agrupando ráfagas) e incluye los límites', async () => {
    const m = new Medidor(await tmp())
    const avisos: number[] = []
    const baja = m.suscribir((r) => avisos.push(r.total.llamadas))
    void m.registrar('x', uso(1, 1))
    void m.registrar('x', uso(1, 1))
    m.cabeceras(new Headers({ 'anthropic-ratelimit-tokens-limit': '100', 'anthropic-ratelimit-tokens-remaining': '40' }))
    await vi.waitFor(() => expect(avisos.length).toBeGreaterThan(0))
    expect(avisos).toHaveLength(1) // una sola notificación para toda la ráfaga
    expect(avisos[0]).toBe(2)
    expect((await m.resumen()).limites?.tokens).toEqual({ limite: 100, restante: 40 })
    baja()
  })

  it('LlmMedido apunta cada llamada al modelo que se usó (o al de por defecto)', async () => {
    const m = new Medidor(await tmp())
    const llm = new LlmMedido(new LlmFalso([texto('a'), texto('b')]), m, 'por-defecto')
    await llm.completar({ mensajes: [], herramientas: [], maxTokens: 10, modelo: 'claude-opus-5-5' })
    await llm.completar({ mensajes: [], herramientas: [], maxTokens: 10 })
    const r = await m.resumen()
    expect(Object.keys(r.hoy).sort()).toEqual(['claude-opus-5-5', 'por-defecto'])
    expect(diaLocal()).toBe(r.dia)
  })
})

describe('uso del plan de suscripción', () => {
  const respuesta = { five_hour: { utilization: 37.4, resets_at: '2026-10-27T22:00:00Z' }, seven_day: { utilization: 12, resets_at: null }, seven_day_opus: null, extra: 1 }

  it('traduce la respuesta (porcentaje 0-100 y reinicio en ms) e ignora lo que no entiende', () => {
    expect(interpretarUsoPlan(respuesta)).toEqual({ cincoHoras: { porcentaje: 37, reinicio: Date.parse('2026-10-27T22:00:00Z') }, semana: { porcentaje: 12 } })
    expect(interpretarUsoPlan('basura')).toEqual({})
  })

  it('consulta con la sesión de la carpeta de la cuenta y explica cuándo no se puede', async () => {
    const dir = await tmp()
    const pedir = vi.fn(async () => new Response(JSON.stringify(respuesta), { status: 200 }))
    expect(await consultarUsoPlan(dir, pedir as unknown as typeof fetch)).toMatchObject({ ok: false, error: expect.stringMatching(/sesión|llavero/) })
    await writeFile(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: 2000, subscriptionType: 'max' } }))
    expect(await consultarUsoPlan(dir, pedir as unknown as typeof fetch, 3000)).toMatchObject({ ok: false, error: expect.stringMatching(/caducó/) })
    expect(pedir).not.toHaveBeenCalled()
    const r = await consultarUsoPlan(dir, pedir as unknown as typeof fetch, 1000)
    expect(r).toMatchObject({ ok: true, datos: { tipo: 'max', cincoHoras: { porcentaje: 37 }, actualizado: 1000 } })
    const [url, init] = pedir.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const limitado = vi.fn(async () => new Response('', { status: 429 }))
    expect(await consultarUsoPlan(dir, limitado as unknown as typeof fetch, 1000)).toMatchObject({ ok: false, reintentarEn: 300_000 })
  })

  it('el medidor conserva los últimos datos buenos de la cuenta si una consulta falla', async () => {
    const m = new Medidor(await tmp())
    m.fijarPlan('principal', { datos: { cincoHoras: { porcentaje: 40 }, actualizado: 1 } })
    m.fijarPlan('principal', { error: 'Sin conexión con Anthropic.' })
    expect((await m.resumen()).plan).toEqual({ cuenta: 'principal', cincoHoras: { porcentaje: 40 }, actualizado: 1, error: 'Sin conexión con Anthropic.' })
    m.fijarPlan('otra', { error: 'Sin sesión de Claude Code en esta cuenta.' })
    expect((await m.resumen()).plan).toEqual({ cuenta: 'otra', error: 'Sin sesión de Claude Code en esta cuenta.' })
  })
})

describe('ProveedorAnthropic: cabeceras y modelos', () => {
  const respuesta = (cuerpo: unknown, cabeceras: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json', ...cabeceras } })

  it('entrega las cabeceras de cada respuesta sin romper la llamada', async () => {
    const vistas: Headers[] = []
    const p = new ProveedorAnthropic('k', undefined, {
      alCabeceras: (h) => vistas.push(h),
      fetch: async () => respuesta({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hola' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } }, { 'anthropic-ratelimit-tokens-limit': '9' })
    })
    const r = await p.completar({ mensajes: [{ rol: 'user', contenido: [{ tipo: 'texto', texto: 'x' }] }], herramientas: [], maxTokens: 10 })
    expect(r.uso).toEqual({ tokensEntrada: 3, tokensSalida: 2 })
    expect(vistas[0]!.get('anthropic-ratelimit-tokens-limit')).toBe('9')
    // un fallo en el callback de telemetría no afecta a la llamada
    const q = new ProveedorAnthropic('k', undefined, { alCabeceras: () => { throw new Error('boom') }, fetch: async () => respuesta({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) })
    expect((await q.completar({ mensajes: [{ rol: 'user', contenido: [{ tipo: 'texto', texto: 'x' }] }], herramientas: [], maxTokens: 10 })).contenido).toEqual([{ tipo: 'texto', texto: 'ok' }])
  })

  it('lista los modelos de la API con su ventana y cae a los conocidos si falla', async () => {
    const lista = new ProveedorAnthropic('k', undefined, {
      fetch: async () => respuesta({ data: [
        { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z', max_input_tokens: 1_000_000, max_tokens: 64000 },
        { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z', max_input_tokens: null, max_tokens: null },
        { id: 'otro-modelo', display_name: 'Otro', type: 'model', created_at: '2026-01-01T00:00:00Z', max_input_tokens: 5, max_tokens: 5 }
      ], has_more: false, first_id: 'a', last_id: 'b' })
    })
    expect(await lista.modelos()).toEqual([
      { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', ventana: 1_000_000 },
      { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', ventana: 200_000 }
    ])
    const roto = new ProveedorAnthropic('k', undefined, { fetch: async () => new Response('{}', { status: 404 }) })
    expect(await roto.modelos()).toEqual([...MODELOS_CONOCIDOS])
  })
})

describe('contexto en tiempo real', () => {
  it('el Harness emite el contexto real (tokens de entrada) solo del agente raíz', async () => {
    const llm = new LlmFalso([usar('d', 'delegar', { agente: 'hijo', tarea: 't' }), texto('hijo'), texto('padre')])
    const agente = new Agente({ nombre: 'padre', descripcion: '', sistema: 's', subagentes: [{ nombre: 'hijo', descripcion: 'h', sistema: 'sh' }] })
    const eventos: EventoAgente[] = []
    await new Harness({ llm, registro: new RegistroHerramientas() }).ejecutar(agente, { prompt: 'p', cwd: '.', modelo: 'claude-opus-5-5', alEvento: (e) => eventos.push(e) })
    const ctx = eventos.filter((e) => e.tipo === 'uso_contexto')
    expect(ctx).toHaveLength(2) // dos llamadas del padre; la del hijo no cuenta
    expect(ctx[0]).toMatchObject({ tipo: 'uso_contexto', tokens: 10, modelo: 'claude-opus-5-5', agente: 'padre' })
  })

  it('una conversación retomada trae una estimación de su contexto', async () => {
    const m = new MemoriaCortoPlazo(await tmp())
    await m.guardar('s', [{ rol: 'user', contenido: [{ tipo: 'texto', texto: 'x'.repeat(3500) }] }], uso(1, 1), 'p')
    await m.guardarTranscripcion('s', [{ prompt: 'x', modo: 'chat', destino: 'P', raiz: 'asistente', eventos: [], estado: 'completado' }], 'p')
    expect((await m.transcripcion('s'))!.tokensContexto).toBeGreaterThanOrEqual(1000)
  })
})

describe('Nucleo: modelo elegido', () => {
  let Nucleo: new () => TipoNucleo
  beforeAll(async () => {
    vi.stubEnv('HOME', await tmp())
    const srv = await new ServidorFalso().iniciar()
    srv.apuntar()
    ;({ Nucleo } = await import('../src/main/core/index'))
    await srv.entrar()
  })
  it('usa el modelo fijado (sin router), rechaza ids raros y sin clave lista los conocidos', async () => {
    const n = new Nucleo()
    await n.preferencias.fijar('api')
    const llm = new LlmFalso([texto('ok')])
    ;(n as unknown as { llm: () => Promise<LlmFalso> }).llm = async () => llm
    await expect(n.ejecutar({ prompt: 'x', modelo: 'gpt-4; rm -rf' }, () => undefined)).rejects.toThrow(/Modelo inválido/)
    const eventos: EventoAgente[] = []
    await new Promise<void>((r) => void n.ejecutar({ prompt: 'hola', modelo: 'claude-opus-5-5' }, (e) => { eventos.push(e); if (e.tipo === 'fin') r() }))
    expect(llm.peticiones[0]!.modelo).toBe('claude-opus-5-5')
    expect(eventos.some((e) => e.tipo === 'ruta')).toBe(false) // fijado a mano: el router no interviene
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await new Nucleo().modelos()).map((m) => m.id)).toEqual(MODELOS_CONOCIDOS.map((m) => m.id))
  })
})
