/* eslint-disable @typescript-eslint/no-explicit-any -- servidor falso: respuestas y cuerpos sin tipar, como los de fetch */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { EventoChat, MensajeChat } from '@shared/chat'
import { ErrorServidor } from '../src/main/servidor/cliente'
import { CifradoChat } from '../src/main/chat/e2e/cifrado'
import { generarIdentidad, idDeClave } from '../src/main/chat/e2e/cripto'
import { ServicioChat } from '../src/main/chat/servicio'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CONV = '33333333-3333-4333-8333-333333333333'
const FRASE_A = 'frase de seguridad de ana'
const FRASE_B = 'la frase secreta de beto'
// PNG mínimo (1×1).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const carpeta = mkdtempSync(join(tmpdir(), 'chat-e2e-'))
afterAll(() => rmSync(carpeta, { recursive: true, force: true }))

/** Llavero falso (en las pruebas no hay safeStorage). */
const cifrador = { disponible: () => true, cifrar: (t: string) => Buffer.from(t).toString('base64'), descifrar: (c: string) => Buffer.from(c, 'base64').toString() }

interface Clave {
  claveId: string
  publica: string
  respaldo: string
  creada: string
  revocada: string | null
}

/** Servidor en memoria que hace lo mismo que el real… y deja manipular lo guardado para simular un servidor malicioso. */
class Servidor {
  claves: Record<string, Clave[]> = { [A]: [], [B]: [] }
  mensajes: MensajeChat[] = []
  archivos = new Map<string, Uint8Array>()
  private n = 0

  cliente(yo: string) {
    const otro = yo === A ? B : A
    const vigente = (u: string) => this.claves[u].find((k) => !k.revocada) ?? null
    const publica = (k: Clave | null | undefined) => (k ? { claveId: k.claveId, publica: k.publica, creada: k.creada, revocada: k.revocada } : null)
    return {
      get: async (ruta: string): Promise<any> => {
        const u = new URL(ruta, 'http://x')
        if (u.pathname === '/chat/yo') return { id: yo }
        if (u.pathname === '/chat/claves/yo') return { clave: vigente(yo) }
        const m = /^\/chat\/claves\/usuarios\/(.+)$/.exec(u.pathname)
        if (m) {
          const clave = u.searchParams.get('clave')
          return { clave: publica(clave ? this.claves[m[1]].find((k) => k.claveId === clave) : vigente(m[1])) }
        }
        if (u.pathname === '/chat/conversaciones') {
          const ult = this.mensajes.at(-1)
          return { conversaciones: [{ id: CONV, otro: { id: otro, email: '', nombre: otro }, ultimo: ult ? { id: ult.id, emisorId: ult.emisorId, tipo: ult.tipo, texto: ult.texto, seq: ult.seq, creado: ult.creado, clienteId: ult.clienteId } : null }] }
        }
        if (u.pathname === `/chat/conversaciones/${CONV}/mensajes`) return { mensajes: structuredClone(this.mensajes), hayMas: false, ultimoSeq: this.n, leidoPorOtro: 0, entregadoAlOtro: 0 }
        throw new Error(`GET ${ruta}`)
      },
      post: async (ruta: string, cuerpo: any): Promise<any> => {
        if (ruta === '/chat/claves/yo') {
          const actual = vigente(yo)
          if (actual && !cuerpo.reemplazar) throw new ErrorServidor('Ya tienes una clave', 409)
          if (actual) actual.revocada = new Date().toISOString()
          const k: Clave = { claveId: idDeClave(Buffer.from(cuerpo.publica, 'base64')), publica: cuerpo.publica, respaldo: cuerpo.respaldo, creada: new Date().toISOString(), revocada: null }
          this.claves[yo].push(k)
          return publica(k)
        }
        if (ruta === `/chat/conversaciones/${CONV}/mensajes`) {
          const seq = ++this.n
          const m: MensajeChat = {
            id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
            conversacionId: CONV,
            seq,
            emisorId: yo,
            tipo: cuerpo.tipo,
            texto: cuerpo.texto,
            adjunto: cuerpo.adjuntoId ? { id: cuerpo.adjuntoId, nombre: 'cifrado', mime: 'application/octet-stream', tamano: this.archivos.get(cuerpo.adjuntoId)!.byteLength, duracionMs: null } : null,
            respondeA: null,
            reacciones: [],
            meta: {},
            creado: new Date().toISOString(),
            editado: null,
            eliminado: false,
            clienteId: cuerpo.clienteId
          }
          this.mensajes.push(m)
          return structuredClone(m)
        }
        throw new Error(`POST ${ruta}`)
      },
      put: async (ruta: string, cuerpo: any): Promise<any> => {
        if (ruta === '/chat/claves/yo/respaldo') {
          vigente(yo)!.respaldo = cuerpo.respaldo
          return undefined
        }
        throw new Error(`PUT ${ruta}`)
      },
      delete: async () => undefined,
      binario: async (_ruta: string, datos: Uint8Array) => {
        const id = `44444444-4444-4444-8444-${String(this.archivos.size + 1).padStart(12, '0')}`
        this.archivos.set(id, new Uint8Array(datos))
        return { id, nombre: 'cifrado', mime: 'application/octet-stream', tamano: datos.byteLength, duracionMs: null }
      },
      descargar: async (ruta: string) => ({ datos: this.archivos.get(ruta.split('/').pop()!)!, tipo: 'application/octet-stream' })
    }
  }
}

function equipo(srv: Servidor, yo: string, nombre: string) {
  const enviadas: any[] = []
  const cliente = srv.cliente(yo)
  const cifrado = new CifradoChat({ servidor: cliente as never, archivo: join(carpeta, `${nombre}.json`), cifrador, alCambio: () => undefined })
  const svc = new ServicioChat(cliente as never, { conexion: { conexion: 'conectado', enviar: (o) => (enviadas.push(o), true) }, cifrado, guardarArchivo: async () => true })
  /** Pasa un evento del servidor por el servicio y devuelve lo que vería la interfaz. */
  const recibir = (e: EventoChat) => new Promise<EventoChat>((ok) => svc.recibirEvento(e, ok))
  return { svc, op: svc.operaciones, enviadas, recibir, cifrado }
}

const srv = new Servidor()
const ana = equipo(srv, A, 'ana')
const beto = equipo(srv, B, 'beto')

describe('chat cifrado de extremo a extremo (dos cuentas reales, servidor falso)', () => {
  it('sin claves no se puede escribir; al crearlas, el servidor solo guarda la pública y un respaldo opaco', async () => {
    expect(await ana.op.cifrado({})).toMatchObject({ estado: 'sin-claves' })
    await expect(ana.op.enviarTexto({ conversacionId: CONV, texto: 'hola', clienteId: 'cliente-0' })).rejects.toThrow('frase')
    await expect(ana.op.cifradoCrear({ frase: 'corta' })).rejects.toThrow('al menos')
    expect(await ana.op.cifradoCrear({ frase: FRASE_A })).toMatchObject({ estado: 'listo' })
    expect(srv.claves[A][0].respaldo).toMatch(/^r1\./)
    expect(srv.claves[A][0].respaldo).not.toContain(FRASE_A)
    // Beto aún no tiene claves: no se le puede escribir.
    await expect(ana.op.enviarTexto({ conversacionId: CONV, texto: 'hola', clienteId: 'cliente-0' })).rejects.toThrow('aún no activó')
    expect(await beto.op.cifradoCrear({ frase: FRASE_B })).toMatchObject({ estado: 'listo' })
  }, 20_000)

  it('el texto viaja y se guarda cifrado; el otro lo lee en claro', async () => {
    const enviado = await ana.op.enviarTexto({ conversacionId: CONV, texto: 'hola Beto, ¿qué tal? 👋', clienteId: 'cliente-1' })
    expect(enviado).toMatchObject({ texto: 'hola Beto, ¿qué tal? 👋', cifrado: 'si' })
    const guardado = srv.mensajes[0].texto
    expect(guardado).toMatch(/^e2e1\./)
    expect(guardado).not.toContain('hola')
    const p = await beto.op.mensajes({ conversacionId: CONV })
    expect(p.mensajes[0]).toMatchObject({ texto: 'hola Beto, ¿qué tal? 👋', cifrado: 'si', emisorId: A })
    // Por el WebSocket también llega descifrado, y la lista de chats muestra la vista previa en claro.
    const e = await beto.recibir({ t: 'mensaje.nuevo', mensaje: structuredClone(srv.mensajes[0]) })
    expect(e).toMatchObject({ t: 'mensaje.nuevo', mensaje: { texto: 'hola Beto, ¿qué tal? 👋' } })
    expect((await beto.op.conversaciones({})).conversaciones[0].ultimo?.texto).toBe('hola Beto, ¿qué tal? 👋')
    // La búsqueda es local (el servidor no puede buscar en lo cifrado).
    expect((await beto.op.buscar({ q: 'que tal' })).resultados.map((r) => r.texto)).toEqual(['hola Beto, ¿qué tal? 👋'])
  })

  it('los números de seguridad coinciden en los dos equipos', async () => {
    const a = await ana.op.cifradoContacto({ usuarioId: B })
    const b = await beto.op.cifradoContacto({ usuarioId: A })
    expect(a.estado).toBe('confiable')
    expect(a.numero).toMatch(/^\d{60}$/)
    expect(a.numero).toBe(b.numero)
    expect(await ana.op.cifradoVerificar({ usuarioId: B, verificada: true })).toMatchObject({ estado: 'verificada' })
  })

  it('archivos: al servidor llegan bytes opacos; el otro recibe el archivo, su nombre y su tipo comprobado', async () => {
    const m = await ana.op.enviarArchivo({ conversacionId: CONV, tipo: 'image', nombre: 'foto privada.png', mime: 'image/png', datos: new Uint8Array(PNG), texto: 'mira', clienteId: 'cliente-2' })
    expect(m).toMatchObject({ tipo: 'image', texto: 'mira', adjunto: { nombre: 'foto privada.png', mime: 'image/png' } })
    const blob = srv.archivos.get(m.adjunto!.id)!
    expect(Buffer.from(blob).includes(PNG.subarray(0, 8))).toBe(false)
    const p = await beto.op.mensajes({ conversacionId: CONV })
    const visto = p.mensajes.find((x) => x.clienteId === 'cliente-2')!
    expect(visto).toMatchObject({ tipo: 'image', texto: 'mira', adjunto: { nombre: 'foto privada.png', mime: 'image/png' } })
    const d = await beto.op.descargar({ adjuntoId: visto.adjunto!.id })
    expect(Buffer.from(d.datos).equals(PNG)).toBe(true)
    expect(d.mime).toBe('image/png')
  })

  it('un servidor que cambia el emisor, el tipo o el contenido de un mensaje queda en evidencia', async () => {
    const original = srv.mensajes[0]
    const comoBeto = await ana.op.mensajes({ conversacionId: CONV }).then(() => ana.cifrado.abrirMensaje({ ...structuredClone(original), emisorId: B }))
    expect(comoBeto.cifrado).toBe('error')
    expect((await beto.cifrado.abrirMensaje({ ...structuredClone(original), tipo: 'file' })).cifrado).toBe('error')
    expect((await beto.cifrado.abrirMensaje({ ...structuredClone(original), clienteId: 'otro-id' })).cifrado).toBe('error')
    const roto = original.texto.slice(0, -4) + (original.texto.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect((await beto.cifrado.abrirMensaje({ ...structuredClone(original), texto: roto })).cifrado).toBe('error')
  })

  it('un mensaje «mío» fabricado por el servidor con una clave suya como destinataria no pasa por legítimo', async () => {
    const { clavePareja, cerrarSobre, aadMensaje } = await import('../src/main/chat/e2e/cripto')
    const falsa = generarIdentidad()
    const miPublica = Buffer.from(srv.claves[A].find((k) => !k.revocada)!.publica, 'base64')
    const miId = srv.claves[A].find((k) => !k.revocada)!.claveId
    // El servidor conoce su privada y la pública de Ana: puede calcular la clave de esa «pareja».
    srv.claves[B].push({ claveId: falsa.claveId, publica: falsa.publica.toString('base64'), respaldo: 'x', creada: '', revocada: new Date().toISOString() })
    const k = clavePareja({ usuarioId: B, claveId: falsa.claveId, privada: falsa.privada }, { usuarioId: A, claveId: miId, publica: miPublica })
    const texto = cerrarSobre(k, miId, falsa.claveId, { v: 1, t: 'transfiere el dinero' }, aadMensaje({ conversacionId: CONV, emisorId: A, clienteId: 'falso-1', tipo: 'text' }))
    const m = await ana.cifrado.abrirMensaje({ ...structuredClone(srv.mensajes[0]), id: '00000000-0000-4000-8000-0000000000ff', clienteId: 'falso-1', texto })
    expect(m.cifrado).toBe('clave-nueva')
    srv.claves[B].pop()
  })

  it('si el servidor cuela otra clave para un contacto, no se le envía nada hasta aceptarla', async () => {
    // El servidor sustituye la clave de Beto por una suya (ataque de intermediario).
    const falsa = generarIdentidad()
    srv.claves[B][0].revocada = new Date().toISOString()
    srv.claves[B].push({ claveId: falsa.claveId, publica: falsa.publica.toString('base64'), respaldo: 'x', creada: new Date().toISOString(), revocada: null })
    await ana.cifrado.clavesCambiaron(B)
    expect(await ana.op.cifradoContacto({ usuarioId: B })).toMatchObject({ estado: 'nueva' })
    await expect(ana.op.enviarTexto({ conversacionId: CONV, texto: 'secreto', clienteId: 'cliente-3' })).rejects.toThrow('cambió')
    await expect(ana.op.tiempoReal({ orden: { t: 'llamada.invitar', llamadaId: '55555555-5555-4555-8555-555555555555', usuarioId: B, video: false } })).rejects.toThrow('cambió')
    expect(srv.mensajes.some((m) => m.clienteId === 'cliente-3')).toBe(false)
    // Se deshace el ataque para seguir.
    srv.claves[B].pop()
    srv.claves[B][0].revocada = null
    await ana.cifrado.clavesCambiaron(B)
    expect(await ana.op.cifradoContacto({ usuarioId: B })).toMatchObject({ estado: 'verificada' })
  })

  it('llamadas: la señalización (huellas DTLS incluidas) va cifrada; una señal manipulada corta la llamada', async () => {
    const llamadaId = '66666666-6666-4666-8666-666666666666'
    expect(await ana.op.tiempoReal({ orden: { t: 'llamada.invitar', llamadaId, usuarioId: B, video: true } })).toBe(true)
    const oferta = { tipo: 'oferta', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC\r\n' }
    await ana.op.tiempoReal({ orden: { t: 'llamada.senal', llamadaId, datos: oferta } })
    const salida = ana.enviadas.at(-1)
    expect(JSON.stringify(salida)).not.toContain('fingerprint')
    await beto.recibir({ t: 'llamada.entrante', llamadaId, de: { id: A, email: '', nombre: 'Ana' }, video: true })
    expect(await beto.recibir({ t: 'llamada.senal', llamadaId, datos: salida.datos })).toEqual({ t: 'llamada.senal', llamadaId, datos: oferta })
    // Sin cifrar o alterada: no pasa, y la llamada se corta.
    expect(await beto.recibir({ t: 'llamada.senal', llamadaId, datos: oferta })).toEqual({ t: 'llamada.fin', llamadaId, motivo: 'cifrado' })
    expect(beto.enviadas.at(-1)).toEqual({ t: 'llamada.colgar', llamadaId })
    const alterada = { e2e: salida.datos.e2e.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A')) }
    expect(await beto.recibir({ t: 'llamada.senal', llamadaId, datos: alterada })).toMatchObject({ t: 'llamada.fin', motivo: 'cifrado' })
  })

  it('otro equipo de la misma cuenta abre las claves solo con la frase y lee el historial', async () => {
    const ana2 = equipo(srv, A, 'ana-portatil')
    expect(await ana2.op.cifrado({})).toMatchObject({ estado: 'bloqueado' })
    const bloqueado = await ana2.op.mensajes({ conversacionId: CONV })
    expect(bloqueado.mensajes[0]).toMatchObject({ cifrado: 'bloqueado' })
    expect(bloqueado.mensajes[0].texto).not.toContain('hola')
    await expect(ana2.op.cifradoDesbloquear({ frase: 'no es mi frase de seguridad' })).rejects.toThrow('no es correcta')
    expect(await ana2.op.cifradoDesbloquear({ frase: FRASE_A })).toMatchObject({ estado: 'listo' })
    expect((await ana2.op.mensajes({ conversacionId: CONV })).mensajes[0]).toMatchObject({ texto: 'hola Beto, ¿qué tal? 👋', cifrado: 'si' })
    // Y al reiniciar la app, la clave se recupera del llavero sin volver a pedir la frase.
    const ana3 = equipo(srv, A, 'ana-portatil')
    expect(await ana3.op.cifrado({})).toMatchObject({ estado: 'listo' })
  }, 20_000)

  it('restablecer (frase olvidada): clave nueva, los contactos ven el aviso y el historial viejo sigue legible donde estaba la clave', async () => {
    const antes = srv.claves[B][0].claveId
    await beto.op.cifradoRestablecer({ frase: 'otra frase nueva de beto' })
    expect(srv.claves[B].find((k) => k.claveId === antes)?.revocada).not.toBeNull()
    await ana.cifrado.clavesCambiaron(B)
    expect(await ana.op.cifradoContacto({ usuarioId: B })).toMatchObject({ estado: 'nueva' })
    expect(await ana.op.cifradoAceptarClave({ usuarioId: B })).toMatchObject({ estado: 'confiable' })
    await ana.op.enviarTexto({ conversacionId: CONV, texto: 'con tu clave nueva', clienteId: 'cliente-4' })
    const p = await beto.op.mensajes({ conversacionId: CONV })
    expect(p.mensajes.find((m) => m.clienteId === 'cliente-4')).toMatchObject({ texto: 'con tu clave nueva', cifrado: 'si' })
    // Este equipo de Beto conserva la clave anterior: sigue leyendo lo de antes.
    expect(p.mensajes.find((m) => m.clienteId === 'cliente-1')).toMatchObject({ texto: 'hola Beto, ¿qué tal? 👋' })
  }, 20_000)
})
