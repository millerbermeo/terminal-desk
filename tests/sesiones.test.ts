import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { TurnoGuardado } from '@shared/core/sesion'
import { MemoriaCortoPlazo, sanearTranscripcion } from '../src/main/core/memory/sesion'

const secreto = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
const ev = (e: Record<string, unknown>): EventoAgente => ({ ejecucionId: 'e', agente: 'asistente', profundidad: 0, ...e }) as EventoAgente
const turno = (prompt: string, eventos: EventoAgente[] = [], extra: Partial<TurnoGuardado> = {}): TurnoGuardado => ({
  prompt, modo: 'chat', destino: 'P', raiz: 'asistente', eventos, estado: 'completado', ...extra
})
const mem = async () => new MemoriaCortoPlazo(await mkdtemp(join(tmpdir(), 'ses-')))
const uso = { tokensEntrada: 10, tokensSalida: 5 }

describe('sanearTranscripcion', () => {
  it('quita deltas y pasos, no duplica la conversación del evento fin, recorta y redacta credenciales', () => {
    const [t] = sanearTranscripcion([
      turno(`usa ${secreto}`, [
        ev({ tipo: 'texto_delta', texto: 'ho' }),
        ev({ tipo: 'paso', numero: 1 }),
        ev({ tipo: 'texto', texto: `clave ${secreto}` }),
        ev({ tipo: 'herramienta_fin', llamada: { id: '1', nombre: 'leer', entrada: {} }, resultado: { texto: 'x'.repeat(10_000) } }),
        ev({ tipo: 'fin', resultado: { estado: 'completado', texto: 'ok', mensajes: [{ rol: 'user', contenido: [{ tipo: 'texto', texto: 'enorme' }] }], uso, pasos: 1 } })
      ])
    ])
    expect(t!.eventos.map((e) => e.tipo)).toEqual(['texto', 'herramienta_fin', 'fin'])
    expect(JSON.stringify(t)).not.toContain(secreto)
    expect(t!.prompt).toContain('[REDACTADO')
    const fin = t!.eventos[2] as Extract<EventoAgente, { tipo: 'fin' }>
    expect(fin.resultado.mensajes).toEqual([])
    expect((t!.eventos[1] as Extract<EventoAgente, { tipo: 'herramienta_fin' }>).resultado.texto.length).toBeLessThan(4100)
  })
  it('acota el tamaño total conservando lo más reciente', () => {
    const grande = Array.from({ length: 12 }, (_, i) => turno(`turno ${i}`, [ev({ tipo: 'texto', texto: 'y'.repeat(19_000) + i })]))
    const muchos = Array.from({ length: 10 }, () => grande).flat() // ~2,3 MB
    const r = sanearTranscripcion(muchos)
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(1_500_000)
    expect(r.at(-1)!.prompt).toBe('turno 11')
  })
})

describe('MemoriaCortoPlazo: historial', () => {
  it('guarda contexto y transcripción sin pisarse; título del primer mensaje', async () => {
    const m = await mem()
    const mensajes = [{ rol: 'user' as const, contenido: [{ tipo: 'texto' as const, texto: 'hola' }] }]
    await m.guardar('s-1', mensajes, uso, 'p1') // fin de la ejecución en main
    await m.guardarTranscripcion('s-1', [turno('Explica el módulo de pagos con detalle')], 'p1') // pantalla
    await m.guardar('s-1', mensajes, uso, 'p1') // segunda ejecución: no borra la transcripción
    const s = (await m.obtener('s-1'))!
    expect(s).toMatchObject({ proyectoId: 'p1', titulo: 'Explica el módulo de pagos con detalle', mensajes, uso: { tokensEntrada: 20, tokensSalida: 10 } })
    expect(s.transcripcion).toHaveLength(1)
    expect((await m.transcripcion('s-1'))!).toMatchObject({ id: 's-1', titulo: s.titulo })
    expect(await m.transcripcion('nada')).toBeUndefined()
    // se pueden guardar en cualquier orden
    await m.guardarTranscripcion('s-2', [turno('otra')], 'p1')
    await m.guardar('s-2', mensajes, uso, 'p1')
    expect((await m.obtener('s-2'))!.transcripcion).toHaveLength(1)
  })

  it('lista por proyecto, más recientes primero, ignorando sesiones sin transcripción', async () => {
    const m = await mem()
    await m.guardarTranscripcion('a', [turno('primera')], 'p1')
    await new Promise((r) => setTimeout(r, 5))
    await m.guardarTranscripcion('b', [turno('segunda'), turno('tercera')], 'p1')
    await m.guardarTranscripcion('c', [turno('de otro')], 'p2')
    await m.guardar('huerfana', [], uso, 'p1') // sin nada que mostrar
    expect((await m.listar('p1')).map((s) => [s.id, s.turnos])).toEqual([['b', 2], ['a', 1]])
    expect((await m.listar()).map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])
    await m.borrar('b')
    expect((await m.listar('p1')).map((s) => s.id)).toEqual(['a'])
  })

  it('conserva las 50 conversaciones más recientes de cada proyecto', async () => {
    const m = await mem()
    for (let i = 0; i < 53; i++) await m.guardarTranscripcion(`s${i}`, [turno(`c${i}`)], 'p1')
    await m.guardarTranscripcion('otro', [turno('x')], 'p2')
    const l = await m.listar('p1')
    expect(l).toHaveLength(50)
    expect(l.some((s) => s.id === 's0')).toBe(false)
    expect(l.some((s) => s.id === 's52')).toBe(true)
    expect(await m.listar('p2')).toHaveLength(1)
  })

  it('rechaza ids con rutas', async () => {
    await expect((await mem()).transcripcion('../x')).rejects.toThrow(/inválido/)
  })
})
