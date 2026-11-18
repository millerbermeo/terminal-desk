import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

/**
 * Servidor WebSocket mínimo (RFC 6455, solo texto) para el puente con la extensión de Chrome. Sin dependencias: solo lo que hace falta
 * para hablar con `new WebSocket()` de un navegador (máscara del cliente, fragmentos, ping/pong, cierre). Escucha SOLO en 127.0.0.1.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** Una captura de pantalla de página completa en base64 puede ocupar varios MB. */
export const MAX_MENSAJE = 48 * 1024 * 1024

export interface ConexionWs {
  /** Origen declarado por el cliente (`chrome-extension://<id>`). */
  readonly origen: string
  enviar(texto: string): void
  cerrar(codigo?: number, motivo?: string): void
  readonly abierta: boolean
  alMensaje?: (texto: string) => void
  alCerrar?: () => void
}

export interface OpcionesWs {
  puerto: number
  /** Decide si se acepta un cliente por su cabecera Origin (las páginas web no pueden falsearla). */
  aceptarOrigen: (origen: string) => boolean
  alConectar: (c: ConexionWs) => void
}

/** `Sec-WebSocket-Accept` para una `Sec-WebSocket-Key`. */
export const claveAceptacion = (clave: string): string => createHash('sha1').update(clave + GUID).digest('base64')

/** Trama de servidor (sin máscara). */
export function trama(opcode: number, datos: Buffer): Buffer {
  const n = datos.length
  const cab = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10)
  cab[0] = 0x80 | opcode
  if (n < 126) cab[1] = n
  else if (n < 65536) {
    cab[1] = 126
    cab.writeUInt16BE(n, 2)
  } else {
    cab[1] = 127
    cab.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([cab, datos])
}

/** Lector de tramas de cliente: acumula bytes y devuelve las tramas completas. Lanza ante un protocolo inválido. */
export class LectorTramas {
  private buf: Buffer = Buffer.alloc(0)

  leer(trozo: Buffer): { fin: boolean; opcode: number; datos: Buffer }[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, trozo]) : trozo
    const tramas: { fin: boolean; opcode: number; datos: Buffer }[] = []
    for (;;) {
      if (this.buf.length < 2) break
      const b0 = this.buf[0]!
      const b1 = this.buf[1]!
      if (b0 & 0x70) throw new Error('bits reservados')
      if (!(b1 & 0x80)) throw new Error('trama de cliente sin máscara')
      let largo = b1 & 0x7f
      let pos = 2
      if (largo === 126) {
        if (this.buf.length < 4) break
        largo = this.buf.readUInt16BE(2)
        pos = 4
      } else if (largo === 127) {
        if (this.buf.length < 10) break
        const grande = this.buf.readBigUInt64BE(2)
        if (grande > BigInt(MAX_MENSAJE)) throw new Error('mensaje demasiado grande')
        largo = Number(grande)
        pos = 10
      }
      if (largo > MAX_MENSAJE) throw new Error('mensaje demasiado grande')
      if (this.buf.length < pos + 4 + largo) break
      const mascara = this.buf.subarray(pos, pos + 4)
      const datos = Buffer.from(this.buf.subarray(pos + 4, pos + 4 + largo))
      for (let i = 0; i < datos.length; i++) datos[i] = datos[i]! ^ mascara[i & 3]!
      tramas.push({ fin: Boolean(b0 & 0x80), opcode: b0 & 0x0f, datos })
      this.buf = this.buf.subarray(pos + 4 + largo)
    }
    return tramas
  }
}

function conexion(socket: Socket, origen: string): ConexionWs {
  const lector = new LectorTramas()
  let partes: Buffer[] = []
  let total = 0
  let abierta = true
  const c: ConexionWs = {
    origen,
    get abierta() {
      return abierta
    },
    enviar(texto) {
      if (abierta) socket.write(trama(0x1, Buffer.from(texto, 'utf8')))
    },
    cerrar(codigo = 1000, motivo = '') {
      if (!abierta) return
      abierta = false
      const cuerpo = Buffer.alloc(2 + Buffer.byteLength(motivo))
      cuerpo.writeUInt16BE(codigo, 0)
      cuerpo.write(motivo, 2)
      socket.end(trama(0x8, cuerpo))
    }
  }
  const terminar = (): void => {
    if (abierta) abierta = false
    socket.destroy()
    c.alCerrar?.()
    c.alCerrar = undefined
  }
  socket.on('data', (trozo: Buffer) => {
    let tramas
    try {
      tramas = lector.leer(trozo)
    } catch {
      c.cerrar(1002, 'protocolo')
      return terminar()
    }
    for (const t of tramas) {
      if (t.opcode === 0x8) {
        c.cerrar()
        return terminar()
      }
      if (t.opcode === 0x9) {
        if (abierta) socket.write(trama(0xa, t.datos))
        continue
      }
      if (t.opcode === 0xa) continue
      if (t.opcode === 0x2) {
        c.cerrar(1003, 'solo texto')
        return terminar()
      }
      // 0x1 texto o 0x0 continuación
      partes.push(t.datos)
      total += t.datos.length
      if (total > MAX_MENSAJE) {
        c.cerrar(1009, 'demasiado grande')
        return terminar()
      }
      if (t.fin) {
        const texto = Buffer.concat(partes).toString('utf8')
        partes = []
        total = 0
        try {
          c.alMensaje?.(texto)
        } catch {
          // un fallo del receptor no tumba la conexión
        }
      }
    }
  })
  socket.on('close', terminar)
  socket.on('error', terminar)
  socket.setNoDelay(true)
  return c
}

/** Arranca el servidor. Rechaza cualquier petición HTTP normal y todo origen no aceptado. */
export function servirWs(o: OpcionesWs): Promise<{ servidor: Server; puerto: number }> {
  const servidor = createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' })
    res.end('Odesk: solo WebSocket')
  })
  servidor.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    const origen = String(req.headers.origin ?? '')
    const clave = req.headers['sec-websocket-key']
    const valido = req.headers.upgrade?.toLowerCase() === 'websocket' && typeof clave === 'string' && req.headers['sec-websocket-version'] === '13'
    if (!valido || !o.aceptarOrigen(origen)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${claveAceptacion(clave)}`, '', ''].join('\r\n'))
    o.alConectar(conexion(socket, origen))
  })
  return new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar)
    servidor.listen(o.puerto, '127.0.0.1', () => {
      servidor.off('error', rechazar)
      resolver({ servidor, puerto: (servidor.address() as AddressInfo).port })
    })
  })
}
