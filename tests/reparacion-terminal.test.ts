import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VigilanteAtlas } from '../src/renderer/terminal/reparacion'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('VigilanteAtlas', () => {
  it('no repara con poca salida', () => {
    const reparar = vi.fn()
    const v = new VigilanteAtlas(reparar, {}, Date.now)
    v.alEscribir(10_000)
    vi.advanceTimersByTime(60_000)
    expect(reparar).not.toHaveBeenCalled()
  })

  it('repara cuando mucha salida se calma', () => {
    const reparar = vi.fn()
    const v = new VigilanteAtlas(reparar, { umbral: 1000, calmaMs: 500 }, Date.now)
    v.alEscribir(600)
    v.alEscribir(600)
    vi.advanceTimersByTime(499)
    expect(reparar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(reparar).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(reparar).toHaveBeenCalledTimes(1) // la cuenta empieza de cero
  })

  it('mientras sigue llegando salida espera a que pare', () => {
    const reparar = vi.fn()
    const v = new VigilanteAtlas(reparar, { umbral: 1000, calmaMs: 500, umbralDuro: 1e9 }, Date.now)
    for (let i = 0; i < 10; i++) {
      v.alEscribir(500)
      vi.advanceTimersByTime(300)
    }
    expect(reparar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(reparar).toHaveBeenCalledTimes(1)
  })

  it('con salida continua repara igualmente, sin pasarse de una vez cada minimoMs', () => {
    const reparar = vi.fn()
    const v = new VigilanteAtlas(reparar, { umbral: 1e9, umbralDuro: 1000, minimoMs: 10_000 }, Date.now)
    v.alEscribir(2000) // demasiado pronto desde que nació
    expect(reparar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    v.alEscribir(2000)
    expect(reparar).toHaveBeenCalledTimes(1)
    v.alEscribir(5000)
    expect(reparar).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    v.alEscribir(1000)
    expect(reparar).toHaveBeenCalledTimes(2)
  })

  it('alReparar y destruir cancelan lo pendiente', () => {
    const reparar = vi.fn()
    const v = new VigilanteAtlas(reparar, { umbral: 100, calmaMs: 500 }, Date.now)
    v.alEscribir(500)
    v.alReparar()
    vi.advanceTimersByTime(5000)
    expect(reparar).not.toHaveBeenCalled()
    v.alEscribir(500)
    v.destruir()
    vi.advanceTimersByTime(5000)
    expect(reparar).not.toHaveBeenCalled()
  })
})
