import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EventoAgente, SolicitudAgente } from '@shared/core/agente'
import type { TurnoGuardado } from '@shared/core/sesion'
import { describirFrecuencia, siguienteEjecucion, validarFrecuencia, type TareaProgramada } from '@shared/programadas'
import { AVISO_SIN_SUPERVISION, ServicioProgramadas, type DependenciasProgramadas } from '../src/main/core/programadas'

describe('siguienteEjecucion', () => {
  it('intervalo: cuenta desde la base, y si ya pasó, toca enseguida', () => {
    const base = new Date(2026, 0, 1, 8, 0)
    expect(siguienteEjecucion({ tipo: 'intervalo', horas: 6 }, new Date(2026, 0, 1, 9, 0), base)).toEqual(new Date(2026, 0, 1, 14, 0))
    const tarde = new Date(2026, 0, 2, 9, 0)
    expect(siguienteEjecucion({ tipo: 'intervalo', horas: 6 }, tarde, base).getTime()).toBe(tarde.getTime() + 1000)
  })

  it('diaria: el próximo día marcado a esa hora, nunca la misma hora ya pasada', () => {
    const viernes = new Date(2026, 0, 2, 10, 0) // 2 ene 2026 = viernes
    expect(viernes.getDay()).toBe(5)
    // lun–vie a las 09:00: el viernes a las 10 ya pasó → lunes
    expect(siguienteEjecucion({ tipo: 'diaria', hora: '09:00', dias: [1, 2, 3, 4, 5] }, viernes)).toEqual(new Date(2026, 0, 5, 9, 0))
    // todos los días a las 18:30 → hoy
    expect(siguienteEjecucion({ tipo: 'diaria', hora: '18:30', dias: [0, 1, 2, 3, 4, 5, 6] }, viernes)).toEqual(new Date(2026, 0, 2, 18, 30))
    // justo a la hora: es la del día siguiente
    expect(siguienteEjecucion({ tipo: 'diaria', hora: '10:00', dias: [0, 1, 2, 3, 4, 5, 6] }, viernes)).toEqual(new Date(2026, 0, 3, 10, 0))
  })

  it('valida y describe', () => {
    expect(() => validarFrecuencia({ tipo: 'intervalo', horas: 0 })).toThrow()
    expect(() => validarFrecuencia({ tipo: 'diaria', hora: '25:00', dias: [1] })).toThrow()
    expect(() => validarFrecuencia({ tipo: 'diaria', hora: '09:00', dias: [] })).toThrow()
    expect(validarFrecuencia({ tipo: 'diaria', hora: '09:00', dias: [5, 1, 1, 9] })).toEqual({ tipo: 'diaria', hora: '09:00', dias: [1, 5] })
    expect(describirFrecuencia({ tipo: 'diaria', hora: '08:30', dias: [1, 2, 3, 4, 5] })).toBe('Lun–vie a las 08:30')
    expect(describirFrecuencia({ tipo: 'intervalo', horas: 24 })).toBe('Cada 1 día')
    expect(describirFrecuencia({ tipo: 'intervalo', horas: 6 })).toBe('Cada 6 h')
  })
})

describe('ServicioProgramadas', () => {
  let dir: string
  let ahora: Date
  let enviados: SolicitudAgente[]
  let respuestas: string[]
  let guardados: { id: string; turnos: TurnoGuardado[] }[]
  let avisos: string[]
  let pedirConfirmacion: boolean

  const deps = (): DependenciasProgramadas => ({
    ahora: () => ahora,
    ejecutar: async (sol, alEvento) => {
      enviados.push(sol)
      const base = { ejecucionId: 'e1', agente: 'asistente', profundidad: 0 }
      queueMicrotask(() => {
        alEvento({ ...base, tipo: 'inicio', prompt: sol.prompt, mensajeId: 'm1' } as EventoAgente)
        if (pedirConfirmacion) alEvento({ ...base, tipo: 'solicitud_humana', solicitudId: 's1', clase: 'accion', contenido: 'rm' } as EventoAgente)
        alEvento({ ...base, tipo: 'texto', texto: 'Hay 2 PRs pendientes.' } as EventoAgente)
        alEvento({ ...base, tipo: 'fin', resultado: { estado: 'completado', texto: 'Hay 2 PRs pendientes.', mensajes: [], uso: { tokensEntrada: 1, tokensSalida: 1 }, pasos: 1 } } as EventoAgente)
      })
      return { ejecucionId: 'e1', sesionId: 'ses1' }
    },
    responder: (id, d) => (respuestas.push(`${id}:${d.aprobado}`), true),
    cancelar: () => undefined,
    guardarTranscripcion: async (id, turnos) => void guardados.push({ id, turnos }),
    fijarTitulo: async () => undefined,
    nombreProyecto: async () => 'Web',
    avisar: (t) => void avisos.push(t)
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'programadas-'))
    ahora = new Date(2026, 0, 2, 10, 0)
    enviados = []
    respuestas = []
    guardados = []
    avisos = []
    pedirConfirmacion = false
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const nueva = { nombre: 'PRs', proyectoId: 'p1', prompt: 'Revisa los PRs', frecuencia: { tipo: 'intervalo' as const, horas: 2 }, autonomia: 'preguntar' as const, activa: true }

  it('no se dispara al crearla; sí al llegar su hora, y deja conversación, aviso y próxima', async () => {
    const s = new ServicioProgramadas(dir, deps())
    const t = await s.guardar(nueva)
    expect(new Date(t.proxima!).getTime()).toBe(ahora.getTime() + 2 * 3_600_000)
    await s.revisar()
    await s.esperar()
    expect(enviados).toHaveLength(0)

    ahora = new Date(ahora.getTime() + 2 * 3_600_000 + 1)
    await s.revisar()
    await s.esperar()
    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.prompt.startsWith(AVISO_SIN_SUPERVISION)).toBe(true)
    expect(enviados[0]!.autonomia).toBeUndefined()
    expect(guardados[0]!.turnos[0]!.prompt).toBe('Revisa los PRs') // se ve la instrucción, no el aviso interno
    expect(guardados[0]!.turnos[0]!.mensajeId).toBe('m1')
    expect(avisos[0]).toContain('PRs')
    const [g] = (await s.listar()) as TareaProgramada[]
    expect(g!.ultima).toMatchObject({ estado: 'completado', sesionId: 'ses1', resumen: 'Hay 2 PRs pendientes.' })
    expect(new Date(g!.proxima!).getTime()).toBeGreaterThan(ahora.getTime())
  })

  it('deniega solo cualquier confirmación (no hay nadie delante)', async () => {
    pedirConfirmacion = true
    const s = new ServicioProgramadas(dir, deps())
    const t = await s.guardar(nueva)
    await s.operar({ op: 'ejecutar', id: t.id })
    await s.esperar()
    expect(respuestas).toEqual(['s1:false'])
  })

  it('pausada no se ejecuta; valida lo que llega', async () => {
    const s = new ServicioProgramadas(dir, deps())
    await s.guardar({ ...nueva, activa: false })
    ahora = new Date(ahora.getTime() + 10 * 3_600_000)
    await s.revisar()
    await s.esperar()
    expect(enviados).toHaveLength(0)
    await expect(s.guardar({ ...nueva, prompt: ' ' })).rejects.toThrow()
    await expect(s.guardar({ ...nueva, proyectoId: '../x' })).rejects.toThrow()
  })
})
