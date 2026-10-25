import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACTIVO, Banco, herramientas } from './banco-asistente'

/**
 * Límites de consumo con el CLI REAL: con un tope de pasos bajo (`ODESK_MAX_PASOS`, se lee al cargar el módulo), una tarea larga en
 * «Autónomo» sigue sola (continuación automática) hasta terminar; fuera de autónomo se para y lo dice.
 * `ODESK_EVAL_CLI=1 pnpm evals -- asistente-limites`
 */
const b = new Banco()
beforeAll(async () => {
  if (!ACTIVO) return
  vi.stubEnv('ODESK_MAX_PASOS', '4')
  await b.preparar()
}, 120_000)
afterAll(() => (ACTIVO ? b.cerrar() : undefined))

const TAREA = 'Crea, uno por uno y cada uno con una llamada distinta a la herramienta de escribir archivos, los archivos p1.txt, p2.txt, p3.txt, p4.txt, p5.txt y p6.txt (cada uno con su propio nombre como contenido). No uses la terminal.'

describe.skipIf(!ACTIVO)('Asistente con el CLI real: límites', () => {
  it('en autónomo, al topar el límite de pasos sigue sola hasta terminar la tarea', async () => {
    const t = await b.turno({ prompt: TAREA, autonomia: 'autonomo', sesionId: 'limite-auto' }, undefined, 6 * 60_000)
    const continuaciones = t.eventos.filter((e) => e.tipo === 'continuacion_automatica').length
    console.log('[límite autónomo]', t.fin.resultado.estado, 'continuaciones:', continuaciones, herramientas(t))
    expect(continuaciones).toBeGreaterThan(0)
    expect(t.fin.resultado.estado).toBe('completado')
    for (let i = 1; i <= 6; i++) expect(existsSync(join(b.proyecto, `p${i}.txt`)), `p${i}.txt`).toBe(true)
  })

  it('fuera de autónomo se para en el tope y lo informa (el usuario decide si sigue)', async () => {
    const t = await b.turno({ prompt: TAREA.replace(/p(\d)\.txt/g, 'q$1.txt'), autonomia: 'ediciones', sesionId: 'limite-ed' }, undefined, 6 * 60_000)
    console.log('[límite ediciones]', t.fin.resultado.estado, t.fin.resultado.error)
    expect(t.fin.resultado.estado).toBe('limite_pasos')
    expect(t.fin.resultado.error).toMatch(/pasos/)
    expect(t.eventos.some((e) => e.tipo === 'continuacion_automatica')).toBe(false)
  })
})
