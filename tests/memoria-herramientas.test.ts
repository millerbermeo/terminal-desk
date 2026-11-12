import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUIA_TRABAJO } from '../src/main/core/avisos'
import { crearEjecutorOdesk, herramientasOdesk } from '../src/main/core/herramientas-odesk'
import { MemoriaLargoPlazo } from '../src/main/core/memory/largo-plazo'
import { permisosCli } from '../src/main/core/suscripcion'
import { PREFIJO_MCP } from '../src/shared/herramientas-odesk'

const nueva = async (): Promise<{ memoria: MemoriaLargoPlazo; ejecutar: ReturnType<typeof crearEjecutorOdesk> }> => {
  const memoria = new MemoriaLargoPlazo(await mkdtemp(join(tmpdir(), 'odesk-mem-')))
  return { memoria, ejecutar: crearEjecutorOdesk({ tareas: {} as never, github: {} as never, carpetaDe: async () => '', memoria }) }
}

describe('memoria de largo plazo para la IA en suscripción (MCP odesk)', () => {
  it('guarda en el proyecto de la conversación y lo encuentra después', async () => {
    const { memoria, ejecutar } = await nueva()
    const r = await ejecutar('memoria_guardar', { tipo: 'decision', titulo: 'Fechas en UTC', contenido: 'Todas las fechas se guardan en UTC y se convierten al mostrar.' }, { proyectoId: 'p1' })
    expect(r.error).toBeFalsy()
    expect(await memoria.listar('p1')).toHaveLength(1)
    expect(await memoria.listar()).toHaveLength(0)
    expect((await ejecutar('memoria_buscar', { consulta: 'fechas utc' }, { proyectoId: 'p1' })).texto).toContain('Fechas en UTC')
    expect((await ejecutar('memoria_buscar', { consulta: 'fechas utc' }, { proyectoId: 'otro' })).texto).toContain('Sin resultados')
  })

  it('ámbito global, o sin proyecto: va a la memoria global y la ven todos los proyectos', async () => {
    const { memoria, ejecutar } = await nueva()
    await ejecutar('memoria_guardar', { tipo: 'regla', titulo: 'Commits en español', contenido: 'Los mensajes de commit van en español.', ambito: 'global' }, { proyectoId: 'p1' })
    await ejecutar('memoria_guardar', { tipo: 'hecho', titulo: 'Gestor de paquetes', contenido: 'Se usa pnpm.' })
    expect(await memoria.listar()).toHaveLength(2)
    expect((await ejecutar('memoria_buscar', { consulta: 'commits español' }, { proyectoId: 'p2' })).texto).toContain('Commits en español')
  })

  it('mismo tipo y título actualiza la nota en vez de duplicarla', async () => {
    const { memoria, ejecutar } = await nueva()
    await ejecutar('memoria_guardar', { tipo: 'hecho', titulo: 'Cómo se prueba', contenido: 'pnpm test' }, { proyectoId: 'p1' })
    const [primera] = await memoria.listar('p1')
    await ejecutar('memoria_guardar', { tipo: 'hecho', titulo: '  cómo se   PRUEBA ', contenido: 'pnpm test y pnpm typecheck' }, { proyectoId: 'p1' })
    const notas = await memoria.listar('p1')
    expect(notas).toHaveLength(1)
    expect(notas[0]!.id).toBe(primera!.id)
    expect(notas[0]!.contenido).toBe('pnpm test y pnpm typecheck')
    await ejecutar('memoria_guardar', { tipo: 'decision', titulo: 'Cómo se prueba', contenido: 'Otro tipo: es otra nota.' }, { proyectoId: 'p1' })
    expect(await memoria.listar('p1')).toHaveLength(2)
  })

  it('rechaza credenciales y entradas inválidas sin lanzar', async () => {
    const { memoria, ejecutar } = await nueva()
    expect((await ejecutar('memoria_guardar', { tipo: 'hecho', titulo: 'Clave', contenido: 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }, { proyectoId: 'p1' })).error).toBe(true)
    expect((await ejecutar('memoria_guardar', { tipo: 'hecho', titulo: 'Sin contenido' }, { proyectoId: 'p1' })).error).toBe(true)
    expect(await memoria.listar('p1')).toHaveLength(0)
  })

  it('buscar se permite siempre; guardar, desde «aceptar ediciones»', () => {
    const permitidas = (a: 'preguntar' | 'ediciones' | 'autonomo'): string[] => permisosCli(a, [], true)
    expect(permitidas('preguntar')).toContain(`${PREFIJO_MCP}memoria_buscar`)
    expect(permitidas('preguntar')).not.toContain(`${PREFIJO_MCP}memoria_guardar`)
    expect(permitidas('ediciones')).toContain(`${PREFIJO_MCP}memoria_guardar`)
  })

  it('en modo API no se registran dos veces (el núcleo ya trae buscar_memoria / guardar_memoria)', () => {
    const nombres = herramientasOdesk(async () => ({ texto: '' })).map((h) => h.nombre)
    expect(nombres.some((n) => n.startsWith('memoria_'))).toBe(false)
    expect(nombres).toContain('credenciales_listar')
  })

  it('la guía de trabajo nombra el plan, la verificación y la memoria, y es corta', () => {
    expect(GUIA_TRABAJO).toContain('TodoWrite')
    expect(GUIA_TRABAJO).toContain('memoria_guardar')
    expect(GUIA_TRABAJO.length).toBeLessThan(2400)
  })
})
