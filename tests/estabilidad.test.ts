import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cierreAnteriorInesperado, LimitadorRecargas, marcarCierreLimpio, marcarInicio, motivoRecuperable } from '../src/main/estabilidad'

describe('estabilidad de la interfaz', () => {
  it('recarga solo ante caídas reales, no ante cierres normales o a propósito', () => {
    for (const r of ['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit']) expect(motivoRecuperable(r), r).toBe(true)
    for (const r of ['clean-exit', 'killed']) expect(motivoRecuperable(r), r).toBe(false)
  })

  it('tope de recargas por ventana: a la 4.ª en un minuto deja de recargar; pasado el minuto vuelve a permitir', () => {
    let t = 0
    const l = new LimitadorRecargas(3, 60_000, () => t)
    expect([l.permitir(1), l.permitir(1), l.permitir(1), l.permitir(1)]).toEqual([true, true, true, false])
    expect(l.permitir(2)).toBe(true) // otra ventana tiene su propio contador
    t = 61_000
    expect(l.permitir(1)).toBe(true)
  })

  it('detecta un cierre inesperado de la sesión anterior y no avisa tras un cierre normal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estab-'))
    const f = join(dir, 'logs', 'sesion.json')
    expect(cierreAnteriorInesperado(f)).toBeUndefined() // primera vez
    marcarInicio(f, 1234)
    await new Promise((r) => setTimeout(r, 50))
    expect(cierreAnteriorInesperado(f)).toEqual({ inicio: 1234 }) // empezó y no se marcó el cierre: se cerró de golpe
    marcarCierreLimpio(f)
    expect(cierreAnteriorInesperado(f)).toBeUndefined()
  })

  it('un archivo de sesión ilegible no produce avisos falsos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estab-'))
    const f = join(dir, 'sesion.json')
    await writeFile(f, '{basura')
    expect(cierreAnteriorInesperado(f)).toBeUndefined()
  })
})
