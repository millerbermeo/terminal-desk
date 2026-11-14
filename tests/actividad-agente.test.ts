import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { actividadActual, agruparEventos, describirHerramienta, duracion } from '../src/renderer/agente/actividad'

const base = { ejecucionId: 'e', agente: 'asistente', profundidad: 0 }
const ini = (id: string, nombre: string, entrada: Record<string, unknown> = {}): EventoAgente => ({ ...base, tipo: 'herramienta_inicio', llamada: { id, nombre, entrada } })
const fin = (id: string, error = false): EventoAgente => ({ ...base, tipo: 'herramienta_fin', llamada: { id, nombre: 'x', entrada: {} }, resultado: { texto: 'ok', ...(error ? { error: 'mal' } : {}) } } as EventoAgente)
const txt = (texto: string): EventoAgente => ({ ...base, tipo: 'texto', texto })

describe('describirHerramienta', () => {
  it('nombra las herramientas conocidas con su dato clave', () => {
    expect(describirHerramienta('Read', { file_path: '/home/a/proyecto/src/modules/chat/chat.service.ts' })).toMatchObject({ categoria: 'leer', titulo: 'Leer archivo', detalle: '…/modules/chat/chat.service.ts' })
    expect(describirHerramienta('Bash', { command: 'pnpm test', description: 'Correr pruebas' })).toMatchObject({ categoria: 'terminal', detalle: 'Correr pruebas' })
  })
  it('humaniza las herramientas MCP', () => {
    const d = describirHerramienta('mcp__odesk__comentar_tarea', { tarea: '58', texto: 'Frontend verificado' })
    expect(d).toMatchObject({ categoria: 'tareas', titulo: 'Comentar tarea', enCurso: 'Comentando tarea', detalle: '#58 · Frontend verificado' })
    expect(describirHerramienta('mcp__odesk__memoria_guardar', { titulo: 'E2E' }).categoria).toBe('memoria')
    expect(describirHerramienta('mcp__playwright__browser_click', { element: 'Botón' })).toMatchObject({ categoria: 'navegador', titulo: 'Click' })
  })
})

describe('agruparEventos', () => {
  it('agrupa herramientas seguidas y corta en el texto', () => {
    const evs = [txt('hola'), ini('1', 'Read'), fin('1'), ini('2', 'Grep'), fin('2', true), txt('listo'), ini('3', 'Bash')]
    const g = agruparEventos(evs)
    expect(g.map((x) => x.tipo)).toEqual(['evento', 'herramientas', 'evento', 'herramientas'])
    const grupo = g[1] as Extract<(typeof g)[number], { tipo: 'herramientas' }>
    expect(grupo.pasos.map((p) => [p.inicio.llamada.id, Boolean(p.fin), Boolean(p.fin?.resultado.error)])).toEqual([['1', true, false], ['2', true, true]])
  })
  it('el plan (TodoWrite) no corta el grupo', () => {
    const g = agruparEventos([ini('1', 'Read'), ini('p', 'TodoWrite', { todos: [] }), ini('2', 'Edit')])
    expect(g.filter((x) => x.tipo === 'herramientas')).toHaveLength(1)
  })
})

describe('actividadActual', () => {
  it('dice qué herramienta está en curso, o si piensa o escribe', () => {
    expect(actividadActual([ini('1', 'Read', { file_path: 'a.ts' })], false)).toMatchObject({ texto: 'Leyendo archivo · a.ts', categoria: 'leer' })
    expect(actividadActual([ini('1', 'Read'), fin('1')], false).texto).toBe('Pensando')
    expect(actividadActual([ini('1', 'Read'), fin('1')], true).texto).toBe('Escribiendo')
  })
  it('formatea la duración', () => expect(duracion(75_000)).toBe('1:15'))
})
