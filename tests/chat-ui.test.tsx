import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactoChat, ConversacionChat, EventoChat, MensajeChat } from '../src/shared/chat'

const YO = { id: 'u-yo', email: 'yo@x.com', nombre: 'Yo', nombrePropio: null, mostrarPresencia: true }
const ANA = { id: 'u-ana', email: 'ana@x.com', nombre: 'Ana', enLinea: true }
const hace = (min: number): string => new Date(Date.now() - min * 60_000).toISOString()

const msg = (o: Partial<MensajeChat>): MensajeChat => ({
  id: 'm1', conversacionId: 'c1', seq: 1, emisorId: ANA.id, tipo: 'text', texto: 'hola', adjunto: null, respondeA: null, reacciones: [], meta: {}, creado: hace(10), editado: null, eliminado: false, clienteId: 'cli00001', ...o
})

const conversacion: ConversacionChat = {
  id: 'c1', otro: ANA, ultimo: { id: 'm3', emisorId: ANA.id, tipo: 'text', texto: 'nos vemos', seq: 3, creado: hace(1) }, noLeidos: 2, silenciada: false, archivada: false, ultimoSeq: 3, leidoPorOtro: 1, entregadoAlOtro: 2, actividad: hace(1)
}
const contactos: ContactoChat[] = [
  { id: 'k1', estado: 'aceptado', desde: hace(100), usuario: ANA },
  { id: 'k2', estado: 'recibida', desde: hace(5), usuario: { id: 'u-leo', email: 'leo@x.com', nombre: 'Leo' } },
  { id: 'k3', estado: 'enviada', desde: hace(5), usuario: { id: 'u-eva', email: 'eva@x.com', nombre: 'Eva' } }
]
const mensajes: MensajeChat[] = [
  msg({ id: 'm1', seq: 1, texto: 'hola, mira https://ejemplo.com/x' }),
  msg({ id: 'm2', seq: 2, emisorId: YO.id, texto: 'qué tal', respondeA: { id: 'm1', emisorId: ANA.id, tipo: 'text', texto: 'hola', eliminado: false }, reacciones: [{ emoji: '👍', usuarios: [ANA.id] }] }),
  msg({ id: 'm3', seq: 3, texto: '', tipo: 'call', meta: { video: false, estado: 'perdida', duracionS: 0 } }),
  msg({ id: 'm4', seq: 4, emisorId: YO.id, tipo: 'audio', texto: '', adjunto: { id: 'a1', nombre: 'nota.webm', mime: 'audio/webm', tamano: 5000, duracionMs: 75_000 } }),
  msg({ id: 'm5', seq: 5, texto: '', eliminado: true }),
  msg({ id: 'm6', seq: 0, emisorId: YO.id, texto: 'sin red', local: 'fallido', error: 'No se pudo conectar', clienteId: 'cli00006' })
]

const eventos: ((e: EventoChat) => void)[] = []

beforeEach(() => {
  vi.resetModules()
  eventos.length = 0
  const operar = vi.fn(async (op: string) => {
    if (op === 'estado') return { conexion: 'conectado' }
    if (op === 'perfil') return YO
    if (op === 'contactos') return { contactos, bloqueados: [] }
    if (op === 'conversaciones') return { conversaciones: [conversacion] }
    if (op === 'mensajes') return { mensajes, hayMas: true, ultimoSeq: 3, leidoPorOtro: 1, entregadoAlOtro: 2 }
    return undefined
  })
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      chat: { operar, onEvento: (cb: (e: EventoChat) => void) => (eventos.push(cb), () => undefined) },
      notificaciones: { mostrar: async () => true, onClic: () => () => undefined },
      navegador: { externo: async () => undefined }
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    clearTimeout, setTimeout, setInterval, clearInterval
  }
  ;(globalThis as unknown as { document: unknown }).document = { hasFocus: () => true, hidden: false }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem: () => undefined }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { document?: unknown }).document
  delete (globalThis as { localStorage?: unknown }).localStorage
})

const limpio = (html: string): string => html.replace(/<!-- -->/g, '')

async function montar() {
  const { almacenChat } = await import('../src/renderer/chat/almacen')
  const baja = almacenChat.iniciar()
  await new Promise((r) => setTimeout(r, 10))
  return { almacenChat, baja }
}

describe('chat: interfaz', () => {
  it('la lista muestra conversaciones con no leídos, vista previa, estado de conexión y la pestaña con las solicitudes', async () => {
    await montar()
    const { Chat } = await import('../src/renderer/chat/Chat')
    const html = limpio(renderToString(<Chat visible />))
    expect(html).toContain('Ana')
    expect(html).toContain('nos vemos')
    expect(html).toMatch(/ch-badge[^>]*>2</) // no leídos de Ana
    expect(html).toMatch(/Contactos<b class="ch-badge">1</) // una solicitud recibida
    expect(html).toContain('Conectado')
    expect(html).toContain('Elige una conversación')
  })

  it('el hilo pinta mensajes propios y ajenos, cita, reacción, llamada perdida, borrado, nota de voz y un envío fallido con «Reintentar»', async () => {
    const { almacenChat } = await montar()
    await almacenChat.abrir('c1')
    const { Chat } = await import('../src/renderer/chat/Chat')
    const html = limpio(renderToString(<Chat visible />))
    expect(html).toContain('aria-label="Conversación con Ana"')
    expect(html).toContain('href="https://ejemplo.com/x"')
    expect(html).toContain('Llamada de voz perdida')
    expect(html).toContain('Este mensaje fue eliminado')
    expect(html).toContain('Reproducir nota de voz')
    expect(html).toContain('1:15') // duración de la nota
    expect(html).toContain('👍')
    expect(html).toContain('ch-cita')
    expect(html).toMatch(/No se envió: No se pudo conectar/)
    expect(html).toContain('Reintentar')
    expect(html).toContain('Cargando mensajes anteriores…') // hayMas
    expect(html).toContain('en línea')
    expect(html).toContain('placeholder="Escribe un mensaje"')
  })

  it('un mensaje que llega por el servidor aparece en el hilo y sube el total de no leídos', async () => {
    const { almacenChat } = await montar()
    await almacenChat.abrir('c1')
    ;(globalThis as unknown as { document: { hasFocus: () => boolean } }).document.hasFocus = () => false // la ventana no está en primer plano: no se marca leído
    eventos[0]({ t: 'mensaje.nuevo', mensaje: msg({ id: 'm9', seq: 4, texto: 'llegó ahora' }) })
    const { Chat } = await import('../src/renderer/chat/Chat')
    const html = limpio(renderToString(<Chat visible />))
    expect(html).toContain('llegó ahora')
    expect(almacenChat.obtener().noLeidos).toBe(3)
  })

  it('sin ser contacto ya no se puede escribir', async () => {
    const { almacenChat } = await montar()
    await almacenChat.abrir('c1')
    ;(window.api.chat.operar as ReturnType<typeof vi.fn>).mockImplementation(async (op: string) => (op === 'contactos' ? { contactos: [], bloqueados: [] } : undefined))
    eventos[0]({ t: 'contacto.cambio' })
    await new Promise((r) => setTimeout(r, 10))
    const { Chat } = await import('../src/renderer/chat/Chat')
    const html = limpio(renderToString(<Chat visible />))
    expect(html).toContain('Ya no puedes enviar mensajes a esta persona')
    expect(html).not.toContain('placeholder="Escribe un mensaje"')
  })

  it('contactos: solicitudes recibidas con Aceptar/Rechazar, enviadas con Cancelar y el perfil propio', async () => {
    await montar()
    const { Contactos } = await import('../src/renderer/chat/Contactos')
    const { almacenChat } = await import('../src/renderer/chat/almacen')
    const html = limpio(renderToString(<Contactos vista={almacenChat.obtener()} alAbrirChat={() => undefined} />))
    expect(html).toContain('Solicitudes (1)')
    expect(html).toContain('Aceptar')
    expect(html).toContain('Rechazar')
    expect(html).toContain('Pendientes de respuesta')
    expect(html).toContain('Contactos (1)')
    expect(html).toContain('Mi perfil en el chat')
    expect(html).toContain('yo@x.com')
  })

  it('la pantalla de llamada no pinta nada sin llamada', async () => {
    const { Llamada } = await import('../src/renderer/chat/Llamada')
    expect(renderToString(<Llamada />)).toBe('')
  })
})
