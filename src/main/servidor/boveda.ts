import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EstadoBoveda } from '@shared/sesion'
import type { Cifrador } from '../github/token'
import { ErrorServidor, type ClienteServidor } from './cliente'
import { hashDe } from './sync-cuenta'

const scrypt = (frase: string, sal: Buffer, n: number, opciones: ScryptOptions): Promise<Buffer> =>
  new Promise((ok, mal) => scryptCb(frase, sal, n, opciones, (err, clave) => (err ? mal(err) : ok(clave))))

/** Parámetros de scrypt: ~100 ms por intento en un equipo normal (frena probar frases si alguien roba la base de datos). */
const KDF = { alg: 'scrypt' as const, N: 32768, r: 8, p: 1 }
const LARGO_MINIMO_FRASE = 10
/** Secciones que son «nombre → claves»: al subir se suman a las del servidor (un equipo que aún no tiene un proveedor no borra sus claves). */
const POR_NOMBRE = new Set(['proveedores', 'mcp'])
const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

interface Kdf {
  alg: 'scrypt'
  N: number
  r: number
  p: number
  salt: string
}

interface BovedaRemota {
  v: 1
  kdf: Kdf
  blob: string
  updatedAt: number
}

/** Contenido descifrado: secciones independientes, cada una con su fecha (gana la más reciente por sección). */
interface Contenido {
  secciones: Record<string, { data: unknown; updatedAt: number }>
}

/** De dónde salen y adónde van los secretos de cada sección (proveedores, MCP, cliente API, GitHub). */
export interface SeccionesSecretas {
  leer(): Promise<Record<string, unknown>>
  aplicar(seccion: string, data: unknown): Promise<void>
}


async function derivar(frase: string, kdf: Kdf): Promise<Buffer> {
  return scrypt(frase.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 })
}

export function cifrar(clave: Buffer, contenido: Contenido): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', clave, iv)
  const cuerpo = Buffer.concat([c.update(JSON.stringify(contenido), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), cuerpo]).toString('base64')
}

/** Descifra y autentica (GCM): con otra clave, o si alguien alteró el texto cifrado, falla. */
export function descifrar(clave: Buffer, blob: string): Contenido {
  const b = Buffer.from(blob, 'base64')
  const d = createDecipheriv('aes-256-gcm', clave, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  const texto = Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
  const c = JSON.parse(texto) as Contenido
  return { secciones: c.secciones ?? {} }
}

/**
 * Bóveda de claves: proveedores de IA y servidores MCP (sus `env`), el cliente API (colecciones y entornos) y el token de GitHub
 * viajan entre equipos cifrados aquí con una clave derivada de una frase que solo conoce el usuario. El servidor guarda solo el
 * texto cifrado. En cada equipo la clave se guarda cifrada con el llavero del sistema (o solo en memoria si no hay llavero).
 * Olvidar la frase = perder lo guardado en la bóveda (se puede borrar y crear otra).
 */
export class Boveda {
  private clave?: Buffer
  private kdf?: Kdf
  private cargada?: Promise<void>
  /** Hash y fecha de lo último sincronizado de cada sección. */
  private estadoSecciones?: Record<string, { hash: string; updatedAt: number }>

  constructor(
    private readonly cliente: ClienteServidor,
    private readonly archivoClave: string,
    private readonly archivoEstado: string,
    private readonly cifrador: Cifrador,
    private readonly secciones: SeccionesSecretas
  ) {}

  private cargar(): Promise<void> {
    this.cargada ??= (async () => {
      try {
        const a = JSON.parse(await readFile(this.archivoClave, 'utf8')) as { cifrada?: string; kdf?: Kdf }
        if (a.cifrada && a.kdf && this.cifrador.disponible()) {
          this.clave = Buffer.from(this.cifrador.descifrar(a.cifrada), 'base64')
          this.kdf = a.kdf
        }
      } catch {
        // sin clave guardada en este equipo
      }
      try {
        this.estadoSecciones = (JSON.parse(await readFile(this.archivoEstado, 'utf8')) as { secciones?: Record<string, { hash: string; updatedAt: number }> }).secciones
      } catch {
        this.estadoSecciones = undefined
      }
    })()
    return this.cargada
  }

  private async guardarClave(): Promise<boolean> {
    if (!this.clave || !this.kdf || !this.cifrador.disponible()) return false
    await mkdir(dirname(this.archivoClave), { recursive: true })
    const tmp = `${this.archivoClave}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ cifrada: this.cifrador.cifrar(this.clave.toString('base64')), kdf: this.kdf }), { mode: 0o600 })
    await rename(tmp, this.archivoClave)
    return true
  }

  private async guardarEstado(): Promise<void> {
    await mkdir(dirname(this.archivoEstado), { recursive: true })
    const tmp = `${this.archivoEstado}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ secciones: this.estadoSecciones ?? {} }), { mode: 0o600 })
    await rename(tmp, this.archivoEstado)
  }

  private async remota(): Promise<BovedaRemota | undefined> {
    try {
      return await this.cliente.get<BovedaRemota>('/me/vault')
    } catch (err) {
      if (err instanceof ErrorServidor && err.estado === 404) return undefined
      throw err
    }
  }

  async estado(): Promise<EstadoBoveda> {
    await this.cargar()
    const remota = await this.remota()
    return { configurada: !!remota, desbloqueada: !!this.clave && !!remota, persistente: !!this.clave && this.cifrador.disponible() }
  }

  /** Crea la bóveda de la cuenta con lo que hay en este equipo. */
  async crear(frase: string): Promise<EstadoBoveda> {
    if (frase.length < LARGO_MINIMO_FRASE) throw new ErrorServidor(`La frase debe tener al menos ${LARGO_MINIMO_FRASE} caracteres.`)
    await this.cargar()
    if (await this.remota()) throw new ErrorServidor('Tu cuenta ya tiene una bóveda: desbloquéala con su frase.')
    const kdf: Kdf = { ...KDF, salt: randomBytes(16).toString('base64') }
    const clave = await derivar(frase, kdf)
    const locales = await this.secciones.leer()
    const ahora = Date.now()
    const contenido: Contenido = { secciones: Object.fromEntries(Object.entries(locales).map(([n, data]) => [n, { data, updatedAt: ahora }])) }
    await this.cliente.put('/me/vault', { v: 1, kdf, blob: cifrar(clave, contenido), updatedAt: ahora })
    this.kdf = kdf
    this.clave = clave
    this.estadoSecciones = Object.fromEntries(Object.entries(locales).map(([n, data]) => [n, { hash: hashDe(data), updatedAt: ahora }]))
    await this.guardarEstado()
    await this.guardarClave()
    return this.estado()
  }

  /** Desbloquea en este equipo una bóveda ya creada (en otro) y baja sus claves. */
  async desbloquear(frase: string): Promise<EstadoBoveda> {
    await this.cargar()
    const remota = await this.remota()
    if (!remota) throw new ErrorServidor('Tu cuenta aún no tiene bóveda: créala primero.')
    const clave = await derivar(frase, remota.kdf)
    try {
      descifrar(clave, remota.blob)
    } catch {
      throw new ErrorServidor('La frase no es correcta.')
    }
    this.clave = clave
    this.kdf = remota.kdf
    this.estadoSecciones = undefined // primer contacto de este equipo: manda lo del servidor
    await this.guardarClave()
    await this.sincronizar()
    return this.estado()
  }

  /** Cambia la frase: vuelve a cifrar todo con una clave nueva (los demás equipos tendrán que desbloquear con la nueva). */
  async cambiarFrase(actual: string, nueva: string): Promise<EstadoBoveda> {
    if (nueva.length < LARGO_MINIMO_FRASE) throw new ErrorServidor(`La frase debe tener al menos ${LARGO_MINIMO_FRASE} caracteres.`)
    await this.cargar()
    const remota = await this.remota()
    if (!remota) throw new ErrorServidor('Tu cuenta aún no tiene bóveda.')
    let contenido: Contenido
    try {
      contenido = descifrar(await derivar(actual, remota.kdf), remota.blob)
    } catch {
      throw new ErrorServidor('La frase actual no es correcta.')
    }
    const kdf = { ...KDF, salt: randomBytes(16).toString('base64') }
    const clave = await derivar(nueva, kdf)
    await this.cliente.put('/me/vault', { v: 1, kdf, blob: cifrar(clave, contenido), updatedAt: Date.now(), base: remota.updatedAt })
    this.clave = clave
    this.kdf = kdf
    await this.guardarClave()
    return this.estado()
  }

  /** Olvida la clave en este equipo (la bóveda sigue en el servidor). */
  async bloquear(): Promise<void> {
    await this.cargar()
    this.clave = undefined
    this.kdf = undefined
    await rm(this.archivoClave, { force: true })
  }

  /** Si se olvidó la frase: borra la bóveda del servidor (lo que tenía se pierde; las claves de este equipo siguen aquí). */
  async reiniciar(): Promise<void> {
    await this.bloquear()
    await this.cliente.delete('/me/vault')
    this.estadoSecciones = undefined
    await rm(this.archivoEstado, { force: true })
  }

  /**
   * Sube y baja secretos por sección: lo que cambió aquí se sube, lo que cambió en otro equipo se aplica aquí, y si cambió en los dos
   * gana lo más reciente. Sin clave en este equipo no hace nada. Si otro equipo la cambió a la vez (409), lo reintenta una vez.
   */
  async sincronizar(intento = 0): Promise<{ subidas: number; bajadas: number }> {
    await this.cargar()
    if (!this.clave) return { subidas: 0, bajadas: 0 }
    const remota = await this.remota()
    if (!remota) return { subidas: 0, bajadas: 0 }
    if (this.kdf?.salt !== remota.kdf.salt) {
      // Se cambió la frase en otro equipo: la clave de aquí ya no sirve.
      await this.bloquear()
      return { subidas: 0, bajadas: 0 }
    }
    const contenido = descifrar(this.clave, remota.blob)
    const locales = await this.secciones.leer()
    const primera = !this.estadoSecciones
    const estado = { ...(this.estadoSecciones ?? {}) } // copia: si hay que reintentar (409) no debe quedar a medias
    const resultado = { subidas: 0, bajadas: 0 }
    let subir = false
    for (const nombre of new Set([...Object.keys(contenido.secciones), ...Object.keys(locales)])) {
      const r = contenido.secciones[nombre]
      const tieneLocal = locales[nombre] !== undefined
      const hashLocal = tieneLocal ? hashDe(locales[nombre]) : undefined
      const e = estado[nombre]
      const cambioLocal = tieneLocal && (!e || e.hash !== hashLocal)
      const cambioRemoto = !!r && (!e || r.updatedAt > e.updatedAt)
      if (cambioRemoto && (!cambioLocal || primera)) {
        await this.secciones.aplicar(nombre, r!.data)
        estado[nombre] = { hash: hashDe(r!.data), updatedAt: r!.updatedAt }
        resultado.bajadas++
      } else if (cambioLocal) {
        const cuando = Math.max(Date.now(), (r?.updatedAt ?? 0) + 1)
        const data = POR_NOMBRE.has(nombre) && esObjeto(r?.data) && esObjeto(locales[nombre]) ? { ...r!.data, ...locales[nombre] } : locales[nombre]
        contenido.secciones[nombre] = { data, updatedAt: cuando }
        estado[nombre] = { hash: hashLocal!, updatedAt: cuando }
        subir = true
        resultado.subidas++
      }
    }
    if (subir) {
      try {
        await this.cliente.put('/me/vault', { v: 1, kdf: remota.kdf, blob: cifrar(this.clave, contenido), updatedAt: Date.now(), base: remota.updatedAt })
      } catch (err) {
        if (err instanceof ErrorServidor && err.estado === 409 && intento === 0) return this.sincronizar(1)
        throw err
      }
    }
    this.estadoSecciones = estado
    await this.guardarEstado()
    return resultado
  }
}
