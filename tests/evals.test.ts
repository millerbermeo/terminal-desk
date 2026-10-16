import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InformeEval, ResultadoCaso } from '@shared/core/evals'
import { ejecutarCaso, ejecutarSuite } from '../src/main/core/evals/ejecutor'
import { AlmacenInformes, compararInformes } from '../src/main/core/evals/informes'
import { SUITE_BASICA } from '../src/main/core/evals/suites'
import { Trazador } from '../src/main/core/tracing/trazador'
import { LlmFalso, texto, usar } from './ayudas'

const caso = (id: string) => SUITE_BASICA.casos.find((c) => c.id === id)!
const suma = (cuerpo: string) => usar('w', 'escribir_archivo', { ruta: 'suma.js', contenido: `exports.sumar = (a, b) => ${cuerpo}\n` })
const probar = usar('t', 'ejecutar_comando', { comando: 'node', args: ['--test'] })

describe('ejecutarCaso', () => {
  it('pasa cuando el agente cumple la especificación (pruebas reales con node --test)', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'raiz-'))
    const trazador = new Trazador()
    const r = await ejecutarCaso(caso('implementar-sumar'), { llm: new LlmFalso([suma('a + b'), probar, texto('listo')]), trazador, raiz })
    expect(r.pasa, JSON.stringify(r.aserciones)).toBe(true)
    expect(r.aserciones.map((a) => a.tipo)).toEqual(['agente_completa', 'archivo_existe', 'comando_pasa', 'archivo_contiene', 'max_pasos'])
    expect(r.pasos).toBe(3)
    expect(r.uso.tokensEntrada).toBe(30)
    expect(r.trazaId).toBeTruthy()
    expect(await readdir(raiz)).toEqual([]) // el proyecto temporal se elimina
  })

  it('falla y explica por qué cuando el código no pasa las pruebas', async () => {
    const r = await ejecutarCaso(caso('implementar-sumar'), { llm: new LlmFalso([suma('a - b'), probar, texto('listo')]), raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r.pasa).toBe(false)
    const fallo = r.aserciones.find((a) => !a.ok)!
    expect(fallo.tipo).toBe('comando_pasa')
    expect(fallo.detalle).toContain('falló')
  })

  it('detecta que se alteró la especificación (el test)', async () => {
    const llm = new LlmFalso([
      suma('a + b'),
      usar('x', 'escribir_archivo', { ruta: 'suma.test.js', contenido: "require('node:test')('x', () => {})\n" }),
      texto('listo')
    ])
    const r = await ejecutarCaso(caso('implementar-sumar'), { llm, raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r.pasa).toBe(false)
    expect(r.aserciones.find((a) => !a.ok)!.tipo).toBe('archivo_contiene')
  })

  it('el guardrail impide escribir la credencial y el caso lo reconoce', async () => {
    const llm = new LlmFalso([
      usar('w', 'escribir_archivo', { ruta: 'config.js', contenido: `const token = "${caso('no-filtra-credenciales').prompt.match(/ghp_\w+/)![0]}"` }),
      texto('No puedo escribir credenciales en el código.')
    ])
    const r = await ejecutarCaso(caso('no-filtra-credenciales'), { llm, raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r.pasa, JSON.stringify(r.aserciones)).toBe(true)
  })

  it('solo lectura + juez: usa el modelo juez para el criterio subjetivo', async () => {
    const agente = new LlmFalso([usar('r', 'leer_archivo', { ruta: 'utils.js' }), texto('Convierte a mayúscula la primera letra (capitalizar).')])
    const juez = new LlmFalso([texto('Veredicto: {"cumple": true, "razon": "explica la mayúscula inicial"}')])
    const r = await ejecutarCaso(caso('investigar-sin-modificar'), { llm: agente, juez, raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r.pasa, JSON.stringify(r.aserciones)).toBe(true)
    expect(juez.peticiones[0]!.mensajes[0]!.contenido[0]).toMatchObject({ texto: expect.stringContaining('capitalizar') })

    const malo = new LlmFalso([texto('No sé.')])
    const juezNo = new LlmFalso([texto('{"cumple": false, "razon": "no explica nada"}')])
    const r2 = await ejecutarCaso(caso('investigar-sin-modificar'), { llm: malo, juez: juezNo, raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r2.pasa).toBe(false)
    expect(r2.aserciones.find((a) => a.tipo === 'juez_llm')).toMatchObject({ ok: false, detalle: 'no explica nada' })
    const r3 = await ejecutarCaso(caso('investigar-sin-modificar'), { llm: new LlmFalso([texto('capitaliza')]), juez: new LlmFalso([texto('basura')]), raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r3.aserciones.find((a) => a.tipo === 'juez_llm')!.ok).toBe(false) // veredicto ilegible = no cumple
  })

  it('el sandbox solo permite los binarios autorizados y nunca acciones destructivas', async () => {
    const llm = new LlmFalso([
      usar('1', 'ejecutar_comando', { comando: 'rm', args: ['-rf', '.'] }),
      usar('2', 'ejecutar_comando', { comando: 'curl', args: ['http://x'] }),
      texto('fin')
    ])
    const c = { ...caso('investigar-sin-modificar'), aserciones: [] }
    const r = await ejecutarCaso(c, { llm, raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r.estadoAgente).toBe('completado')
    expect(JSON.stringify(llm.peticiones[2]!.mensajes)).toContain('Acción denegada')
  })

  it('un error del agente (sin respuesta del modelo) cuenta como fallo', async () => {
    const r = await ejecutarCaso(caso('implementar-sumar'), { llm: new LlmFalso([]), raiz: await mkdtemp(join(tmpdir(), 'raiz-')) })
    expect(r.pasa).toBe(false)
    expect(r.aserciones[0]).toMatchObject({ tipo: 'agente_completa', ok: false })
  })
})

describe('ejecutarSuite e informes', () => {
  it('consolida tasa, umbral y tokens; permite filtrar casos', async () => {
    const llm = new LlmFalso([suma('a + b'), probar, texto('ok'), texto('sin hacer nada')])
    const alCaso: ResultadoCaso[] = []
    const informe = await ejecutarSuite(
      { ...SUITE_BASICA, casos: [caso('implementar-sumar'), caso('corregir-bug')], umbral: 0.5 },
      { llm, raiz: await mkdtemp(join(tmpdir(), 'raiz-')), modelo: 'm' },
      { alCaso: (r) => alCaso.push(r) }
    )
    expect(informe).toMatchObject({ total: 2, pasan: 1, tasa: 0.5, umbral: 0.5, superaUmbral: true, modelo: 'm' })
    expect(alCaso.map((r) => r.pasa)).toEqual([true, false])
    expect(informe.uso.tokensEntrada).toBe(40)
    const solo = await ejecutarSuite(SUITE_BASICA, { llm: new LlmFalso([]), raiz: await mkdtemp(join(tmpdir(), 'raiz-')) }, { casos: ['no-existe'] })
    expect(solo).toMatchObject({ total: 0, superaUmbral: false })
  })

  const informe = (suite: string, fecha: string, pasa: Record<string, boolean>): InformeEval => {
    const casos = Object.entries(pasa).map(([id, ok]) => ({ id, descripcion: id, pasa: ok, aserciones: [], pasos: 1, uso: { tokensEntrada: 0, tokensSalida: 0 }, duracionMs: 1 }))
    const pasan = casos.filter((c) => c.pasa).length
    return { suite, fecha, total: casos.length, pasan, tasa: pasan / casos.length, umbral: 0.8, superaUmbral: false, uso: { tokensEntrada: 0, tokensSalida: 0 }, duracionMs: 1, casos }
  }

  it('compara informes: regresiones, mejoras y casos nuevos', () => {
    const c = compararInformes(informe('s', '2026-01-01T00:00:00.000Z', { a: true, b: false, c: true }), informe('s', '2026-01-02T00:00:00.000Z', { a: false, b: true, c: true, d: true }))
    expect(c).toMatchObject({ regresiones: ['a'], mejoras: ['b'], nuevos: ['d'] })
    expect(c.deltaTasa).toBeCloseTo(0.75 - 2 / 3)
  })

  it('el almacén devuelve los informes de la suite, el más reciente primero', async () => {
    const almacen = new AlmacenInformes(await mkdtemp(join(tmpdir(), 'inf-')))
    await almacen.guardar(informe('s', '2026-01-01T10:00:00.000Z', { a: true }))
    await almacen.guardar(informe('s', '2026-01-02T10:00:00.000Z', { a: false }))
    await almacen.guardar(informe('otra', '2026-01-03T10:00:00.000Z', { a: true }))
    expect((await almacen.listar('s')).map((i) => i.fecha)).toEqual(['2026-01-02T10:00:00.000Z', '2026-01-01T10:00:00.000Z'])
    expect(await almacen.listar('nada')).toEqual([])
  })
})
