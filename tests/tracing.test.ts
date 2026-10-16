import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Span } from '@shared/core/traza'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { redactarSecretos } from '../src/main/core/guardrails/secretos'
import { AlmacenTrazas } from '../src/main/core/tracing/almacen'
import { LlmTrazado } from '../src/main/core/tracing/llm-trazado'
import { Trazador } from '../src/main/core/tracing/trazador'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { LlmFalso, texto, usar } from './ayudas'

const secreto = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'

function montar(guion: ConstructorParameters<typeof LlmFalso>[0], almacen?: AlmacenTrazas) {
  let t = 1000
  const trazador = new Trazador(almacen, () => (t += 10)) // reloj determinista: cada medición avanza 10 ms
  const registro = new RegistroHerramientas()
  registro.registrar({ nombre: 'leer', descripcion: 'l', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: 'contenido' }) })
  registro.registrar({ nombre: 'falla', descripcion: 'f', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: 'roto', error: true }) })
  const llm = new LlmTrazado(new LlmFalso(guion), trazador, 'modelo-x')
  return { trazador, harness: new Harness({ llm, registro, trazador }) }
}
const hijos = (spans: Span[], padre?: string): Span[] => spans.filter((s) => s.padre === padre)

describe('Trazador', () => {
  it('registra el árbol agente > llm / herramienta con tiempos, tokens y estado', async () => {
    const { trazador, harness } = montar([usar('1', 'leer'), usar('2', 'falla'), texto('listo')])
    trazador.iniciar('e1', { prompt: 'haz algo', agente: 'a', modo: 'chat' })
    await harness.ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), { prompt: 'haz algo', cwd: '.', ejecucionId: 'e1', modelo: 'm1' })
    const t = (await trazador.finalizar('e1'))!
    const raiz = hijos(t.spans)[0]!
    expect(raiz).toMatchObject({ tipo: 'agente', nombre: 'a', estado: 'ok', entrada: 'haz algo', atributos: { estado: 'completado', pasos: 3, modelo: 'm1' } })
    const sub = hijos(t.spans, raiz.id)
    expect(sub.map((s) => `${s.tipo}:${s.nombre}`)).toEqual(['llm:m1', 'herramienta:leer', 'llm:m1', 'herramienta:falla', 'llm:m1'])
    expect(sub[3]).toMatchObject({ estado: 'error', salida: 'roto' })
    expect(sub[0]!.duracionMs).toBeGreaterThan(0)
    expect(sub[0]!.uso).toEqual({ tokensEntrada: 10, tokensSalida: 5 })
    expect(t.uso).toEqual({ tokensEntrada: 30, tokensSalida: 15 })
    expect(t.estado).toBe('completado')
    expect(t.duracionMs).toBeGreaterThan(0)
  })

  it('anida los subagentes bajo la herramienta delegar y las llamadas paralelas bajo su agente', async () => {
    const { trazador, harness } = montar([
      {
        contenido: [
          { tipo: 'herramienta_uso', id: 'a', nombre: 'delegar', entrada: { agente: 'hijo', tarea: 't' } },
          { tipo: 'herramienta_uso', id: 'b', nombre: 'leer', entrada: {} }
        ],
        parada: 'herramientas',
        uso: { tokensEntrada: 1, tokensSalida: 1 }
      },
      texto('respuesta hijo'),
      texto('final')
    ])
    trazador.iniciar('e2', { prompt: 'p', agente: 'padre', modo: 'chat' })
    const agente = new Agente({ nombre: 'padre', descripcion: '', sistema: 's', subagentes: [{ nombre: 'hijo', descripcion: 'h', sistema: 'sh' }] })
    await harness.ejecutar(agente, { prompt: 'p', cwd: '.', ejecucionId: 'e2' })
    const t = (await trazador.finalizar('e2'))!
    const raiz = hijos(t.spans)[0]!
    const delegar = hijos(t.spans, raiz.id).find((s) => s.nombre === 'delegar')!
    const hijo = hijos(t.spans, delegar.id)[0]!
    expect(hijo).toMatchObject({ tipo: 'agente', nombre: 'hijo' })
    expect(hijos(t.spans, hijo.id).some((s) => s.tipo === 'llm')).toBe(true)
    expect(hijos(t.spans, raiz.id).some((s) => s.nombre === 'leer')).toBe(true) // paralela, hermana de delegar
  })

  it('redacta credenciales y recorta textos largos; registra eventos de interés', async () => {
    const { trazador, harness } = montar([texto(`mi clave es ${secreto}`)])
    trazador.iniciar('e3', { prompt: `usa ${secreto}`, agente: 'a', modo: 'chat' })
    await harness.ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), {
      prompt: `usa ${secreto} ${'x'.repeat(10_000)}`, cwd: '.', ejecucionId: 'e3', alEvento: (e) => trazador.registrarEvento(e)
    })
    trazador.registrarEvento({ ejecucionId: 'e3', agente: 'a', profundidad: 0, tipo: 'guardrail', herramienta: 'escribir_archivo', motivo: 'no' })
    trazador.registrarEvento({ ejecucionId: 'e3', agente: 'a', profundidad: 0, tipo: 'paso', numero: 1 }) // no se registra
    const t = (await trazador.finalizar('e3'))!
    expect(JSON.stringify(t)).not.toContain(secreto)
    expect(t.prompt).toContain('[REDACTADO:token de GitHub]')
    expect(t.spans.find((s) => s.tipo === 'agente')!.entrada!.length).toBeLessThan(4100)
    expect(t.spans.filter((s) => s.tipo === 'evento').map((s) => s.nombre)).toEqual(['guardrail'])
    expect(t.spans.find((s) => s.nombre === 'guardrail')).toMatchObject({ estado: 'error', atributos: { herramienta: 'escribir_archivo' } })
  })

  it('sin traza registrada no mide ni falla; el estado sale del flujo o del agente raíz', async () => {
    const { trazador, harness } = montar([texto('a'), texto('b')])
    const r = await harness.ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), { prompt: 'p', cwd: '.', ejecucionId: 'sin-traza' })
    expect(r.estado).toBe('completado')
    expect(await trazador.finalizar('sin-traza')).toBeUndefined()

    trazador.iniciar('f', { prompt: 'p', agente: 'flujo', modo: 'flujo' })
    trazador.registrarEvento({ ejecucionId: 'f', agente: 'flujo', profundidad: 0, tipo: 'flujo_fin', estado: 'rechazado', resumen: 'no' })
    expect((await trazador.finalizar('f'))!.estado).toBe('rechazado')
    trazador.iniciar('g', { prompt: 'p', agente: 'a', modo: 'chat' })
    expect((await trazador.finalizar('g', 'cancelado'))!.estado).toBe('cancelado')
  })

  it('un fallo del modelo queda como span con error y se propaga', async () => {
    const { trazador, harness } = montar([])
    trazador.iniciar('h', { prompt: 'p', agente: 'a', modo: 'chat' })
    const r = await harness.ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), { prompt: 'p', cwd: '.', ejecucionId: 'h' })
    expect(r.estado).toBe('error')
    const t = (await trazador.finalizar('h'))!
    expect(t.spans.find((s) => s.tipo === 'llm')).toMatchObject({ estado: 'error', salida: 'guion agotado' })
    expect(t.estado).toBe('error')
  })
})

describe('AlmacenTrazas', () => {
  it('guarda, lista (recientes primero con métricas), obtiene y elimina', async () => {
    const almacen = new AlmacenTrazas(await mkdtemp(join(tmpdir(), 'trazas-')))
    const { trazador, harness } = montar([usar('1', 'leer'), texto('ok'), texto('ok2')], almacen)
    for (const id of ['t-a', 't-b']) {
      trazador.iniciar(id, { prompt: `prompt ${id}`, agente: 'a', modo: 'chat' })
      await harness.ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), { prompt: 'p', cwd: '.', ejecucionId: id })
      await trazador.finalizar(id)
    }
    const lista = await almacen.listar()
    expect(lista.map((r) => r.id)).toEqual(['t-b', 't-a'])
    expect(lista[1]).toMatchObject({ llamadasLlm: 2, herramientas: 1, errores: 0, estado: 'completado' })
    expect((await almacen.obtener('t-a'))!.spans.length).toBeGreaterThan(3)
    await almacen.eliminar('t-a')
    expect(await almacen.obtener('t-a')).toBeUndefined()
    await expect(almacen.obtener('../x')).rejects.toThrow(/inválido/)
  })
})

describe('redactarSecretos', () => {
  it('sustituye credenciales y respeta ejemplos', () => {
    expect(redactarSecretos(`a ${secreto} b`)).toBe('a [REDACTADO:token de GitHub] b')
    expect(redactarSecretos('password = "your_password_here"')).toBe('password = "your_password_here"')
  })
})
