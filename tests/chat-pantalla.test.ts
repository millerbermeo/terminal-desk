import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventoChat, OrdenTiempoReal } from '../src/shared/chat'
import { midsEnOrden, ordenarVideo } from '../src/renderer/chat/llamadas'

/** Compartir pantalla y grabar llamadas (renderer): canales de video por posición en el SDP, señales y grabación. */

const ANA = { id: 'u-ana', email: 'ana@x.com', nombre: 'Ana' }

let idPista = 0
class Pista {
  id = `p${++idPista}`
  enabled = true
  readyState = 'live'
  contentHint = ''
  onended: (() => void) | null = null
  constructor(readonly kind: string) {}
  stop() {
    this.readyState = 'ended'
  }
}
class FlujoFalso {
  constructor(private readonly pistas: Pista[] = []) {}
  getTracks() {
    return this.pistas
  }
  getAudioTracks() {
    return this.pistas.filter((p) => p.kind === 'audio')
  }
  getVideoTracks() {
    return this.pistas.filter((p) => p.kind === 'video')
  }
}
class Emisor {
  reemplazos: (Pista | null)[] = []
  parametros: Record<string, unknown> = { encodings: [{}] }
  constructor(public track: Pista | null) {}
  async replaceTrack(t: Pista | null) {
    this.track = t
    this.reemplazos.push(t)
  }
  getParameters() {
    return this.parametros
  }
  async setParameters(p: Record<string, unknown>) {
    this.parametros = p
  }
}
class Transceptor {
  mid: string | null = null
  readonly sender: Emisor
  readonly receiver: { track: Pista }
  constructor(
    kind: string,
    pista: Pista | null,
    public direction: string,
    readonly porAddTrack: boolean
  ) {
    this.sender = new Emisor(pista)
    this.receiver = { track: new Pista(kind) }
  }
}
const conexiones: ConexionFalsa[] = []
/**
 * Conexión con transceptores como los de Chrome: quien ofrece numera las líneas en orden de creación; quien responde reutiliza
 * por tipo los creados con `addTrack` y crea los que falten (recvonly). Un `addTransceiver` del que responde queda huérfano.
 */
class ConexionFalsa {
  remoteDescription: { type: string; sdp: string } | null = null
  localDescription: { type: string; sdp: string } | null = null
  connectionState = 'new'
  signalingState = 'stable'
  transceptores: Transceptor[] = []
  agregados = 0
  cerrada = false
  ontrack: ((e: unknown) => void) | null = null
  onicecandidate: unknown = null
  onconnectionstatechange: (() => void) | null = null
  onnegotiationneeded: unknown = null
  constructor(readonly config: unknown) {
    conexiones.push(this)
  }
  addTrack(t: Pista) {
    this.transceptores.push(new Transceptor(t.kind, t, 'sendrecv', true))
  }
  addTransceiver(kind: string, o: { direction: string }) {
    this.agregados++
    this.transceptores.push(new Transceptor(kind, null, o.direction, false))
  }
  getTransceivers() {
    return this.transceptores
  }
  getSenders() {
    return this.transceptores.map((t) => t.sender)
  }
  private sdp(): string {
    return this.transceptores
      .filter((t) => t.mid !== null)
      .map((t) => `m=${t.receiver.track.kind}\na=mid:${t.mid}`)
      .join('\n')
  }
  async createOffer() {
    this.transceptores.forEach((t, i) => (t.mid ??= String(i)))
    return { type: 'offer', sdp: this.sdp() }
  }
  async createAnswer() {
    return { type: 'answer', sdp: this.sdp() }
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d
    if (d.type !== 'offer') return
    const lineas = [...d.sdp.matchAll(/m=(\w+)\na=mid:(\S+)/g)].map((m) => ({ kind: m[1]!, mid: m[2]! }))
    for (const l of lineas) {
      let t = this.transceptores.find((x) => x.mid === null && x.porAddTrack && x.receiver.track.kind === l.kind)
      if (!t) {
        t = new Transceptor(l.kind, null, 'recvonly', false)
        this.transceptores.push(t)
      }
      t.mid = l.mid
      this.ontrack?.({ track: t.receiver.track, transceiver: t, streams: [] })
    }
  }
  async addIceCandidate() {}
  close() {
    this.cerrada = true
  }
  conectar() {
    this.connectionState = 'connected'
    this.onconnectionstatechange?.()
  }
}

let ordenes: OrdenTiempoReal[]
let operaciones: { op: string; e: unknown }[]
let emitir: (e: EventoChat) => void
let pantalla: FlujoFalso
let falloIniciar = ''
let grabadores: { iniciar: ReturnType<typeof vi.fn>; detener: ReturnType<typeof vi.fn>; cancelar: ReturnType<typeof vi.fn> }[]

beforeEach(async () => {
  vi.resetModules()
  conexiones.length = 0
  ordenes = []
  operaciones = []
  grabadores = []
  falloIniciar = ''
  pantalla = new FlujoFalso([new Pista('video')])
  vi.doMock('../src/renderer/chat/grabacion-llamada', () => ({
    GrabadorLlamada: class {
      iniciar = vi.fn(async () => {
        if (falloIniciar) throw new Error(falloIniciar)
      })
      detener = vi.fn(async () => ({ ruta: '/videos/Llamada con Ana.webm', nombre: 'Llamada con Ana.webm' }))
      cancelar = vi.fn(async () => undefined)
      segundos = 3
      constructor() {
        grabadores.push(this)
      }
    }
  }))
  const operar = vi.fn(async (op: string, e: { orden?: OrdenTiempoReal }) => {
    operaciones.push({ op, e })
    if (op === 'tiempoReal') return (ordenes.push(e.orden!), true)
    if (op === 'ice') return { servidores: [] }
    if (op === 'estado') return { conexion: 'conectado' }
    return op === 'contactos' ? { contactos: [], bloqueados: [] } : op === 'conversaciones' ? { conversaciones: [] } : {}
  })
  const globales: Record<string, unknown> = {
    window: { api: { chat: { operar, onEvento: (cb: (e: EventoChat) => void) => ((emitir = cb), () => undefined) }, notificaciones: { mostrar: async () => true } }, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener: () => undefined, removeEventListener: () => undefined },
    document: { hasFocus: () => true, hidden: false },
    localStorage: { getItem: () => null, setItem: () => undefined },
    navigator: {
      mediaDevices: {
        getUserMedia: async (c: { video: unknown }) => new FlujoFalso(c.video ? [new Pista('audio'), new Pista('video')] : [new Pista('audio')]),
        getDisplayMedia: vi.fn(async () => pantalla)
      }
    },
    RTCPeerConnection: ConexionFalsa,
    MediaStream: FlujoFalso
  }
  for (const [k, value] of Object.entries(globales)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true })
})
afterEach(() => {
  vi.doUnmock('../src/renderer/chat/grabacion-llamada')
  for (const k of ['window', 'document', 'localStorage', 'navigator', 'RTCPeerConnection', 'MediaStream']) delete (globalThis as Record<string, unknown>)[k]
})

const pausa = () => new Promise((r) => setTimeout(r, 5))

/** Llamo yo a Ana y la conexión queda establecida; devuelve el control y mi conexión. */
async function enLlamada(video: boolean) {
  const { almacenChat } = await import('../src/renderer/chat/almacen')
  const { controlLlamada } = await import('../src/renderer/chat/llamadas')
  almacenChat.iniciar()
  controlLlamada.iniciar()
  await pausa()
  await controlLlamada.llamar(ANA, video)
  const id = (ordenes.find((o) => o.t === 'llamada.invitar') as { llamadaId: string }).llamadaId
  emitir({ t: 'llamada.aceptada', llamadaId: id })
  await pausa()
  const pc = conexiones[0]!
  // El otro responde con las mismas líneas.
  emitir({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'respuesta', sdp: { type: 'answer', sdp: pc.localDescription!.sdp } } })
  await pausa()
  pc.conectar()
  return { controlLlamada, pc, id }
}

/** Me llama Ana, contesto y llega su oferta. */
async function contestando(video: boolean, oferta: string) {
  const { almacenChat } = await import('../src/renderer/chat/almacen')
  const { controlLlamada } = await import('../src/renderer/chat/llamadas')
  almacenChat.iniciar()
  controlLlamada.iniciar()
  await pausa()
  const id = '44444444-4444-4444-8444-444444444444'
  emitir({ t: 'llamada.entrante', llamadaId: id, de: ANA, video })
  await controlLlamada.contestar()
  emitir({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'oferta', sdp: { type: 'offer', sdp: oferta } } })
  await pausa()
  const pc = conexiones[0]!
  pc.conectar()
  return { controlLlamada, pc, id }
}

describe('orden de los canales de video', () => {
  it('ordena por la posición de su línea en el SDP, no por el orden de creación', () => {
    const t = (mid: string | null, kind = 'video') => ({ mid, receiver: { track: { kind } } })
    const a = t('2')
    const b = t('1')
    const audio = t('0', 'audio')
    expect(midsEnOrden('v=0\na=mid:0\nx\na=mid:1\na=mid:2')).toEqual(['0', '1', '2'])
    expect(ordenarVideo([a, audio, b], 'a=mid:0\na=mid:1\na=mid:2')).toEqual([b, a])
    // Sin SDP aún: orden de creación. Uno sin línea va al final.
    expect(ordenarVideo([a, b])).toEqual([a, b])
    const huerfano = t(null)
    expect(ordenarVideo([huerfano, b], 'a=mid:1')).toEqual([b, huerfano])
  })
})

describe('canales de la llamada', () => {
  it('quien llama negocia audio, cámara y pantalla, también en una llamada de voz', async () => {
    const { pc, controlLlamada } = await enLlamada(false)
    expect(pc.transceptores.map((t) => t.receiver.track.kind)).toEqual(['audio', 'video', 'video'])
    expect(controlLlamada.obtener().puedeCompartir).toBe(true)
  })

  it('quien contesta no crea canales propios (antes quedaba uno huérfano y su cámara no llegaba)', async () => {
    const oferta = 'm=audio\na=mid:0\nm=video\na=mid:1\nm=video\na=mid:2'
    const { pc, controlLlamada } = await contestando(true, oferta)
    expect(pc.agregados).toBe(0)
    expect(pc.transceptores.every((t) => t.mid !== null)).toBe(true)
    // Mi cámara (addTrack) quedó en la línea de cámara; el canal de pantalla, en enviar y recibir.
    const camara = pc.transceptores.find((t) => t.mid === '1')!
    expect(camara.sender.track?.kind).toBe('video')
    expect(pc.transceptores.find((t) => t.mid === '2')!.direction).toBe('sendrecv')
    expect(controlLlamada.obtener().puedeCompartir).toBe(true)
  })

  it('con un equipo antiguo (sin canal de pantalla) no se ofrece compartir', async () => {
    const { controlLlamada } = await contestando(true, 'm=audio\na=mid:0\nm=video\na=mid:1')
    expect(controlLlamada.obtener().puedeCompartir).toBe(false)
    await controlLlamada.compartirPantalla('screen:1:0')
    expect(controlLlamada.obtener().compartiendo).toBe(false)
    expect(controlLlamada.obtener().aviso).toMatch(/actualizar/)
  })

  it('lo que llega por el segundo canal de video es la pantalla del otro, no su cámara', async () => {
    const { controlLlamada } = await contestando(true, 'm=audio\na=mid:0\nm=video\na=mid:1\nm=video\na=mid:2')
    const v = controlLlamada.obtener()
    expect(v.remoto?.getTracks().map((t) => t.kind)).toEqual(['audio', 'video'])
    expect(v.pantallaRemota?.getVideoTracks()).toHaveLength(1)
  })
})

describe('compartir pantalla', () => {
  it('elige la fuente en main, la captura y la manda por el canal de pantalla sin tocar la cámara', async () => {
    const { controlLlamada, pc, id } = await enLlamada(true)
    const camara = pc.transceptores[1]!.sender.track
    await controlLlamada.compartirPantalla('window:42:0')
    expect(operaciones.find((o) => o.op === 'pantallaElegir')?.e).toEqual({ id: 'window:42:0' })
    const pista = pantalla.getVideoTracks()[0]!
    expect(pc.transceptores[2]!.sender.track).toBe(pista)
    expect(pc.transceptores[1]!.sender.track).toBe(camara)
    expect(pista.contentHint).toBe('detail')
    expect(pc.transceptores[2]!.sender.parametros).toMatchObject({ degradationPreference: 'maintain-resolution' })
    expect(controlLlamada.obtener()).toMatchObject({ compartiendo: true })
    expect(ordenes.at(-1)).toEqual({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'pantalla', activa: true } })

    await controlLlamada.dejarDeCompartir()
    expect(pc.transceptores[2]!.sender.track).toBeNull()
    expect(pista.readyState).toBe('ended')
    expect(controlLlamada.obtener().compartiendo).toBe(false)
    expect(ordenes.at(-1)).toEqual({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'pantalla', activa: false } })
  })

  it('si la ventana se cierra o el sistema corta la captura, deja de compartir solo', async () => {
    const { controlLlamada, pc } = await enLlamada(false)
    await controlLlamada.compartirPantalla('screen:0:0')
    const pista = pantalla.getVideoTracks()[0]!
    pista.onended?.()
    await pausa()
    expect(controlLlamada.obtener().compartiendo).toBe(false)
    expect(pc.transceptores[2]!.sender.track).toBeNull()
  })

  it('elegir otra ventana mientras se comparte la cambia y suelta la anterior', async () => {
    const { controlLlamada, pc } = await enLlamada(true)
    await controlLlamada.compartirPantalla('window:1:0')
    const primera = pantalla.getVideoTracks()[0]!
    pantalla = new FlujoFalso([new Pista('video')])
    await controlLlamada.compartirPantalla('window:2:0')
    expect(primera.readyState).toBe('ended')
    expect(pc.transceptores[2]!.sender.track).toBe(pantalla.getVideoTracks()[0])
    expect(controlLlamada.obtener().compartiendo).toBe(true)
  })

  it('si el sistema niega la captura lo explica y no cambia nada', async () => {
    const { controlLlamada } = await enLlamada(true)
    ;(navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await controlLlamada.compartirPantalla('screen:0:0')
    expect(controlLlamada.obtener().compartiendo).toBe(false)
    expect(controlLlamada.obtener().aviso).toMatch(/Grabación de pantalla/)
  })

  it('el aviso del otro muestra u oculta su pantalla; colgar suelta la mía', async () => {
    const { controlLlamada, id } = await enLlamada(true)
    emitir({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'pantalla', activa: true } })
    await pausa()
    expect(controlLlamada.obtener().pantallaRemotaActiva).toBe(true)
    await controlLlamada.compartirPantalla('screen:0:0')
    controlLlamada.colgar()
    expect(pantalla.getVideoTracks()[0]!.readyState).toBe('ended')
  })
})

describe('grabar la llamada', () => {
  it('avisa al otro al empezar y al parar, y deja «Mostrar en carpeta» aunque se cuelgue', async () => {
    const { controlLlamada, id } = await enLlamada(true)
    await controlLlamada.alternarGrabacion()
    expect(grabadores).toHaveLength(1)
    expect(grabadores[0]!.iniciar).toHaveBeenCalledWith('Ana')
    expect(controlLlamada.obtener().grabando).toBe(true)
    expect(ordenes.at(-1)).toEqual({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'grabacion', activa: true } })

    controlLlamada.colgar() // colgar guarda la grabación
    await pausa()
    expect(grabadores[0]!.detener).toHaveBeenCalled()
    expect(controlLlamada.obtener().grabacionGuardada).toEqual({ ruta: '/videos/Llamada con Ana.webm', nombre: 'Llamada con Ana.webm' })
    controlLlamada.mostrarGrabacion()
    expect(operaciones.at(-1)).toEqual({ op: 'mostrarGrabacion', e: { ruta: '/videos/Llamada con Ana.webm' } })
  })

  it('detener a mano avisa al otro y guarda', async () => {
    const { controlLlamada, id } = await enLlamada(false)
    await controlLlamada.alternarGrabacion()
    await controlLlamada.alternarGrabacion()
    expect(controlLlamada.obtener().grabando).toBe(false)
    expect(ordenes.at(-1)).toEqual({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'grabacion', activa: false } })
    expect(controlLlamada.obtener().grabacionGuardada?.nombre).toBe('Llamada con Ana.webm')
  })

  it('si no se puede empezar a grabar lo explica', async () => {
    const { controlLlamada } = await enLlamada(true)
    falloIniciar = 'no hay espacio en el disco'
    await controlLlamada.alternarGrabacion()
    expect(controlLlamada.obtener().grabando).toBe(false)
    expect(controlLlamada.obtener().aviso).toBe('No se pudo empezar a grabar: no hay espacio en el disco')
    expect(ordenes.some((o) => o.t === 'llamada.senal' && (o.datos as { tipo: string }).tipo === 'grabacion')).toBe(false)
  })

  it('el otro ve que lo están grabando', async () => {
    const { controlLlamada, id } = await enLlamada(true)
    emitir({ t: 'llamada.senal', llamadaId: id, datos: { tipo: 'grabacion', activa: true } })
    await pausa()
    expect(controlLlamada.obtener().grabandoRemoto).toBe(true)
  })
})
