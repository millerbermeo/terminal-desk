import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { cambiosDelTurno, revertirArchivo } from '../src/renderer/agente/utilidades-chat'
import { bloqueFijado, huellaFijado, normalizarFijado } from '../src/renderer/agente/fijado'

const base = { ejecucionId: 'e', agente: 'asistente', profundidad: 0 }
const uso = (id: string, nombre: string, entrada: Record<string, unknown>): EventoAgente => ({ ...base, tipo: 'herramienta_inicio', llamada: { id, nombre, entrada } }) as EventoAgente
const fin = (id: string, nombre: string, error = false): EventoAgente => ({ ...base, tipo: 'herramienta_fin', llamada: { id, nombre, entrada: {} }, resultado: { texto: '', error } }) as EventoAgente

describe('cambiosDelTurno', () => {
  it('agrupa por archivo, cuenta líneas y omite las llamadas fallidas o sin terminar', () => {
    const r = cambiosDelTurno([
      uso('1', 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b\\nc' }),
      fin('1', 'Edit'),
      uso('2', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }),
      fin('2', 'Edit', true),
      uso('3', 'Write', { file_path: '/p/b.ts', content: 'uno\\ndos' }),
      fin('3', 'Write'),
      uso('4', 'Edit', { file_path: '/p/c.ts', old_string: 'q', new_string: 'w' })
    ])
    expect(r.map((x) => x.ruta)).toEqual(['/p/a.ts', '/p/b.ts'])
    expect(r[0]!.cambios).toHaveLength(1)
    expect(r[1]!.reescribe).toBe(true)
  })
})

describe('revertirArchivo', () => {
  it('deshace del último al primero', () => {
    const cambios = [
      { ruta: 'a', antes: 'uno', despues: 'UNO', reescribe: false },
      { ruta: 'a', antes: 'UNO dos', despues: 'UNO DOS', reescribe: false }
    ]
    expect(revertirArchivo('x UNO DOS y', cambios)).toEqual({ ok: true, contenido: 'x uno dos y' })
  })

  it('todo o nada: si un trozo ya cambió, no devuelve nada', () => {
    expect(revertirArchivo('otra cosa', [{ ruta: 'a', antes: 'a', despues: 'b', reescribe: false }])).toEqual({ ok: false, motivo: 'ya-cambiado' })
    expect(revertirArchivo('b', [{ ruta: 'a', antes: '', despues: 'b', reescribe: true }]).ok).toBe(false)
  })
})

describe('contexto fijado', () => {
  it('normaliza rutas y nota', () => {
    expect(normalizarFijado('@src/chat/\n src/chat/ \n"docs/a.md", x', '  usa pnpm  ')).toEqual({ archivos: ['src/chat/', 'docs/a.md', 'x'], nota: 'usa pnpm' })
  })

  it('se envía solo si cambió o tras compactar; quitarlo se avisa una vez', () => {
    const f = { archivos: ['src/'], nota: '' }
    const h = huellaFijado(f)
    expect(bloqueFijado(f, '', false)).toContain('- src/')
    expect(bloqueFijado(f, h, false)).toBeUndefined()
    expect(bloqueFijado(f, h, true)).toContain('src/')
    expect(bloqueFijado({ archivos: [], nota: '' }, h, false)).toContain('quitó')
    expect(bloqueFijado({ archivos: [], nota: '' }, '', true)).toBeUndefined()
  })
})
