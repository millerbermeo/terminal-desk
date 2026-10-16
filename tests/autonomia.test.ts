import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { ModoAutonomia } from '@shared/core/permisos'
import { Agente } from '../src/main/core/agents/agente'
import { ejecutarBucle } from '../src/main/core/agents/bucle'
import { Harness } from '../src/main/core/agents/harness'
import { generador, planificador } from '../src/main/core/agentes-base'
import { crearAprobadorHumano } from '../src/main/core/hitl/aprobador'
import { crearFlujoDesarrollo, estadoInicial } from '../src/main/core/orchestrator/flujo-desarrollo'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'
import { registrarIntegradas } from '../src/main/core/tools/integradas'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { LlmFalso, texto, usar } from './ayudas'

const cmd = (comando: string, ...args: string[]) => ({ id: '1', nombre: 'ejecutar_comando', entrada: { comando, args } })
const escribir = { id: '1', nombre: 'escribir_archivo', entrada: { ruta: 'a.ts', contenido: 'x' } }

function aprobador(autonomia: ModoAutonomia, verificaciones: string[][] = []) {
  const puerta = new PuertaHumana()
  const preguntas: string[] = []
  const alEvento = (e: EventoAgente): void => {
    if (e.tipo !== 'solicitud_humana') return
    preguntas.push(e.herramienta ?? e.clase)
    queueMicrotask(() => puerta.responder(e.solicitudId, { aprobado: false }))
  }
  return { aprobar: crearAprobadorHumano({ puerta, ejecucionId: 'e', alEvento, autonomia, verificaciones }), preguntas }
}

describe('modos de autonomía (aprobador)', () => {
  it('preguntar: todo se pregunta', async () => {
    const { aprobar, preguntas } = aprobador('preguntar', [['pnpm', 'test']])
    expect(await aprobar(escribir, 'escritura', 'a')).toBe(false)
    expect(await aprobar(cmd('pnpm', 'test'), 'ejecucion', 'a')).toBe(false)
    expect(preguntas).toEqual(['escribir_archivo', 'ejecutar_comando'])
  })
  it('ediciones: las escrituras pasan solas, los comandos siguen preguntando', async () => {
    const { aprobar, preguntas } = aprobador('ediciones', [['pnpm', 'test']])
    expect(await aprobar(escribir, 'escritura', 'a')).toBe(true)
    expect(await aprobar(cmd('pnpm', 'test'), 'ejecucion', 'a')).toBe(false)
    expect(preguntas).toEqual(['ejecutar_comando'])
  })
  it('autónomo: escrituras y verificaciones exactas solas; el resto y lo destructivo, no', async () => {
    const { aprobar, preguntas } = aprobador('autonomo', [['pnpm', 'run', 'test'], ['pnpm', 'run', 'lint']])
    expect(await aprobar(escribir, 'escritura', 'a')).toBe(true)
    expect(await aprobar(cmd('pnpm', 'run', 'test'), 'ejecucion', 'a')).toBe(true)
    expect(await aprobar(cmd('pnpm', 'run', 'lint'), 'ejecucion', 'a')).toBe(true)
    expect(await aprobar(cmd('pnpm', 'run', 'deploy'), 'ejecucion', 'a')).toBe(false) // otro script: pregunta
    expect(await aprobar(cmd('pnpm', 'run', 'test', '--', '--bail'), 'ejecucion', 'a')).toBe(false) // no es exactamente la verificación
    expect(await aprobar(cmd('node', '-e', 'process.exit()'), 'ejecucion', 'a')).toBe(false)
    expect(await aprobar(cmd('git', 'push'), 'ejecucion', 'a')).toBe(false)
    expect(await aprobar(cmd('rm', '-rf', 'x'), 'ejecucion', 'a')).toBe(false)
    expect(await aprobar({ id: '1', nombre: 'guardar_memoria', entrada: {} }, 'escritura', 'a')).toBe(false)
    expect(preguntas).toHaveLength(6)
  })
})

describe('presupuesto de tokens', () => {
  const base = { maxPasos: 10, maxTokens: 100, herramientas: [], llamar: async () => ({ texto: 'ok' }) }
  const inicio = [{ rol: 'user' as const, contenido: [{ tipo: 'texto' as const, texto: 'hola' }] }]
  it('el bucle se detiene con limite_pasos al agotarse', async () => {
    let gastado = 0
    const llm = new LlmFalso([usar('1', 'a'), usar('2', 'a'), texto('no debería llegar')])
    const r = await ejecutarBucle({ ...base, llm, alUso: (u) => (gastado += u.tokensEntrada + u.tokensSalida), agotado: () => gastado >= 20 }, inicio)
    expect(r).toMatchObject({ estado: 'limite_pasos', pasos: 2 })
    expect(r.error).toMatch(/Presupuesto/)
  })
  it('el Harness lo comparte entre el agente y sus subagentes', async () => {
    const llm = new LlmFalso([usar('d', 'delegar', { agente: 'hijo', tarea: 't' }), texto('hijo'), texto('padre sigue'), texto('no')])
    const agente = new Agente({ nombre: 'padre', descripcion: '', sistema: 's', subagentes: [{ nombre: 'hijo', descripcion: 'h', sistema: 'sh' }] })
    const r = await new Harness({ llm, registro: new RegistroHerramientas(), presupuestoTokens: 30 }).ejecutar(agente, { prompt: 'p', cwd: '.' })
    expect(r.estado).toBe('limite_pasos') // 15 (padre) + 15 (hijo) = 30: el padre no vuelve a llamar al modelo
    expect(llm.peticiones).toHaveLength(2)
    const libre = new LlmFalso([texto('ok')])
    expect((await new Harness({ llm: libre, registro: new RegistroHerramientas() }).ejecutar(agente, { prompt: 'p', cwd: '.' })).estado).toBe('completado')
  })
})

describe('flujo con plan aprobado automáticamente', () => {
  it('no pregunta por el plan pero sí por el resultado final', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'auto-'))
    const registro = new RegistroHerramientas()
    registrarIntegradas(registro)
    const llm = new LlmFalso([texto('PLAN'), usar('w', 'escribir_archivo', { ruta: 'a.txt', contenido: 'hola' }), texto('hecho')])
    const puerta = new PuertaHumana()
    const eventos: EventoAgente[] = []
    const alEvento = (e: EventoAgente): void => {
      eventos.push(e)
      if (e.tipo === 'solicitud_humana') queueMicrotask(() => puerta.responder(e.solicitudId, { aprobado: true }))
    }
    const grafo = crearFlujoDesarrollo(
      { harness: new Harness({ llm, registro }), puerta, cwd, proyectoId: 'p', ejecucionId: 'e', verificaciones: [], ejecutarVerificacion: async () => ({ ok: true, salida: '' }), autoAprobarPlan: true, alEvento },
      new Agente(planificador),
      new Agente(generador)
    )
    const r = await grafo.ejecutar(estadoInicial('crea a.txt'))
    expect(r.estado.estado).toBe('completado')
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('hola')
    expect(eventos.filter((e) => e.tipo === 'aprobacion_automatica')).toHaveLength(1)
    expect(eventos.filter((e) => e.tipo === 'solicitud_humana').map((e) => e.tipo === 'solicitud_humana' && e.clase)).toEqual(['confirmacion'])
  })
})
