import { describe, expect, it } from 'vitest'
import { COMANDOS_CLAUDE, COMANDOS_INCLUIDOS, NOMBRES_CLAUDE_CODE, nombreReservado } from '../src/shared/core/comandos'

describe('comandos oficiales de Claude Code', () => {
  it('incluyen los de uso diario y todos están reservados', () => {
    for (const n of ['help', 'clear', 'compact', 'init', 'config', 'model', 'cost', 'memory', 'mcp', 'exit']) expect(NOMBRES_CLAUDE_CODE.has(n)).toBe(true)
    for (const c of COMANDOS_CLAUDE) expect(NOMBRES_CLAUDE_CODE.has(c.nombre)).toBe(true)
  })
  it('nombres válidos para un comando y sin repetir', () => {
    const nombres = COMANDOS_CLAUDE.map((c) => c.nombre)
    expect(new Set(nombres).size).toBe(nombres.length)
    for (const n of nombres) expect(n).toMatch(/^[a-z][a-z0-9_-]{0,31}$/)
    for (const c of COMANDOS_CLAUDE) expect(c.uso.startsWith(`/${c.nombre}`)).toBe(true)
  })
  it('no pisan los comandos propios de la aplicación', () => {
    const app = new Set<string>(COMANDOS_INCLUIDOS.map((c) => c.nombre))
    for (const c of COMANDOS_CLAUDE) expect(app.has(c.nombre)).toBe(false)
  })
  it('nombreReservado distingue aplicación, Claude Code y libre', () => {
    expect(nombreReservado('flujo')).toMatch(/aplicación/)
    expect(nombreReservado('compact')).toMatch(/oficial de Claude Code/)
    expect(nombreReservado('desplegar')).toBeNull()
  })
})
