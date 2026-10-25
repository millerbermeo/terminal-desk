import { describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { crearPermisoCli } from '../src/main/core/hitl/permiso-cli'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'

function montar(validar: (n: string) => string | null = () => null) {
  const puerta = new PuertaHumana()
  const eventos: Extract<EventoAgente, { tipo: 'solicitud_humana' }>[] = []
  const permiso = crearPermisoCli({
    puerta,
    ejecucionId: 'e1',
    alEvento: (e) => void (e.tipo === 'solicitud_humana' && eventos.push(e)),
    validar: async (l) => validar(l.nombre),
    reglas: async () => [],
    guardarRegla: async () => undefined
  })
  return { puerta, eventos, permiso }
}

describe('permiso del CLI de suscripción', () => {
  it('AskUserQuestion: muestra las opciones y devuelve las respuestas elegidas', async () => {
    const { puerta, eventos, permiso } = montar()
    const entrada = { questions: [{ question: '¿Color?', header: 'Color', multiSelect: false, options: [{ label: 'Rojo', description: 'r' }, { label: 'Azul' }] }] }
    const r = permiso({ herramienta: 'AskUserQuestion', entrada })
    await vi.waitFor(() => expect(eventos.length).toBeGreaterThan(0))
    expect(eventos[0]).toMatchObject({ clase: 'pregunta', preguntas: [{ pregunta: '¿Color?', opciones: [{ etiqueta: 'Rojo' }, { etiqueta: 'Azul' }] }] })
    puerta.responder(eventos[0]!.solicitudId, { aprobado: true, respuestas: { '¿Color?': 'Azul' } })
    expect(await r).toEqual({ permitir: true, entrada: { ...entrada, answers: { '¿Color?': 'Azul' } } })
  })

  it('Edit: pide confirmación y respeta el rechazo con su comentario', async () => {
    const { puerta, eventos, permiso } = montar()
    const r = permiso({ herramienta: 'Edit', entrada: { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' } })
    await vi.waitFor(() => expect(eventos.length).toBeGreaterThan(0))
    expect(eventos[0]).toMatchObject({ clase: 'accion', herramienta: 'Edit' })
    puerta.responder(eventos[0]!.solicitudId, { aprobado: false, comentario: 'no' })
    expect(await r).toEqual({ permitir: false, mensaje: 'El usuario lo rechazó: no' })
  })

  it('un guardrail bloquea sin preguntar', async () => {
    const { eventos, permiso } = montar(() => 'archivo sensible')
    expect(await permiso({ herramienta: 'Write', entrada: { file_path: '/p/.env', content: 'x' } })).toEqual({ permitir: false, mensaje: 'Bloqueado: archivo sensible' })
    expect(eventos).toHaveLength(0)
  })

  it('un comando compuesto con un tramo destructivo se marca destructivo', async () => {
    const { puerta, eventos, permiso } = montar()
    const r = permiso({ herramienta: 'Bash', entrada: { command: 'ls && rm -rf build' } })
    await vi.waitFor(() => expect(eventos.length).toBeGreaterThan(0))
    expect(eventos[0]).toMatchObject({ destructivo: true })
    expect(eventos[0]!.puedeSiempre).toBeUndefined()
    puerta.responder(eventos[0]!.solicitudId, { aprobado: true, siempre: true })
    expect(await r).toEqual({ permitir: true })
  })

  it('en autónomo aprueba los comandos sin preguntar, salvo los catastróficos, que deniega avisando', async () => {
    const puerta = new PuertaHumana()
    const eventos: EventoAgente[] = []
    const permiso = crearPermisoCli({ puerta, ejecucionId: 'e1', alEvento: (e) => void eventos.push(e), validar: async () => null, reglas: async () => [], guardarRegla: async () => undefined, autonomia: 'autonomo' })
    expect(await permiso({ herramienta: 'Bash', entrada: { command: 'npm test && rm -rf build' } })).toEqual({ permitir: true })
    const r = await permiso({ herramienta: 'Bash', entrada: { command: 'git push origin main --force' } })
    expect(r).toMatchObject({ permitir: false, mensaje: expect.stringMatching(/autónomo.*push forzado/) })
    expect(eventos).toEqual([expect.objectContaining({ tipo: 'guardrail', herramienta: 'Bash' })])
    expect(eventos.some((e) => e.tipo === 'solicitud_humana')).toBe(false)
  })
})
