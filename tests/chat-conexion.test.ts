import { describe, expect, it } from 'vitest'
import type { EventoChat } from '../src/shared/chat'
import { ConexionChat, type SocketChat } from '../src/main/chat/conexion'

class SocketFalso implements SocketChat {
  readyState = 0
  enviados: string[] = []
  cerrado?: { codigo?: number }
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {}
  send(d: string): void {
    this.enviados.push(d)
  }
  close(codigo?: number): void {
    this.cerrado = { codigo }
    this.readyState = 3
  }
  abrir(): void {
    this.readyState = 1
    this.onopen?.()
  }
  recibir(o: object): void {
    this.onmessage?.({ data: JSON.stringify(o) })
  }
  caer(code = 1006): void {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

function montar(token: string | null = 'tok', url = 'https://api.ejemplo.com') {
  const sockets: SocketFalso[] = []
  const eventos: EventoChat[] = []
  const timers: { ms: number; fn: () => void; vivo: boolean }[] = []
  const c = new ConexionChat({
    url: () => url,
    token: async () => token ?? undefined,
    alEvento: (e) => eventos.push(e),
    crearSocket: (u) => {
      const s = new SocketFalso(u)
      sockets.push(s)
      return s
    },
    esperar: (ms, fn) => {
      const t = { ms, fn, vivo: true }
      timers.push(t)
      return () => (t.vivo = false)
    }
  })
  const pendientes = () => timers.filter((t) => t.vivo)
  const tic = () => {
    const t = pendientes()[0]
    t.vivo = false
    t.fn()
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { c, sockets, eventos, timers, pendientes, tic, flush }
}

describe('conexión del chat', () => {
  it('abre ws(s)://…/chat/ws, se autentica con el primer mensaje y pasa a conectado al recibir «listo»', async () => {
    const m = montar()
    m.c.iniciar()
    await m.flush()
    expect(m.sockets[0].url).toBe('wss://api.ejemplo.com/chat/ws')
    expect(m.c.conexion).toBe('conectando')
    m.sockets[0].abrir()
    expect(JSON.parse(m.sockets[0].enviados[0])).toEqual({ t: 'auth', token: 'tok' })
    m.sockets[0].recibir({ t: 'listo', usuarioId: 'u' })
    expect(m.c.conexion).toBe('conectado')
    expect(m.eventos.map((e) => e.t)).toEqual(['conexion', 'conexion'])
    expect(m.eventos[1]).toEqual({ t: 'conexion', estado: 'conectado' })
  })

  it('reenvía los eventos del servidor, ignora basura y no deja pasar «pong»', async () => {
    const m = montar()
    m.c.iniciar()
    await m.flush()
    const s = m.sockets[0]
    s.abrir()
    s.recibir({ t: 'listo' })
    s.recibir({ t: 'pong' })
    s.onmessage?.({ data: 'no es json' })
    s.onmessage?.({ data: '{"sin":"tipo"}' })
    s.recibir({ t: 'escribiendo', conversacionId: 'c', usuarioId: 'o', escribiendo: true })
    expect(m.eventos.filter((e) => e.t !== 'conexion')).toEqual([{ t: 'escribiendo', conversacionId: 'c', usuarioId: 'o', escribiendo: true }])
  })

  it('solo envía órdenes estando conectado', async () => {
    const m = montar()
    expect(m.c.enviar({ t: 'llamada.colgar', llamadaId: 'x' })).toBe(false)
    m.c.iniciar()
    await m.flush()
    m.sockets[0].abrir()
    expect(m.c.enviar({ t: 'llamada.colgar', llamadaId: 'x' })).toBe(false) // aún sin «listo»
    m.sockets[0].recibir({ t: 'listo' })
    expect(m.c.enviar({ t: 'llamada.colgar', llamadaId: 'x' })).toBe(true)
    expect(JSON.parse(m.sockets[0].enviados.at(-1)!)).toEqual({ t: 'llamada.colgar', llamadaId: 'x' })
  })

  it('si se cae reintenta con pausas crecientes y las reinicia al volver a conectar', async () => {
    const m = montar()
    m.c.iniciar()
    await m.flush()
    m.sockets[0].abrir()
    m.sockets[0].caer()
    expect(m.c.conexion).toBe('desconectado')
    const pausa = (i: number) => m.timers.filter((t) => t.vivo && t.ms >= 1000)[i]
    expect(m.pendientes()[0].ms).toBeGreaterThanOrEqual(1000)
    expect(m.pendientes()[0].ms).toBeLessThanOrEqual(1300)
    m.tic()
    await m.flush()
    m.sockets[1].caer() // no llegó a conectar: la pausa crece
    expect(m.pendientes()[0].ms).toBeGreaterThanOrEqual(2000)
    m.tic()
    await m.flush()
    m.sockets[2].abrir()
    m.sockets[2].recibir({ t: 'listo' })
    m.sockets[2].caer()
    expect(m.pendientes().find((t) => t.ms < 2000)).toBeTruthy() // vuelve a empezar por 1 s
    void pausa
    expect(m.sockets).toHaveLength(3)
  })

  it('detener cierra, no reintenta y descarta lo que llegue de la conexión vieja', async () => {
    const m = montar()
    m.c.iniciar()
    await m.flush()
    const s = m.sockets[0]
    s.abrir()
    s.recibir({ t: 'listo' })
    m.c.detener()
    expect(s.cerrado?.codigo).toBe(1000)
    expect(m.c.conexion).toBe('desconectado')
    expect(m.pendientes()).toHaveLength(0)
    s.recibir({ t: 'mensaje.nuevo', mensaje: {} })
    expect(m.eventos.some((e) => e.t === 'mensaje.nuevo')).toBe(false)
    expect(m.c.enviar({ t: 'llamada.colgar', llamadaId: 'x' })).toBe(false)
  })

  it('sin sesión no abre nada ni reintenta', async () => {
    const m = montar(null)
    m.c.iniciar()
    await m.flush()
    expect(m.sockets).toHaveLength(0)
    expect(m.pendientes()).toHaveLength(0)
    expect(m.c.conexion).toBe('desconectado')
  })

  it('no manda el token por http hacia otra máquina, pero sí hacia localhost', async () => {
    const remoto = montar('tok', 'http://servidor.ejemplo.com')
    remoto.c.iniciar()
    await remoto.flush()
    expect(remoto.sockets).toHaveLength(0)
    const local = montar('tok', 'http://localhost:3000')
    local.c.iniciar()
    await local.flush()
    expect(local.sockets[0].url).toBe('ws://localhost:3000/chat/ws')
  })

  it('manda latidos y reabre la conexión si el servidor deja de responder', async () => {
    const m = montar()
    m.c.iniciar()
    await m.flush()
    const s = m.sockets[0]
    s.abrir()
    s.recibir({ t: 'listo' })
    m.tic() // primer latido
    expect(s.enviados.at(-1)).toBe('{"t":"ping"}')
    const antes = Date.now
    Date.now = () => antes() + 80_000 // pasó más de lo tolerable sin recibir nada
    try {
      m.tic()
    } finally {
      Date.now = antes
    }
    expect(s.cerrado?.codigo).toBe(4000)
  })
})
