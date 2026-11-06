import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conServidoresDeSerie, navegadorCompartido, puertoNavegador } from '../src/main/core/mcp/config'

describe('navegadorCompartido (Playwright + Chrome DevTools en un solo navegador)', () => {
  it('Chrome DevTools viene de serie junto a Playwright', () => {
    const s = conServidoresDeSerie({ servidores: {} }).servidores
    expect(s.playwright?.deshabilitado).toBe(false)
    expect(s['chrome-devtools']?.args).toContain('chrome-devtools-mcp@latest')
  })

  it('Playwright abre un puerto CDP estable por conversación y DevTools se conecta a él', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nav-'))
    const serie = conServidoresDeSerie({ servidores: {} }).servidores
    const a = await navegadorCompartido(serie, 'conv-1', dir)
    const b = await navegadorCompartido(serie, 'conv-1', dir)
    expect(a).toEqual(b) // misma conversación, mismos args: no relanza el proceso del CLI
    const puerto = puertoNavegador('conv-1')
    expect(puerto).toBeGreaterThanOrEqual(20_000)
    expect(puerto).toBeLessThan(30_000)
    expect(a['chrome-devtools']!.args.slice(-2)).toEqual(['--browserUrl', `http://127.0.0.1:${puerto}`])
    const i = a.playwright!.args.indexOf('--config')
    const config = JSON.parse(await readFile(a.playwright!.args[i + 1]!, 'utf8'))
    expect(config.browser.launchOptions.args).toContain(`--remote-debugging-port=${puerto}`)
    expect(a.playwright!.args).toContain('--isolated')
  })

  it('no toca nada si el usuario cambió o apagó alguno de los dos en mcp.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nav-'))
    const propio = conServidoresDeSerie({ servidores: { playwright: { comando: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {}, deshabilitado: false, riesgo: 'escritura' } } }).servidores
    expect(await navegadorCompartido(propio, 'c', dir)).toEqual(propio)
    const apagado = conServidoresDeSerie({ servidores: { 'chrome-devtools': { comando: 'npx', args: [], env: {}, deshabilitado: true, riesgo: 'escritura' } } }).servidores
    expect(await navegadorCompartido(apagado, 'c', dir)).toEqual(apagado)
  })
})
