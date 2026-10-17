import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'
import type { CuerpoRespuesta, PeticionResuelta } from '@shared/api'

/** Lo más que se descarga de una respuesta; más allá se corta y se avisa. */
export const MAX_BYTES = 20 * 1024 * 1024
export const MAX_TEXTO = 1_500_000
const MAX_IMAGEN = 5 * 1024 * 1024
const MAX_REDIRECCIONES = 10

export interface ResultadoHttp {
  estado: number
  texto: string
  urlFinal: string
  redirecciones: string[]
  cabeceras: [string, string][]
  tipoContenido: string
  ms: number
  /** Cuerpo ya descomprimido. */
  datos: Buffer
  truncado: boolean
}

const TEXTUAL = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|yaml|csv|graphql|html|svg|x-sh|markdown/i
const IMAGEN = /^image\/(png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif)/i

/** Decide cómo mostrar un cuerpo: texto (respetando el charset), imagen pequeña o binario. */
export function clasificarCuerpo(datos: Buffer, tipoContenido: string, truncado: boolean): CuerpoRespuesta {
  const tipo = tipoContenido.split(';')[0]!.trim().toLowerCase()
  if (IMAGEN.test(tipo) && datos.length <= MAX_IMAGEN && !truncado) return { tipo: 'imagen', base64: datos.toString('base64'), truncado: false }
  const sinNulos = !datos.subarray(0, 4000).includes(0)
  if (TEXTUAL.test(tipo) || (!tipo && sinNulos) || (tipo === 'application/octet-stream' && sinNulos && datos.length > 0 && datos.length < 200_000)) {
    const charset = /charset=([^;\s]+)/i.exec(tipoContenido)?.[1]?.replace(/["']/g, '') ?? 'utf-8'
    let t: string
    try {
      t = new TextDecoder(charset).decode(datos)
    } catch {
      t = datos.toString('utf8')
    }
    const largo = t.length > MAX_TEXTO
    return { tipo: 'texto', texto: largo ? t.slice(0, MAX_TEXTO) : t, truncado: truncado || largo }
  }
  return { tipo: 'binario', truncado }
}

/** Traduce los errores de red a algo que diga qué pasó y qué probar. */
export function explicarErrorRed(err: unknown, tiempoMs: number): string {
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }
  const codigo = e.code ?? e.cause?.code ?? ''
  const detalle = e.message || String(err)
  switch (codigo) {
    case 'ECONNREFUSED':
      return 'Conexión rechazada: no hay nada escuchando en esa dirección y puerto. ¿Está el servidor en marcha?'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'No se encontró el servidor: revisa el nombre del host y tu conexión.'
    case 'ECONNRESET':
    case 'EPIPE':
      return 'El servidor cerró la conexión sin responder.'
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'No se pudo llegar al servidor (tiempo agotado o sin ruta).'
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return `Certificado no confiable (${codigo.toLowerCase().replace(/_/g, ' ')}). Si es tu servidor local, activa «Ignorar errores de certificado» en las opciones.`
    case 'ERR_TLS_CERT_ALTNAME_INVALID_':
      return detalle
    default:
      if (/EPROTO|wrong version number|SSL|TLS/i.test(detalle + codigo)) return `Fallo de TLS: ${detalle}. ¿El servidor usa http en vez de https (o al revés)?`
      if (e.name === 'AbortError' || codigo === 'ABORT_ERR') return `Tiempo de espera agotado (${Math.round(tiempoMs / 1000)} s).`
      return detalle
  }
}

function descomprimir(res: IncomingMessage): Readable {
  const cod = String(res.headers['content-encoding'] ?? '').toLowerCase().trim()
  if (cod === 'gzip' || cod === 'x-gzip') return res.pipe(createGunzip())
  if (cod === 'deflate') return res.pipe(createInflate())
  if (cod === 'br') return res.pipe(createBrotliDecompress())
  return res
}

const aLista = (h: IncomingHttpHeaders, crudas: string[]): [string, string][] => {
  const salida: [string, string][] = []
  for (let i = 0; i + 1 < crudas.length; i += 2) salida.push([crudas[i]!, crudas[i + 1]!])
  return salida.length ? salida : Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x): [string, string] => [k, x]) : v === undefined ? [] : [[k, v] as [string, string]]))
}

interface Intento {
  res: IncomingMessage
  cuerpo: Promise<{ datos: Buffer; truncado: boolean }>
}

function unaPeticion(url: URL, metodo: string, cabeceras: [string, string][], cuerpo: Buffer | null, ignorarCertificado: boolean, senal: AbortSignal): Promise<Intento> {
  return new Promise((resolver, rechazar) => {
    // Una cabecera repetida se junta con comas (es lo que HTTP permite); se conserva el nombre tal como se escribió.
    const cab: Record<string, string> = {}
    const nombres = new Map<string, string>()
    for (const [k, v] of cabeceras) {
      const previo = nombres.get(k.toLowerCase())
      if (previo === undefined) {
        nombres.set(k.toLowerCase(), k)
        cab[k] = v
      } else cab[previo] = `${cab[previo]}, ${v}`
    }
    const tiene = (n: string): boolean => nombres.has(n)
    if (!tiene('user-agent')) cab['User-Agent'] = 'OdeskAgent/1.0'
    if (!tiene('accept')) cab['Accept'] = '*/*'
    if (!tiene('accept-encoding')) cab['Accept-Encoding'] = 'gzip, deflate, br'
    if (cuerpo) {
      const previo = nombres.get('content-length')
      if (previo) delete cab[previo]
      cab['Content-Length'] = String(cuerpo.length)
    }
    const pedir = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = pedir(url, { method: metodo, headers: cab, signal: senal, agent: false, ...(url.protocol === 'https:' ? { rejectUnauthorized: !ignorarCertificado } : {}) }, (res) => {
      const flujo = descomprimir(res)
      const cuerpoPromesa = new Promise<{ datos: Buffer; truncado: boolean }>((ok, fallo) => {
        const trozos: Buffer[] = []
        let total = 0
        let truncado = false
        flujo.on('data', (t: Buffer) => {
          if (truncado) return
          total += t.length
          if (total > MAX_BYTES) {
            trozos.push(t.subarray(0, t.length - (total - MAX_BYTES)))
            truncado = true
            res.destroy()
            flujo.destroy()
            return ok({ datos: Buffer.concat(trozos), truncado: true })
          }
          trozos.push(t)
        })
        flujo.on('end', () => ok({ datos: Buffer.concat(trozos), truncado }))
        flujo.on('error', (e) => (truncado ? ok({ datos: Buffer.concat(trozos), truncado }) : fallo(e)))
        res.on('error', (e) => (truncado ? ok({ datos: Buffer.concat(trozos), truncado }) : fallo(e)))
        res.on('aborted', () => !truncado && fallo(Object.assign(new Error('El servidor cortó la respuesta.'), { code: 'ECONNRESET' })))
      })
      cuerpoPromesa.catch(() => undefined)
      resolver({ res, cuerpo: cuerpoPromesa })
    })
    req.on('error', rechazar)
    if (cuerpo) req.write(cuerpo)
    req.end()
  })
}

/** Ejecuta una petición HTTP(S): redirecciones, descompresión, tiempo total, límite de tamaño y cancelación. */
export async function ejecutarPeticion(r: PeticionResuelta, senalExterna: AbortSignal): Promise<ResultadoHttp> {
  let actual: URL
  try {
    actual = new URL(r.url)
  } catch (err) {
    throw new Error('La URL no es válida. Escribe una dirección completa, p. ej. http://localhost:3000/api.', { cause: err })
  }
  if (actual.protocol !== 'http:' && actual.protocol !== 'https:') throw new Error('Solo se admiten direcciones http y https.')
  if (!actual.hostname) throw new Error('Falta el servidor en la URL.')

  const control = new AbortController()
  let vencido = false
  const temporizador = setTimeout(() => {
    vencido = true
    control.abort()
  }, r.opciones.tiempoMs)
  const alCancelar = (): void => control.abort()
  if (senalExterna.aborted) control.abort()
  else senalExterna.addEventListener('abort', alCancelar, { once: true })

  const inicio = Date.now()
  let metodo: string = r.metodo
  let cuerpo = r.cuerpo === null ? null : Buffer.from(r.cuerpo, 'utf8')
  let cabeceras = [...r.cabeceras]
  const redirecciones: string[] = []
  try {
    for (let salto = 0; ; salto++) {
      const intento = await unaPeticion(actual, metodo, cabeceras, cuerpo, r.opciones.ignorarCertificado, control.signal)
      const { res } = intento
      const estado = res.statusCode ?? 0
      const destino = res.headers.location
      if (r.opciones.seguirRedirecciones && [301, 302, 303, 307, 308].includes(estado) && destino) {
        res.resume()
        if (salto >= MAX_REDIRECCIONES) throw new Error(`Demasiadas redirecciones (más de ${MAX_REDIRECCIONES}).`)
        const siguiente = new URL(destino, actual)
        if (siguiente.protocol !== 'http:' && siguiente.protocol !== 'https:') throw new Error('La redirección va a una dirección que no es http ni https.')
        redirecciones.push(actual.href)
        if (estado === 303 || ((estado === 301 || estado === 302) && metodo === 'POST')) {
          metodo = metodo === 'HEAD' ? 'HEAD' : 'GET'
          cuerpo = null
          cabeceras = cabeceras.filter(([k]) => !['content-type', 'content-length'].includes(k.toLowerCase()))
        }
        // Las credenciales no viajan a otro servidor.
        if (siguiente.host !== actual.host) cabeceras = cabeceras.filter(([k]) => !['authorization', 'cookie'].includes(k.toLowerCase()))
        actual = siguiente
        continue
      }
      const { datos, truncado } = metodo === 'HEAD' ? { datos: Buffer.alloc(0), truncado: false } : await intento.cuerpo
      if (metodo === 'HEAD') res.resume()
      return {
        estado,
        texto: res.statusMessage ?? '',
        urlFinal: actual.href,
        redirecciones,
        cabeceras: aLista(res.headers, res.rawHeaders),
        tipoContenido: String(res.headers['content-type'] ?? ''),
        ms: Date.now() - inicio,
        datos,
        truncado
      }
    }
  } catch (err) {
    if (senalExterna.aborted) throw new Error('Petición cancelada.', { cause: err })
    if (vencido) throw new Error(`Tiempo de espera agotado (${Math.round(r.opciones.tiempoMs / 1000)} s).`, { cause: err })
    if (err instanceof Error && /^(Demasiadas redirecciones|La redirección|Falta|Solo se admiten|La URL)/.test(err.message)) throw err
    throw new Error(explicarErrorRed(err, r.opciones.tiempoMs), { cause: err })
  } finally {
    clearTimeout(temporizador)
    senalExterna.removeEventListener('abort', alCancelar)
  }
}
