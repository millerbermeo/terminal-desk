import { describe, expect, it } from 'vitest'
import type { Mensaje } from '@shared/core/agente'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { MARCA_RESUMEN, CompresorContexto, puntoDeCorte } from '../src/main/core/context/compresion'
import { MonitorContexto } from '../src/main/core/context/monitor'
import { resumenDeRespaldo } from '../src/main/core/consumo'
import { LectorTurno } from '../src/main/core/suscripcion'
import { RegistroHerramientas, type Herramienta } from '../src/main/core/tools/registro'
import { LlmFalso, resultadosDe, texto, usar } from './ayudas'

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Varias llamadas a herramientas en una misma respuesta del modelo. */
const usarVarias = (...us: [string, string][]): ReturnType<typeof usar> => {
  const rs = us.map(([id, nombre]) => usar(id, nombre))
  return { ...rs[0]!, contenido: rs.flatMap((r) => r.contenido) }
}

describe('Harness: las herramientas no se pisan', () => {
  function montar(llm: LlmFalso, traza: string[], extra: Herramienta[] = []) {
    const registro = new RegistroHerramientas()
    const lenta = (nombre: string, riesgo: Herramienta['riesgo']): Herramienta => ({
      nombre, descripcion: nombre, esquema: { type: 'object' }, riesgo,
      ejecutar: async () => {
        traza.push(`+${nombre}`)
        await pausa(15)
        traza.push(`-${nombre}`)
        return { texto: 'ok' }
      }
    })
    for (const h of [lenta('leer', 'lectura'), lenta('buscar', 'lectura'), lenta('editar', 'escritura'), lenta('ejecutar', 'ejecucion'), ...extra]) registro.registrar(h)
    return new Harness({ llm, registro, aprobar: async () => true })
  }
  const agente = new Agente({ nombre: 'a', descripcion: '', sistema: 's' })

  it('las lecturas van en paralelo y las escrituras de una en una', async () => {
    const traza: string[] = []
    const llm = new LlmFalso([usarVarias(['1', 'leer'], ['2', 'buscar'], ['3', 'editar'], ['4', 'ejecutar']), texto('fin')])
    const r = await montar(llm, traza).ejecutar(agente, { prompt: 'p', cwd: '.' })
    expect(r.estado).toBe('completado')
    // Las dos lecturas se solapan…
    expect(traza.indexOf('+buscar')).toBeLessThan(traza.indexOf('-leer'))
    // …pero la ejecución no empieza hasta que la edición terminó.
    expect(traza.indexOf('+ejecutar')).toBeGreaterThan(traza.indexOf('-editar'))
    // Los resultados vuelven en el orden de las llamadas.
    expect(resultadosDe(r.mensajes.at(-2)!).map((x) => x.usoId)).toEqual(['1', '2', '3', '4'])
  })

  it('dos subagentes delegados a la vez no escriben al mismo tiempo', async () => {
    const traza: string[] = []
    const padre = new Agente({
      nombre: 'padre', descripcion: '', sistema: 'sp',
      subagentes: [{ nombre: 'uno', descripcion: 'x', sistema: 'uno' }, { nombre: 'dos', descripcion: 'x', sistema: 'dos' }]
    })
    // Cada hijo edita una vez; el LLM falso responde según quién pregunta (los hijos corren a la vez).
    const pasos = new Map<string, number>()
    const llm = new LlmFalso([])
    llm.completar = async (p) => {
      const quien = p.sistema ?? ''
      const n = pasos.get(quien) ?? 0
      pasos.set(quien, n + 1)
      if (quien === 'sp') return n === 0 ? { ...usar('d1', 'delegar', { agente: 'uno', tarea: 't' }), contenido: [...usar('d1', 'delegar', { agente: 'uno', tarea: 't' }).contenido, ...usar('d2', 'delegar', { agente: 'dos', tarea: 't' }).contenido] } : texto('fin')
      return n === 0 ? usar(`e-${quien}`, 'editar') : texto(`hecho ${quien}`)
    }
    const r = await montar(llm, traza).ejecutar(padre, { prompt: 'p', cwd: '.' })
    expect(r.estado).toBe('completado')
    expect(traza).toEqual(['+editar', '-editar', '+editar', '-editar'])
    expect(resultadosDe(r.mensajes.at(-2)!).map((x) => x.texto).sort()).toEqual(['hecho dos', 'hecho uno'])
    // El consumo de los hijos cuenta en el total del padre (2 llamadas del padre + 2 de cada hijo).
    const porLlamada = texto('x').uso
    expect(r.uso.tokensSalida).toBe(porLlamada.tokensSalida * 6)
  })

  it('una herramienta que lanza no tumba el turno: el modelo recibe el error', async () => {
    const rota: Herramienta = { nombre: 'rota', descripcion: '', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => { throw new Error('boom') } }
    const llm = new LlmFalso([usar('1', 'rota'), texto('fin')])
    const registro = new RegistroHerramientas()
    registro.registrar(rota)
    const h = new Harness({ llm, registro, validar: async () => { throw new Error('guardrail roto') } })
    const r = await h.ejecutar(agente, { prompt: 'p', cwd: '.' })
    expect(r.estado).toBe('completado')
    expect(resultadosDe(r.mensajes.at(-2)!)[0]).toMatchObject({ error: true })
    expect(resultadosDe(r.mensajes.at(-2)!)[0]!.texto).toContain('guardrail roto')
  })
})

describe('compresión a mitad de un turno largo', () => {
  const user = (t: string): Mensaje => ({ rol: 'user', contenido: [{ tipo: 'texto', texto: t }] })
  const usa = (id: string): Mensaje => ({ rol: 'assistant', contenido: [{ tipo: 'herramienta_uso', id, nombre: 'leer', entrada: { ruta: 'x'.repeat(300) } }] })
  const res = (id: string): Mensaje => ({ rol: 'user', contenido: [{ tipo: 'herramienta_resultado', usoId: id, texto: 'r'.repeat(300) }] })
  const asis = (t: string): Mensaje => ({ rol: 'assistant', contenido: [{ tipo: 'texto', texto: t }] })

  it('sin corte hacia delante, corta en el inicio del turno en curso', () => {
    const ms = [user('a'), asis('b'), user('tarea larga'), ...Array.from({ length: 6 }, (_, i) => [usa(`t${i}`), res(`t${i}`)]).flat()]
    expect(puntoDeCorte(ms, ms.length - 6)).toBe(2)
  })

  it('resume lo anterior al turno en curso y conserva el resumen previo entero', async () => {
    const previo = `${MARCA_RESUMEN}\n${'dato-antiguo '.repeat(400)}FIN-RESUMEN`
    const ms = [
      { rol: 'user', contenido: [{ tipo: 'texto', texto: previo }, { tipo: 'texto', texto: 'primera' }] } as Mensaje,
      asis('respuesta '.repeat(300)),
      user('tarea larga'),
      ...Array.from({ length: 8 }, (_, i) => [usa(`t${i}`), res(`t${i}`)]).flat()
    ]
    const llm = new LlmFalso([texto('RESUMEN NUEVO')])
    const c = new CompresorContexto(new MonitorContexto({ ventana: 3000, umbral: 0.5, reservaSalida: 0 }), { llm })
    const r = await c.preparar({ herramientas: [] }, ms)
    expect(r.estrategia).toBe('resumen')
    // Al modelo que resume le llega el resumen anterior completo, no recortado a 2000 caracteres.
    expect(JSON.stringify(llm.peticiones[0]!.mensajes)).toContain('FIN-RESUMEN')
    // Se conserva el turno en curso completo, con cada tool_use junto a su resultado.
    expect(r.mensajes).toHaveLength(17)
    expect(r.mensajes[0]!.contenido.map((b) => (b.tipo === 'texto' ? b.texto : ''))).toEqual([`${MARCA_RESUMEN}\nRESUMEN NUEVO`, 'tarea larga'])
    // Ya no hay dónde cortar: la siguiente pasada no vuelve a llamar al modelo.
    const otra = await c.preparar({ herramientas: [] }, r.mensajes)
    expect(otra.estrategia).not.toBe('resumen')
    expect(llm.peticiones).toHaveLength(1)
  })
})

describe('rotación de la sesión del CLI', () => {
  it('el resumen de respaldo conserva el de la rotación anterior', () => {
    const r = resumenDeRespaldo('turnos recientes', undefined, 'objetivo inicial')
    expect(r).toContain('objetivo inicial')
    expect(r).toContain('turnos recientes')
    expect(resumenDeRespaldo('solo')).toBe('solo')
  })

  it('la compactación del CLI se avisa y reinicia la cuenta de imágenes', () => {
    const eventos: Record<string, unknown>[] = []
    const l = new LectorTurno({ prompt: 'p', senal: new AbortController().signal, alEvento: (e) => eventos.push(e), retenerFin: true }, () => undefined, () => undefined)
    const imagen = (id: string): Parameters<LectorTurno['procesar']>[0] => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'image' }] }] } })
    l.procesar({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] } })
    l.procesar(imagen('a'))
    l.procesar({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 141000, post_tokens: 9000 } })
    // La de un subagente no cuenta: su contexto es otro.
    l.procesar({ type: 'system', subtype: 'compact_boundary', parent_tool_use_id: 'x', compact_metadata: { pre_tokens: 5 } })
    l.procesar({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Read', input: {} }] } })
    l.procesar(imagen('b'))
    l.procesar({ type: 'result', result: 'listo' })
    const s = l.finalizar(0, '')
    expect(eventos.filter((e) => e.tipo === 'contexto')).toEqual([{ tipo: 'contexto', estrategia: 'resumen', tokensAntes: 141000, tokensDespues: 9000 }])
    expect(s.compactado).toBe(true)
    expect(s.imagenes).toBe(1)
  })
})
