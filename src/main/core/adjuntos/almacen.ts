import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { EXTENSIONES_TEXTO, LIMITES_ADJUNTOS as L, type Adjunto, type TipoAdjunto } from '@shared/core/adjuntos'
import { rutaSensible } from '../guardrails/rutas'
import { detectarSecretos } from '../guardrails/secretos'
import { AlmacenJson, validarId } from '../memory/almacen'

const TOKENS_IMAGEN = 1500
const TOKENS_POR_PAGINA = 2000

const empieza = (b: Uint8Array, firma: readonly number[], desde = 0): boolean => firma.every((x, i) => b[desde + i] === x)
const ascii = (b: Uint8Array, desde: number, largo: number): string => Buffer.from(b.subarray(desde, desde + largo)).toString('latin1')

/** Tipo real según los primeros bytes (nunca la extensión). */
export function detectarMime(b: Uint8Array): { tipo: TipoAdjunto; mime: string } | null {
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { tipo: 'imagen', mime: 'image/png' }
  if (empieza(b, [0xff, 0xd8, 0xff])) return { tipo: 'imagen', mime: 'image/jpeg' }
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { tipo: 'imagen', mime: 'image/gif' }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { tipo: 'imagen', mime: 'image/webp' }
  if (ascii(b, 0, 1024).includes('%PDF-')) return { tipo: 'pdf', mime: 'application/pdf' }
  return null
}

/** Ancho y alto en píxeles (PNG, JPEG y GIF); null si no se pueden leer. */
export function dimensiones(b: Uint8Array, mime: string): { ancho: number; alto: number } | null {
  const v = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  try {
    if (mime === 'image/png') return { ancho: v.readUInt32BE(16), alto: v.readUInt32BE(20) }
    if (mime === 'image/gif') return { ancho: v.readUInt16LE(6), alto: v.readUInt16LE(8) }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < v.length) {
        if (v[i] !== 0xff) return null
        const marca = v[i + 1]!
        if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) return { alto: v.readUInt16BE(i + 5), ancho: v.readUInt16BE(i + 7) }
        i += 2 + v.readUInt16BE(i + 2)
      }
    }
  } catch {
    /* archivo truncado */
  }
  return null
}

const nombreSeguro = (n: string): string =>
  [...(n.split(/[\\/]/).pop() ?? 'archivo')].filter((c) => c.charCodeAt(0) >= 32).join('').trim().slice(0, 80) || 'archivo'
const formato = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`)

/** Valida un archivo subido y devuelve su descripción; lanza con un mensaje claro si no es admisible. */
export function validarAdjunto(nombreOriginal: string, datos: Uint8Array): Omit<Adjunto, 'id'> {
  const nombre = nombreSeguro(nombreOriginal)
  if (datos.byteLength === 0) throw new Error(`«${nombre}» está vacío`)
  const ext = extname(nombre).slice(1).toLowerCase()
  const real = detectarMime(datos)
  if (real?.tipo === 'imagen') {
    if (datos.byteLength > L.imagenBytes) throw new Error(`«${nombre}» pesa ${formato(datos.byteLength)}: las imágenes admiten hasta ${formato(L.imagenBytes)}`)
    const d = dimensiones(datos, real.mime)
    if (d && (d.ancho > L.ladoMaximoImagen || d.alto > L.ladoMaximoImagen)) throw new Error(`«${nombre}» mide ${d.ancho}×${d.alto}: el máximo es ${L.ladoMaximoImagen} px por lado`)
    return { nombre, tipo: 'imagen', mime: real.mime, bytes: datos.byteLength, tokens: TOKENS_IMAGEN }
  }
  if (real?.tipo === 'pdf') {
    if (datos.byteLength > L.pdfBytes) throw new Error(`«${nombre}» pesa ${formato(datos.byteLength)}: los PDF admiten hasta ${formato(L.pdfBytes)}`)
    const crudo = Buffer.from(datos).toString('latin1')
    if (/\/Encrypt\b/.test(crudo)) throw new Error(`«${nombre}» está cifrado o protegido: quítale la protección antes de adjuntarlo`)
    const paginas = Math.max(1, (crudo.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length)
    if (paginas > L.pdfPaginas) throw new Error(`«${nombre}» tiene unas ${paginas} páginas: el máximo es ${L.pdfPaginas}`)
    return { nombre, tipo: 'pdf', mime: 'application/pdf', bytes: datos.byteLength, paginas, tokens: paginas * TOKENS_POR_PAGINA }
  }
  // Texto: solo extensiones conocidas, UTF-8 válido y sin binarios; nunca archivos con credenciales.
  if (!(EXTENSIONES_TEXTO as readonly string[]).includes(ext)) throw new Error(`«${nombre}» no es un tipo admitido (imágenes PNG, JPG, GIF o WebP; PDF; o texto y código)`)
  if (datos.byteLength > L.textoBytes) throw new Error(`«${nombre}» pesa ${formato(datos.byteLength)}: los archivos de texto admiten hasta ${formato(L.textoBytes)}`)
  const sensible = rutaSensible(nombre)
  if (sensible) throw new Error(`«${nombre}» parece un ${sensible}: no se adjunta`)
  if (datos.subarray(0, 8000).includes(0)) throw new Error(`«${nombre}» parece un archivo binario`)
  let texto: string
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(datos)
  } catch {
    throw new Error(`«${nombre}» no está en UTF-8`)
  }
  const secretos = detectarSecretos(texto)
  if (secretos.length) throw new Error(`«${nombre}» parece contener credenciales (${secretos[0]!.mensaje}): no se adjunta`)
  return { nombre, tipo: 'texto', mime: 'text/plain', bytes: datos.byteLength, tokens: Math.ceil(texto.length / 3.5) }
}

/** Adjuntos validados en ~/.odesk-agent/adjuntos/ (0600): el contenido va en `<id>.dat` y la descripción en `<id>.json`. */
export class AlmacenAdjuntos {
  private readonly meta: AlmacenJson<Adjunto>

  constructor(private readonly dir: string) {
    this.meta = new AlmacenJson<Adjunto>(dir, 0o600)
  }

  async guardar(nombre: string, datos: Uint8Array): Promise<Adjunto> {
    const a: Adjunto = { id: randomUUID().replaceAll('-', '').slice(0, 16), ...validarAdjunto(nombre, datos) }
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, `${a.id}.dat`), datos, { mode: 0o600 })
    await this.meta.actualizar(a.id, () => a)
    return a
  }

  async obtener(id: string): Promise<Adjunto | undefined> {
    return this.meta.leer(validarId(id))
  }

  async contenido(id: string): Promise<{ adjunto: Adjunto; datos: Buffer } | undefined> {
    const adjunto = await this.obtener(id)
    if (!adjunto) return undefined
    try {
      return { adjunto, datos: await readFile(join(this.dir, `${validarId(id)}.dat`)) }
    } catch {
      return undefined
    }
  }

  async base64(id: string): Promise<{ mime: string; base64: string } | undefined> {
    const c = await this.contenido(id)
    return c && { mime: c.adjunto.mime, base64: c.datos.toString('base64') }
  }

  async eliminar(id: string): Promise<void> {
    await this.meta.actualizar(validarId(id), () => undefined)
    await rm(join(this.dir, `${validarId(id)}.dat`), { force: true })
  }

  /** Borra los adjuntos de más de `maxDias` días y, si aún se pasa de `maxBytes`, los más antiguos. */
  async limpiar(maxDias = 30, maxBytes = 500 * 1024 * 1024): Promise<number> {
    let archivos: { id: string; m: number; bytes: number }[]
    try {
      archivos = await Promise.all(
        (await readdir(this.dir)).filter((f) => f.endsWith('.dat')).map(async (f) => {
          const s = await stat(join(this.dir, f))
          return { id: f.slice(0, -4), m: s.mtimeMs, bytes: s.size }
        })
      )
    } catch {
      return 0
    }
    archivos.sort((a, b) => a.m - b.m)
    let total = archivos.reduce((s, a) => s + a.bytes, 0)
    const limite = Date.now() - maxDias * 86_400_000
    let borrados = 0
    for (const a of archivos) {
      if (a.m >= limite && total <= maxBytes) break
      await this.eliminar(a.id)
      total -= a.bytes
      borrados++
    }
    return borrados
  }
}
