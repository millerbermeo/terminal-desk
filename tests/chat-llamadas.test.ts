import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventoChat, OrdenTiempoReal } from '../src/shared/chat'

const LLAMADA = '33333333-3333-4333-8333-333333333333'
const ANA = { id: 'u-ana', email: 'ana@x.com', nombre: 'Ana' }

class Pista {
  enabled = true
  detenida = false
  constructor(readonly kind: string) {}
  stop() { this.detenida = true }
}
class FlujoFalso {
  constructor(private readonly pistas: Pista[] = []) {}
  getTracks() { return this.pistas }
  getAudioTracks() { return this.pistas.filter((p) => p.kind === 'audio') }
  getVideoTracks() { return this.pistas.filter((p) => p.kind === 'video') }
}
const conexiones: ConexionFalsa[] = []
class ConexionFalsa {
  remoteDescription: unknown = null
  localDescription: unknown = null
  connectionState = 'new'
  candidatos: unknown[] = []
  cerrada = false
  pistas: unknown[] = []
  ontrack: ((e: unknown) => void) | null = null
  onicecandidate: ((e: { candidate: { toJSON(): unknown } | null }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  constructor(readonly config: unknown) { conexiones.push(this) }
  addTrack(t: unknown) { this.pistas.push(t) }
  async createOffer() { return { type: 'offer', sdp: 'sdp-oferta' } }
  async createAnswer() { return { type: 'answer', sdp: 'sdp-respuesta' } }
  async setLocalDescription(d: unknown) { this.localDescription = d }
  async setRemoteDescription(d: unknown) { this.remoteDescription = d }
  async addIceCandidate(c: unknown) {
    if (!this.remoteDescription) throw new Error('sin descripción remota')
    this.candidatos.push(c)
  }
  close() { this.cerrada = true }
  conectar() { this.connectionState = 'connected'; this.onconnectionstatechange?.() }
}

let ordenes: OrdenTiempoReal[]
let emitir: (e: EventoChat) => void
let pedirMedios: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  conexiones.length = 0
  ordenes = []
  pedirMedios = vi.fn(async (c: { video: unknown }) => new FlujoFalso(c.video ? [new Pista('audio'), new Pista('video')] : [new Pista('audio')]))
  const operar = vi.fn(async (op: string, e: { orden?: OrdenTiempoReal }) => {
    if (op === 'tiempoReal') return (ordenes.push(e.orden!), true)
    if (op === 'ice') return { servidores: [{ urls: ['stun:stun.ejemplo.com'] }] }
    if (op === 'estado') return { conexion: 'conectado' }
    return op === 'contactos' ? { contactos: [], bloqueados: [] } : op === 'conversaciones' ? { conversaciones: [] } : {}
  })
  const globales: Record<string, unknown> = {
    window: { api: { chat: { operar, onEvento: (cb: (e: EventoChat) => void) => ((emitir = cb), () => undefined) }, notificaciones: { mostrar: async () => true } }, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener: () => undefined, removeEventListener: () => undefined },
    document: { hasFocus: () => true, hidden: false },
    localStorage: { getItem: () => null, setItem: () => undefined },
    navigator: { mediaDevices: { getUserMedia: pedirMedios } },
    RTCPeerConnection: ConexionFalsa,
    MediaStream: FlujoFalso
  }
  // `navigator` es un accesor de solo lectura en Node: se redefine en vez de asignar.
  for (const [k, value] of Object.entries(globales)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })
})
afterEach(() => {
  for (const k of ['window', 'document', 'localStorage', 'navigator', 'RTCPeerConnection', 'MediaStream']) delete (globalThis as Record<string, unknown>)[k]
})

async function montar() {
  const { almacenChat } = await import('../src/renderer/chat/almacen')
  const { controlLlamada } = await import('../src/renderer/chat/llamadas')
  almacenChat.iniciar()
  controlLlamada.iniciar()
  await new Promise((r) => setTimeout(r, 5))
  return { controlLlamada }
}
const pausa = () => new Promise((r) => setTimeout(r, 5))

describe('llamadas: quien llama', () => {
  it('pide micrófono y cámara, invita, y al contestar el otro crea la oferta; con la respuesta y la conexión pasa a «en curso»', async () => {
    const { controlLlamada } = await montar()
    await controlLlamada.llamar(ANA, true)
    expect(pedirMedios).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything() }))
    const invitar = ordenes.find((o) => o.t === 'llamada.invitar') as Extract<OrdenTiempoReal, { t: 'llamada.invitar' }>
    expect(invitar).toMatchObject({ usuarioId: ANA.id, video: true })
    expect(controlLlamada.obtener().fase).toBe('llamando')

    emitir({ t: 'llamada.aceptada', llamadaId: invitar.llamadaId })
    await pausa()
    expect(controlLlamada.obtener().fase).toBe('conectando')
    expect(conexiones[0].config).toEqual({ iceServers: [{ urls: ['stun:stun.ejemplo.com'] }] })
    expect(conexiones[0].pistas).toHaveLength(2)
    expect(ordenes.at(-1)).toMatchObject({ t: 'llamada.senal', datos: { tipo: 'oferta', sdp: { type: 'offer', sdp: 'sdp-oferta' } } })

    emitir({ t: 'llamada.senal', llamadaId: invitar.llamadaId, datos: { tipo: 'respuesta', sdp: { type: 'answer', sdp: 'x' } } })
    await pausa()
    expect(conexiones[0].remoteDescription).toEqual({ type: 'answer', sdp: 'x' })
    conexiones[0].conectar()
    expect(controlLlamada.obtener().fase).toBe('en-curso')

    controlLlamada.colgar()
    expect(ordenes.at(-1)).toEqual({ t: 'llamada.colgar', llamadaId: invitar.llamadaId })
    expect(controlLlamada.obtener().fase).toBe('terminada')
    expect(conexiones[0].cerrada).toBe(true)
  })

  it('sin permiso de micrófono no invita y explica por qué', async () => {
    const { controlLlamada } = await montar()
    pedirMedios.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await controlLlamada.llamar(ANA, false)
    expect(ordenes).toEqual([])
    expect(controlLlamada.obtener()).toMatchObject({ fase: 'terminada', mensaje: expect.stringContaining('permiso') })
  })

  it('si el otro rechaza o no contesta, termina con el motivo y libera el micrófono', async () => {
    const { controlLlamada } = await montar()
    await controlLlamada.llamar(ANA, false)
    const local = controlLlamada.obtener().local as unknown as FlujoFalso
    const id = (ordenes[0] as { llamadaId: string }).llamadaId
    emitir({ t: 'llamada.fin', llamadaId: id, motivo: 'sin_respuesta' })
    expect(controlLlamada.obtener()).toMatchObject({ fase: 'terminada', mensaje: 'No contestó' })
    expect(local.getTracks().every((t) => (t as Pista).detenida)).toBe(true)
  })

  it('ignora eventos de otra llamada y no empieza otra mientras hay una', async () => {
    const { controlLlamada } = await montar()
    await controlLlamada.llamar(ANA, false)
    emitir({ t: 'llamada.fin', llamadaId: LLAMADA, motivo: 'rechazada' })
    expect(controlLlamada.obtener().fase).toBe('llamando')
    await controlLlamada.llamar({ id: 'otro', email: 'o@x.com', nombre: 'O' }, false)
    expect(ordenes.filter((o) => o.t === 'llamada.invitar')).toHaveLength(1)
  })
})

describe('llamadas: quien recibe', () => {
  it('suena, al contestar acepta, responde a la oferta y guarda los candidatos que llegan antes de tener la descripción remota', async () => {
    const { controlLlamada } = await montar()
    emitir({ t: 'llamada.entrante', llamadaId: LLAMADA, de: ANA, video: false })
    expect(controlLlamada.obtener()).toMatchObject({ fase: 'entrante', con: ANA })
    await controlLlamada.contestar()
    expect(ordenes).toContainEqual({ t: 'llamada.responder', llamadaId: LLAMADA, aceptar: true })
    expect(controlLlamada.obtener().fase).toBe('conectando')

    // Un candidato ICE llega antes que la oferta: se guarda.
    emitir({ t: 'llamada.senal', llamadaId: LLAMADA, datos: { tipo: 'ice', candidato: { candidate: 'c1' } } })
    await pausa()
    expect(conexiones[0].candidatos).toEqual([])
    emitir({ t: 'llamada.senal', llamadaId: LLAMADA, datos: { tipo: 'oferta', sdp: { type: 'offer', sdp: 'o' } } })
    await pausa()
    expect(conexiones[0].remoteDescription).toEqual({ type: 'offer', sdp: 'o' })
    expect(ordenes.at(-1)).toMatchObject({ t: 'llamada.senal', datos: { tipo: 'respuesta', sdp: { type: 'answer' } } })
    expect(conexiones[0].candidatos).toEqual([{ candidate: 'c1' }]) // ya con descripción remota, se aplican
  })

  it('rechazar manda el rechazo y no abre el micrófono', async () => {
    const { controlLlamada } = await montar()
    emitir({ t: 'llamada.entrante', llamadaId: LLAMADA, de: ANA, video: true })
    controlLlamada.rechazar()
    expect(ordenes).toEqual([{ t: 'llamada.responder', llamadaId: LLAMADA, aceptar: false }])
    expect(pedirMedios).not.toHaveBeenCalled()
  })

  it('si no hay micrófono al contestar, rechaza la llamada y lo explica', async () => {
    const { controlLlamada } = await montar()
    emitir({ t: 'llamada.entrante', llamadaId: LLAMADA, de: ANA, video: false })
    pedirMedios.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotFoundError' }))
    await controlLlamada.contestar()
    expect(ordenes).toEqual([{ t: 'llamada.responder', llamadaId: LLAMADA, aceptar: false }])
    expect(controlLlamada.obtener()).toMatchObject({ fase: 'terminada', mensaje: expect.stringContaining('micrófono') })
  })

  it('si otro de mis equipos contestó, esta pantalla simplemente deja de sonar', async () => {
    const { controlLlamada } = await montar()
    emitir({ t: 'llamada.entrante', llamadaId: LLAMADA, de: ANA, video: false })
    emitir({ t: 'llamada.fin', llamadaId: LLAMADA, motivo: 'atendida_en_otro' })
    expect(controlLlamada.obtener().fase).toBe('inactiva')
  })

  it('silenciar y apagar la cámara actúan sobre las pistas locales', async () => {
    const { controlLlamada } = await montar()
    emitir({ t: 'llamada.entrante', llamadaId: LLAMADA, de: ANA, video: true })
    await controlLlamada.contestar()
    const local = controlLlamada.obtener().local as unknown as FlujoFalso
    controlLlamada.alternarSilencio()
    expect(local.getAudioTracks()[0].enabled).toBe(false)
    controlLlamada.alternarCamara()
    expect(local.getVideoTracks()[0].enabled).toBe(false)
    controlLlamada.alternarSilencio()
    expect(local.getAudioTracks()[0].enabled).toBe(true)
  })
})
