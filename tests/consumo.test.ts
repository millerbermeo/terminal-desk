import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TurnoGuardado } from '../src/shared/core/sesion'
import {
  aAcumulado,
  bloqueContextoPrevio,
  decidirRotacion,
  diferenciaUso,
  digestDeConversacion,
  MetaSesionesCli,
  metaVacia,
  presupuestoTurnoUsd,
  umbralesDeEntorno
} from '../src/main/core/consumo'

const crudo = { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200, costUSD: 0.5 }

describe('diferenciaUso (el CLI acumula modelUsage al reanudar)', () => {
  it('sin ejecución previa toma el valor completo', () => {
    expect(diferenciaUso(aAcumulado(crudo))).toEqual({ entrada: 1210, salida: 5, cache: 1000, costo: 0.5 })
  })

  it('resta lo ya anotado en la ejecución anterior', () => {
    const previo = aAcumulado(crudo)
    const actual = aAcumulado({ inputTokens: 12, outputTokens: 9, cacheReadInputTokens: 1000, cacheCreationInputTokens: 473, costUSD: 0.5004 })
    const d = diferenciaUso(actual, previo)
    expect(d.entrada).toBe(1485 - 1210)
    expect(d.salida).toBe(4)
    expect(d.cache).toBe(0)
    expect(d.costo).toBeCloseTo(0.0004)
  })

  it('si el acumulado baja (sesión nueva) toma el valor actual', () => {
    const d = diferenciaUso(aAcumulado({ inputTokens: 1, outputTokens: 1 }), aAcumulado(crudo))
    expect(d).toEqual({ entrada: 1, salida: 1, cache: 0, costo: 0 })
  })

  it('sumar los deltas de varias ejecuciones da el acumulado final, no el triple', () => {
    let previo = undefined as ReturnType<typeof aAcumulado> | undefined
    let total = 0
    for (const n of [100, 250, 400]) {
      const actual = aAcumulado({ cacheReadInputTokens: n })
      total += diferenciaUso(actual, previo).entrada
      previo = actual
    }
    expect(total).toBe(400)
  })
})

describe('decidirRotacion', () => {
  const u = umbralesDeEntorno({})
  const ahora = 10_000_000_000
  const meta = (c: Partial<ReturnType<typeof metaVacia>>) => ({ ...metaVacia(), ultimaActividad: ahora - 1000, ...c })

  it('no rota una conversación pequeña', () => {
    expect(decidirRotacion(meta({ contexto: 30_000 }), u, ahora)).toBeUndefined()
    expect(decidirRotacion(undefined, u, ahora)).toBeUndefined()
  })

  it('rota por contexto, por imágenes y por caché caducada', () => {
    expect(decidirRotacion(meta({ contexto: 180_000 }), u, ahora)).toBe('contexto')
    expect(decidirRotacion(meta({ contexto: 20_000, imagenes: 10 }), u, ahora)).toBe('imagenes')
    expect(decidirRotacion(meta({ contexto: 100_000, ultimaActividad: ahora - 56 * 60_000 }), u, ahora)).toBe('inactividad')
  })

  it('con poco contexto no compensa resumir aunque la caché haya caducado', () => {
    expect(decidirRotacion(meta({ contexto: 40_000, ultimaActividad: ahora - 5 * 3_600_000 }), u, ahora)).toBeUndefined()
  })

  it('los umbrales se ajustan por entorno y 0 los desactiva', () => {
    const e = umbralesDeEntorno({ ODESK_ROTAR_CONTEXTO: '50000', ODESK_ROTAR_IMAGENES: '0' })
    expect(decidirRotacion(meta({ contexto: 60_000 }), e, ahora)).toBe('contexto')
    expect(decidirRotacion(meta({ contexto: 1, imagenes: 99 }), e, ahora)).toBeUndefined()
  })
})

describe('presupuestoTurnoUsd', () => {
  it('5 USD por defecto, ajustable y 0 desactiva', () => {
    expect(presupuestoTurnoUsd({})).toBe(5)
    expect(presupuestoTurnoUsd({ ODESK_PRESUPUESTO_TURNO_USD: '12.5' })).toBe(12.5)
    expect(presupuestoTurnoUsd({ ODESK_PRESUPUESTO_TURNO_USD: '0' })).toBe(0)
    expect(presupuestoTurnoUsd({ ODESK_PRESUPUESTO_TURNO_USD: 'x' })).toBe(5)
  })
})

describe('digestDeConversacion', () => {
  const turno = (n: number, extra: Partial<TurnoGuardado> = {}): TurnoGuardado => ({
    prompt: `pide ${n}`,
    modo: 'chat',
    destino: 'p',
    raiz: 'asistente',
    estado: 'completado',
    eventos: [
      { ejecucionId: 'e', agente: 'asistente', profundidad: 0, tipo: 'herramienta_inicio', llamada: { id: `t${n}`, nombre: 'Edit', entrada: { file_path: `/p/a${n}.ts` } } },
      { ejecucionId: 'e', agente: 'asistente', profundidad: 0, tipo: 'texto', texto: `hecho ${n}` }
    ],
    ...extra
  })

  it('resume por turno la petición, las herramientas y lo último que dijo la IA', () => {
    const d = digestDeConversacion([turno(1), turno(2)])
    expect(d).toContain('Usuario: pide 1')
    expect(d).toContain('Edit /p/a2.ts')
    expect(d).toContain('Asistente: hecho 2')
  })

  it('ignora las preguntas laterales', () => {
    expect(digestDeConversacion([turno(1), turno(2, { lateral: true })])).not.toContain('pide 2')
  })

  it('al pasar el tope descarta los turnos más antiguos y conserva los recientes', () => {
    const turnos = Array.from({ length: 60 }, (_, i) => turno(i + 1, { prompt: 'x'.repeat(1000) + ` fin${i + 1}` }))
    const d = digestDeConversacion(turnos, 8000)
    expect(d.length).toBeLessThan(9000)
    expect(d).toContain('fin60')
    expect(d).not.toContain('fin1\n')
    expect(d).toMatch(/turnos anteriores omitidos/)
  })

  it('una conversación vacía no produce nada que resumir', () => {
    expect(digestDeConversacion([]).trim()).toBe('')
  })
})

describe('bloqueContextoPrevio', () => {
  it('envuelve el resumen y explica por qué', () => {
    const b = bloqueContextoPrevio('## Objetivo\nX', 'contexto')
    expect(b).toContain('<contexto_previo motivo="contexto">')
    expect(b).toContain('## Objetivo')
    expect(b).toContain('</contexto_previo>')
  })
})

describe('MetaSesionesCli', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('guarda, actualiza en cola sin perder cambios y borra', async () => {
    dir = await mkdtemp(join(tmpdir(), 'meta-'))
    const archivo = join(dir, 'm.json')
    const m = new MetaSesionesCli(archivo)
    expect(await m.obtener('a')).toBeUndefined()
    await Promise.all(Array.from({ length: 10 }, () => m.actualizar('a', (p) => ({ ...p, imagenes: p.imagenes + 1 }))))
    expect((await m.obtener('a'))?.imagenes).toBe(10)
    expect(JSON.parse(await readFile(archivo, 'utf8')).a.imagenes).toBe(10)
    await m.actualizar('a', () => undefined)
    expect(await m.obtener('a')).toBeUndefined()
  })
})
