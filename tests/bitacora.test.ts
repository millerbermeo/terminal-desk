import { describe, expect, it } from 'vitest'
import { Bitacora } from '../src/main/core/bitacora'

const herramienta = (nombre: string, entrada: Record<string, unknown>, texto: string, error = false) =>
  [
    { tipo: 'herramienta_inicio', llamada: { id: nombre, nombre, entrada } },
    { tipo: 'herramienta_fin', llamada: { id: nombre, nombre, entrada }, resultado: { texto, ...(error ? { error: true } : {}) } }
  ] as const

describe('Bitacora', () => {
  it('resume la petición, lo dicho y cada herramienta con su resultado', () => {
    const b = new Bitacora()
    b.registrar({ tipo: 'inicio', prompt: 'Crea tres archivos' })
    b.registrar({ tipo: 'texto', texto: 'Voy con el primero' })
    for (const e of herramienta('Bash', { command: 'sleep 20' }, 'ok')) b.registrar(e)
    for (const e of herramienta('Write', { file_path: '/p/a.txt' }, 'denegado', true)) b.registrar(e)
    const t = b.texto()
    expect(t).toContain('Petición original: Crea tres archivos')
    expect(t).toContain('Herramientas usadas hasta ahora: 2')
    expect(t).toContain('Dijo: Voy con el primero')
    expect(t).toContain('Usa Bash: sleep 20')
    expect(t).toContain('→ ERROR: denegado')
  })

  it('lleva el plan vigente y lo que está ejecutando ahora mismo', () => {
    const b = new Bitacora()
    b.registrar({ tipo: 'inicio', prompt: 'Migra las imágenes' })
    b.registrar({ tipo: 'herramienta_inicio', llamada: { id: 't1', nombre: 'TodoWrite', entrada: { todos: [{ content: 'Leer el código', status: 'completed' }, { content: 'Migrar', status: 'in_progress' }, { content: 'Probar', status: 'pending' }] } } })
    b.registrar({ tipo: 'herramienta_fin', llamada: { id: 't1', nombre: 'TodoWrite', entrada: {} }, resultado: { texto: 'ok' } })
    b.registrar({ tipo: 'herramienta_inicio', llamada: { id: 'b1', nombre: 'Bash', entrada: { command: 'pnpm test' } } })
    const t = b.texto()
    expect(t).toContain('[x] Leer el código')
    expect(t).toContain('[>] Migrar')
    expect(t).toContain('[ ] Probar')
    expect(t).toContain('Ejecutando ahora mismo (sin terminar): Bash: pnpm test')
    b.registrar({ tipo: 'herramienta_fin', llamada: { id: 'b1', nombre: 'Bash', entrada: {} }, resultado: { texto: 'pasa' } })
    expect(b.texto()).not.toContain('Ejecutando ahora mismo')
  })

  it('avisa de un paso largo en curso', () => {
    const b = new Bitacora()
    b.registrar({ tipo: 'inicio', prompt: 'x' })
    expect(b.texto(Date.now() + 120_000)).toContain('paso largo')
  })

  it('al pasar el tope descarta lo más antiguo y conserva la petición y lo reciente', () => {
    const b = new Bitacora(600)
    b.registrar({ tipo: 'inicio', prompt: 'Petición clave' })
    for (let i = 0; i < 50; i++) b.registrar({ tipo: 'texto', texto: `mensaje ${i} ${'x'.repeat(40)}` })
    const t = b.texto()
    expect(t).toContain('Petición clave')
    expect(t).toContain('mensaje 49')
    expect(t).not.toContain('mensaje 0 ')
    expect(t.length).toBeLessThan(1500)
  })

  it('sin movimiento lo dice y no inventa', () => {
    expect(new Bitacora().texto()).toContain('Aún no ha hecho nada visible')
  })
})
