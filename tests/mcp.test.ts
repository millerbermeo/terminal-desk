import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { analizarConfigMcp } from '../src/main/core/mcp/config'
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
