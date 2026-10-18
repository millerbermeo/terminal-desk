import { describe, expect, it } from 'vitest'
import { extrasDe, extrasSinPty, MAX_PESTANAS, MAX_POR_TIPO, ptysDeExtras, puedeDuplicar, reducirPestanas, siguienteNumero, tituloPestana, type CeldaPestanas } from '../src/renderer/duplicar'

const celda = (extra: Partial<CeldaPestanas> = {}): CeldaPestanas => ({ id: 'c1', ...extra })
const agregar = (c: CeldaPestanas, tipo: 'terminal' | 'asistente' | 'archivos') => reducirPestanas(c, { t: 'agregar', tipo })

describe('duplicar pestañas dentro de una celda', () => {
  it('cada tipo admite la original más 3 duplicadas (4 por tipo, 12 en total)', () => {
    expect(MAX_POR_TIPO).toBe(4)
    expect(MAX_PESTANAS).toBe(12)
    let c = celda()
    for (let i = 0; i < 3; i++) c = agregar(c, 'terminal')
    expect(extrasDe(c.extras, 'terminal').map((x) => x.n)).toEqual([2, 3, 4])
    const p = puedeDuplicar(c.extras, 'terminal')
    expect(p).toMatchObject({ ok: false, usadas: 4, max: 4 })
    expect(p.motivo).toMatch(/Máximo 4 terminales/)
    expect(agregar(c, 'terminal')).toBe(c) // la cuarta duplicada no se crea
  })

  it('se pueden llenar los tres tipos hasta 12 pestañas, y ningún tipo quita cupo a otro', () => {
    let c = celda()
    for (const tipo of ['terminal', 'asistente', 'archivos'] as const) for (let i = 0; i < 3; i++) c = agregar(c, tipo)
    expect(c.extras).toHaveLength(9) // + 3 originales = 12
    for (const tipo of ['terminal', 'asistente', 'archivos'] as const) expect(puedeDuplicar(c.extras, tipo).ok).toBe(false)
    expect(puedeDuplicar(celda({ extras: [{ id: 'x', tipo: 'terminal', n: 2 }] }).extras, 'asistente')).toMatchObject({ ok: true, usadas: 1 })
  })

  it('la pestaña nueva queda a la vista, con su tipo, y los ids no chocan entre tipos', () => {
    let c = agregar(celda(), 'asistente')
    expect(c).toMatchObject({ vista: 'asistente', extraActiva: 'c1~asistente2' })
    c = agregar(c, 'archivos')
    expect(c).toMatchObject({ vista: 'archivos', extraActiva: 'c1~archivos2' })
    expect(new Set(c.extras!.map((x) => x.id)).size).toBe(2)
  })

  it('cerrar la que está a la vista vuelve a la original de su tipo; cerrar otra no cambia la vista', () => {
    let c = agregar(agregar(celda(), 'terminal'), 'terminal') // terminal 2 y 3
    expect(c.extraActiva).toBe('c1~terminal3')
    const cerrando3 = reducirPestanas(c, { t: 'cerrar', id: 'c1~terminal3' })
    expect(cerrando3).toMatchObject({ vista: 'terminal', extraActiva: undefined })
    expect(extrasDe(cerrando3.extras, 'terminal').map((x) => x.n)).toEqual([2])
    c = reducirPestanas(c, { t: 'cerrar', id: 'c1~terminal2' })
    expect(c.extraActiva).toBe('c1~terminal3') // seguía a la vista la 3
    expect(reducirPestanas(c, { t: 'cerrar', id: 'no-existe' })).toBe(c)
  })

  it('al cerrar una se reutiliza su número para la siguiente', () => {
    let c = agregar(agregar(agregar(celda(), 'terminal'), 'terminal'), 'terminal') // 2,3,4
    c = reducirPestanas(c, { t: 'cerrar', id: 'c1~terminal3' })
    expect(siguienteNumero(c.extras, 'terminal')).toBe(3)
    c = agregar(c, 'terminal')
    expect(extrasDe(c.extras, 'terminal').map((x) => x.n)).toEqual([2, 3, 4])
  })

  it('activar una duplicada la muestra; activar una que no existe no hace nada', () => {
    const c = agregar(celda({ vista: 'terminal' }), 'asistente')
    const vuelta = { ...c, vista: 'terminal' as const, extraActiva: undefined }
    expect(reducirPestanas(vuelta, { t: 'activar', id: 'c1~asistente2' })).toMatchObject({ vista: 'asistente', extraActiva: 'c1~asistente2' })
    expect(reducirPestanas(vuelta, { t: 'activar', id: 'nada' })).toBe(vuelta)
  })

  it('el proceso de una terminal duplicada se anota en su pestaña (y se puede separar la ventana cuando todas lo tienen)', () => {
    let c = agregar(celda(), 'terminal')
    expect(extrasSinPty(c)).toBe(true)
    c = reducirPestanas(c, { t: 'pty', id: 'c1~terminal2', ptyId: 'pty-9' })
    expect(extrasSinPty(c)).toBe(false)
    expect(ptysDeExtras(c)).toEqual(['pty-9'])
    expect(extrasSinPty(agregar(celda(), 'asistente'))).toBe(false) // solo las terminales tienen proceso
    expect(reducirPestanas(c, { t: 'pty', id: 'otra', ptyId: 'x' })).toBe(c)
  })

  it('títulos de las pestañas', () => {
    expect(tituloPestana('terminal', 1)).toBe('Terminal')
    expect(tituloPestana('terminal', 3)).toBe('Terminal 3')
    expect(tituloPestana('asistente', 2)).toBe('Asistente 2')
    expect(tituloPestana('archivos', 4)).toBe('Archivos 4')
  })
})
