import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { MotorGuardrails } from '../src/main/core/guardrails/motor'
import { crearAprobadorHumano, describirLlamada } from '../src/main/core/hitl/aprobador'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'
import { RegistroHerramientas, type Herramienta } from '../src/main/core/tools/registro'
import { LlmFalso, resultadosDe, texto, usar } from './ayudas'

function montar(respuestas: { aprobado: boolean; recordar?: boolean }[], senal?: AbortSignal) {
  const puerta = new PuertaHumana()
  const eventos: EventoAgente[] = []
  const alEvento = (e: EventoAgente): void => {
    eventos.push(e)
    if (e.tipo === 'solicitud_humana') queueMicrotask(() => puerta.responder(e.solicitudId, respuestas.shift() ?? { aprobado: false }))
  }
  const aprobar = crearAprobadorHumano({ puerta, ejecucionId: 'e', alEvento, ...(senal ? { senal } : {}) })
  return { aprobar, eventos, puerta }
}
const llamada = (nombre: string, entrada: Record<string, unknown>) => ({ id: '1', nombre, entrada })

describe('aprobador humano', () => {
  it('pregunta, describe la acción y respeta la respuesta', async () => {
    const { aprobar, eventos } = montar([{ aprobado: true }, { aprobado: false }])
    expect(await aprobar(llamada('ejecutar_comando', { comando: 'pnpm', args: ['build'] }), 'ejecucion', 'gen')).toBe(true)
    expect(await aprobar(llamada('escribir_archivo', { ruta: 'a.ts', contenido: 'x' }), 'escritura', 'gen')).toBe(false)
    const sol = eventos.filter((e) => e.tipo === 'solicitud_humana')
    expect(sol).toHaveLength(2)
    expect(sol[0]).toMatchObject({ clase: 'accion', contenido: '$ pnpm build', herramienta: 'ejecutar_comando' })
    expect(describirLlamada(llamada('escribir_archivo', { ruta: 'a.ts', contenido: 'hola' }))).toContain('Escribir a.ts')
  })
  it('«recordar» evita preguntar de nuevo, salvo en acciones destructivas', async () => {
    const { aprobar, eventos } = montar([{ aprobado: true, recordar: true }, { aprobado: true, recordar: true }, { aprobado: true }])
    const escribir = llamada('escribir_archivo', { ruta: 'a.ts', contenido: 'x' })
    expect(await aprobar(escribir, 'escritura', 'g')).toBe(true)
    expect(await aprobar(escribir, 'escritura', 'g')).toBe(true) // sin pregunta
    expect(eventos.filter((e) => e.tipo === 'solicitud_humana')).toHaveLength(1)
    const push = llamada('ejecutar_comando', { comando: 'git', args: ['push'] })
    await aprobar(push, 'ejecucion', 'g')
    await aprobar(push, 'ejecucion', 'g')
    const sol = eventos.filter((e) => e.tipo === 'solicitud_humana')
    expect(sol).toHaveLength(3) // el push se pregunta siempre
    expect(sol[1]).toMatchObject({ destructivo: true })
  })
  it('deniega si se cancela mientras espera', async () => {
    const ctl = new AbortController()
    const puerta = new PuertaHumana()
    const aprobar = crearAprobadorHumano({ puerta, ejecucionId: 'e', alEvento: () => ctl.abort(), senal: ctl.signal })
    expect(await aprobar(llamada('escribir_archivo', {}), 'escritura', 'g')).toBe(false)
  })
})

describe('Harness + guardrails + HITL', () => {
  const escribir = (llamadas: string[]): Herramienta => ({
    nombre: 'escribir_archivo', descripcion: 'w', esquema: { type: 'object' }, riesgo: 'escritura',
    ejecutar: async (e) => (llamadas.push(String(e.ruta)), { texto: 'escrito' })
  })

  it('el guardrail bloquea antes de preguntar al humano; lo limpio sí llega al humano', async () => {
    const llamadas: string[] = []
    const registro = new RegistroHerramientas()
    registro.registrar(escribir(llamadas))
    const secreto = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    const llm = new LlmFalso([
      usar('1', 'escribir_archivo', { ruta: 'a.ts', contenido: `const t = "${secreto}"` }),
      usar('2', 'escribir_archivo', { ruta: 'b.ts', contenido: 'export const b = 1' }),
      texto('fin')
    ])
    const { aprobar, eventos } = montar([{ aprobado: true }])
    const r = await new Harness({ llm, registro, validar: new MotorGuardrails().validarLlamada }).ejecutar(
      new Agente({ nombre: 'a', descripcion: '', sistema: 's' }),
      { prompt: 'p', cwd: '.', aprobar, alEvento: (e) => eventos.push(e) }
    )
    expect(llamadas).toEqual(['b.ts'])
    expect(resultadosDe(r.mensajes[2]!)[0]).toMatchObject({ error: true })
    expect(resultadosDe(r.mensajes[2]!)[0]!.texto).toContain('Bloqueado por guardrails')
    expect(resultadosDe(r.mensajes[2]!)[0]!.texto).not.toContain(secreto)
    expect(eventos.filter((e) => e.tipo === 'guardrail')).toHaveLength(1)
    expect(eventos.filter((e) => e.tipo === 'solicitud_humana')).toHaveLength(1) // solo la escritura limpia
  })
})
