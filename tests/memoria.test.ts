import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { Agente } from '../src/main/core/agents/agente'
import { Harness } from '../src/main/core/agents/harness'
import { CompresorContexto } from '../src/main/core/context/compresion'
import { MonitorContexto } from '../src/main/core/context/monitor'
import { buscar, tokenizar } from '../src/main/core/memory/busqueda'
import { herramientasMemoria } from '../src/main/core/memory/herramientas'
import { MemoriaLargoPlazo } from '../src/main/core/memory/largo-plazo'
import { MemoriaCortoPlazo } from '../src/main/core/memory/sesion'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { LlmFalso, texto, usar } from './ayudas'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mem-'))
})

describe('búsqueda', () => {
  it('normaliza acentos, plurales y palabras vacías', () => {
    expect(tokenizar('La Autenticación de los usuarios')).toEqual(['autenticacion', 'usuario'])
  })
  it('ordena por relevancia', () => {
    const e = (id: string, titulo: string, contenido: string) => ({ id, tipo: 'decision' as const, titulo, contenido, etiquetas: [], creada: '' })
    const r = buscar('base de datos postgres', [e('a', 'Estilo', 'usar tabs'), e('b', 'Base de datos', 'Usamos PostgreSQL 16 con postgres.js'), e('c', 'CI', 'github actions')], 3)
    expect(r.map((x) => x.entrada.id)).toEqual(['b'])
    expect(buscar('', [], 3)).toEqual([])
  })
})

describe('MemoriaLargoPlazo', () => {
  it('guarda, lista, elimina y valida', async () => {
    const m = new MemoriaLargoPlazo(dir)
    await m.guardar({ tipo: 'regla', titulo: 'Idioma', contenido: 'Todo en español' }, 'p1')
    const lista = await m.guardar({ tipo: 'decision', titulo: 'ORM', contenido: 'Usamos Drizzle', etiquetas: ['db'] }, 'p1')
    expect(lista).toHaveLength(2)
    expect(await m.listar('otro')).toEqual([])
    expect(await m.eliminar(lista[0]!.id, 'p1')).toHaveLength(1)
    await expect(m.guardar({ tipo: 'regla', titulo: '', contenido: 'x' }, 'p1')).rejects.toThrow()
    // credenciales: rechazadas también cuando las guarda el usuario por la API (no solo por la herramienta del agente)
    await expect(m.guardar({ tipo: 'hecho', titulo: 'k', contenido: `token ${'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}` }, 'p1')).rejects.toThrow(/credenciales/)
    await expect(m.guardar({ tipo: 'regla', titulo: 'a', contenido: 'b' }, '../fuera')).rejects.toThrow(/inválido/)
  })
  it('contextoPara: reglas siempre + decisiones relevantes + globales, dentro del presupuesto', async () => {
    const m = new MemoriaLargoPlazo(dir)
    await m.guardar({ tipo: 'regla', titulo: 'Idioma', contenido: 'Todo en español' }, 'p1')
    await m.guardar({ tipo: 'decision', titulo: 'ORM', contenido: 'Usamos Drizzle para la base de datos' }, 'p1')
    await m.guardar({ tipo: 'decision', titulo: 'Colores', contenido: 'Tema oscuro por defecto' }, 'p1')
    await m.guardar({ tipo: 'regla', titulo: 'Global', contenido: 'Nunca subir secretos' })
    const ctx = await m.contextoPara('cambiar la base de datos', 'p1')
    expect(ctx).toContain('Idioma')
    expect(ctx).toContain('Nunca subir secretos')
    expect(ctx).toContain('Drizzle')
    expect(ctx).not.toContain('Tema oscuro')
    expect(await m.contextoPara('x', 'vacio')).toContain('Nunca subir secretos')
    expect(await new MemoriaLargoPlazo(await mkdtemp(join(tmpdir(), 'v-'))).contextoPara('x', 'p')).toBe('')
    expect((await m.contextoPara('base de datos', 'p1', 20)).split('\n').length).toBeLessThan(4)
  })
  it('herramientas: buscar es de lectura, guardar exige aprobación', async () => {
    const m = new MemoriaLargoPlazo(dir)
    const [buscarT, guardarT] = herramientasMemoria(m)
    expect([buscarT!.riesgo, guardarT!.riesgo]).toEqual(['lectura', 'escritura'])
    await guardarT!.ejecutar({ tipo: 'hecho', titulo: 'Puerto', contenido: 'El backend escucha en el 3001' }, { cwd: '.', proyectoId: 'p1' })
    expect((await buscarT!.ejecutar({ consulta: 'puerto backend' }, { cwd: '.', proyectoId: 'p1' })).texto).toContain('3001')
    expect((await buscarT!.ejecutar({ consulta: 'puerto' }, { cwd: '.', proyectoId: 'p2' })).texto).toBe('Sin resultados.')
  })
})

describe('MemoriaCortoPlazo', () => {
  it('persiste la conversación y acumula el uso', async () => {
    const s = new MemoriaCortoPlazo(dir)
    const ms = [{ rol: 'user' as const, contenido: [{ tipo: 'texto' as const, texto: 'hola' }] }]
    await s.guardar('ses-1', ms, { tokensEntrada: 10, tokensSalida: 5 }, 'p1')
    await s.guardar('ses-1', ms, { tokensEntrada: 1, tokensSalida: 1 })
    expect(await s.obtener('ses-1')).toMatchObject({ proyectoId: 'p1', mensajes: ms, uso: { tokensEntrada: 11, tokensSalida: 6 } })
    expect(await s.obtener('nada')).toBeUndefined()
    await s.borrar('ses-1')
    expect(await s.obtener('ses-1')).toBeUndefined()
    await expect(s.obtener('../x')).rejects.toThrow(/inválido/)
  })
})

describe('Harness + contexto', () => {
  it('añade sistemaExtra solo al agente raíz y comprime antes de enviar', async () => {
    const llm = new LlmFalso([usar('1', 'eco'), texto('fin')])
    const registro = new RegistroHerramientas()
    registro.registrar({ nombre: 'eco', descripcion: 'e', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: 'y'.repeat(6000) }) })
    const eventos: string[] = []
    const compresor = new CompresorContexto(new MonitorContexto({ ventana: 3000, umbral: 0.5, reservaSalida: 0 }), { llm, recientes: 1, minResultado: 100 })
    const historial = [
      { rol: 'user' as const, contenido: [{ tipo: 'texto' as const, texto: 'antes' }] },
      { rol: 'assistant' as const, contenido: [{ tipo: 'texto' as const, texto: 'ok' }] }
    ]
    await new Harness({ llm, registro }).ejecutar(new Agente({ nombre: 'a', descripcion: '', sistema: 'BASE' }), {
      prompt: 'p', cwd: '.', historial, sistemaExtra: 'MEMORIA', contexto: compresor, alEvento: (e) => eventos.push(e.tipo)
    })
    expect(llm.peticiones[0]!.sistema).toBe('BASE\n\nMEMORIA')
    expect(eventos).toContain('contexto') // tras el resultado de 6000 caracteres el segundo paso se poda
  })
})
