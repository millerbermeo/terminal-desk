import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Primitivas del cifrado de extremo a extremo del chat (solo `node:crypto`, sin dependencias):
 *
 * - Identidad de cada cuenta: un par X25519. `claveId` = primeros 32 hex del SHA-256 de la clave pública.
 * - Clave de una pareja: HKDF-SHA256 del secreto X25519 de las dos claves (cada lado la calcula con su privada y la pública del otro).
 * - Mensajes, señales de llamada y archivos: AES-256-GCM con iv aleatorio de 12 bytes y datos asociados (AAD) que atan el cifrado a su
 *   conversación, emisor, id de cliente y tipo: el servidor no puede mover un sobre a otro mensaje ni cambiar quién lo envió.
 * - Respaldo de la privada: scrypt (N=2^17, r=8, p=1) sobre la frase del usuario + AES-256-GCM. El servidor guarda el respaldo pero
 *   no la frase.
 * - Número de seguridad: 60 cifras (como Signal: SHA-512 iterado 5200 veces sobre la clave y el id de cada cuenta) para comparar en
 *   persona o por otro canal y descartar que el servidor haya colado una clave suya.
 */

export const PREFIJO_SOBRE = 'e2e1.'
const SAL_HKDF = createHash('sha256').update('odesk-chat-e2e-v1').digest()
const IV = 12
const ETIQUETA = 16
/** scrypt: ~128 MB y unos 0,3-0,8 s por intento (frena probar frases si alguien se lleva el respaldo). */
const SCRYPT = { logN: 17, r: 8, p: 1 }
const FRASE_MIN = 12

export interface Identidad {
  claveId: string
  /** 32 bytes. */
  publica: Buffer
  /** 32 bytes. Nunca sale de main ni se guarda sin cifrar. */
  privada: Buffer
}

export class ErrorCifrado extends Error {}

const b64u = (b: Buffer): string => b.toString('base64url')
const desdeB64u = (s: string): Buffer => Buffer.from(s, 'base64url')

export function idDeClave(publica: Buffer): string {
  return createHash('sha256').update(publica).digest('hex').slice(0, 32)
}

export function generarIdentidad(): Identidad {
  const { privateKey } = generateKeyPairSync('x25519')
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string }
  const publica = desdeB64u(jwk.x)
  return { claveId: idDeClave(publica), publica, privada: desdeB64u(jwk.d) }
}

/** La pública que corresponde a una privada (para comprobar que un respaldo abierto es de verdad la clave publicada). */
export function publicaDe(privada: Buffer): Buffer {
  const jwk = createPublicKey(objetoPrivada(privada)).export({ format: 'jwk' }) as { x: string }
  return desdeB64u(jwk.x)
}

// Cabeceras DER (PKCS#8 y SPKI) de una clave X25519: así se importan los 32 bytes en crudo.
const DER_PRIVADA = Buffer.from('302e020100300506032b656e04220420', 'hex')
const DER_PUBLICA = Buffer.from('302a300506032b656e032100', 'hex')
const objetoPrivada = (privada: Buffer) => createPrivateKey({ key: Buffer.concat([DER_PRIVADA, privada]), format: 'der', type: 'pkcs8' })
const objetoPublica = (publica: Buffer) => createPublicKey({ key: Buffer.concat([DER_PUBLICA, publica]), format: 'der', type: 'spki' })

function secreto(privada: Buffer, publicaOtro: Buffer): Buffer {
  if (privada.length !== 32 || publicaOtro.length !== 32) throw new ErrorCifrado('Clave de cifrado con tamaño incorrecto')
  const s = diffieHellman({ privateKey: objetoPrivada(privada), publicKey: objetoPublica(publicaOtro) })
  // Una clave pública de orden pequeño da un secreto de ceros: la clave del otro no es válida.
  if (timingSafeEqual(s, Buffer.alloc(s.length))) throw new ErrorCifrado('La clave del contacto no es válida')
  return s
}

/** Clave simétrica de una pareja de claves (igual en los dos lados). Las cuentas se ordenan para que no importe quién la calcule. */
export function clavePareja(yo: { usuarioId: string; claveId: string; privada: Buffer }, otro: { usuarioId: string; claveId: string; publica: Buffer }): Buffer {
  if (idDeClave(otro.publica) !== otro.claveId) throw new ErrorCifrado('La clave del contacto no coincide con su id')
  const partes = [`${yo.usuarioId}:${yo.claveId}`, `${otro.usuarioId}:${otro.claveId}`].sort()
  return Buffer.from(hkdfSync('sha256', secreto(yo.privada, otro.publica), SAL_HKDF, `pareja|${partes.join('|')}`, 32))
}

function sellar(clave: Buffer, plano: Buffer, aad: string): { iv: Buffer; cifrado: Buffer } {
  const iv = randomBytes(IV)
  const c = createCipheriv('aes-256-gcm', clave, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const cifrado = Buffer.concat([c.update(plano), c.final(), c.getAuthTag()])
  return { iv, cifrado }
}

function abrir(clave: Buffer, iv: Buffer, cifrado: Buffer, aad: string): Buffer {
  if (iv.length !== IV || cifrado.length < ETIQUETA) throw new ErrorCifrado('Datos cifrados incompletos')
  const d = createDecipheriv('aes-256-gcm', clave, iv)
  d.setAAD(Buffer.from(aad, 'utf8'))
  d.setAuthTag(cifrado.subarray(cifrado.length - ETIQUETA))
  try {
    return Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - ETIQUETA)), d.final()])
  } catch {
    throw new ErrorCifrado('No se pudo descifrar: el contenido fue alterado o no es para esta clave')
  }
}

export interface Sobre {
  /** Clave del emisor y del destinatario. */
  ks: string
  kr: string
  iv: Buffer
  cifrado: Buffer
}

const SOBRE = /^e2e1\.([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/

export const esSobre = (s: unknown): s is string => typeof s === 'string' && s.startsWith(PREFIJO_SOBRE)

export function leerSobre(s: string): Sobre {
  const m = SOBRE.exec(s)
  if (!m) throw new ErrorCifrado('Sobre cifrado mal formado')
  return { ks: m[1], kr: m[2], iv: desdeB64u(m[3]), cifrado: desdeB64u(m[4]) }
}

/** Rellena hasta un múltiplo de 64 bytes (los espacios al final no cambian el JSON) para no delatar la longitud exacta del texto. */
function rellenar(json: string): Buffer {
  const b = Buffer.from(json, 'utf8')
  const total = Math.ceil((b.length + 1) / 64) * 64
  return Buffer.concat([b, Buffer.alloc(total - b.length, 0x20)])
}

export function cerrarSobre(clave: Buffer, ks: string, kr: string, contenido: unknown, aad: string): string {
  const { iv, cifrado } = sellar(clave, rellenar(JSON.stringify(contenido)), `${aad}|${ks}|${kr}`)
  return `${PREFIJO_SOBRE}${ks}.${kr}.${b64u(iv)}.${b64u(cifrado)}`
}

export function abrirSobre(clave: Buffer, s: Sobre, aad: string): unknown {
  const plano = abrir(clave, s.iv, s.cifrado, `${aad}|${s.ks}|${s.kr}`)
  try {
    return JSON.parse(plano.toString('utf8'))
  } catch {
    throw new ErrorCifrado('El contenido descifrado no es válido')
  }
}

/** Datos asociados de un mensaje: si el servidor cambia cualquiera de estos campos, el mensaje no se abre. */
export const aadMensaje = (m: { conversacionId: string; emisorId: string; clienteId: string; tipo: string }): string => `msg|${m.conversacionId}|${m.emisorId}|${m.clienteId}|${m.tipo}`
export const aadSenal = (llamadaId: string, emisorId: string): string => `senal|${llamadaId}|${emisorId}`

// ---------------------------------------------------------------- archivos

/** Cifra un archivo con una clave propia (que viaja dentro del mensaje cifrado). Resultado: iv ‖ cifrado ‖ etiqueta. */
export function cifrarArchivo(datos: Uint8Array, conversacionId: string): { blob: Buffer; clave: Buffer } {
  const clave = randomBytes(32)
  const { iv, cifrado } = sellar(clave, Buffer.from(datos), `archivo|${conversacionId}`)
  return { blob: Buffer.concat([iv, cifrado]), clave }
}

export function descifrarArchivo(blob: Uint8Array, clave: Buffer, conversacionId: string): Buffer {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  if (b.length < IV + ETIQUETA) throw new ErrorCifrado('El archivo cifrado está incompleto')
  return abrir(clave, b.subarray(0, IV), b.subarray(IV), `archivo|${conversacionId}`)
}

// ---------------------------------------------------------------- respaldo con frase

/** Motivo por el que una frase no sirve, o `null` si vale. */
export function problemaFrase(frase: string): string | null {
  const f = frase.normalize('NFKC')
  if ([...f].length < FRASE_MIN) return `La frase de seguridad debe tener al menos ${FRASE_MIN} caracteres`
  if (f.length > 200) return 'La frase de seguridad es demasiado larga'
  if (new Set(f.toLowerCase()).size < 5) return 'La frase de seguridad es demasiado simple'
  return null
}

function derivar(frase: string, sal: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN
  return new Promise((ok, mal) => scrypt(Buffer.from(frase.normalize('NFKC'), 'utf8'), sal, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (e, k) => (e ? mal(e) : ok(k))))
}

const aadRespaldo = (usuarioId: string, claveId: string): string => `respaldo|${usuarioId}|${claveId}`

/** `r1.<log2 N>.<r>.<p>.<sal>.<iv>.<cifrado>`: la privada cifrada con la frase (el servidor lo guarda sin poder abrirlo). */
export async function envolverPrivada(privada: Buffer, frase: string, usuarioId: string, claveId: string): Promise<string> {
  const problema = problemaFrase(frase)
  if (problema) throw new ErrorCifrado(problema)
  const sal = randomBytes(16)
  const k = await derivar(frase, sal, SCRYPT.logN, SCRYPT.r, SCRYPT.p)
  const { iv, cifrado } = sellar(k, privada, aadRespaldo(usuarioId, claveId))
  return `r1.${SCRYPT.logN}.${SCRYPT.r}.${SCRYPT.p}.${b64u(sal)}.${b64u(iv)}.${b64u(cifrado)}`
}

export async function desenvolverPrivada(respaldo: string, frase: string, usuarioId: string, claveId: string): Promise<Buffer> {
  const m = /^r1\.(\d{2})\.(\d{1,2})\.(\d)\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(respaldo)
  if (!m) throw new ErrorCifrado('El respaldo de la clave no es válido')
  const [logN, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Parámetros acotados: un respaldo manipulado no puede pedir memoria o tiempo sin límite.
  if (logN < 14 || logN > 20 || r < 1 || r > 16 || p < 1 || p > 4) throw new ErrorCifrado('El respaldo de la clave no es válido')
  const k = await derivar(frase, desdeB64u(m[4]), logN, r, p)
  try {
    return abrir(k, desdeB64u(m[5]), desdeB64u(m[6]), aadRespaldo(usuarioId, claveId))
  } catch {
    throw new ErrorCifrado('La frase de seguridad no es correcta')
  }
}

// ---------------------------------------------------------------- número de seguridad

function huellaCuenta(usuarioId: string, publica: Buffer): string {
  let h = createHash('sha512').update(Buffer.from([0, 0])).update(publica).update(usuarioId, 'utf8').digest()
  for (let i = 0; i < 5200; i++) h = createHash('sha512').update(h).update(publica).digest()
  let s = ''
  for (let i = 0; i < 30; i += 5) s += String(h.readUIntBE(i, 5) % 100000).padStart(5, '0')
  return s
}

/** 60 cifras iguales en los dos equipos si cada uno tiene la clave verdadera del otro. */
export function numeroSeguridad(a: { usuarioId: string; publica: Buffer }, b: { usuarioId: string; publica: Buffer }): string {
  const [x, y] = [a, b].sort((p, q) => p.usuarioId.localeCompare(q.usuarioId))
  return huellaCuenta(x.usuarioId, x.publica) + huellaCuenta(y.usuarioId, y.publica)
}
