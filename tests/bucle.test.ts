import { describe, expect, it } from 'vitest'
import { ejecutarBucle, type ConfigBucle } from '../src/main/core/agents/bucle'
import { LlmFalso, resultadosDe, texto, usar } from './ayudas'

const base = (llm: LlmFalso, extra: Partial<ConfigBucle> = {}): ConfigBucle => ({
  llm, maxPasos: 5, maxTokens: 100, herramientas: [], llamar: async (l) => ({ texto: `ok:${l.nombre}` }), ...extra
})
const inicio = [{ rol: 'user' as const, contenido: [{ tipo: 'texto' as const, texto: 'hola' }] }]

describe('ejecutarBucle', () => {
  it('pasa los trozos de texto (streaming) del modelo a alDelta', async () => {
    const llm = new LlmFalso([(p) => { p.alTexto?.('ho'); p.alTexto?.('la'); return texto('hola') }])
    const deltas: string[] = []
    const r = await ejecutarBucle(base(llm, { alDelta: (d) => deltas.push(d) }), inicio)
    expect(deltas).toEqual(['ho', 'la'])
    expect(r.texto).toBe('hola')
    // sin alDelta no se pide streaming al proveedor
    const sin = new LlmFalso([texto('x')])
    await ejecutarBucle(base(sin), inicio)
    expect(sin.peticiones[0]!.alTexto).toBeUndefined()
  })
  it('termina con texto y suma tokens', async () => {
    const r = await ejecutarBucle(base(new LlmFalso([texto('listo')])), inicio)
    expect(r).toMatchObject({ estado: 'completado', texto: 'listo', pasos: 1, uso: { tokensEntrada: 10, tokensSalida: 5 } })
  })
  it('ejecuta herramientas y devuelve resultados al modelo', async () => {
    const llm = new LlmFalso([usar('t1', 'a'), texto('fin')])
    const r = await ejecutarBucle(base(llm), inicio)
    expect(r.estado).toBe('completado')
    expect(r.pasos).toBe(2)
    const resultado = resultadosDe(llm.peticiones[1]!.mensajes.at(-1)!)
    expect(resultado).toEqual([{ tipo: 'herramienta_resultado', usoId: 't1', texto: 'ok:a' }])
  })
  it('respeta maxPasos', async () => {
    const llm = new LlmFalso(Array.from({ length: 5 }, (_, i) => usar(`t${i}`, 'a')))
    expect((await ejecutarBucle(base(llm, { maxPasos: 3 }), inicio)).estado).toBe('limite_pasos')
  })
  it('cancela con la señal', async () => {
    const ctl = new AbortController()
    const llm = new LlmFalso([() => { ctl.abort(); return usar('t', 'a') }, texto('no')])
    expect((await ejecutarBucle(base(llm, { senal: ctl.signal }), inicio)).estado).toBe('cancelado')
  })
  it('reporta error del LLM y corte por maxTokens', async () => {
    expect(await ejecutarBucle(base(new LlmFalso([])), inicio)).toMatchObject({ estado: 'error', error: 'guion agotado' })
    const cortado = new LlmFalso([{ ...texto('x'), parada: 'limite' }])
    expect((await ejecutarBucle(base(cortado), inicio)).estado).toBe('error')
  })
})
