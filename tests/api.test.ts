import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analizarCurl, analizarJson, dividirComando, formatearTamano, generarCurl, par, peticionVacia, resolverPeticion, sustituirVariables, variablesDe, variablesSinResolver, type PeticionApi } from '@shared/api'
import { esDireccionLocal, normalizarUrl } from '@shared/navegador'
import { AlmacenJson } from '../src/main/core/memory/almacen'
import { clasificarCuerpo, ejecutarPeticion, MAX_BYTES } from '../src/main/api/cliente'
import { ejecutarOperacionApi } from '../src/main/api/operaciones'
import { ServicioApi } from '../src/main/api/servicio'
import { sanearPeticion } from '../src/main/api/validar'

const nuevaPeticion = (p: Partial<PeticionApi>): PeticionApi => ({ ...peticionVacia(), ...p })

describe('normalizarUrl (navegador)', () => {
  it('entiende puertos, localhost y dominios; rechaza lo que no es http(s)', () => {
    const ok = (e: string): string => ('url' in normalizarUrl(e) ? (normalizarUrl(e) as { url: string }).url : 'ERROR')
    expect(ok('3000')).toBe('http://localhost:3000/')
    expect(ok(':5173/app')).toBe('http://localhost:5173/app')
    expect(ok('localhost:8080/api?x=1')).toBe('http://localhost:8080/api?x=1')
    expect(ok('127.0.0.1:4000')).toBe('http://127.0.0.1:4000/')
    expect(ok('192.168.1.20:3000')).toBe('http://192.168.1.20:3000/')
    expect(ok('mi-app.test')).toBe('https://mi-app.test/')
    expect(ok('ejemplo.com/ruta')).toBe('https://ejemplo.com/ruta')
    expect(ok('http://ejemplo.com')).toBe('http://ejemplo.com/')
    expect(ok('  https://a.com  ')).toBe('https://a.com/')
    for (const mala of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hola', 'ftp://x.com', 'about:blank', 'hola mundo', 'palabra.suelta con espacio', 'view-source:http://a.com', '99999']) {
      expect('error' in normalizarUrl(mala), mala).toBe(true)
    }
    expect(esDireccionLocal('localhost')).toBe(true)
    expect(esDireccionLocal('app.localhost')).toBe(true)
    expect(esDireccionLocal('172.20.1.1')).toBe(true)
    expect(esDireccionLocal('172.40.1.1')).toBe(false)
    expect(esDireccionLocal('ejemplo.com')).toBe(false)
  })
})

describe('variables, URL final y cURL', () => {
  it('sustituye variables, detecta las que faltan y solo cuenta las activas', () => {
    expect(sustituirVariables('{{base}}/x/{{ id }}/{{falta}}', { base: 'http://h', id: '7' })).toBe('http://h/x/7/{{falta}}')
    const vars = variablesDe({ id: 'e', nombre: 'dev', variables: [{ id: '1', clave: 'base', valor: 'http://h', activa: true }, { id: '2', clave: 'off', valor: 'x', activa: false }, { id: '3', clave: '', valor: 'x', activa: true }] })
    expect(vars).toEqual({ base: 'http://h' })
    const p = nuevaPeticion({ url: '{{base}}/{{ruta}}', cabeceras: [par('X', '{{token}}'), par('Y', '{{off}}', false)] })
    expect(variablesSinResolver(p, vars).sort()).toEqual(['ruta', 'token'])
  })

  it('construye la URL con parámetros, cabeceras, autenticación y cuerpo', () => {
    const vars = { base: 'http://localhost:3000', tk: 'abc' }
    const r = resolverPeticion(
      nuevaPeticion({
        metodo: 'POST',
        url: '{{base}}/items?ya=1#fragmento',
        consulta: [par('q', 'a b&c'), par('apagado', 'x', false), par('', 'sin clave')],
        cabeceras: [par('X-Uno', '1')],
        cuerpo: { tipo: 'json', texto: '{"a":"{{tk}}"}' },
        auth: { tipo: 'bearer', token: '{{tk}}' }
      }),
      vars
    )
    expect(r.url).toBe('http://localhost:3000/items?ya=1&q=a%20b%26c')
    expect(r.cuerpo).toBe('{"a":"abc"}')
    expect(r.cabeceras).toEqual([['X-Uno', '1'], ['Authorization', 'Bearer abc'], ['Content-Type', 'application/json']])
    const g = resolverPeticion(nuevaPeticion({ metodo: 'GET', url: 'http://h', cuerpo: { tipo: 'json', texto: '{}' } }), {})
    expect(g.cuerpo).toBeNull()
    const basica = resolverPeticion(nuevaPeticion({ url: 'http://h', auth: { tipo: 'basica', usuario: 'ana', clave: 'ñandú' } }), {})
    expect(basica.cabeceras[0]).toEqual(['Authorization', `Basic ${Buffer.from('ana:ñandú').toString('base64')}`])
    const clave = resolverPeticion(nuevaPeticion({ url: 'http://h', auth: { tipo: 'clave-api', nombre: 'api_key', valor: 'k', en: 'consulta' } }), {})
    expect(clave.url).toBe('http://h?api_key=k')
    const cab = resolverPeticion(nuevaPeticion({ url: 'http://h', cabeceras: [par('authorization', 'Mía')], auth: { tipo: 'bearer', token: 'x' } }), {})
    expect(cab.cabeceras).toEqual([['authorization', 'Mía']]) // la cabecera del usuario manda
    const form = resolverPeticion(nuevaPeticion({ metodo: 'POST', url: 'http://h', cuerpo: { tipo: 'formulario', campos: [par('a', '1 2'), par('b', 'ñ')] } }), {})
    expect(form.cuerpo).toBe('a=1%202&b=%C3%B1')
    expect(form.cabeceras).toContainEqual(['Content-Type', 'application/x-www-form-urlencoded'])
  })

  it('genera cURL con las comillas bien escapadas y lo vuelve a leer', () => {
    const r = resolverPeticion(nuevaPeticion({ metodo: 'POST', url: 'http://h/x', cabeceras: [par('X-N', "it's")], cuerpo: { tipo: 'json', texto: `{"d":"O'Neil"}` } }), {})
    const curl = generarCurl(r)
    expect(curl).toBe(`curl -X POST 'http://h/x' -H 'X-N: it'\\''s' -H 'Content-Type: application/json' --data-raw '{"d":"O'\\''Neil"}' -L`)
    const p = analizarCurl(curl)
    expect(p).toMatchObject({ metodo: 'POST', url: 'http://h/x', cuerpo: { tipo: 'json', texto: `{"d":"O'Neil"}` } })
    expect(p.cabeceras.map((h) => [h.clave, h.valor])).toEqual([['X-N', "it's"]])
  })

  it('analiza cURL como los que copia el navegador', () => {
    const p = analizarCurl(`curl 'https://api.ejemplo.com/v1/users?id=3' \\
  -H 'accept: application/json' \\
  -H "authorization: Bearer abc" \\
  --data-raw $'{"nombre":"Ana\\n"}' \\
  --compressed -k`)
    expect(p.metodo).toBe('POST')
    expect(p.url).toBe('https://api.ejemplo.com/v1/users?id=3')
    expect(p.opciones.ignorarCertificado).toBe(true)
    expect(p.cuerpo).toEqual({ tipo: 'json', texto: '{"nombre":"Ana\n"}' })
    expect(p.cabeceras.map((h) => h.clave)).toEqual(['accept', 'authorization'])
    expect(analizarCurl('curl -I http://h').metodo).toBe('HEAD')
    expect(analizarCurl('curl -u ana:clave http://h').auth).toEqual({ tipo: 'basica', usuario: 'ana', clave: 'clave' })
    expect(analizarCurl('curl -X PUT -d a=1 -d b=2 http://h')).toMatchObject({ metodo: 'PUT', cuerpo: { tipo: 'formulario', campos: [expect.objectContaining({ clave: 'a', valor: '1' }), expect.objectContaining({ clave: 'b', valor: '2' })] } })
    expect(analizarCurl('curl --url=http://h --max-time 5').opciones.tiempoMs).toBe(5000)
    expect(() => analizarCurl('curl -F a=@x http://h')).toThrow(/multipart/)
    expect(() => analizarCurl('curl')).toThrow(/dirección/)
    expect(() => analizarCurl("curl 'http://h")).toThrow(/Comilla/)
    expect(() => analizarCurl('curl --raro http://h')).toThrow(/no soportada/)
    expect(dividirComando(`a 'b c' "d \\" e" f\\ g`)).toEqual(['a', 'b c', 'd " e', 'f g'])
  })

  it('utilidades de formato y JSON', () => {
    expect(formatearTamano(512)).toBe('512 B')
    expect(formatearTamano(2048)).toBe('2.0 KB')
    expect(formatearTamano(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(analizarJson('{"a":[1,2]}')).toEqual({ valor: { a: [1, 2] } })
    expect(analizarJson('hola')).toBeUndefined()
    expect(analizarJson('{roto')).toBeUndefined()
    expect(analizarJson('')).toBeUndefined()
  })

  it('valida las peticiones que llegan de la interfaz', () => {
    expect(() => sanearPeticion(null)).toThrow()
    expect(() => sanearPeticion({ ...peticionVacia(), metodo: 'TRACE' })).toThrow(/Método/)
    expect(() => sanearPeticion({ ...peticionVacia(), url: 'x'.repeat(9000) })).toThrow(/largo/)
    expect(() => sanearPeticion({ ...peticionVacia(), cabeceras: 'no' })).toThrow(/lista/)
    const p = sanearPeticion({ ...peticionVacia(), url: 'http://h', opciones: { tiempoMs: 5, seguirRedirecciones: false, ignorarCertificado: true } })
    expect(p.opciones).toEqual({ tiempoMs: 1000, seguirRedirecciones: false, ignorarCertificado: true })
  })
})

describe('clasificarCuerpo', () => {
  it('texto, charset, imagen y binario', () => {
    expect(clasificarCuerpo(Buffer.from('{"a":1}'), 'application/json; charset=utf-8', false)).toEqual({ tipo: 'texto', texto: '{"a":1}', truncado: false })
    expect(clasificarCuerpo(Buffer.from('caf\xe9', 'latin1'), 'text/plain; charset=iso-8859-1', false)).toMatchObject({ tipo: 'texto', texto: 'café' })
    expect(clasificarCuerpo(Buffer.from([137, 80, 78, 71]), 'image/png', false)).toMatchObject({ tipo: 'imagen', base64: Buffer.from([137, 80, 78, 71]).toString('base64') })
    expect(clasificarCuerpo(Buffer.from([0, 1, 2, 3]), 'application/octet-stream', false)).toEqual({ tipo: 'binario', truncado: false })
    expect(clasificarCuerpo(Buffer.from('hola'), '', false)).toMatchObject({ tipo: 'texto' })
    expect(clasificarCuerpo(Buffer.from([0, 1]), 'application/zip', true)).toEqual({ tipo: 'binario', truncado: true })
  })
})

describe('ejecutarPeticion (servidor HTTP local)', () => {
  let servidor: Server
  let otro: Server
  let base = ''
  let baseOtro = ''
  let ultimo: { metodo?: string; url?: string; cabeceras: Record<string, string | string[] | undefined>; cuerpo: string } = { cabeceras: {}, cuerpo: '' }

  const leer = (req: IncomingMessage): Promise<string> => new Promise((ok) => { let t = ''; req.on('data', (d) => (t += d)); req.on('end', () => ok(t)) })

  beforeAll(async () => {
    otro = createServer((req, res) => {
      void leer(req).then(() => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }))
      })
    })
    await new Promise<void>((ok) => otro.listen(0, '127.0.0.1', ok))
    baseOtro = `http://127.0.0.1:${(otro.address() as AddressInfo).port}`

    servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
      void leer(req).then((cuerpo) => {
        ultimo = { metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo }
        const url = new URL(req.url ?? '/', 'http://x')
        switch (url.pathname) {
          case '/eco':
            res.setHeader('content-type', 'application/json')
            res.setHeader('x-uno', '1')
            res.setHeader('set-cookie', ['a=1', 'b=2'])
            return void res.end(JSON.stringify({ metodo: req.method, cuerpo, tipo: req.headers['content-type'] ?? null }))
          case '/404':
            res.statusCode = 404
            return void res.end('no está')
          case '/r1':
            res.statusCode = 302
            res.setHeader('location', '/r2')
            return void res.end()
          case '/r2':
            res.statusCode = 301
            res.setHeader('location', '/eco')
            return void res.end()
          case '/post-303':
            res.statusCode = 303
            res.setHeader('location', '/eco')
            return void res.end()
          case '/otro-host':
            res.statusCode = 307
            res.setHeader('location', `${baseOtro}/eco`)
            return void res.end()
          case '/bucle':
            res.statusCode = 302
            res.setHeader('location', '/bucle')
            return void res.end()
          case '/gzip':
            res.setHeader('content-type', 'application/json')
            res.setHeader('content-encoding', 'gzip')
            return void res.end(gzipSync(JSON.stringify({ comprimido: 'gzip', largo: 'x'.repeat(5000) })))
          case '/br':
            res.setHeader('content-type', 'text/plain')
            res.setHeader('content-encoding', 'br')
            return void res.end(brotliCompressSync(Buffer.from('hola brotli')))
          case '/lento':
            return void setTimeout(() => res.end('tarde'), 1500)
          case '/enorme': {
            res.setHeader('content-type', 'application/octet-stream')
            const bloque = Buffer.alloc(1024 * 1024, 7)
            let n = 0
            const escribir = (): void => {
              while (n < 25) {
                n++
                if (!res.write(bloque)) return void res.once('drain', escribir)
              }
              res.end()
            }
            return escribir()
          }
          case '/imagen':
            res.setHeader('content-type', 'image/png')
            return void res.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          default:
            res.end('ok')
        }
      })
    })
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    for (const s of [servidor, otro]) {
      s.closeAllConnections()
      await new Promise((ok) => s.close(ok))
    }
  })

  const peticion = (url: string, extra: Partial<Parameters<typeof resolverPeticion>[0]> = {}) => resolverPeticion(nuevaPeticion({ url, ...extra }), {})
  const enviar = (url: string, extra: Partial<PeticionApi> = {}, senal = new AbortController().signal) => ejecutarPeticion(peticion(url, extra), senal)

  it('envía método, cabeceras y cuerpo, y devuelve estado, cabeceras repetidas y tiempo', async () => {
    const r = await enviar(`${base}/eco?x=1`, { metodo: 'POST', cabeceras: [par('X-Mio', 'sí')], cuerpo: { tipo: 'json', texto: '{"a":1}' } })
    expect(r.estado).toBe(200)
    expect(JSON.parse(r.datos.toString())).toEqual({ metodo: 'POST', cuerpo: '{"a":1}', tipo: 'application/json' })
    expect(ultimo.url).toBe('/eco?x=1')
    expect(ultimo.cabeceras['x-mio']).toBe('sí')
    expect(ultimo.cabeceras['user-agent']).toBe('OdeskAgent/1.0')
    expect(r.cabeceras.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v)).toEqual(['a=1', 'b=2'])
    expect(r.cabeceras).toContainEqual(['x-uno', '1'])
    expect(r.ms).toBeGreaterThanOrEqual(0)
    expect(r.tipoContenido).toMatch(/json/)
  })

  it('devuelve los errores HTTP como respuesta (no como fallo) y respeta HEAD', async () => {
    const r = await enviar(`${base}/404`)
    expect(r).toMatchObject({ estado: 404 })
    expect(r.datos.toString()).toBe('no está')
    const h = await enviar(`${base}/eco`, { metodo: 'HEAD' })
    expect(h.estado).toBe(200)
    expect(h.datos.length).toBe(0)
  })

  it('sigue redirecciones (301/302/303/307) con las reglas de cada una', async () => {
    const r = await enviar(`${base}/r1`)
    expect(r.estado).toBe(200)
    expect(r.redirecciones).toEqual([`${base}/r1`, `${base}/r2`])
    expect(r.urlFinal).toBe(`${base}/eco`)
    const p303 = await enviar(`${base}/post-303`, { metodo: 'POST', cuerpo: { tipo: 'texto', texto: 'datos' } })
    expect(JSON.parse(p303.datos.toString())).toMatchObject({ metodo: 'GET', cuerpo: '' }) // 303 siempre pasa a GET sin cuerpo
    const sin = await enviar(`${base}/r1`, { opciones: { ...peticionVacia().opciones, seguirRedirecciones: false } })
    expect(sin.estado).toBe(302)
    await expect(enviar(`${base}/bucle`)).rejects.toThrow(/Demasiadas redirecciones/)
  })

  it('no manda credenciales a otro servidor al redirigir', async () => {
    const r = await enviar(`${base}/otro-host`, { cabeceras: [par('Authorization', 'Bearer secreto'), par('Cookie', 'sid=1')] })
    expect(r.urlFinal).toBe(`${baseOtro}/eco`)
    expect(JSON.parse(r.datos.toString())).toEqual({ authorization: null, cookie: null })
  })

  it('descomprime gzip y brotli y clasifica imágenes', async () => {
    const g = await enviar(`${base}/gzip`)
    expect(JSON.parse(g.datos.toString())).toMatchObject({ comprimido: 'gzip' })
    expect(g.datos.length).toBeGreaterThan(5000)
    expect((await enviar(`${base}/br`)).datos.toString()).toBe('hola brotli')
    const im = await enviar(`${base}/imagen`)
    expect(clasificarCuerpo(im.datos, im.tipoContenido, im.truncado)).toMatchObject({ tipo: 'imagen' })
  })

  it('corta las respuestas gigantes y avisa', async () => {
    const r = await enviar(`${base}/enorme`)
    expect(r.truncado).toBe(true)
    expect(r.datos.length).toBe(MAX_BYTES)
  })

  it('tiempo agotado, cancelación y errores de red legibles', async () => {
    await expect(enviar(`${base}/lento`, { opciones: { ...peticionVacia().opciones, tiempoMs: 300 } })).rejects.toThrow(/Tiempo de espera agotado/)
    const control = new AbortController()
    const p = enviar(`${base}/lento`, {}, control.signal)
    setTimeout(() => control.abort(), 100)
    await expect(p).rejects.toThrow(/cancelada/)
    const puerto = (servidor.address() as AddressInfo).port + 1
    await expect(enviar(`http://127.0.0.1:${puerto}/`)).rejects.toThrow(/Conexión rechazada/)
    await expect(enviar('http://no-existe.invalid/')).rejects.toThrow(/No se encontró el servidor/)
    await expect(enviar('no es una url')).rejects.toThrow(/URL no es válida/)
    await expect(enviar('file:///etc/passwd')).rejects.toThrow(/http y https/)
  })
})

describe('ServicioApi', () => {
  let servidor: Server
  let base = ''
  beforeAll(async () => {
    servidor = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ token: req.headers['x-token'] ?? null, url: req.url }))
    })
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    servidor.closeAllConnections()
    await new Promise((ok) => servidor.close(ok))
  })

  const nuevo = async (): Promise<{ s: ServicioApi; guardados: { nombre: string; datos: Buffer }[] }> => {
    const dir = await mkdtemp(join(tmpdir(), 'api-'))
    const guardados: { nombre: string; datos: Buffer }[] = []
    const s = new ServicioApi(new AlmacenJson(dir, 0o600), async (nombre, datos) => (guardados.push({ nombre, datos }), '/tmp/' + nombre))
    return { s, guardados }
  }

  it('colecciones, peticiones y entornos: crear, editar, borrar y activar', async () => {
    const { s } = await nuevo()
    expect(await s.datos()).toEqual({ colecciones: [], entornos: [], historial: [] })
    await expect(s.guardarColeccion(undefined, '  ')).rejects.toThrow(/nombre/)
    const { id: col } = await s.guardarColeccion(undefined, 'Tienda')
    const p = nuevaPeticion({ url: 'http://h/a' })
    const { id: pid, datos } = await s.guardarPeticion(col, undefined, 'Listar', p)
    expect(datos.colecciones[0]!.peticiones[0]).toMatchObject({ id: pid, nombre: 'Listar' })
    const editada = await s.guardarPeticion(col, pid, 'Listar todo', { ...p, url: 'http://h/b' })
    expect(editada.id).toBe(pid)
    expect(editada.datos.colecciones[0]!.peticiones).toHaveLength(1)
    expect(editada.datos.colecciones[0]!.peticiones[0]!.peticion.url).toBe('http://h/b')
    await expect(s.guardarPeticion('no-existe', undefined, 'x', p)).rejects.toThrow(/colección/)
    await expect(s.guardarPeticion(col, undefined, 'x', { ...p, metodo: 'TRACE' })).rejects.toThrow(/Método/)
    expect((await s.eliminarPeticion(col, pid)).colecciones[0]!.peticiones).toEqual([])
    expect((await s.guardarColeccion(col, 'Tienda 2')).datos.colecciones[0]!.nombre).toBe('Tienda 2')
    expect((await s.eliminarColeccion(col)).colecciones).toEqual([])

    await expect(s.guardarEntorno(undefined, 'Dev', [{ id: '1', clave: 'mala clave', valor: '', activa: true }])).rejects.toThrow(/Nombre de variable/)
    const e1 = await s.guardarEntorno(undefined, 'Dev', [{ id: '1', clave: 'token', valor: 'abc', activa: true }])
    expect(e1.datos.entornoActivo).toBe(e1.id) // el primero queda activo
    const e2 = await s.guardarEntorno(undefined, 'Prod', [])
    expect(e2.datos.entornoActivo).toBe(e1.id)
    expect((await s.fijarEntorno(e2.id)).entornoActivo).toBe(e2.id)
    await expect(s.fijarEntorno('nope')).rejects.toThrow(/entorno/)
    expect((await s.eliminarEntorno(e2.id)).entornoActivo).toBeUndefined()
    expect((await s.fijarEntorno(undefined)).entornoActivo).toBeUndefined()
  })

  it('envía con el entorno activo, anota el historial (sin resolver secretos) y guarda la respuesta', async () => {
    const { s, guardados } = await nuevo()
    const e = await s.guardarEntorno(undefined, 'Dev', [{ id: '1', clave: 'token', valor: 'sec-123', activa: true }, { id: '2', clave: 'base', valor: base, activa: true }])
    const peticion = nuevaPeticion({ url: '{{base}}/datos', cabeceras: [par('X-Token', '{{token}}')] })
    const r = await s.enviar(peticion, 'envio-1')
    expect(r.estado).toBe(200)
    expect(r.cuerpo).toMatchObject({ tipo: 'texto' })
    expect(JSON.parse(r.cuerpo.texto!)).toEqual({ token: 'sec-123', url: '/datos' })
    const datos = await s.datos()
    expect(datos.historial).toHaveLength(1)
    expect(datos.historial[0]).toMatchObject({ metodo: 'GET', url: '{{base}}/datos', estado: 200 })
    expect(JSON.stringify(datos.historial)).not.toContain('sec-123')
    expect(e.id).toBeTruthy()

    await expect(s.enviar(peticion, 'envio-2').then(() => s.enviar(nuevaPeticion({ url: '' }), 'x'))).rejects.toThrow(/URL/)
    await expect(s.enviar(nuevaPeticion({ url: 'http://127.0.0.1:1/' }), 'envio-3')).rejects.toThrow(/rechazada/)
    const h = (await s.datos()).historial
    expect(h[0]!.error).toMatch(/rechazada/)
    expect(h).toHaveLength(3)

    expect(await s.guardarRespuesta('envio-1')).toEqual({ ruta: expect.stringContaining('/tmp/') })
    expect(guardados[0]!.datos.toString()).toContain('sec-123')
    await expect(s.guardarRespuesta('desconocido')).rejects.toThrow(/memoria/)
    expect(await s.curl(peticion)).toContain(`-H 'X-Token: sec-123'`)
    expect((await s.limpiarHistorial()).historial).toEqual([])
  })

  it('el historial se acota y se puede cancelar una petición en curso', async () => {
    const { s } = await nuevo()
    for (let i = 0; i < 103; i++) await s.enviar(nuevaPeticion({ url: `${base}/n${i}` }), `e${i}`)
    const h = (await s.datos()).historial
    expect(h).toHaveLength(100)
    expect(h[0]!.url).toMatch(/n102$/)
    expect(s.cancelar('no-existe')).toBe(false)
  }, 60_000)

  it('rechaza operaciones desconocidas', async () => {
    const { s } = await nuevo()
    await expect(ejecutarOperacionApi(s, 'borrarTodo', {})).rejects.toThrow(/desconocida/)
    await expect(ejecutarOperacionApi(s, '__proto__', {})).rejects.toThrow(/desconocida/)
    expect(await ejecutarOperacionApi(s, 'datos', {})).toMatchObject({ colecciones: [] })
  })
})
