import { describe, expect, it } from 'vitest'
import { Trazador } from '../src/main/core/tracing/trazador'

describe('Trazador con ejecuciones por suscripción', () => {
  it('suma el consumo informado por el CLI y respeta el estado con que se cierra', async () => {
    const t = new Trazador()
    t.iniciar('e1', { prompt: 'hola', agente: 'asistente', modo: 'chat' })
    t.anotarUso('e1', { tokensEntrada: 1200, tokensSalida: 40 })
    t.anotarUso('e1', { tokensEntrada: 300, tokensSalida: 10 })
    const traza = await t.finalizar('e1', 'completado')
    expect(traza).toMatchObject({ estado: 'completado', uso: { tokensEntrada: 1500, tokensSalida: 50 } })
  })

  it('anotar uso de una traza que no existe no falla', () => {
    expect(() => new Trazador().anotarUso('nada', { tokensEntrada: 1, tokensSalida: 1 })).not.toThrow()
  })
})
