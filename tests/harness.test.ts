import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { RegistroHerramientas, type Herramienta } from '../src/main/core/tools/registro'
import { LlmFalso, resultadosDe, texto, usar } from './ayudas'

const herramienta = (nombre: string, riesgo: Herramienta['riesgo'], llamadas: string[] = []): Herramienta => ({
  nombre, descripcion: nombre, esquema: { type: 'object' }, riesgo,
  ejecutar: async () => { llamadas.push(nombre); return { texto: `hecho:${nombre}` } }
})

function montar(llm: LlmFalso, extra: { aprobar?: boolean; llamadas?: string[] } = {}) {
  const registro = new RegistroHerramientas()
  registro.registrar(herramienta('leer', 'lectura', extra.llamadas))
  registro.registrar(herramienta('borrar', 'ejecucion', extra.llamadas))
  const aprobar = extra.aprobar === undefined ? undefined : async () => extra.aprobar!
  return new Harness({ llm, registro, ...(aprobar ? { aprobar } : {}) })
}

describe('Harness', () => {
  it('lectura pasa; ejecución se deniega sin aprobador', async () => {
    const llamadas: string[] = []
    const llm = new LlmFalso([usar('1', 'leer'), usar('2', 'borrar'), texto('fin')])
    const r = await montar(llm, { llamadas }).ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), { prompt: 'p', cwd: '.' })
    expect(llamadas).toEqual(['leer'])
    expect(resultadosDe(r.mensajes.at(-2)!)[0]).toMatchObject({ error: true })
    expect(r.estado).toBe('completado')
  })
  it('con aprobador que acepta, ejecuta', async () => {
    const llamadas: string[] = []
    const llm = new LlmFalso([usar('1', 'borrar'), texto('fin')])
    await montar(llm, { llamadas, aprobar: true }).ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 's' }), { prompt: 'p', cwd: '.' })
    expect(llamadas).toEqual(['borrar'])
  })
  it('un agente solo ve y puede llamar sus herramientas permitidas', async () => {
    const llamadas: string[] = []
    const llm = new LlmFalso([usar('1', 'borrar'), texto('fin')])
    const agente = new Agente({ nombre: 'a', descripcion: '', sistema: 's', herramientas: ['leer'] })
    await montar(llm, { llamadas, aprobar: true }).ejecutar(agente, { prompt: 'p', cwd: '.' })
    expect(llm.peticiones[0]!.herramientas.map((h) => h.nombre)).toEqual(['leer'])
    expect(llamadas).toEqual([])
  })
  it('delega en subagente con contexto aislado y emite eventos con profundidad', async () => {
    const llm = new LlmFalso([
      usar('d', 'delegar', { agente: 'hijo', tarea: 'investiga X' }),
      texto('resumen del hijo'), // respuesta del hijo
      texto('final del padre')
    ])
    const agente = new Agente({
      nombre: 'padre', descripcion: '', sistema: 'sp',
      subagentes: [{ nombre: 'hijo', descripcion: 'investiga', sistema: 'sh', herramientas: ['leer'] }]
    })
    const eventos: EventoAgente[] = []
    const r = await montar(llm).ejecutar(agente, { prompt: 'p', cwd: '.', alEvento: (e) => eventos.push(e) })
    expect(r.texto).toBe('final del padre')
    // El hijo solo vio la tarea, no la conversación del padre.
    expect(llm.peticiones[1]!.sistema).toBe('sh')
    expect(llm.peticiones[1]!.mensajes).toHaveLength(1)
    expect(llm.peticiones[1]!.herramientas.map((h) => h.nombre)).toEqual(['leer'])
    expect(resultadosDe(r.mensajes.at(-2)!)[0]!.texto).toBe('resumen del hijo')
    expect(new Set(eventos.map((e) => e.ejecucionId)).size).toBe(1)
    expect(eventos.filter((e) => e.tipo === 'fin').map((e) => [e.agente, e.profundidad])).toEqual([['hijo', 1], ['padre', 0]])
  })
  it('no ofrece delegar más allá de la profundidad máxima', async () => {
    const llm = new LlmFalso([texto('x')])
    const registro = new RegistroHerramientas()
    const agente = new Agente({ nombre: 'p', descripcion: '', sistema: 's', subagentes: [{ nombre: 'h', descripcion: '', sistema: 's' }] })
    await new Harness({ llm, registro, maxProfundidad: 0 }).ejecutar(agente, { prompt: 'p', cwd: '.' })
    expect(llm.peticiones[0]!.herramientas).toEqual([])
  })
})
