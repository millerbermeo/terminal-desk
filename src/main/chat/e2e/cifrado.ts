import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AdjuntoChat, CifradoContacto, ConversacionChat, EstadoCifrado, MensajeChat, PerfilChat, TipoMensaje } from '@shared/chat'
import { vistaPrevia } from '@shared/chat'
import type { Cifrador } from '../../github/token'
import { ErrorServidor, type ClienteServidor } from '../../servidor/cliente'
import {
  aadMensaje,
  aadSenal,
  abrirSobre,
  cerrarSobre,
  clavePareja,
  cifrarArchivo,
  descifrarArchivo,
  desenvolverPrivada,
  envolverPrivada,
  ErrorCifrado,
  esSobre,
  generarIdentidad,
  idDeClave,
  leerSobre,
  numeroSeguridad,
  problemaFrase,
  publicaDe,
  type Identidad
} from './cripto'
import { detectarTipo } from './tipo'

type Cliente = Pick<ClienteServidor, 'get' | 'post' | 'put'>

export interface DepsCifrado {
  servidor: Cliente
  /** Archivo local con las claves privadas (cifradas con el llavero del sistema) y las claves fijadas de los contactos. */
  archivo: string
  cifrador: Cifrador
  /** Avisa a la interfaz de que el estado de las claves cambió. */
  alCambio(): void
}

/** Contenido de un mensaje dentro del sobre. `a`: datos reales del adjunto (el servidor solo tiene bytes opacos). */
interface Contenido {
  v: 1
  t: string
  a?: { id: string; k: string; n: string; m: string; s: number; d?: number }
}

interface Confianza {
  /** Claves del contacto aceptadas en este equipo (la primera se fija sola; las siguientes, al aceptarlas). */
  aceptadas: string[]
  /** Clave cuyo número de seguridad se comprobó. */
  verificada: string | null
}

interface DatosCuenta {
  /** `cifrador.cifrar(JSON {actual, privadas: {claveId: base64}})`. Sin llavero seguro no se guarda (solo en memoria). */
  claves?: string
  confianza: Record<string, Confianza>
}

interface Archivo {
  v: 1
  cuentas: Record<string, DatosCuenta>
}

interface ClaveServidor {
  claveId: string
  publica: string
  creada: string
  revocada: string | null
}

interface AdjuntoAbierto {
  clave: Buffer
  conversacionId: string
  mime: string
  nombre: string
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i
const limpiarNombre = (n: unknown): string =>
  (typeof n === 'string' ? n : '')
    .replace(/[\\/]+/g, '_')
    // eslint-disable-next-line no-control-regex -- el nombre viene del otro equipo: fuera caracteres de control
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .trim()
    .slice(-200) || 'archivo'

/** El tipo del mensaje tiene que encajar con lo que dice ser el archivo; si no, se trata como archivo a descargar. */
function tipoCoherente(tipo: TipoMensaje, mime: string): TipoMensaje {
  if (tipo === 'image') return /^image\/(png|jpeg|gif|webp)$/.test(mime) ? 'image' : 'file'
  if (tipo === 'audio') return mime.startsWith('audio/') ? 'audio' : 'file'
  if (tipo === 'video') return mime.startsWith('video/') ? 'video' : 'file'
  return tipo
}

/**
 * Cifrado de extremo a extremo del chat en este equipo. Lo usa `ServicioChat` para cerrar y abrir sobres; nada de esto sale de main.
 *
 * - Claves propias: se crean aquí; la privada se guarda con `safeStorage` y su respaldo, cifrado con la frase del usuario, en el servidor
 *   (para abrirla en otros equipos). Sin frase no se abre: el servidor no la conoce.
 * - Claves de los contactos: se piden al servidor y se comprueba que el id sea el hash de la clave. La primera se fija (TOFU); si
 *   después cambia, no se envía nada ni se acepta una llamada hasta que el usuario acepte la nueva (avisando de comparar el número
 *   de seguridad).
 */
export class CifradoChat {
  private yo?: string
  private propia?: Identidad
  /** Privadas anteriores de la cuenta guardadas en este equipo (para leer el historial cifrado con ellas). */
  private viejas = new Map<string, Buffer>()
  private datos?: Archivo
  private escritura: Promise<void> = Promise.resolve()
  private readonly publicas = new Map<string, Promise<Buffer | null>>()
  /** Clave vigente de cada contacto; caduca a los 5 min por si se perdió el aviso `claves.cambio` (sin clave no se guarda). */
  private readonly vigentes = new Map<string, { p: Promise<ClaveServidor | null>; hasta: number }>()
  private readonly parejas = new Map<string, Buffer>()
  private readonly adjuntos = new Map<string, AdjuntoAbierto>()
  private readonly otros = new Map<string, string>()
  private readonly llamadas = new Map<string, string>()
  private estadoCache?: Promise<EstadoCifrado>

  constructor(private readonly deps: DepsCifrado) {}

  /** Al cerrar sesión: fuera de memoria todo lo de la cuenta (las claves siguen cifradas en disco para la próxima vez). */
  olvidar(): void {
    this.yo = undefined
    this.propia = undefined
    this.viejas.clear()
    this.publicas.clear()
    this.vigentes.clear()
    this.parejas.clear()
    this.adjuntos.clear()
    this.otros.clear()
    this.llamadas.clear()
    this.estadoCache = undefined
  }

  // ---------------------------------------------------------------- disco

  private async leer(): Promise<Archivo> {
    if (this.datos) return this.datos
    try {
      const d = JSON.parse(await readFile(this.deps.archivo, 'utf8')) as Archivo
      this.datos = d?.v === 1 && d.cuentas && typeof d.cuentas === 'object' ? d : { v: 1, cuentas: {} }
    } catch {
      this.datos = { v: 1, cuentas: {} }
    }
    return this.datos
  }

  private async cuenta(): Promise<DatosCuenta> {
    const d = await this.leer()
    const yo = await this.miId()
    return (d.cuentas[yo] ??= { confianza: {} })
  }

  private guardar(): Promise<void> {
    this.escritura = this.escritura.then(async () => {
      const ruta = this.deps.archivo
      await mkdir(dirname(ruta), { recursive: true })
      const tmp = `${ruta}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(this.datos ?? { v: 1, cuentas: {} }), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, ruta)
    })
    return this.escritura.catch(() => undefined)
  }

  private async guardarPrivadas(): Promise<void> {
    const c = await this.cuenta()
    if (!this.deps.cifrador.disponible() || !this.propia) {
      // Sin llavero seguro la privada no toca el disco: se pedirá la frase en cada arranque.
      delete c.claves
    } else {
      const privadas: Record<string, string> = {}
      for (const [id, p] of this.viejas) privadas[id] = p.toString('base64')
      privadas[this.propia.claveId] = this.propia.privada.toString('base64')
      c.claves = this.deps.cifrador.cifrar(JSON.stringify({ actual: this.propia.claveId, privadas }))
    }
    await this.guardar()
  }

  /** Lo guardado en este equipo (si el llavero puede abrirlo). */
  private async privadasLocales(): Promise<{ actual?: string; privadas: Map<string, Buffer> }> {
    const c = await this.cuenta()
    const privadas = new Map<string, Buffer>()
    if (!c.claves || !this.deps.cifrador.disponible()) return { privadas }
    try {
      const j = JSON.parse(this.deps.cifrador.descifrar(c.claves)) as { actual?: string; privadas?: Record<string, string> }
      for (const [id, b] of Object.entries(j.privadas ?? {})) {
        const p = Buffer.from(b, 'base64')
        // Solo se acepta lo que cuadra: el id tiene que salir de la pública de esa privada.
        if (p.length === 32 && idDeClave(publicaDe(p)) === id) privadas.set(id, p)
      }
      return { actual: j.actual, privadas }
    } catch {
      return { privadas }
    }
  }

  // ---------------------------------------------------------------- cuenta propia

  private async miId(): Promise<string> {
    if (!this.yo) this.yo = (await this.deps.servidor.get<PerfilChat>('/chat/yo')).id
    return this.yo
  }

  estado(): Promise<EstadoCifrado> {
    this.estadoCache ??= this.calcularEstado().catch((err) => {
      this.estadoCache = undefined
      throw err
    })
    return this.estadoCache
  }

  private async calcularEstado(): Promise<EstadoCifrado> {
    const llaveroSeguro = this.deps.cifrador.disponible()
    const { clave } = await this.deps.servidor.get<{ clave: (ClaveServidor & { respaldo: string }) | null }>('/chat/claves/yo')
    if (!clave) return { estado: 'sin-claves', llaveroSeguro }
    if (this.propia?.claveId === clave.claveId) return { estado: 'listo', claveId: clave.claveId, llaveroSeguro }
    const locales = await this.privadasLocales()
    const p = locales.privadas.get(clave.claveId)
    if (p && Buffer.from(clave.publica, 'base64').equals(publicaDe(p))) {
      this.propia = { claveId: clave.claveId, publica: publicaDe(p), privada: p }
      this.viejas = new Map([...locales.privadas].filter(([id]) => id !== clave.claveId))
      return { estado: 'listo', claveId: clave.claveId, llaveroSeguro }
    }
    // La clave de la cuenta ya no es la que tenía este equipo (se cambió en otro): hay que abrir la nueva con la frase.
    const cambio = !!this.propia || (!!locales.actual && locales.actual !== clave.claveId)
    if (this.propia) this.viejas.set(this.propia.claveId, this.propia.privada)
    this.propia = undefined
    return { estado: 'bloqueado', llaveroSeguro, ...(cambio ? { cambioEnOtroEquipo: true } : {}) }
  }

  private cambio(): void {
    this.estadoCache = undefined
    this.parejas.clear()
    this.deps.alCambio()
  }

  async crear(frase: string, reemplazar = false): Promise<EstadoCifrado> {
    const problema = problemaFrase(String(frase ?? ''))
    if (problema) throw new ErrorServidor(problema)
    const yo = await this.miId()
    const id = generarIdentidad()
    const respaldo = await envolverPrivada(id.privada, frase, yo, id.claveId)
    const r = await this.deps.servidor.post<ClaveServidor>('/chat/claves/yo', { publica: id.publica.toString('base64'), respaldo, ...(reemplazar ? { reemplazar: true } : {}) })
    if (r.claveId !== id.claveId) throw new ErrorServidor('El servidor devolvió otra clave')
    if (this.propia) this.viejas.set(this.propia.claveId, this.propia.privada)
    this.propia = id
    await this.guardarPrivadas()
    this.cambio()
    return this.estado()
  }

  async desbloquear(frase: string): Promise<EstadoCifrado> {
    const yo = await this.miId()
    const { clave } = await this.deps.servidor.get<{ clave: (ClaveServidor & { respaldo: string }) | null }>('/chat/claves/yo')
    if (!clave) throw new ErrorServidor('Tu cuenta aún no tiene claves de cifrado')
    let privada: Buffer
    try {
      privada = await desenvolverPrivada(clave.respaldo, String(frase ?? ''), yo, clave.claveId)
    } catch (err) {
      throw new ErrorServidor((err as Error).message)
    }
    const publica = publicaDe(privada)
    // El respaldo tiene que ser de la clave publicada (si no, el servidor estaría mezclando claves).
    if (!publica.equals(Buffer.from(clave.publica, 'base64')) || idDeClave(publica) !== clave.claveId) throw new ErrorServidor('El respaldo no corresponde a tu clave publicada')
    const locales = await this.privadasLocales()
    for (const [k, v] of locales.privadas) if (k !== clave.claveId) this.viejas.set(k, v)
    this.propia = { claveId: clave.claveId, publica, privada }
    await this.guardarPrivadas()
    this.cambio()
    return this.estado()
  }

  restablecer(frase: string): Promise<EstadoCifrado> {
    return this.crear(frase, true)
  }

  async cambiarFrase(frase: string): Promise<void> {
    const problema = problemaFrase(String(frase ?? ''))
    if (problema) throw new ErrorServidor(problema)
    await this.preparar()
    const p = this.exigirPropia()
    const respaldo = await envolverPrivada(p.privada, frase, await this.miId(), p.claveId)
    await this.deps.servidor.put('/chat/claves/yo/respaldo', { claveId: p.claveId, respaldo })
  }

  /** Carga (una vez) las claves guardadas en este equipo. Sin servidor no falla: simplemente no habrá clave abierta. */
  private async preparar(): Promise<void> {
    if (!this.propia) await this.estado().catch(() => undefined)
  }

  private exigirPropia(): Identidad {
    if (!this.propia) throw new ErrorServidor('Abre el cifrado del chat con tu frase de seguridad para continuar')
    return this.propia
  }

  private privadaDe(claveId: string): Buffer | undefined {
    return this.propia?.claveId === claveId ? this.propia.privada : this.viejas.get(claveId)
  }

  // ---------------------------------------------------------------- claves de los contactos

  private vigente(usuarioId: string): Promise<ClaveServidor | null> {
    const previa = this.vigentes.get(usuarioId)
    if (previa && previa.hasta > Date.now()) return previa.p
    {
      const p = this.deps.servidor
        .get<{ clave: ClaveServidor | null }>(`/chat/claves/usuarios/${usuarioId}`)
        .then(({ clave }) => {
          if (!clave) {
            this.vigentes.delete(usuarioId)
            return null
          }
          if (idDeClave(Buffer.from(clave.publica, 'base64')) !== clave.claveId) throw new ErrorServidor('El servidor entregó una clave que no coincide con su id')
          this.publicas.set(`${usuarioId}:${clave.claveId}`, Promise.resolve(Buffer.from(clave.publica, 'base64')))
          return clave
        })
        .catch((err) => {
          this.vigentes.delete(usuarioId)
          throw err
        })
      this.vigentes.set(usuarioId, { p, hasta: Date.now() + 5 * 60_000 })
      return p
    }
  }

  /** Pública de una clave concreta de una cuenta (comprobando que corresponde a su id). */
  private publica(usuarioId: string, claveId: string): Promise<Buffer | null> {
    const k = `${usuarioId}:${claveId}`
    let p = this.publicas.get(k)
    if (!p) {
      p = this.deps.servidor
        .get<{ clave: ClaveServidor | null }>(`/chat/claves/usuarios/${usuarioId}?clave=${claveId}`)
        .then(({ clave }) => {
          if (!clave) return null
          const b = Buffer.from(clave.publica, 'base64')
          return idDeClave(b) === claveId ? b : null
        })
        .catch((err) => {
          this.publicas.delete(k)
          throw err
        })
      this.publicas.set(k, p)
    }
    return p
  }

  /** Un contacto (o la cuenta propia) publicó una clave nueva. */
  async clavesCambiaron(usuarioId: string): Promise<void> {
    this.vigentes.delete(usuarioId)
    if (usuarioId === this.yo) this.cambio()
  }

  async contacto(usuarioId: string): Promise<CifradoContacto> {
    await this.preparar()
    const vig = await this.vigente(usuarioId)
    if (!vig) return { estado: 'sin-claves' }
    const c = await this.cuenta()
    let conf = c.confianza[usuarioId]
    if (!conf) {
      // Primera vez que este equipo ve a este contacto: se fija su clave.
      conf = c.confianza[usuarioId] = { aceptadas: [vig.claveId], verificada: null }
      await this.guardar()
    }
    const yo = await this.miId()
    const propia = this.propia
    const numero = propia ? numeroSeguridad({ usuarioId: yo, publica: propia.publica }, { usuarioId, publica: Buffer.from(vig.publica, 'base64') }) : undefined
    const estado = !conf.aceptadas.includes(vig.claveId) ? 'nueva' : conf.verificada === vig.claveId ? 'verificada' : 'confiable'
    return { estado, ...(numero ? { numero } : {}) }
  }

  async aceptar(usuarioId: string): Promise<CifradoContacto> {
    const vig = await this.vigente(usuarioId)
    if (!vig) throw new ErrorServidor('Este contacto aún no activó el cifrado')
    const c = await this.cuenta()
    const conf = (c.confianza[usuarioId] ??= { aceptadas: [], verificada: null })
    if (!conf.aceptadas.includes(vig.claveId)) conf.aceptadas.push(vig.claveId)
    conf.verificada = null
    await this.guardar()
    return this.contacto(usuarioId)
  }

  async verificar(usuarioId: string, verificada: boolean): Promise<CifradoContacto> {
    const actual = await this.contacto(usuarioId)
    if (actual.estado === 'sin-claves' || actual.estado === 'nueva') throw new ErrorServidor('Acepta primero la clave del contacto')
    const vig = (await this.vigente(usuarioId))!
    const c = await this.cuenta()
    c.confianza[usuarioId].verificada = verificada ? vig.claveId : null
    await this.guardar()
    return this.contacto(usuarioId)
  }

  private async aceptada(usuarioId: string, claveId: string): Promise<boolean> {
    // Primera vez que se ve al contacto (también al recibir): `contacto()` fija su clave vigente.
    if (!(await this.cuenta()).confianza[usuarioId]) await this.contacto(usuarioId).catch(() => undefined)
    const conf = (await this.cuenta()).confianza[usuarioId]
    return !!conf?.aceptadas.includes(claveId)
  }

  /** La clave del contacto a la que se puede escribir: tiene que existir y estar aceptada en este equipo. */
  private async claveParaEnviar(usuarioId: string): Promise<ClaveServidor> {
    const est = await this.contacto(usuarioId)
    if (est.estado === 'sin-claves') throw new ErrorServidor('Este contacto aún no activó el cifrado de extremo a extremo: tiene que actualizar la app y crear su frase de seguridad.')
    if (est.estado === 'nueva') throw new ErrorServidor('La clave de seguridad de este contacto cambió. Revísala y acéptala antes de seguir.')
    return (await this.vigente(usuarioId))!
  }

  private async pareja(miClave: string, otroId: string, otraClave: string): Promise<Buffer> {
    const k = `${miClave}|${otroId}:${otraClave}`
    const previa = this.parejas.get(k)
    if (previa) return previa
    const privada = this.privadaDe(miClave)
    if (!privada) throw new ErrorCifrado('Este mensaje se cifró con una clave tuya que este equipo no tiene')
    const publica = await this.publica(otroId, otraClave)
    if (!publica) throw new ErrorCifrado('No se encontró la clave con la que se cifró este mensaje')
    const clave = clavePareja({ usuarioId: await this.miId(), claveId: miClave, privada }, { usuarioId: otroId, claveId: otraClave, publica })
    this.parejas.set(k, clave)
    return clave
  }

  // ---------------------------------------------------------------- conversaciones y llamadas

  /** Con quién es cada conversación (lo dice la lista de chats; si no se sabe, se pide). */
  recordarConversaciones(lista: ConversacionChat[]): void {
    for (const c of lista) this.otros.set(c.id, c.otro.id)
  }

  async otroDe(conversacionId: string): Promise<string> {
    const ya = this.otros.get(conversacionId)
    if (ya) return ya
    const { conversaciones } = await this.deps.servidor.get<{ conversaciones: ConversacionChat[] }>('/chat/conversaciones')
    this.recordarConversaciones(conversaciones)
    const otro = this.otros.get(conversacionId)
    if (!otro) throw new ErrorServidor('La conversación no existe')
    return otro
  }

  recordarLlamada(llamadaId: string, otroId: string): void {
    this.llamadas.set(llamadaId, otroId)
    if (this.llamadas.size > 200) this.llamadas.delete(this.llamadas.keys().next().value!)
  }

  /** Antes de llamar: el contacto tiene que tener una clave aceptada (si no, la señalización no se podría cifrar). */
  async exigirContactoSeguro(otroId: string): Promise<void> {
    await this.preparar()
    this.exigirPropia()
    await this.claveParaEnviar(otroId)
  }

  // ---------------------------------------------------------------- mensajes

  async cerrarMensaje(m: { conversacionId: string; clienteId: string; tipo: TipoMensaje; texto: string; adjunto?: { id: string; clave: Buffer; nombre: string; mime: string; tamano: number; duracionMs?: number } }): Promise<string> {
    await this.preparar()
    const propia = this.exigirPropia()
    const otroId = await this.otroDe(m.conversacionId)
    const otra = await this.claveParaEnviar(otroId)
    const yo = await this.miId()
    const clave = await this.pareja(propia.claveId, otroId, otra.claveId)
    const contenido: Contenido = { v: 1, t: m.texto }
    if (m.adjunto) {
      const a = m.adjunto
      contenido.a = { id: a.id, k: a.clave.toString('base64'), n: a.nombre, m: a.mime, s: a.tamano, ...(a.duracionMs !== undefined ? { d: a.duracionMs } : {}) }
      this.adjuntos.set(a.id, { clave: a.clave, conversacionId: m.conversacionId, mime: a.mime, nombre: a.nombre })
    }
    return cerrarSobre(clave, propia.claveId, otra.claveId, contenido, aadMensaje({ conversacionId: m.conversacionId, emisorId: yo, clienteId: m.clienteId, tipo: m.tipo }))
  }

  /** Abre un sobre de mensaje; devuelve el contenido y si la clave del emisor está aceptada en este equipo. */
  private async abrirContenido(m: { conversacionId: string; emisorId: string; clienteId: string; tipo: TipoMensaje; texto: string }): Promise<{ c: Contenido; claveNueva: boolean }> {
    const s = leerSobre(m.texto)
    const yo = await this.miId()
    const mio = m.emisorId === yo
    const otroId = mio ? await this.otroDe(m.conversacionId) : m.emisorId
    const [miClave, otraClave] = mio ? [s.ks, s.kr] : [s.kr, s.ks]
    const clave = await this.pareja(miClave, otroId, otraClave)
    const c = abrirSobre(clave, s, aadMensaje(m)) as Contenido
    if (c?.v !== 1 || typeof c.t !== 'string') throw new ErrorCifrado('El contenido descifrado no es válido')
    // La clave del contacto que aparece en el sobre tiene que estar aceptada, también en los mensajes propios: con una clave suya
    // colada como destinataria, el servidor podría fabricar un mensaje que este equipo abriría como «enviado por mí».
    return { c, claveNueva: !(await this.aceptada(otroId, otraClave)) }
  }

  /** Mensaje del servidor (con el sobre) → mensaje para la interfaz (en claro). Nunca lanza: lo que no se abre se marca. */
  async abrirMensaje(m: MensajeChat): Promise<MensajeChat> {
    await this.preparar()
    const respondeA = m.respondeA ? await this.abrirCita(m.conversacionId, m.respondeA) : null
    if (m.eliminado || m.tipo === 'call') return { ...m, respondeA }
    if (!esSobre(m.texto)) return { ...m, respondeA, cifrado: 'no' }
    if (!this.propia) return { ...m, respondeA, tipo: 'text', texto: 'Mensaje cifrado. Abre el cifrado del chat con tu frase para leerlo.', adjunto: null, cifrado: 'bloqueado' }
    try {
      const { c, claveNueva } = await this.abrirContenido(m)
      let adjunto: AdjuntoChat | null = null
      let tipo: TipoMensaje = m.tipo
      if (m.adjunto) {
        const a = c.a
        // El sobre tiene que hablar de este adjunto (el servidor no puede cambiar un archivo por otro).
        if (!a || a.id !== m.adjunto.id || typeof a.k !== 'string') throw new ErrorCifrado('El archivo no corresponde al mensaje')
        const clave = Buffer.from(a.k, 'base64')
        if (clave.length !== 32) throw new ErrorCifrado('La clave del archivo no es válida')
        const mime = typeof a.m === 'string' && MIME.test(a.m) ? a.m.toLowerCase() : 'application/octet-stream'
        const nombre = limpiarNombre(a.n)
        this.adjuntos.set(a.id, { clave, conversacionId: m.conversacionId, mime, nombre })
        adjunto = { id: a.id, nombre, mime, tamano: Number.isFinite(a.s) ? Number(a.s) : m.adjunto.tamano, duracionMs: Number.isFinite(a.d) ? Number(a.d) : null }
        tipo = tipoCoherente(m.tipo, mime)
      }
      return { ...m, tipo, texto: c.t, adjunto, respondeA, cifrado: claveNueva ? 'clave-nueva' : 'si' }
    } catch {
      return { ...m, respondeA, tipo: 'text', texto: 'No se pudo descifrar este mensaje.', adjunto: null, cifrado: 'error' }
    }
  }

  private async abrirCita(conversacionId: string, r: NonNullable<MensajeChat['respondeA']>): Promise<MensajeChat['respondeA']> {
    if (r.eliminado || !esSobre(r.texto)) return r
    if (!this.propia || !r.clienteId) return { ...r, texto: '🔒 Mensaje cifrado' }
    try {
      const { c } = await this.abrirContenido({ conversacionId, emisorId: r.emisorId, clienteId: r.clienteId, tipo: r.tipo, texto: r.texto })
      return { ...r, texto: vistaPrevia({ tipo: r.tipo, texto: c.t, eliminado: false }) }
    } catch {
      return { ...r, texto: '🔒 No se pudo descifrar' }
    }
  }

  /** Lista de chats: la vista previa del último mensaje también viene en un sobre. */
  async abrirConversaciones(lista: ConversacionChat[]): Promise<ConversacionChat[]> {
    await this.preparar()
    this.recordarConversaciones(lista)
    return Promise.all(
      lista.map(async (c) => {
        const u = c.ultimo
        if (!u || !esSobre(u.texto)) return c
        if (!this.propia || !u.clienteId) return { ...c, ultimo: { ...u, texto: '🔒 Mensaje cifrado' } }
        try {
          const { c: cont } = await this.abrirContenido({ conversacionId: c.id, emisorId: u.emisorId, clienteId: u.clienteId, tipo: u.tipo, texto: u.texto })
          return { ...c, ultimo: { ...u, texto: vistaPrevia({ tipo: u.tipo, texto: cont.t, eliminado: false }) } }
        } catch {
          return { ...c, ultimo: { ...u, texto: '🔒 No se pudo descifrar' } }
        }
      })
    )
  }

  // ---------------------------------------------------------------- archivos

  async cifrarArchivo(datos: Uint8Array, conversacionId: string): Promise<{ blob: Buffer; clave: Buffer }> {
    await this.preparar()
    this.exigirPropia()
    return cifrarArchivo(datos, conversacionId)
  }

  /** Bytes cifrados del servidor → archivo en claro, con el tipo comprobado por sus bytes (no por lo que dijo el emisor). */
  abrirArchivo(adjuntoId: string, blob: Uint8Array): { datos: Uint8Array; mime: string; nombre: string } | null {
    const a = this.adjuntos.get(adjuntoId)
    if (!a) return null
    const datos = descifrarArchivo(blob, a.clave, a.conversacionId)
    const det = detectarTipo(datos, a.mime)
    // Solo se muestra como imagen/audio/video si los bytes lo confirman; si no, se trata como archivo neutro.
    return { datos: new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength), mime: det.seguro ? det.mime : 'application/octet-stream', nombre: a.nombre }
  }

  /** ¿Este adjunto es de un mensaje cifrado (y se tiene su clave)? */
  esAdjuntoCifrado(adjuntoId: string): boolean {
    return this.adjuntos.has(adjuntoId)
  }

  // ---------------------------------------------------------------- señalización de llamadas

  /**
   * La oferta/respuesta SDP lleva las huellas DTLS que protegen el audio y el video. Cifrándola con la clave de la pareja, el servidor
   * no puede cambiarlas para meterse en medio: la llamada queda cifrada de extremo a extremo.
   */
  async cerrarSenal(llamadaId: string, datos: unknown): Promise<{ e2e: string }> {
    const otroId = this.llamadas.get(llamadaId)
    if (!otroId) throw new ErrorServidor('Llamada desconocida')
    await this.preparar()
    const propia = this.exigirPropia()
    const otra = await this.claveParaEnviar(otroId)
    const clave = await this.pareja(propia.claveId, otroId, otra.claveId)
    return { e2e: cerrarSobre(clave, propia.claveId, otra.claveId, datos, aadSenal(llamadaId, await this.miId())) }
  }

  /** Abre una señal del otro extremo. Lanza si no viene cifrada con una clave aceptada del contacto de esa llamada. */
  async abrirSenal(llamadaId: string, datos: unknown): Promise<unknown> {
    const otroId = this.llamadas.get(llamadaId)
    if (!otroId) throw new ErrorCifrado('Llamada desconocida')
    const sobre = (datos as { e2e?: unknown } | null)?.e2e
    if (!esSobre(sobre)) throw new ErrorCifrado('Señal de llamada sin cifrar')
    await this.preparar()
    const s = leerSobre(sobre)
    if (!(await this.aceptada(otroId, s.ks))) throw new ErrorCifrado('La clave del contacto no está aceptada')
    const clave = await this.pareja(s.kr, otroId, s.ks)
    return abrirSobre(clave, s, aadSenal(llamadaId, otroId))
  }
}
