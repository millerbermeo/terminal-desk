import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { analizarConfigMcp, conServidoresDeSerie } from '../src/main/core/mcp/config'
import { OrquestadorMcp } from '../src/main/core/mcp/orquestador'
import { RegistroHerramientas } from '../src/main/core/tools/registro'

const servidor = resolve(__dirname, 'fixtures/servidor-mcp.mjs')
const registro = new RegistroHerramientas()
const mcp = new OrquestadorMcp(registro)
afterAll(() => mcp.detener())

describe('MCP', () => {
  it('valida config y aplica valores por defecto', () => {
    const c = analizarConfigMcp({ servidores: { fs: { comando: 'npx' } } })
    expect(c.servidores.fs).toMatchObject({ args: [], env: {}, deshabilitado: false, riesgo: 'ejecucion' })
    expect(() => analizarConfigMcp({ servidores: { 'mal nombre': { comando: 'x' } } })).toThrow()
  })

  it('conecta, registra herramientas y las llama; un servidor roto no tumba a los demás', async () => {
    const estado = await mcp.iniciar(
      analizarConfigMcp({
        servidores: {
          prueba: { comando: process.execPath, args: [servidor], riesgo: 'lectura' },
          roto: { comando: '/no/existe/binario' },
          off: { comando: 'x', deshabilitado: true }
        }
      })
    )
    expect(Object.fromEntries(estado.map((s) => [s.nombre, s.estado]))).toEqual({ prueba: 'conectado', roto: 'error', off: 'deshabilitado' })
    expect(registro.definiciones().map((d) => d.nombre).sort()).toEqual(['mcp__prueba__fallar', 'mcp__prueba__sumar'])
    expect(registro.obtener('mcp__prueba__sumar')!.riesgo).toBe('lectura')
    expect(await registro.llamar('mcp__prueba__sumar', { a: 2, b: 3 }, { cwd: '.' })).toEqual({ texto: '5' })
    expect(await registro.llamar('mcp__prueba__fallar', {}, { cwd: '.' })).toEqual({ texto: 'boom', error: true })
  })

  it('detener quita las herramientas', async () => {
    await mcp.detener()
    expect(registro.definiciones()).toEqual([])
  })
})

describe('servidores de serie', () => {
  it('Playwright viene activo por defecto en cualquier proyecto', () => {
    const c = conServidoresDeSerie(analizarConfigMcp({}))
    expect(c.servidores.playwright).toMatchObject({ comando: 'npx', deshabilitado: false })
    expect(c.servidores.playwright?.args).toContain('@playwright/mcp@latest')
  })
  it('lo declarado por el usuario con el mismo nombre manda (p. ej. apagarlo)', () => {
    const c = conServidoresDeSerie(analizarConfigMcp({ servidores: { playwright: { comando: 'npx', deshabilitado: true }, otro: { comando: 'x' } } }))
    expect(c.servidores.playwright?.deshabilitado).toBe(true)
    expect(Object.keys(c.servidores).sort()).toEqual(['otro', 'playwright'])
  })
})

describe('MCP externos en suscripción (claude -p)', () => {
  it('Playwright y los servidores de mcp.json van al --mcp-config y se permiten según la autonomía', async () => {
    const { servidoresExternos, archivoMcpTareas, configurarMcpTareas } = await import('../src/main/core/tareas/mcp-config')
    const { permisosCli } = await import('../src/main/core/suscripcion')
    const { mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const c = conServidoresDeSerie(analizarConfigMcp({ servidores: { otro: { comando: 'x', deshabilitado: true }, odesk: { comando: 'y' } } }))
    const ext = servidoresExternos(c.servidores)
    expect(Object.keys(ext)).toEqual(['playwright']) // deshabilitado y nombre reservado fuera
    const dir = await mkdtemp(join(tmpdir(), 'mcp-ext-'))
    configurarMcpTareas({ raizApp: dir, dirDatos: dir })
    const archivo = (await archivoMcpTareas('p1', ext))!
    expect(JSON.parse(await readFile(archivo, 'utf8')).mcpServers.playwright).toMatchObject({ command: 'npx', args: expect.arrayContaining(['@playwright/mcp@latest']) })
    const externos = [{ nombre: 'playwright', riesgo: c.servidores.playwright!.riesgo }]
    expect(permisosCli('preguntar', [], false, externos)).not.toContain('mcp__playwright')
    expect(permisosCli('ediciones', [], false, externos)).toContain('mcp__playwright')
    expect(permisosCli('autonomo', [], false, externos)).toContain('mcp__playwright')
  })
})
