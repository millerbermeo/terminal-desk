import { describe, expect, it } from 'vitest'
import type { Mensaje } from '@shared/core/agente'
import { CompresorContexto, MARCA_RESUMEN, podarResultados, puntoDeCorte } from '../src/main/core/context/compresion'
import { MonitorContexto } from '../src/main/core/context/monitor'
import { estimarTokens } from '../src/main/core/context/tokens'
import { LlmFalso, texto } from './ayudas'

const user = (t: string): Mensaje => ({ rol: 'user', contenido: [{ tipo: 'texto', texto: t }] })
const asistenteUsa = (id: string): Mensaje => ({ rol: 'assistant', contenido: [{ tipo: 'herramienta_uso', id, nombre: 'leer', entrada: {} }] })
const resultado = (id: string, t: string): Mensaje => ({ rol: 'user', contenido: [{ tipo: 'herramienta_resultado', usoId: id, texto: t }] })
const asistente = (t: string): Mensaje => ({ rol: 'assistant', contenido: [{ tipo: 'texto', texto: t }] })

/** Conversación larga: turnos con resultados de herramienta enormes. */
function conversacion(turnos: number): Mensaje[] {
  const ms: Mensaje[] = []
  for (let i = 0; i < turnos; i++) ms.push(user(`pregunta ${i}`), asistenteUsa(`t${i}`), resultado(`t${i}`, 'x'.repeat(4000)), asistente(`respuesta ${i}`))
  return ms
}

describe('MonitorContexto', () => {
  it('mide y detecta el umbral', () => {
    const m = new MonitorContexto({ ventana: 1000, umbral: 0.5, reservaSalida: 0 })
    expect(m.medir('s', [user('hola')], []).sobreUmbral).toBe(false)
    const grande = m.medir(undefined, [user('x'.repeat(2000))], [])
    expect(grande.sobreUmbral).toBe(true)
    expect(grande.tokens).toBeGreaterThan(estimarTokens('x'.repeat(2000)) - 1)
  })
})

describe('podarResultados / puntoDeCorte', () => {
  it('poda solo resultados antiguos y largos', () => {
    const ms = conversacion(4)
    const p = podarResultados(ms, 4, 500)
    expect(JSON.stringify(p[2])).toContain('omitido')
    expect(JSON.stringify(p.at(-2))).not.toContain('omitido') // dentro de los recientes
    expect(ms[2]).toBe(ms[2]) // no muta el original
    expect(JSON.stringify(ms[2])).not.toContain('omitido')
  })
  it('nunca corta entre tool_use y tool_result', () => {
    const ms = conversacion(3)
    // desde=2 cae en un resultado: debe avanzar hasta el siguiente mensaje de usuario con texto (índice 4)
    expect(puntoDeCorte(ms, 2)).toBe(4)
    expect(puntoDeCorte([user('a'), asistenteUsa('x'), resultado('x', 'r')], 1)).toBe(-1)
  })
})

describe('CompresorContexto', () => {
  const monitor = () => new MonitorContexto({ ventana: 6000, umbral: 0.6, reservaSalida: 0 })

  it('no hace nada bajo el umbral', async () => {
    const llm = new LlmFalso([])
    const r = await new CompresorContexto(monitor(), { llm }).preparar({ herramientas: [] }, [user('hola')])
    expect(r.estrategia).toBe('ninguna')
    expect(llm.peticiones).toHaveLength(0)
  })
  it('poda si basta con eso (sin llamar al modelo)', async () => {
    const llm = new LlmFalso([])
    const ms = conversacion(4) // ~1100 tokens por resultado -> sobre el umbral; podado queda muy por debajo
    const r = await new CompresorContexto(monitor(), { llm, recientes: 2 }).preparar({ herramientas: [] }, ms)
    expect(r.estrategia).toBe('poda')
    expect(r.tokensDespues).toBeLessThan(r.tokensAntes)
    expect(llm.peticiones).toHaveLength(0)
  })
  it('resume lo antiguo y conserva lo reciente, con roles alternados', async () => {
    const llm = new LlmFalso([texto('Objetivo: X. Decisión: Y.')])
    const ms = conversacion(30)
    const c = new CompresorContexto(new MonitorContexto({ ventana: 2000, umbral: 0.5, reservaSalida: 0 }), { llm, recientes: 6, modeloResumen: 'barato' })
    const r = await c.preparar({ herramientas: [] }, ms)
    expect(r.estrategia).toBe('resumen')
    expect(llm.peticiones[0]!.modelo).toBe('barato')
    expect(r.mensajes[0]!.rol).toBe('user')
    expect(JSON.stringify(r.mensajes[0])).toContain(MARCA_RESUMEN)
    expect(JSON.stringify(r.mensajes[0])).toContain('Decisión: Y.')
    expect(r.mensajes.at(-1)).toBe(ms.at(-1)) // el final no se toca
    for (let i = 1; i < r.mensajes.length; i++) expect(r.mensajes[i]!.rol).not.toBe(r.mensajes[i - 1]!.rol)
    // ningún resultado queda huérfano de su tool_use
    const usos = new Set(r.mensajes.flatMap((m) => m.contenido.flatMap((b) => (b.tipo === 'herramienta_uso' ? [b.id] : []))))
    for (const b of r.mensajes.flatMap((m) => m.contenido)) if (b.tipo === 'herramienta_resultado') expect(usos.has(b.usoId)).toBe(true)
  })
  it('si el resumen falla, se queda con la poda', async () => {
    const llm = new LlmFalso([]) // guion agotado -> lanza
    const c = new CompresorContexto(new MonitorContexto({ ventana: 2000, umbral: 0.5, reservaSalida: 0 }), { llm, recientes: 6 })
    expect((await c.preparar({ herramientas: [] }, conversacion(30))).estrategia).toBe('poda')
  })
})
