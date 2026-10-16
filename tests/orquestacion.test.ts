import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { generador, planificador } from '../src/main/core/agentes-base'
import { crearFlujoDesarrollo, estadoInicial } from '../src/main/core/orchestrator/flujo-desarrollo'
import { FIN, GrafoEstados } from '../src/main/core/orchestrator/grafo'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'
import { correrVerificaciones, detectarVerificaciones, type EjecutorVerificacion, type Verificacion } from '../src/main/core/orchestrator/verificaciones'
import { registrarIntegradas } from '../src/main/core/tools/integradas'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { LlmFalso, texto, usar } from './ayudas'

describe('GrafoEstados', () => {
  it('sigue las transiciones, cuenta intentos y registra el recorrido', async () => {
    const g = new GrafoEstados<{ n: number }>(
      {
        a: async (e) => ({ estado: { n: e.n + 1 }, siguiente: 'b' }),
        b: async (e, c) => ({ estado: e, siguiente: c.intento < 2 ? 'a' : FIN })
      },
      'a'
    )
    const nodos: string[] = []
    const r = await g.ejecutar({ n: 0 }, { alNodo: (n, i) => nodos.push(`${n}${i}`) })
    expect(r).toMatchObject({ estado: { n: 2 }, recorrido: ['a', 'b', 'a', 'b'], motivo: 'fin' })
    expect(nodos).toEqual(['a1', 'b1', 'a2', 'b2'])
  })
  it('corta ciclos, cancela y rechaza nodos inexistentes', async () => {
    const ciclo = new GrafoEstados<number>({ a: async (e) => ({ estado: e, siguiente: 'a' }) }, 'a')
    expect((await ciclo.ejecutar(0, { maxTransiciones: 5 })).motivo).toBe('limite')
    const ctl = new AbortController()
    ctl.abort()
    expect((await ciclo.ejecutar(0, { senal: ctl.signal })).motivo).toBe('cancelado')
    const roto = new GrafoEstados<number>({ a: async (e) => ({ estado: e, siguiente: 'zzz' }) }, 'a')
    await expect(roto.ejecutar(0)).rejects.toThrow(/inexistente/)
    expect(() => new GrafoEstados({}, 'a')).toThrow()
  })
})

describe('PuertaHumana', () => {
  it('espera la respuesta, solo una vez, y se rechaza al cancelar', async () => {
    const puerta = new PuertaHumana()
    let id = ''
    const p = puerta.solicitar({ clase: 'plan', contenido: 'x' }, (s) => (id = s))
    expect(puerta.responder(id, { aprobado: true, comentario: 'ok' })).toBe(true)
    expect(await p).toEqual({ aprobado: true, comentario: 'ok' })
    expect(puerta.responder(id, { aprobado: true })).toBe(false)
    const ctl = new AbortController()
    const q = puerta.solicitar({ clase: 'plan', contenido: 'x' }, () => undefined, ctl.signal)
    ctl.abort()
    await expect(q).rejects.toThrow('cancelado')
  })
})

describe('verificaciones', () => {
  it('detecta typecheck/lint/test con el gestor del lockfile y omite el script por defecto de npm', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr-'))
    expect(await detectarVerificaciones(dir)).toEqual([])
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))
    expect(await detectarVerificaciones(dir)).toEqual([])
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', 'type-check': 'tsc' } }))
    expect(await detectarVerificaciones(dir)).toEqual([
      { nombre: 'typecheck', comando: ['npm', 'run', 'type-check'] },
      { nombre: 'lint', comando: ['npm', 'run', 'lint'] },
      { nombre: 'test', comando: ['npm', 'run', 'test'] }
    ])
    await writeFile(join(dir, 'pnpm-lock.yaml'), '')
    expect((await detectarVerificaciones(dir))[0]!.comando[0]).toBe('pnpm')
  })
  it('se detiene en la primera que falla e indica cuál', async () => {
    const vs: Verificacion[] = [{ nombre: 'typecheck', comando: ['a'] }, { nombre: 'lint', comando: ['b'] }, { nombre: 'test', comando: ['c'] }]
    const corridas: string[] = []
    const ejecutar: EjecutorVerificacion = async (_cwd, cmd) => (corridas.push(cmd[0]!), { ok: cmd[0] !== 'b', salida: 'error en ' + cmd[0] })
    const r = await correrVerificaciones('.', vs, ejecutar)
    expect(r).toMatchObject({ ok: false, fallo: 'lint' })
    expect(corridas).toEqual(['a', 'b'])
    expect(await correrVerificaciones('.', [], ejecutar)).toMatchObject({ ok: true, omitidas: true })
  })
})

describe('flujo de desarrollo', () => {
  async function montar(llm: LlmFalso, pruebas: EjecutorVerificacion, respuestas: { aprobado: boolean; comentario?: string }[], conVerificaciones = true) {
    const cwd = await mkdtemp(join(tmpdir(), 'flujo-'))
    const registro = new RegistroHerramientas()
    registrarIntegradas(registro)
    const puerta = new PuertaHumana()
    const eventos: EventoAgente[] = []
    const alEvento = (e: EventoAgente): void => {
      eventos.push(e)
      if (e.tipo === 'solicitud_humana') {
        const r = respuestas.shift() ?? { aprobado: false }
        queueMicrotask(() => puerta.responder(e.solicitudId, r))
      }
    }
    const grafo = crearFlujoDesarrollo(
      { harness: new Harness({ llm, registro }), puerta, cwd, proyectoId: 'p1', ejecucionId: 'e1', verificaciones: conVerificaciones ? [{ nombre: 'test', comando: ['t'] }] : [], ejecutarVerificacion: pruebas, alEvento },
      new Agente(planificador),
      new Agente(generador)
    )
    return { grafo, cwd, eventos }
  }
  const ok: EjecutorVerificacion = async () => ({ ok: true, salida: 'ok' })

  it('camino feliz con un reintento por pruebas fallidas; la escritura solo la permite el generador', async () => {
    const llm = new LlmFalso([
      texto('PLAN: crear a.txt'),
      usar('w1', 'escribir_archivo', { ruta: 'a.txt', contenido: 'v1' }),
      texto('hecho v1'),
      usar('w2', 'escribir_archivo', { ruta: 'a.txt', contenido: 'v2' }),
      texto('hecho v2')
    ])
    let corridas = 0
    const { grafo, cwd, eventos } = await montar(llm, async () => (++corridas === 1 ? { ok: false, salida: 'falla X' } : { ok: true, salida: 'ok' }), [{ aprobado: true }, { aprobado: true }])
    const r = await grafo.ejecutar(estadoInicial('crea a.txt'))
    expect(r.estado.estado).toBe('completado')
    expect(r.recorrido).toEqual(['planificacion', 'aprobacion', 'generacion', 'pruebas', 'generacion', 'pruebas', 'confirmacion'])
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('v2')
    // el segundo prompt del generador incluye la salida de las pruebas fallidas
    expect(JSON.stringify(llm.peticiones[3]!.mensajes)).toContain('falla X') // y se indica qué verificación falló
    // el planificador no ve herramientas de escritura
    expect(llm.peticiones[0]!.herramientas.map((h) => h.nombre)).not.toContain('escribir_archivo')
    expect(eventos.filter((e) => e.tipo === 'solicitud_humana').map((e) => e.tipo === 'solicitud_humana' && e.clase)).toEqual(['plan', 'confirmacion'])
  })

  it('plan rechazado vuelve a planificar con el comentario; tras 3 rechazos termina', async () => {
    const llm = new LlmFalso([texto('plan 1'), texto('plan 2'), texto('plan 3')])
    const { grafo } = await montar(llm, ok, [{ aprobado: false, comentario: 'más simple' }, { aprobado: false }, { aprobado: false }])
    const r = await grafo.ejecutar(estadoInicial('p'))
    expect(r.estado).toMatchObject({ estado: 'rechazado', planes: 3 })
    expect(JSON.stringify(llm.peticiones[1]!.mensajes)).toContain('más simple')
    expect(llm.peticiones.every((p) => !p.herramientas.some((h) => h.nombre === 'escribir_archivo'))).toBe(true)
  })

  it('sin comando de pruebas continúa marcándolo; las pruebas que no pasan agotan los intentos', async () => {
    const sin = new LlmFalso([texto('plan'), texto('listo')])
    const a = await montar(sin, ok, [{ aprobado: true }, { aprobado: true }], false)
    const ra = await a.grafo.ejecutar(estadoInicial('p'))
    expect(ra.estado).toMatchObject({ estado: 'completado', pruebas: { omitidas: true } })

    const llm = new LlmFalso([texto('plan'), texto('g1'), texto('g2'), texto('g3')])
    const b = await montar(llm, async () => ({ ok: false, salida: 'rojo' }), [{ aprobado: true }])
    const rb = await b.grafo.ejecutar(estadoInicial('p'))
    expect(rb.estado).toMatchObject({ estado: 'fallido', generaciones: 3 })
  })

  it('un fallo del LLM en la planificación termina como fallido', async () => {
    const { grafo } = await montar(new LlmFalso([]), ok, [])
    expect((await grafo.ejecutar(estadoInicial('p'))).estado.estado).toBe('fallido')
  })
})
