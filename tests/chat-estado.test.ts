import { describe, expect, it } from 'vitest'
import { duracionCorta, partirEnlaces, tamanoLegible, textoLlamada, tipoPorMime, vistaPrevia, type ConversacionChat, type MensajeChat } from '../src/shared/chat'
import { aplicarEvento, estadoInicial, etiquetaDia, insertarMensaje, marcarFallido, mensajeLocal, textoPresencia, totalNoLeidos } from '../src/shared/chat-estado'

const YO = 'yo'
const OTRO = 'otro'

const msg = (o: Partial<MensajeChat> = {}): MensajeChat => ({
  id: `m${o.seq ?? 1}`, conversacionId: 'c1', seq: 1, emisorId: OTRO, tipo: 'text', texto: 'hola', adjunto: null, respondeA: null, reacciones: [], meta: {},
  creado: '2026-11-13T10:00:00.000Z', editado: null, eliminado: false, clienteId: `cli${o.seq ?? 1}`, ...o
})

const conv = (o: Partial<ConversacionChat> = {}): ConversacionChat => ({
  id: 'c1', otro: { id: OTRO, email: 'o@x.com', nombre: 'Otro' }, ultimo: null, noLeidos: 0, silenciada: false, archivada: false, ultimoSeq: 0, leidoPorOtro: 0, entregadoAlOtro: 0,
  actividad: '2026-11-13T09:00:00.000Z', ...o
})

describe('estado del chat', () => {
  it('un mensaje nuevo entra en el hilo cargado, sube la conversación y cuenta como no leído', () => {
    const e = { ...estadoInicial(), conversaciones: [conv({ id: 'c0', actividad: '2026-11-13T09:30:00.000Z' }), conv()], hilos: { c1: { mensajes: [], hayMas: false } } }
    const n = aplicarEvento(e, { t: 'mensaje.nuevo', mensaje: msg({ seq: 1 }) }, YO)
    expect(n.hilos.c1.mensajes.map((m) => m.id)).toEqual(['m1'])
    expect(n.conversaciones.map((c) => c.id)).toEqual(['c1', 'c0']) // la de la actividad más reciente primero
    expect(n.conversaciones[0]).toMatchObject({ noLeidos: 1, ultimoSeq: 1, ultimo: { texto: 'hola' } })
    // El mismo evento dos veces (reconexión) no cuenta dos veces.
    expect(aplicarEvento(n, { t: 'mensaje.nuevo', mensaje: msg({ seq: 1 }) }, YO).conversaciones[0].noLeidos).toBe(1)
  })

  it('mis propios mensajes no suman no leídos; los de una conversación desconocida piden recargar la lista', () => {
    const e = { ...estadoInicial(), conversaciones: [conv()] }
    expect(aplicarEvento(e, { t: 'mensaje.nuevo', mensaje: msg({ emisorId: YO }) }, YO).conversaciones[0].noLeidos).toBe(0)
    const x = aplicarEvento(e, { t: 'mensaje.nuevo', mensaje: msg({ conversacionId: 'c9' }) }, YO)
    expect(x.recargar.conversaciones).toBe(true)
    expect(aplicarEvento(e, { t: 'mensaje.nuevo', mensaje: msg() }, YO).recargar.conversaciones).toBe(false)
  })

  it('mi mensaje pendiente se sustituye por el confirmado (mismo clienteId) sin duplicarse', () => {
    const local = mensajeLocal({ conversacionId: 'c1', emisorId: YO, tipo: 'text', texto: 'hey', clienteId: 'abc12345' })
    const e = { ...estadoInicial(), conversaciones: [conv()], hilos: { c1: { mensajes: [msg({ seq: 1 }), local], hayMas: false } } }
    const n = aplicarEvento(e, { t: 'mensaje.nuevo', mensaje: msg({ id: 'real', seq: 2, emisorId: YO, texto: 'hey', clienteId: 'abc12345' }) }, YO)
    expect(n.hilos.c1.mensajes.map((m) => m.id)).toEqual(['m1', 'real'])
    expect(n.hilos.c1.mensajes[1].local).toBeUndefined()
  })

  it('los pendientes quedan al final aunque lleguen mensajes nuevos, y un fallo se puede marcar', () => {
    const local = mensajeLocal({ conversacionId: 'c1', emisorId: YO, tipo: 'text', texto: 'x', clienteId: 'pend0001' })
    const lista = insertarMensaje([msg({ seq: 1 }), local], msg({ seq: 2 }))
    expect(lista.map((m) => m.id)).toEqual(['m1', 'm2', local.id])
    expect(marcarFallido(lista, 'pend0001', 'sin red').find((m) => m.id === local.id)).toMatchObject({ local: 'fallido', error: 'sin red' })
  })

  it('editar o eliminar un mensaje actualiza el hilo y la vista previa si era el último', () => {
    const e = { ...estadoInicial(), conversaciones: [conv({ ultimoSeq: 1, ultimo: { id: 'm1', emisorId: OTRO, tipo: 'text', texto: 'hola', seq: 1, creado: '2026-11-13T10:00:00.000Z' } })], hilos: { c1: { mensajes: [msg()], hayMas: false } } }
    const n = aplicarEvento(e, { t: 'mensaje.cambio', mensaje: msg({ eliminado: true, texto: '' }) }, YO)
    expect(n.hilos.c1.mensajes[0].eliminado).toBe(true)
    expect(n.conversaciones[0].ultimo?.texto).toBe('Mensaje eliminado')
    expect(n.conversaciones[0].noLeidos).toBe(0)
  })

  it('los acuses del otro suben ✓/✓✓ sin retroceder; los míos limpian los no leídos', () => {
    const e = { ...estadoInicial(), conversaciones: [conv({ ultimoSeq: 5, noLeidos: 3, leidoPorOtro: 2, entregadoAlOtro: 4 })] }
    const a = aplicarEvento(e, { t: 'recibo', conversacionId: 'c1', usuarioId: OTRO, leidoSeq: 3 }, YO).conversaciones[0]
    expect(a).toMatchObject({ leidoPorOtro: 3, entregadoAlOtro: 4, noLeidos: 3 })
    expect(aplicarEvento(e, { t: 'recibo', conversacionId: 'c1', usuarioId: OTRO, leidoSeq: 1 }, YO).conversaciones[0].leidoPorOtro).toBe(2)
    expect(aplicarEvento(e, { t: 'recibo', conversacionId: 'c1', usuarioId: YO, leidoSeq: 5 }, YO).conversaciones[0].noLeidos).toBe(0)
    expect(aplicarEvento(e, { t: 'recibo', conversacionId: 'c1', usuarioId: YO, leidoSeq: 4 }, YO).conversaciones[0].noLeidos).toBe(3)
  })

  it('«escribiendo» se pone y se quita; enviar un mensaje también lo quita', () => {
    let e = aplicarEvento(estadoInicial(), { t: 'escribiendo', conversacionId: 'c1', usuarioId: OTRO, escribiendo: true }, YO)
    expect(e.escribiendo).toEqual({ c1: OTRO })
    expect(aplicarEvento(e, { t: 'escribiendo', conversacionId: 'c1', usuarioId: OTRO, escribiendo: false }, YO).escribiendo).toEqual({})
    e = { ...e, conversaciones: [conv()] }
    expect(aplicarEvento(e, { t: 'mensaje.nuevo', mensaje: msg() }, YO).escribiendo).toEqual({})
  })

  it('la presencia actualiza contactos y conversaciones; contacto.cambio pide recargar', () => {
    const e = { ...estadoInicial(), conversaciones: [conv()], contactos: [{ id: 'k', estado: 'aceptado' as const, desde: '', usuario: { id: OTRO, email: 'o@x.com', nombre: 'Otro', enLinea: false } }] }
    const n = aplicarEvento(e, { t: 'presencia', usuarioId: OTRO, enLinea: true, ultimaConexion: null }, YO)
    expect(n.conversaciones[0].otro.enLinea).toBe(true)
    expect(n.contactos[0].usuario.enLinea).toBe(true)
    expect(aplicarEvento(e, { t: 'contacto.cambio' }, YO).recargar).toEqual({ contactos: true, conversaciones: true })
  })

  it('el total de no leídos ignora las conversaciones silenciadas', () => {
    expect(totalNoLeidos({ conversaciones: [conv({ noLeidos: 2 }), conv({ id: 'c2', noLeidos: 5, silenciada: true }), conv({ id: 'c3', noLeidos: 1 })] })).toBe(3)
  })
})

describe('textos del chat', () => {
  it('formatea duraciones, tamaños y llamadas', () => {
    expect(duracionCorta(75)).toBe('1:15')
    expect(duracionCorta(3725)).toBe('1:02:05')
    expect(duracionCorta(-3)).toBe('0:00')
    expect(tamanoLegible(512)).toBe('512 B')
    expect(tamanoLegible(1536)).toBe('1,5 KB')
    expect(tamanoLegible(25 * 1024 * 1024)).toBe('25 MB')
    expect(textoLlamada({ emisorId: YO, meta: { video: true, estado: 'completada', duracionS: 61 } }, YO)).toBe('Videollamada · 1:01')
    expect(textoLlamada({ emisorId: OTRO, meta: { video: false, estado: 'perdida' } }, YO)).toBe('Llamada de voz perdida')
    expect(textoLlamada({ emisorId: YO, meta: { video: false, estado: 'cancelada' } }, YO)).toBe('Llamada de voz cancelada')
  })

  it('vista previa por tipo y tipo por MIME', () => {
    expect(vistaPrevia({ tipo: 'image', texto: '', eliminado: false })).toBe('📷 Foto')
    expect(vistaPrevia({ tipo: 'file', texto: 'informe', eliminado: false })).toBe('📎 Archivo · informe')
    expect(vistaPrevia({ tipo: 'text', texto: 'x', eliminado: true })).toBe('Mensaje eliminado')
    expect(tipoPorMime('image/png')).toBe('image')
    expect(tipoPorMime('image/svg+xml')).toBe('file') // el SVG puede llevar scripts: va como archivo
    expect(tipoPorMime('audio/webm')).toBe('audio')
    expect(tipoPorMime('application/pdf')).toBe('file')
  })

  it('separa los enlaces del texto sin comerse la puntuación final', () => {
    expect(partirEnlaces('mira https://a.com/x?y=1, ok')).toEqual([{ texto: 'mira ' }, { texto: 'https://a.com/x?y=1', enlace: 'https://a.com/x?y=1' }, { texto: ', ok' }])
    expect(partirEnlaces('sin enlaces')).toEqual([{ texto: 'sin enlaces' }])
    expect(partirEnlaces('javascript:alert(1)')).toEqual([{ texto: 'javascript:alert(1)' }])
  })

  it('etiqueta días y presencia', () => {
    const ahora = new Date(2026, 10, 13, 12, 0)
    expect(etiquetaDia(new Date(2026, 10, 13, 8).toISOString(), ahora)).toBe('Hoy')
    expect(etiquetaDia(new Date(2026, 10, 12, 23).toISOString(), ahora)).toBe('Ayer')
    expect(textoPresencia({ enLinea: true }, ahora)).toBe('en línea')
    expect(textoPresencia({}, ahora)).toBe('')
    expect(textoPresencia({ enLinea: false, ultimaConexion: new Date(2026, 10, 13, 9, 5).toISOString() }, ahora)).toMatch(/^últ\. vez hoy a las /)
  })
})
