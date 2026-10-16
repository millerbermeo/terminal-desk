import { describe, expect, it } from 'vitest'
import { RegistroHerramientas, validarEntrada, type Herramienta } from '../src/main/core/tools/registro'

const eco: Herramienta = {
  nombre: 'eco',
  descripcion: 'eco',
  esquema: { type: 'object', properties: { t: { type: 'string' }, n: { type: 'integer' }, m: { type: 'string', enum: ['a', 'b'] } }, required: ['t'] },
  riesgo: 'lectura',
  ejecutar: async (e) => ({ texto: String(e.t) })
}

describe('validarEntrada', () => {
  it('detecta faltantes, tipos y enum', () => {
    expect(validarEntrada(eco.esquema, {})).toMatch(/falta/)
    expect(validarEntrada(eco.esquema, { t: 1 })).toMatch(/string/)
    expect(validarEntrada(eco.esquema, { t: 'x', n: 1.5 })).toMatch(/integer/)
    expect(validarEntrada(eco.esquema, { t: 'x', m: 'z' })).toMatch(/uno de/)
    expect(validarEntrada(eco.esquema, { t: 'x', n: 2, m: 'a' })).toBeNull()
    expect(validarEntrada(eco.esquema, [])).toMatch(/objeto/)
  })
})

describe('RegistroHerramientas', () => {
  it('registra, llama y filtra', async () => {
    const r = new RegistroHerramientas()
    r.registrar(eco)
    expect(() => r.registrar(eco)).toThrow(/duplicada/)
    expect(await r.llamar('eco', { t: 'hola' }, { cwd: '.' })).toEqual({ texto: 'hola' })
    expect(r.definiciones(['otra'])).toEqual([])
    expect(r.definiciones()).toHaveLength(1)
  })
  it('devuelve error (no lanza) ante desconocida, inválida o excepción', async () => {
    const r = new RegistroHerramientas()
    r.registrar(eco)
    r.registrar({ ...eco, nombre: 'rota', esquema: { type: 'object' }, ejecutar: async () => { throw new Error('x') } })
    expect((await r.llamar('nada', {}, { cwd: '.' })).error).toBe(true)
    expect((await r.llamar('eco', {}, { cwd: '.' })).error).toBe(true)
    expect(await r.llamar('rota', {}, { cwd: '.' })).toEqual({ texto: 'Error en rota: x', error: true })
  })
  it('quitarPrefijo', () => {
    const r = new RegistroHerramientas()
    r.registrar({ ...eco, nombre: 'mcp__a__x' })
    r.registrar(eco)
    r.quitarPrefijo('mcp__a__')
    expect(r.definiciones().map((d) => d.nombre)).toEqual(['eco'])
  })
})
