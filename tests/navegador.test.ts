import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analizarTitulo, puertoAbierto, servidoresLocales } from '../src/main/puertos'

describe('detección de servidores locales', () => {
  let web: Server
  let json: Server
  let puertoWeb = 0
  let puertoJson = 0
  beforeAll(async () => {
    web = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<html><head>\n  <title>\n   Mi   tienda · Vite\n  </title></head><body>hola</body></html>')
    })
    json = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end('{"ok":true}')
    })
    await Promise.all([new Promise<void>((ok) => web.listen(0, '127.0.0.1', ok)), new Promise<void>((ok) => json.listen(0, '127.0.0.1', ok))])
    puertoWeb = (web.address() as AddressInfo).port
    puertoJson = (json.address() as AddressInfo).port
  })
  afterAll(async () => {
    for (const s of [web, json]) {
      s.closeAllConnections()
      await new Promise((ok) => s.close(ok))
    }
  })

  it('reconoce un puerto abierto y uno cerrado', async () => {
    expect(await puertoAbierto(puertoWeb)).toBe(true)
    expect(await puertoAbierto(1)).toBe(false)
  })

  it('lista solo los puertos con servidor y lee el título de las páginas HTML', async () => {
    const lista = await servidoresLocales([puertoJson, 1, puertoWeb, 2])
    expect(lista.map((s) => s.puerto)).toEqual([puertoWeb, puertoJson].sort((a, b) => a - b))
    const w = lista.find((s) => s.puerto === puertoWeb)!
    expect(w).toMatchObject({ url: `http://localhost:${puertoWeb}/`, titulo: 'Mi tienda · Vite' })
    expect(lista.find((s) => s.puerto === puertoJson)?.titulo).toBeUndefined()
  })

  it('extrae el título con espacios, mayúsculas y sin título', () => {
    expect(analizarTitulo('<TITLE>  Hola \n mundo </TITLE>')).toBe('Hola mundo')
    expect(analizarTitulo('<title></title>')).toBeUndefined()
    expect(analizarTitulo('<p>sin título</p>')).toBeUndefined()
    expect(analizarTitulo(`<title>${'x'.repeat(300)}</title>`)).toHaveLength(100)
  })
})
