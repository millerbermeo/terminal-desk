import { describe, expect, it } from 'vitest'
import { MAX_CELDAS, MAX_POR_TIPO, puedeDuplicar, tituloDuplicado, type CeldaMinima } from '../src/renderer/duplicar'

const celda = (id: string, proyectoId: string, vista?: CeldaMinima['vista']): CeldaMinima => ({ id, proyectoId, ...(vista ? { vista } : {}) })

describe('duplicar celdas: límites', () => {
  it('permite hasta 3 por tipo y proyecto y bloquea la cuarta, explicando por qué', () => {
    const celdas = [celda('1', 'p'), celda('2', 'p')]
    expect(puedeDuplicar(celdas, celdas[0]!, 'terminal')).toEqual({ ok: true, usadas: 2, max: MAX_POR_TIPO })
    celdas.push(celda('3', 'p'))
    const r = puedeDuplicar(celdas, celdas[0]!, 'terminal')
    expect(r.ok).toBe(false)
    expect(r.usadas).toBe(3)
    expect(r.motivo).toMatch(/Máximo 3 terminales/)
  })

  it('cuenta por tipo: llenar las terminales no impide abrir asistentes ni archivos', () => {
    const celdas = [celda('1', 'p'), celda('2', 'p'), celda('3', 'p')]
    expect(puedeDuplicar(celdas, celdas[0]!, 'asistente').ok).toBe(true)
    expect(puedeDuplicar(celdas, celdas[0]!, 'archivos').ok).toBe(true)
  })

  it('cuenta por proyecto: otro proyecto tiene su propio cupo', () => {
    const celdas = [celda('1', 'a'), celda('2', 'a'), celda('3', 'a'), celda('4', 'b')]
    expect(puedeDuplicar(celdas, celdas[0]!, 'terminal').ok).toBe(false)
    expect(puedeDuplicar(celdas, celdas[3]!, 'terminal')).toMatchObject({ ok: true, usadas: 1 })
  })

  it('una celda se cuenta por lo que muestra (su vista)', () => {
    const celdas = [celda('1', 'p', 'asistente'), celda('2', 'p', 'asistente'), celda('3', 'p', 'asistente')]
    expect(puedeDuplicar(celdas, celdas[0]!, 'asistente').ok).toBe(false)
    expect(puedeDuplicar(celdas, celdas[0]!, 'terminal')).toMatchObject({ ok: true, usadas: 0 })
  })

  it(`tope de ${MAX_CELDAS} celdas por pestaña aunque cada proyecto tenga cupo`, () => {
    const celdas = Array.from({ length: MAX_CELDAS }, (_, i) => celda(String(i), `p${i}`))
    const r = puedeDuplicar(celdas, celdas[0]!, 'terminal')
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/12 celdas/)
  })

  it('una celda sin proyecto no se duplica', () => {
    expect(puedeDuplicar([{ id: '1' }], { id: '1' }, 'terminal').ok).toBe(false)
  })

  it('títulos únicos para las copias', () => {
    expect(tituloDuplicado('Mobile', 'terminal', ['Mobile'])).toBe('Mobile · 2')
    expect(tituloDuplicado('Mobile', 'terminal', ['Mobile', 'Mobile · 2'])).toBe('Mobile · 3')
    expect(tituloDuplicado('Mobile', 'asistente', ['Mobile'])).toBe('Mobile · Asistente')
    expect(tituloDuplicado('Mobile', 'archivos', ['Mobile · Archivos'])).toBe('Mobile · Archivos · 2')
  })
})
