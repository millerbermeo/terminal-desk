import { get } from 'node:http'
import { connect } from 'node:net'
import { PUERTOS_COMUNES, type ServidorLocal } from '@shared/navegador'

/** ¿Hay algo escuchando en ese puerto de esta máquina (IPv4 o IPv6)? Los servidores de desarrollo suelen enlazar solo `localhost`. */
export function puertoAbierto(puerto: number, esperaMs = 300): Promise<boolean> {
  const probar = (host: string): Promise<boolean> =>
    new Promise((resolver) => {
      const s = connect({ host, port: puerto })
      const fin = (ok: boolean): void => {
        s.destroy()
        resolver(ok)
      }
      s.setTimeout(esperaMs, () => fin(false))
      s.once('connect', () => fin(true))
      s.once('error', () => fin(false))
    })
  return Promise.all([probar('127.0.0.1'), probar('::1')]).then(([a, b]) => a || b)
}

/** Título (`<title>`) de la página que sirve ese puerto, si responde con HTML. */
export function tituloDe(puerto: number, esperaMs = 800): Promise<string | undefined> {
  return new Promise((resolver) => {
    const req = get({ host: 'localhost', port: puerto, path: '/', timeout: esperaMs, headers: { Accept: 'text/html', 'User-Agent': 'OdeskAgent/1.0' } }, (res) => {
      if (!String(res.headers['content-type'] ?? '').includes('html')) {
        res.resume()
        return resolver(undefined)
      }
      let t = ''
      res.setEncoding('utf8')
      res.on('data', (d: string) => {
        t += d
        if (t.length > 32_768 || /<\/title>/i.test(t)) {
          res.destroy()
          resolver(analizarTitulo(t))
        }
      })
      res.on('end', () => resolver(analizarTitulo(t)))
      res.on('error', () => resolver(analizarTitulo(t)))
    })
    req.on('timeout', () => (req.destroy(), resolver(undefined)))
    req.on('error', () => resolver(undefined))
  })
}

export function analizarTitulo(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const t = m?.[1]?.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 100) : undefined
}

/** Servidores de desarrollo que están escuchando ahora mismo en los puertos habituales (o en los que se indiquen). */
export async function servidoresLocales(puertos: readonly number[] = PUERTOS_COMUNES): Promise<ServidorLocal[]> {
  const abiertos = (await Promise.all(puertos.map(async (p) => ((await puertoAbierto(p)) ? p : 0)))).filter((p) => p > 0)
  return Promise.all(
    abiertos.sort((a, b) => a - b).map(async (puerto): Promise<ServidorLocal> => {
      const titulo = await tituloDe(puerto)
      return { puerto, url: `http://localhost:${puerto}/`, ...(titulo ? { titulo } : {}) }
    })
  )
}
