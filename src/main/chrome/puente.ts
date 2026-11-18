import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { dirname } from 'node:path'
import { INTENTOS_CODIGO, PROTOCOLO_CHROME, PUERTOS_CHROME, VIGENCIA_CODIGO_MS, type ExtensionEmparejada, type PestanaChrome } from '@shared/chrome'
import { servirWs, type ConexionWs } from './ws'

/**
 * Puente entre Odesk y la extensión de Chrome. La extensión se conecta por WebSocket a 127.0.0.1 (las páginas web no pueden: se exige
 * origen `chrome-extension://`), se empareja UNA vez con un código de 6 cifras que muestra Odesk y desde entonces entra con un token
 * (aquí solo se guarda su SHA-256, atado al origen de esa extensión). Una sola extensión conectada a la vez: la nueva sustituye a la vieja.
 *
 * Mensajes (JSON): extensión → Odesk `hola {token, protocolo, navegador, version}` | `emparejar {codigo, navegador, version}` |
 * `respuesta {id, ok, valor|error}` | `evento {pestana, metodo, params}` | `pestanas {lista, pausado}` | `latido`.
 * Odesk → extensión `bienvenida {token?}` | `rechazo {motivo}` | `pedir {id, op, ...}` | `latido`.
 */

const ESPERA_SALUDO_MS = 10_000
const SIN_NOTICIAS_MS = 70_000
const TOPE_PETICION_MS = 30_000

interface Registro {
  id: string
  nombre: string
  origen: string
  hash: string
  creada: number
  ultimoUso?: number
}

export interface DatosChrome {
  activo: boolean
  extensiones: Registro[]
  sitios: string[]
}

const DATOS_VACIOS: DatosChrome = { activo: true, extensiones: [], sitios: [] }

const sha = (t: string): string => createHash('sha256').update(t).digest('hex')
const iguales = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Solo extensiones de navegadores Chromium (Chrome, Edge, Brave… usan este esquema). */
export const origenExtension = (origen: string): boolean => /^chrome-extension:\/\/[a-p]{32}$/.test(origen)

export interface EventoPagina {
  pestana: number
  metodo: string
  params: Record<string, unknown>
}

export interface OpcionesPuente {
  archivo: string
  puertos?: readonly number[]
  /** Para pruebas: qué orígenes se aceptan (por defecto, solo `chrome-extension://`). */
  aceptarOrigen?: (origen: string) => boolean
}

export class PuenteChrome {
  private datos: DatosChrome = { ...DATOS_VACIOS }
  private cargado?: Promise<void>
  private servidor?: Server
  puerto: number | null = null
  error?: string
  private conexion?: { ws: ConexionWs; registro: Registro; navegador: string; version: string }
  private codigo?: { codigo: string; expira: number; intentos: number }
  private readonly pendientes = new Map<string, { resolver: (v: unknown) => void; rechazar: (e: Error) => void; t: NodeJS.Timeout }>()
  pestanas: PestanaChrome[] = []
  pausado = false
  /** Se llama cuando cambia algo visible (conexión, pestañas, código…). */
  alCambio?: () => void
  /** Eventos del protocolo de DevTools de las pestañas controladas (consola, red, diálogos). */
  alEvento?: (e: EventoPagina) => void

  constructor(private readonly o: OpcionesPuente) {}

  private async cargar(): Promise<void> {
    this.cargado ??= readFile(this.o.archivo, 'utf8')
      .then((t) => {
        const d = JSON.parse(t) as Partial<DatosChrome>
        this.datos = { activo: d.activo !== false, extensiones: Array.isArray(d.extensiones) ? d.extensiones : [], sitios: Array.isArray(d.sitios) ? d.sitios.filter((s) => typeof s === 'string') : [] }
      })
      .catch(() => undefined)
    return this.cargado
  }

  private escritura: Promise<unknown> = Promise.resolve()

  /** Escrituras en cola (dos guardados a la vez compartirían el temporal) y atómicas. */
  private guardar(): Promise<void> {
    const p = this.escritura.then(async () => {
      await mkdir(dirname(this.o.archivo), { recursive: true })
      const tmp = `${this.o.archivo}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(this.datos, null, 2), { mode: 0o600 })
      await rename(tmp, this.o.archivo)
    })
    this.escritura = p.catch(() => undefined)
    return p
  }

  async leerDatos(): Promise<DatosChrome> {
    await this.cargar()
    return this.datos
  }

  async cambiarDatos(f: (d: DatosChrome) => void): Promise<void> {
    await this.cargar()
    f(this.datos)
    await this.guardar()
    this.alCambio?.()
  }

  /** Abre el puerto (el primero libre de la lista). No lanza: si no puede, queda en `error`. */
  async iniciar(): Promise<void> {
    await this.cargar()
    for (const puerto of this.o.puertos ?? PUERTOS_CHROME) {
      try {
        const r = await servirWs({ puerto, aceptarOrigen: this.o.aceptarOrigen ?? origenExtension, alConectar: (ws) => this.recibir(ws) })
        this.servidor = r.servidor
        this.puerto = r.puerto
        this.error = undefined
        return
      } catch {
        // ocupado: el siguiente
      }
    }
    this.error = `Los puertos ${(this.o.puertos ?? PUERTOS_CHROME).join(', ')} están ocupados: la extensión no podrá conectarse.`
  }

  async detener(): Promise<void> {
    this.conexion?.ws.cerrar(1001, 'Odesk se cierra')
    await new Promise<void>((r) => (this.servidor ? this.servidor.close(() => r()) : r()))
    this.servidor = undefined
  }

  get conectado(): boolean {
    return Boolean(this.conexion?.ws.abierta)
  }

  get navegador(): { nombre: string; version: string } | undefined {
    return this.conexion ? { nombre: this.conexion.navegador, version: this.conexion.version } : undefined
  }

  get codigoVigente(): { codigo: string; expira: number } | undefined {
    if (this.codigo && this.codigo.expira > Date.now()) return { codigo: this.codigo.codigo, expira: this.codigo.expira }
    return undefined
  }

  emparejadas(): ExtensionEmparejada[] {
    return this.datos.extensiones.map(({ hash: _h, ...r }) => r)
  }

  /** Nuevo código de emparejamiento (sustituye al anterior). */
  nuevoCodigo(): { codigo: string; expira: number } {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.codigo = { codigo, expira: Date.now() + VIGENCIA_CODIGO_MS, intentos: 0 }
    this.alCambio?.()
    return { codigo, expira: this.codigo.expira }
  }

  cancelarCodigo(): void {
    this.codigo = undefined
    this.alCambio?.()
  }

  /** Olvida una extensión (o todas): su token deja de valer y, si está conectada, se corta. */
  async olvidar(id?: string): Promise<void> {
    await this.cambiarDatos((d) => {
      d.extensiones = id ? d.extensiones.filter((x) => x.id !== id) : []
    })
    if (this.conexion && (!id || this.conexion.registro.id === id)) {
      this.conexion.ws.enviar(JSON.stringify({ t: 'rechazo', motivo: 'olvidada' }))
      this.conexion.ws.cerrar(4001, 'olvidada')
    }
  }

  /** Pide algo a la extensión y espera la respuesta. */
  pedir<T = unknown>(op: string, datos: Record<string, unknown> = {}, topeMs = TOPE_PETICION_MS): Promise<T> {
    const c = this.conexion
    if (!c?.ws.abierta) return Promise.reject(new Error('Chrome no está conectado: abre Chrome con la extensión de Odesk (y emparéjala en Odesk → Proveedores de IA → Chrome).'))
    const id = randomUUID()
    return new Promise<T>((resolver, rechazar) => {
      const t = setTimeout(() => {
        this.pendientes.delete(id)
        rechazar(new Error(`Chrome no respondió a tiempo (${op}).`))
      }, topeMs)
      this.pendientes.set(id, { resolver: resolver as (v: unknown) => void, rechazar, t })
      c.ws.enviar(JSON.stringify({ t: 'pedir', id, op, ...datos }))
    })
  }

  private cortarPendientes(motivo: string): void {
    for (const [id, p] of this.pendientes) {
      clearTimeout(p.t)
      p.rechazar(new Error(motivo))
      this.pendientes.delete(id)
    }
  }

  private recibir(ws: ConexionWs): void {
    let registro: Registro | undefined
    let ultimo = Date.now()
    const saludo = setTimeout(() => !registro && ws.cerrar(4000, 'sin saludo'), ESPERA_SALUDO_MS)
    const vigia = setInterval(() => Date.now() - ultimo > SIN_NOTICIAS_MS && ws.cerrar(4002, 'sin latido'), 15_000)
    const rechazar = (motivo: string): void => {
      ws.enviar(JSON.stringify({ t: 'rechazo', motivo }))
      ws.cerrar(4001, motivo)
    }
    ws.alCerrar = () => {
      clearTimeout(saludo)
      clearInterval(vigia)
      if (this.conexion?.ws === ws) {
        this.conexion = undefined
        this.pestanas = []
        this.cortarPendientes('Se perdió la conexión con Chrome.')
        this.alCambio?.()
      }
    }
    ws.alMensaje = (texto) => {
      ultimo = Date.now()
      let m: Record<string, unknown>
      try {
        m = JSON.parse(texto) as Record<string, unknown>
      } catch {
        return rechazar('mensaje inválido')
      }
      if (!registro) return void this.saludar(ws, m, (r) => (registro = r), rechazar)
      this.mensaje(ws, m)
    }
  }

  private async saludar(ws: ConexionWs, m: Record<string, unknown>, aceptar: (r: Registro) => void, rechazar: (motivo: string) => void): Promise<void> {
    await this.cargar()
    const navegador = String(m.navegador ?? 'Chrome').slice(0, 80)
    const version = String(m.version ?? '').slice(0, 20)
    if (Number(m.protocolo) !== PROTOCOLO_CHROME) return rechazar('protocolo')
    let registro: Registro | undefined
    let token: string | undefined
    if (m.t === 'hola' && typeof m.token === 'string') {
      const h = sha(m.token)
      registro = this.datos.extensiones.find((x) => iguales(x.hash, h) && x.origen === ws.origen)
      if (!registro) return rechazar('token')
    } else if (m.t === 'emparejar' && typeof m.codigo === 'string') {
      const c = this.codigo
      if (!c || c.expira < Date.now()) return rechazar('sin-codigo')
      if (++c.intentos > INTENTOS_CODIGO) {
        this.codigo = undefined
        this.alCambio?.()
        return rechazar('intentos')
      }
      if (!iguales(m.codigo.trim(), c.codigo)) return rechazar('codigo')
      this.codigo = undefined
      token = randomBytes(32).toString('base64url')
      registro = { id: randomUUID(), nombre: navegador, origen: ws.origen, hash: sha(token), creada: Date.now() }
      // Una extensión vuelta a emparejar (mismo origen) sustituye a la anterior.
      const nuevo = registro
      await this.cambiarDatos((d) => {
        d.extensiones = [...d.extensiones.filter((x) => x.origen !== nuevo.origen), nuevo]
      })
    } else return rechazar('saludo')
    registro.ultimoUso = Date.now()
    registro.nombre = navegador
    void this.guardar().catch(() => undefined)
    aceptar(registro)
    if (this.conexion && this.conexion.ws !== ws) {
      this.cortarPendientes('Otra ventana de Chrome tomó el control.')
      this.conexion.ws.cerrar(4003, 'sustituida')
    }
    this.conexion = { ws, registro, navegador, version }
    ws.enviar(JSON.stringify({ t: 'bienvenida', ...(token ? { token } : {}) }))
    this.alCambio?.()
  }

  private mensaje(ws: ConexionWs, m: Record<string, unknown>): void {
    if (this.conexion?.ws !== ws) return
    switch (m.t) {
      case 'latido':
        return ws.enviar(JSON.stringify({ t: 'latido' }))
      case 'respuesta': {
        const p = this.pendientes.get(String(m.id))
        if (!p) return
        this.pendientes.delete(String(m.id))
        clearTimeout(p.t)
        if (m.ok === true) p.resolver(m.valor)
        else p.rechazar(new Error(String(m.error ?? 'Error en Chrome.')))
        return
      }
      case 'pestanas':
        this.pestanas = Array.isArray(m.lista) ? (m.lista as PestanaChrome[]).filter((x) => typeof x?.id === 'number').slice(0, 200) : []
        this.pausado = m.pausado === true
        return this.alCambio?.()
      case 'evento':
        if (typeof m.pestana === 'number' && typeof m.metodo === 'string') this.alEvento?.({ pestana: m.pestana, metodo: m.metodo, params: (m.params as Record<string, unknown>) ?? {} })
    }
  }
}
