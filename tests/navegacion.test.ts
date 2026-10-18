import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { esPaginaDeLaApp } from '../src/main/navegacion'

const INDEX = join('/opt', 'odesk', 'resources', 'app.asar', 'out', 'renderer', 'index.html')

describe('las ventanas con window.api solo navegan a la interfaz', () => {
  it('empaquetada: solo el index.html de la interfaz (con su query), nada más del disco ni de la web', () => {
    const app = pathToFileURL(INDEX)
    app.search = '?ventana=abc'
    expect(esPaginaDeLaApp(app.href, { indexHtml: INDEX })).toBe(true)
    expect(esPaginaDeLaApp(pathToFileURL('/home/ana/Descargas/pagina.html').href, { indexHtml: INDEX })).toBe(false) // .html soltado encima
    expect(esPaginaDeLaApp('https://ejemplo.com/', { indexHtml: INDEX })).toBe(false)
    expect(esPaginaDeLaApp('javascript:alert(1)', { indexHtml: INDEX })).toBe(false)
    expect(esPaginaDeLaApp('no es una url', { indexHtml: INDEX })).toBe(false)
  })

  it('en desarrollo: el servidor de Vite y nada más', () => {
    const o = { urlDev: 'http://localhost:5173', indexHtml: INDEX }
    expect(esPaginaDeLaApp('http://localhost:5173/?navegador=2', o)).toBe(true)
    expect(esPaginaDeLaApp('http://localhost:5174/', o)).toBe(false)
    expect(esPaginaDeLaApp('http://localhost.evil.com:5173/', o)).toBe(false)
    expect(esPaginaDeLaApp(pathToFileURL(INDEX).href, o)).toBe(false)
  })
})
