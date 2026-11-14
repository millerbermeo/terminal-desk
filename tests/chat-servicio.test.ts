import { describe, expect, it, vi } from 'vitest'
import { ErrorServidor } from '../src/main/servidor/cliente'
import { ServicioChat, ejecutarOperacionChat, mensajeDeError } from '../src/main/chat/servicio'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

function montar() {
  const llamadas: { m: string; ruta: string; cuerpo?: unknown; datos?: Uint8Array; tipo?: string }[] = []
  const respuesta: Record<string, unknown> = {}
  const servidor = {
    get: vi.fn(async (ruta: string) => (llamadas.push({ m: 'GET', ruta }), respuesta[`GET ${ruta}`] ?? {})),
    post: vi.fn(async (ruta: string, cuerpo?: unknown) => (llamadas.push({ m: 'POST', ruta, cuerpo }), respuesta[`POST ${ruta}`] ?? {})),
    put: vi.fn(async (ruta: string, cuerpo?: unknown) => (llamadas.push({ m: 'PUT', ruta, cuerpo }), {})),
    delete: vi.fn(async (ruta: string) => (llamadas.push({ m: 'DELETE', ruta }), undefined)),
    binario: vi.fn(async (ruta: string, datos: Uint8Array, tipo: string) => (llamadas.push({ m: 'BIN', ruta, datos, tipo }), { id: ID2, nombre: 'a', mime: tipo, tamano: datos.length, duracionMs: null })),
    descargar: vi.fn(async (ruta: string) => (llamadas.push({ m: 'DESCARGA', ruta }), { datos: new Uint8Array([1, 2, 3]), tipo: 'image/png; charset=x' }))
  }
  const enviadas: object[] = []
  const guardados: { nombre: string; datos: Uint8Array }[] = []
  const svc = new ServicioChat(servidor as never, {
    conexion: { conexion: 'conectado', enviar: (o) => (enviadas.push(o), true) },
    guardarArchivo: async (nombre, datos) => (guardados.push({ nombre, datos }), true)
  })
  return { svc, servidor, llamadas, respuesta, enviadas, guardados }
}

describe('operaciones del chat', () => {
  it('valida los ids y los textos antes de armar ninguna ruta', async () => {
    const { svc, servidor } = montar()
    await expect(svc.operaciones.mensajes({ conversacionId: '../../auth/me' })).rejects.toThrow('no es válido')
    await expect(svc.operaciones.eliminar({ mensajeId: 'x' })).rejects.toThrow('no es válido')
    await expect(svc.operaciones.enviarTexto({ conversacionId: ID, texto: '   ', clienteId: 'abcdefgh' })).rejects.toThrow('está vacío')
    await expect(svc.operaciones.enviarTexto({ conversacionId: ID, texto: 'x'.repeat(8001), clienteId: 'abcdefgh' })).rejects.toThrow('pasa de')
    await expect(svc.operaciones.enviarTexto({ conversacionId: ID, texto: 'hola', clienteId: 'a b' })).rejects.toThrow('identificador')
    expect(servidor.post).not.toHaveBeenCalled()
    expect(servidor.get).not.toHaveBeenCalled()
  })

  it('arma las rutas y cuerpos esperados', async () => {
    const { svc, llamadas } = montar()
    await svc.operaciones.enviarTexto({ conversacionId: ID, texto: ' hola ', clienteId: 'abcdefgh', respondeA: ID2 })
    await svc.operaciones.mensajes({ conversacionId: ID, antes: 20, limite: 500 })
    await svc.operaciones.mensajes({ conversacionId: ID, desde: 0 })
    await svc.operaciones.solicitar({ email: ' Ana@Ejemplo.com ' })
    await svc.operaciones.responder({ contactoId: ID, aceptar: true })
    await svc.operaciones.reaccionar({ mensajeId: ID, emoji: null })
    await svc.operaciones.buscar({ q: 'a&b=1' })
    await svc.operaciones.leido({ conversacionId: ID, seq: 7 })
    expect(llamadas).toEqual([
      { m: 'POST', ruta: `/chat/conversaciones/${ID}/mensajes`, cuerpo: { tipo: 'text', texto: 'hola', clienteId: 'abcdefgh', respondeA: ID2 } },
      { m: 'GET', ruta: `/chat/conversaciones/${ID}/mensajes?antes=20&limite=100` },
      { m: 'GET', ruta: `/chat/conversaciones/${ID}/mensajes?desde=0` },
      { m: 'POST', ruta: '/chat/contactos', cuerpo: { email: 'Ana@Ejemplo.com' } },
      { m: 'POST', ruta: `/chat/contactos/${ID}/respuesta`, cuerpo: { aceptar: true } },
      { m: 'PUT', ruta: `/chat/mensajes/${ID}/reaccion`, cuerpo: { emoji: null } },
      { m: 'GET', ruta: '/chat/buscar?q=a%26b%3D1' },
      { m: 'POST', ruta: `/chat/conversaciones/${ID}/leido`, cuerpo: { seq: 7 } }
    ])
  })

  it('enviar un archivo: sube los bytes y luego manda el mensaje con el adjunto', async () => {
    const { svc, llamadas } = montar()
    const datos = new Uint8Array([1, 2, 3, 4])
    await svc.operaciones.enviarArchivo({ conversacionId: ID, tipo: 'audio', nombre: 'nota de voz.webm', mime: 'audio/webm;codecs=opus', datos, duracionMs: 4200.4, texto: '', clienteId: 'abcdefgh' })
    expect(llamadas[0]).toMatchObject({ m: 'BIN', ruta: `/chat/conversaciones/${ID}/archivos?nombre=nota%20de%20voz.webm&duracionMs=4200`, tipo: 'audio/webm;codecs=opus' })
    expect(llamadas[1]).toEqual({ m: 'POST', ruta: `/chat/conversaciones/${ID}/mensajes`, cuerpo: { tipo: 'audio', texto: '', adjuntoId: ID2, clienteId: 'abcdefgh' } })
  })

  it('rechaza archivos vacíos, enormes o con tipos y duraciones absurdos sin tocar la red', async () => {
    const { svc, servidor } = montar()
    const base = { conversacionId: ID, tipo: 'file' as const, nombre: 'a', mime: 'text/plain', clienteId: 'abcdefgh' }
    await expect(svc.operaciones.enviarArchivo({ ...base, datos: new Uint8Array(0) })).rejects.toThrow('vacío')
    await expect(svc.operaciones.enviarArchivo({ ...base, datos: new Uint8Array(26 * 1024 * 1024) })).rejects.toThrow('pasa de')
    await expect(svc.operaciones.enviarArchivo({ ...base, tipo: 'exe' as never, datos: new Uint8Array(1) })).rejects.toThrow('Tipo')
    await expect(svc.operaciones.enviarArchivo({ ...base, datos: new Uint8Array(1), duracionMs: 99 * 60_000 })).rejects.toThrow('Duración')
    await expect(svc.operaciones.enviarArchivo({ ...base, datos: [1, 2] as never })).rejects.toThrow('vacío')
    expect(servidor.binario).not.toHaveBeenCalled()
  })

  it('descargar usa caché: el mismo archivo no se vuelve a pedir; guardarComo entrega los bytes', async () => {
    const { svc, servidor, guardados } = montar()
    const a = await svc.operaciones.descargar({ adjuntoId: ID })
    expect(a).toMatchObject({ mime: 'image/png' })
    await svc.operaciones.descargar({ adjuntoId: ID })
    expect(servidor.descargar).toHaveBeenCalledTimes(1)
    expect(await svc.operaciones.guardarComo({ adjuntoId: ID, nombre: 'foto.png' })).toBe(true)
    expect(guardados[0].nombre).toBe('foto.png')
    expect([...guardados[0].datos]).toEqual([1, 2, 3])
    await expect(svc.operaciones.descargar({ adjuntoId: '../x' })).rejects.toThrow()
  })

  it('las órdenes de tiempo real se reconstruyen con solo los campos permitidos', async () => {
    const { svc, enviadas } = montar()
    expect(await svc.operaciones.tiempoReal({ orden: { t: 'llamada.invitar', llamadaId: ID, usuarioId: ID2, video: true, extra: 'x' } as never })).toBe(true)
    await svc.operaciones.tiempoReal({ orden: { t: 'llamada.senal', llamadaId: ID, datos: { sdp: 'o' } } })
    await svc.operaciones.tiempoReal({ orden: { t: 'escribiendo', conversacionId: ID, escribiendo: 'sí' as never } })
    expect(enviadas).toEqual([
      { t: 'llamada.invitar', llamadaId: ID, usuarioId: ID2, video: true },
      { t: 'llamada.senal', llamadaId: ID, datos: { sdp: 'o' } },
      { t: 'escribiendo', conversacionId: ID, escribiendo: false }
    ])
    await expect(svc.operaciones.tiempoReal({ orden: { t: 'auth', token: 'robado' } as never })).rejects.toThrow('Orden no válida')
    await expect(svc.operaciones.tiempoReal({ orden: { t: 'llamada.colgar', llamadaId: 'no-uuid' } })).rejects.toThrow('no es válido')
  })

  it('el IPC devuelve errores como datos y rechaza operaciones desconocidas', async () => {
    const { svc, servidor } = montar()
    servidor.get.mockRejectedValueOnce(new ErrorServidor('No se pudo conectar con el servidor (https://x). ¿Está en marcha?'))
    expect(await ejecutarOperacionChat(svc, 'contactos', {})).toEqual({ ok: false, mensaje: 'No se pudo conectar con el servidor (https://x). ¿Está en marcha?' })
    expect(await ejecutarOperacionChat(svc, 'constructor', {})).toMatchObject({ ok: false })
    expect(await ejecutarOperacionChat(svc, '__proto__', {})).toMatchObject({ ok: false })
    expect(await ejecutarOperacionChat(svc, 'estado', undefined)).toEqual({ ok: true, valor: { conexion: 'conectado' } })
  })

  it('traduce el 404 de un servidor sin chat', () => {
    expect(mensajeDeError(new ErrorServidor('Cannot GET /chat/contactos', 404))).toContain('actualiza el backend')
    expect(mensajeDeError(new ErrorServidor('La conversación no existe', 404))).toBe('La conversación no existe')
  })
})
