import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { analizarTecla } from '@shared/navegador'
import { HERRAMIENTAS_ODESK } from '@shared/herramientas-odesk'
import { HERRAMIENTAS_NAVEGADOR } from '@shared/navegador-herramientas'
import { crearEjecutorOdesk, type ControlNavegador, type ServiciosOdesk } from '../src/main/core/herramientas-odesk'
import { llamarTareas } from '../src/main/core/tareas/cliente'
import { servirMcpTareas } from '../src/main/core/tareas/mcp-servidor'
import { iniciarServidorTareas } from '../src/main/core/tareas/servidor'
import { permisosCli } from '../src/main/core/suscripcion'

const servicios = (navegador?: ControlNavegador): ServiciosOdesk => ({ tareas: {} as never, github: {} as never, carpetaDe: async () => '/tmp', navegador: () => navegador })

describe('teclas para el navegador (CDP)', () => {
  it('traduce nombres, alias y combinaciones', () => {
    expect(analizarTecla('Enter')).toEqual({ key: 'Enter', code: 'Enter', vk: 13, texto: '\r', modificadores: 0 })
    expect(analizarTecla('intro').key).toBe('Enter')
    expect(analizarTecla('Esc')).toMatchObject({ key: 'Escape', vk: 27 })
    expect(analizarTecla('Control+a')).toEqual({ key: 'a', code: 'KeyA', vk: 65, modificadores: 2 }) // sin texto: no escribe la «a»
    expect(analizarTecla('Shift+Tab')).toMatchObject({ key: 'Tab', modificadores: 8 })
    expect(analizarTecla('Shift+a')).toMatchObject({ key: 'A', texto: 'A', modificadores: 8 })
    expect(analizarTecla('F5')).toMatchObject({ key: 'F5', vk: 116 })
    expect(analizarTecla('7')).toMatchObject({ code: 'Digit7', texto: '7' })
    expect(analizarTecla('Control++')).toMatchObject({ key: '+', modificadores: 2 })
    expect(analizarTecla('Space')).toMatchObject({ key: ' ', code: 'Space', texto: ' ' })
  })
  it('rechaza lo que no entiende', () => {
    expect(() => analizarTecla('')).toThrow(/tecla/i)
    expect(() => analizarTecla('Hiper+a')).toThrow(/Modificador/)
    expect(() => analizarTecla('Patata')).toThrow(/desconocida/)
  })
})

describe('herramientas navegador_*', () => {
  it('forman parte del servidor odesk y sus permisos siguen el riesgo', () => {
    for (const h of HERRAMIENTAS_NAVEGADOR) expect(HERRAMIENTAS_ODESK).toContain(h)
    const preguntar = permisosCli('preguntar', [], true)
    expect(preguntar).toContain('mcp__odesk__navegador_instantanea')
    expect(preguntar).not.toContain('mcp__odesk__navegador_clic')
    expect(permisosCli('ediciones', [], true)).toContain('mcp__odesk__navegador_clic')
    expect(permisosCli('ediciones', [], true)).not.toContain('mcp__odesk__navegador_evaluar')
    expect(permisosCli('autonomo', [], true)).toContain('mcp__odesk__navegador_evaluar')
  })

  it('el ejecutor valida, acepta números como texto y delega en el navegador', async () => {
    const llamadas: [string, Record<string, unknown>][] = []
    const ejecutar = crearEjecutorOdesk(servicios({ ejecutar: async (n, e) => (llamadas.push([n, e]), { texto: 'hecho' }) }))
    expect(await ejecutar('navegador_clic', { ventana: '2', ref: 'e5', doble: 'true' })).toEqual({ texto: 'hecho' })
    expect(llamadas).toEqual([['navegador_clic', { ventana: 2, ref: 'e5', doble: true }]])
    expect(await ejecutar('navegador_clic', { ventana: 1 })).toMatchObject({ error: true, texto: expect.stringMatching(/falta el parámetro «ref»/) })
    expect(await ejecutar('navegador_ir', { accion: 'saltar' })).toMatchObject({ error: true })
    expect(llamadas).toHaveLength(1)
  })

  it('sin la app (o en tests) responde con un error legible', async () => {
    expect(await crearEjecutorOdesk(servicios())('navegador_ventanas', {})).toMatchObject({ error: true, texto: expect.stringMatching(/Odesk Agent abierto/) })
    const falla = crearEjecutorOdesk(servicios({ ejecutar: async () => Promise.reject(new Error('No hay ninguna ventana 9.')) }))
    expect(await falla('navegador_instantanea', { ventana: 9 })).toEqual({ texto: 'No hay ninguna ventana 9.', error: true })
  })

  it('la captura llega como imagen por el socket y por MCP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nav-ia-'))
    const ejecutar = crearEjecutorOdesk(servicios({ ejecutar: async () => ({ texto: 'Captura', imagen: { datos: 'QUJD', tipo: 'image/jpeg' } }) }))
    const servidor = await iniciarServidorTareas(dir, ejecutar)
    const entrada = new PassThrough()
    const salida = new PassThrough()
    const respuestas: { id?: number; result?: { content: unknown[] } }[] = []
    salida.on('data', (d: Buffer) => respuestas.push(...d.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l))))
    const fin = servirMcpTareas(entrada, salida, (h, e) => llamarTareas(dir, h, e))
    try {
      entrada.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'navegador_captura', arguments: {} } }) + '\n')
      entrada.end()
      await fin
      expect(respuestas.find((r) => r.id === 1)?.result?.content).toEqual([
        { type: 'text', text: 'Captura' },
        { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }
      ])
    } finally {
      await servidor.cerrar()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
