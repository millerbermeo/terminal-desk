import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { LectorTurno } from '../src/main/core/suscripcion'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { RAIZ, construirTrabajo, duracion, enOrdenDeArbol } from '../src/renderer/agente/trabajo'
import { VistaActividad, VistaArbol, VistaTiempo } from '../src/renderer/components/PanelTrabajo'
import { LlmFalso, texto, usar } from './ayudas'

type Ev = EventoAgente
const base = { ejecucionId: 'e' }
const raiz = (e: Record<string, unknown>): Ev => ({ ...base, agente: 'asistente', profundidad: 0, ...e }) as Ev
const sub = (agente: string, padre: string, e: Record<string, unknown>, profundidad = 1): Ev => ({ ...base, agente, profundidad, padre, ...e }) as Ev
const ini = (id: string, nombre: string, entrada: Record<string, unknown> = {}) => ({ tipo: 'herramienta_inicio', llamada: { id, nombre, entrada } })
const fin = (id: string, nombre: string, error = false) => ({ tipo: 'herramienta_fin', llamada: { id, nombre, entrada: {} }, resultado: { texto: 'ok', ...(error ? { error: true } : {}) } })

/** Turno de suscripción: el asistente lee, delega en dos «revisor» en paralelo y uno falla una herramienta. */
const eventosCli: Ev[] = [
  raiz({ tipo: 'inicio', prompt: 'revisa todo' }),
  raiz(ini('r1', 'Read', { file_path: '/p/a.ts' })),
  raiz(fin('r1', 'Read')),
  raiz(ini('A1', 'Agent', { subagent_type: 'revisor', description: 'Revisar el backend' })),
  raiz(ini('A2', 'Agent', { subagent_type: 'revisor', description: 'Revisar el frontend' })),
  sub('revisor', 'A1', ini('s1', 'Grep', { pattern: 'TODO' })),
  sub('revisor', 'A2', ini('s2', 'Bash', { command: 'npm test' })),
  sub('revisor', 'A1', fin('s1', 'Grep')),
  sub('revisor', 'A2', fin('s2', 'Bash', true)),
  sub('revisor', 'A1', { tipo: 'texto', texto: 'Backend correcto' }),
  raiz(fin('A1', 'Agent'))
]

describe('construirTrabajo', () => {
  it('arma el árbol por la llamada que lanzó cada subagente (dos iguales en paralelo son nodos distintos)', () => {
    const tr = construirTrabajo({ eventos: eventosCli, prompt: 'revisa todo', raiz: 'asistente', enCurso: true })
    expect(tr.nodos[RAIZ]!.hijos).toEqual(['A1', 'A2'])
    expect(tr.nodos.A1).toMatchObject({ agente: 'revisor', tarea: 'Revisar el backend', profundidad: 1, estado: 'completado', ultimoTexto: 'Backend correcto' })
    expect(tr.nodos.A2).toMatchObject({ tarea: 'Revisar el frontend', estado: 'trabajando' })
    expect(tr.nodos.A2!.pasos[0]).toMatchObject({ nombre: 'Bash', error: true })
    expect(tr.nodos[RAIZ]!.pasos.map((p) => p.nombre)).toEqual(['Read'])
    expect(tr.activos).toBe(1)
    expect(tr.totalPasos).toBe(3)
    expect(enOrdenDeArbol(tr).map((n) => n.id)).toEqual([RAIZ, 'A1', 'A2'])
  })

  it('en vivo marca lo que hace ahora cada agente; al terminar cierra todo con el estado del turno', () => {
    const vivo = construirTrabajo({ eventos: [...eventosCli, sub('revisor', 'A2', ini('s3', 'Read', { file_path: '/p/b.ts' }))], prompt: 'p', raiz: 'asistente', enCurso: true })
    expect(vivo.nodos.A2!.actual).toContain('b.ts')
    expect(vivo.nodos.A2!.categoriaActual).toBe('leer')

    const cerrado = construirTrabajo({ eventos: eventosCli, prompt: 'p', raiz: 'asistente', enCurso: false, estadoTurno: 'cancelado' })
    expect(cerrado.nodos[RAIZ]!.estado).toBe('cancelado')
    expect(cerrado.nodos.A2!.estado).toBe('cancelado') // seguía abierto: hereda el estado del turno
    expect(cerrado.nodos.A1!.estado).toBe('completado') // ya había terminado: no cambia
    expect(cerrado.activos).toBe(0)
  })

  it('una petición de permiso pone al agente en espera hasta el siguiente evento', () => {
    const espera = [...eventosCli, sub('revisor', 'A2', { tipo: 'solicitud_humana', solicitudId: 'x', clase: 'accion', contenido: 'c', herramienta: 'Bash' })]
    expect(construirTrabajo({ eventos: espera, prompt: 'p', raiz: 'asistente', enCurso: true }).nodos.A2!.estado).toBe('esperando')
    const sigue = [...espera, sub('revisor', 'A2', ini('s4', 'Bash', { command: 'ls' }))]
    expect(construirTrabajo({ eventos: sigue, prompt: 'p', raiz: 'asistente', enCurso: true }).nodos.A2!.estado).toBe('trabajando')
  })

  it('usa los tiempos reales si están alineados; si no, la secuencia', () => {
    const tiempos = eventosCli.map((_, i) => 1000 + i * 500)
    const real = construirTrabajo({ eventos: eventosCli, tiempos, prompt: 'p', raiz: 'asistente', enCurso: false, estadoTurno: 'completado' })
    expect(real.relativo).toBe(false)
    expect(real.desde).toBe(1000)
    expect(real.nodos.A1!.fin! - real.nodos.A1!.inicio).toBe(3500)
    const sinTiempos = construirTrabajo({ eventos: eventosCli, tiempos: [1, 2], prompt: 'p', raiz: 'asistente', enCurso: false })
    expect(sinTiempos.relativo).toBe(true)
  })

  it('la actividad cuenta delegaciones, fallos y avisos; TodoWrite no es un paso', () => {
    const tr = construirTrabajo({
      eventos: [...eventosCli, raiz(ini('t', 'TodoWrite', { todos: [] })), raiz({ tipo: 'guardrail', herramienta: 'Read', motivo: 'credenciales tapadas' })],
      prompt: 'p',
      raiz: 'asistente',
      enCurso: true
    })
    const tipos = tr.actividad.map((a) => a.tipo)
    expect(tipos.filter((t) => t === 'subagente')).toHaveLength(2)
    expect(tipos).toContain('fin_subagente')
    expect(tipos).toContain('guardrail')
    expect(tr.actividad.some((a) => a.error && a.texto.startsWith('Falló'))).toBe(true)
    expect(tr.totalPasos).toBe(3)
  })

  it('duracion es legible', () => {
    expect(duracion(850)).toBe('850 ms')
    expect(duracion(12_400)).toBe('12 s')
    expect(duracion(185_000)).toBe('3 min 05 s')
  })
})

describe('origen de los eventos', () => {
  it('suscripción: los mensajes de un subagente del CLI salen con su nombre, profundidad y padre (sin contar pasos)', () => {
    const eventos: Record<string, unknown>[] = []
    const l = new LectorTurno({ prompt: 'p', senal: new AbortController().signal, alEvento: (e) => eventos.push(e), retenerFin: true }, () => undefined, () => undefined)
    l.procesar({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'A1', name: 'Agent', input: { subagent_type: 'revisor', description: 'd', prompt: 'p' } }] } })
    l.procesar({ type: 'assistant', parent_tool_use_id: 'A1', message: { content: [{ type: 'text', text: 'miro' }, { type: 'tool_use', id: 's1', name: 'Grep', input: { pattern: 'x' } }] } })
    l.procesar({ type: 'user', parent_tool_use_id: 'A1', message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: 'x'.repeat(5000) }] } })
    const delSub = eventos.filter((e) => e.padre === 'A1')
    expect(delSub.map((e) => e.tipo)).toEqual(['texto', 'herramienta_inicio', 'herramienta_fin'])
    expect(delSub.every((e) => e.agente === 'revisor' && e.profundidad === 1)).toBe(true)
    const resultado = (delSub[2]!.resultado as { texto: string }).texto
    expect(resultado.length).toBeLessThan(2100) // recortado: solo se muestra
    expect(eventos.filter((e) => e.tipo === 'paso')).toHaveLength(1) // solo el mensaje propio cuenta como paso
  })

  it('modo API: los eventos del subagente llevan como padre la llamada a delegar', async () => {
    const registro = new RegistroHerramientas()
    registro.registrar({ nombre: 'leer', descripcion: 'leer', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: 'contenido' }) })
    const padre = new Agente({ nombre: 'jefe', descripcion: '', sistema: 's', herramientas: ['leer'], subagentes: [{ nombre: 'revisor', descripcion: 'revisa', sistema: 's', herramientas: ['leer'] }] })
    const llm = new LlmFalso([usar('d1', 'delegar', { agente: 'revisor', tarea: 'mira a.ts' }), usar('l1', 'leer'), texto('visto'), texto('hecho')])
    const eventos: EventoAgente[] = []
    await new Harness({ llm, registro }).ejecutar(padre, { prompt: 'p', cwd: '.', alEvento: (e) => eventos.push(e) })
    const delHijo = eventos.filter((e) => e.agente === 'revisor')
    expect(delHijo.length).toBeGreaterThan(0)
    expect(delHijo.every((e) => e.padre === 'd1' && e.profundidad === 1)).toBe(true)
    expect(eventos.filter((e) => e.agente === 'jefe').every((e) => e.padre === undefined)).toBe(true)
    const tr = construirTrabajo({ eventos, prompt: 'p', raiz: 'jefe', enCurso: false, estadoTurno: 'completado' })
    expect(tr.nodos.d1).toMatchObject({ agente: 'revisor', tarea: 'mira a.ts', estado: 'completado' })
    expect(tr.nodos.d1!.pasos.map((p) => p.nombre)).toEqual(['leer'])
  })
})

describe('vistas del panel', () => {
  const tr = construirTrabajo({ eventos: eventosCli, tiempos: eventosCli.map((_, i) => i * 1000), prompt: 'revisa todo', raiz: 'asistente', enCurso: true, ahora: 20_000 })

  it('el árbol pinta una tarjeta por agente con su estado', () => {
    const html = renderToString(createElement(VistaArbol, { tr }))
    expect(html.match(/class="trb-tarjeta /g)).toHaveLength(3)
    expect(html).toContain('Revisar el frontend')
    expect(html).toContain('estado-trabajando')
    expect(html).toContain('trb-particula')
  })

  it('la línea de tiempo pinta una fila por agente y un segmento por herramienta', () => {
    const html = renderToString(createElement(VistaTiempo, { tr }))
    expect(html.match(/class="trb-fila /g)).toHaveLength(3)
    expect(html.match(/class="trb-segmento /g)).toHaveLength(3)
  })

  it('la actividad lista lo ocurrido con su agente', () => {
    const html = renderToString(createElement(VistaActividad, { tr, vivo: true }))
    expect(html).toContain('Delega en revisor')
    expect(html).toContain('Falló')
  })
})
