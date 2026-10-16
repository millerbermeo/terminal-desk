import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { Proyecto } from '@shared/modelos'
import { BusA2A } from '../src/main/core/a2a/bus'
import { crearTopologia, nombreAgente } from '../src/main/core/a2a/submodulos'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { MODELOS_POR_DEFECTO, Router } from '../src/main/core/router/router'
import { registrarIntegradas } from '../src/main/core/tools/integradas'
import { RegistroHerramientas, type Herramienta } from '../src/main/core/tools/registro'
import { LlmFalso, resultadosDe, texto, usar } from './ayudas'

describe('Router', () => {
  const r = new Router()
  it('clasifica por complejidad y asigna modelo', () => {
    expect(r.decidir('¿Qué hace la función parse en utils.ts?')).toMatchObject({ complejidad: 'simple', modelo: MODELOS_POR_DEFECTO.simple, sugerirFlujo: false })
    expect(r.decidir('Renombra la variable x a total')).toMatchObject({ complejidad: 'simple' })
    const media = r.decidir('Añade validación del email en el formulario de registro de usuarios')
    expect(media.complejidad).toBe('media')
    expect(media.sugerirFlujo).toBe(true)
    const compleja = r.decidir('Refactoriza la arquitectura de autenticación y migra la base de datos tocando src/auth/login.ts, src/auth/token.ts y src/db/schema.ts')
    expect(compleja).toMatchObject({ complejidad: 'compleja', modelo: MODELOS_POR_DEFECTO.compleja, sugerirFlujo: true })
  })
  it('acepta un clasificador y modelos propios', () => {
    const rr = new Router({ simple: 'a', media: 'b', compleja: 'c' }, { clasificar: () => ({ complejidad: 'media', razon: 'fijo' }) })
    expect(rr.decidir('x')).toMatchObject({ modelo: 'b', razon: 'fijo' })
  })
})

describe('Harness: extras, modelo y aprobador por ejecución', () => {
  it('extras solo para el agente raíz, modelo del raíz, aprobador propio', async () => {
    const llamadas: string[] = []
    const extra: Herramienta = { nombre: 'extra', descripcion: 'e', esquema: { type: 'object' }, riesgo: 'ejecucion', ejecutar: async () => (llamadas.push('extra'), { texto: 'x' }) }
    const llm = new LlmFalso([usar('1', 'extra'), texto('fin')])
    const registro = new RegistroHerramientas()
    const agente = new Agente({ nombre: 'a', descripcion: '', sistema: 's', herramientas: [] })
    await new Harness({ llm, registro }).ejecutar(agente, { prompt: 'p', cwd: '.', extras: [extra], modelo: 'm-router', aprobar: async () => true })
    expect(llamadas).toEqual(['extra'])
    expect(llm.peticiones[0]).toMatchObject({ modelo: 'm-router' })
    expect(llm.peticiones[0]!.herramientas.map((h) => h.nombre)).toEqual(['extra'])
    // sin aprobador propio ni global se deniega
    const llm2 = new LlmFalso([usar('1', 'extra'), texto('fin')])
    const r = await new Harness({ llm: llm2, registro }).ejecutar(agente, { prompt: 'p', cwd: '.', extras: [extra] })
    expect(resultadosDe(r.mensajes.at(-2)!)[0]).toMatchObject({ error: true })
  })
})

describe('A2A', () => {
  it('nombres de agente válidos y únicos', () => {
    const usados = new Set<string>()
    const a = nombreAgente('Mi Backend (API)', usados)
    usados.add(a)
    expect(a).toBe('mi-backend-api')
    expect(nombreAgente('Mi Backend (API)', usados)).toBe('mi-backend-api-2')
    expect(nombreAgente('Coordinador', new Set())).not.toBe('coordinador')
  })

  it('el bus detecta ciclos, cadenas largas y destinos desconocidos', async () => {
    const bus = new BusA2A()
    for (const n of ['a', 'b', 'c', 'd'])
      bus.registrar({ nombre: n, descripcion: n, atender: async (p) => `${n}:${p.pregunta}` })
    expect(await bus.enviar({ de: 'x', a: 'a', pregunta: 'q', cadena: [] })).toBe('a:q')
    await expect(bus.enviar({ de: 'a', a: 'a', pregunta: 'q', cadena: ['a'] })).rejects.toThrow(/Ciclo/)
    await expect(bus.enviar({ de: 'c', a: 'd', pregunta: 'q', cadena: ['a', 'b', 'c'] })).rejects.toThrow(/larga/)
    await expect(bus.enviar({ de: 'a', a: 'zz', pregunta: 'q', cadena: [] })).rejects.toThrow(/desconocido/)
    const h = bus.herramientaConsultar('a', [], undefined)
    expect(h.esquema.properties!.agente!.enum).toEqual(['b', 'c', 'd'])
  })

  it('el coordinador consulta a los especialistas, que leen su propio proyecto', async () => {
    const mk = async (nombre: string, archivo: string, contenido: string): Promise<Proyecto> => {
      const ruta = await mkdtemp(join(tmpdir(), `${nombre}-`))
      await mkdir(ruta, { recursive: true })
      await writeFile(join(ruta, archivo), contenido)
      return { id: nombre, nombre, ruta }
    }
    const back = await mk('Backend', 'api.txt', 'GET /usuarios')
    const front = await mk('Frontend', 'ui.txt', 'tabla')
    const registro = new RegistroHerramientas()
    registrarIntegradas(registro)
    const llm = new LlmFalso([
      // coordinador pide al backend
      usar('c1', 'consultar_agente', { agente: 'backend', pregunta: '¿qué endpoints hay?' }),
      // backend lee su archivo y responde
      usar('b1', 'leer_archivo', { ruta: 'api.txt' }),
      texto('Endpoint: GET /usuarios'),
      // coordinador sintetiza
      texto('El backend expone GET /usuarios')
    ])
    const eventos: EventoAgente[] = []
    const bus = new BusA2A()
    const harness = new Harness({ llm, registro })
    const { coordinador, agentes } = crearTopologia({ proyectos: [back, front], harness, bus, ejecucionId: 'e', alEvento: (e) => eventos.push(e) })
    expect(agentes).toEqual(['backend', 'frontend'])
    const r = await harness.ejecutar(coordinador, {
      prompt: 'resume la API', cwd: back.ruta, ejecucionId: 'e', alEvento: (e) => eventos.push(e),
      extras: [bus.herramientaConsultar('coordinador', [], (m) => eventos.push({ ejecucionId: 'e', agente: m.de, profundidad: 0, tipo: 'a2a', ...m }))]
    })
    expect(r.texto).toBe('El backend expone GET /usuarios')
    // el especialista recibió la pregunta y el resultado de su lectura volvió a él
    expect(JSON.stringify(llm.peticiones[1]!.mensajes)).toContain('¿qué endpoints hay?')
    expect(JSON.stringify(llm.peticiones[2]!.mensajes)).toContain('GET /usuarios')
    // el coordinador no tiene herramientas de archivo
    expect(llm.peticiones[0]!.herramientas.map((h) => h.nombre).sort()).toEqual(['consultar_agente']) // buscar_memoria no está registrada en este registro de prueba
    expect(eventos.filter((e) => e.tipo === 'a2a').map((e) => e.tipo === 'a2a' && e.fase)).toEqual(['envio', 'respuesta'])
  })
})
