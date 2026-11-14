import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AlmacenToken, type Cifrador } from '../github/token'
import { servidorSeguro, type EstadoSesion, type SesionDispositivo } from '@shared/sesion'

/** Error con un mensaje apto para mostrar tal cual en la interfaz. */
export class ErrorServidor extends Error {
  constructor(
    mensaje: string,
    readonly estado?: number,
    /** Código de la API para casos que la interfaz trata aparte (p. ej. `VERIFICACION_PENDIENTE`). */
    readonly codigo?: string
  ) {
    super(mensaje)
    this.name = 'ErrorServidor'
  }
}

/** No hay sesión (o el token venció): la interfaz debe mostrar la pantalla de acceso. */
/** No hubo respuesta (sin red, servidor caído o reiniciándose) o el servidor falló por dentro: lo último que se leyó sigue valiendo. */
export const esFalloDeConexion = (e: unknown): boolean => e instanceof ErrorServidor && !(e instanceof ErrorSesion) && (e.estado === undefined || e.estado >= 500)

export class ErrorSesion extends ErrorServidor {
  constructor(mensaje = 'Inicia sesión para continuar') {
    super(mensaje, 401)
    this.name = 'ErrorSesion'
  }
}

interface RespuestaSesion {
  token: string
  usuario: { id: string; email: string }
}

/** Respuesta de los pasos que no abren sesión (registro, reenvío, olvido): la misma exista o no el correo. */
export interface RespuestaPaso {
  pendiente: true
  mensaje: string
}

const TIEMPO_MAX_MS = 15_000
/** Pausas antes de reintentar una lectura que falló por la red (ms). */
const ESPERAS_REINTENTO = process.env.VITEST ? [1, 1] : [300, 1200]

/** Causa técnica de un `fetch` fallido (`ECONNRESET`, `ENOTFOUND`…), para el registro. */
const causaDe = (err: unknown): string => {
  const c = (err as { cause?: { code?: string; message?: string } } | undefined)?.cause
  return c?.code ?? c?.message ?? (err instanceof Error ? err.message : String(err))
}

const limpiarUrl = (u: string): string => u.trim().replace(/\/+$/, '')

/**
 * Cliente HTTP del backend. Guarda el JWT (cifrado con el llavero del sistema; sin llavero, solo en memoria) y lo manda en cada
 * petición. El renderer nunca ve el token: todo pasa por el proceso principal.
 */
export class ClienteServidor {
  private almacen?: AlmacenToken
  private email?: string
  private usuarioId?: string
  private token?: string
  private persistente = false
  private cargado?: Promise<void>

  private direccion: string
  private archivoUrl?: string
  /** Se avisa cuando el servidor rechaza el token y la sesión se cierra sola (la interfaz vuelve al acceso). */
  alPerderSesion?: () => void

  constructor(url = process.env.ODESK_API_URL || 'http://localhost:3000') {
    this.direccion = limpiarUrl(url)
  }

  /**
   * Dirección por defecto de esta instalación (la app empaquetada usa el servidor de producción; en desarrollo sigue `localhost`).
   * Se llama antes de `configurar`: lo que el usuario guardó en `servidor.json` y la variable `ODESK_API_URL` mandan sobre ella.
   */
  usarPorDefecto(url: string): void {
    if (!process.env.ODESK_API_URL) this.direccion = limpiarUrl(url)
  }

  get url(): string {
    return this.direccion
  }

  /**
   * `archivo`: dónde se guarda el token; `archivoUrl`: `servidor.json` con `{ "url": "https://…" }`. La variable `ODESK_API_URL`
   * manda sobre el archivo; sin ninguna de las dos se usa la dirección por defecto (`usarPorDefecto`, o `http://localhost:3000`).
   */
  configurar(archivo: string, cifrador: Cifrador, archivoUrl?: string): void {
    this.almacen = new AlmacenToken(archivo, cifrador)
    this.cargado = undefined
    this.archivoUrl = archivoUrl
    if (archivoUrl && !process.env.ODESK_API_URL) {
      try {
        const j = JSON.parse(readFileSync(archivoUrl, 'utf8')) as { url?: unknown }
        if (typeof j.url === 'string') this.direccion = limpiarUrl(j.url)
      } catch {
        // sin archivo o ilegible: se queda la dirección por defecto
      }
    }
  }

  /** Cambia el servidor al que se conecta esta instalación; la sesión anterior era de otro servidor, así que se cierra. */
  async fijarUrl(url: string): Promise<EstadoSesion> {
    let u: URL
    try {
      u = new URL(url.trim())
    } catch {
      throw new ErrorServidor('La dirección del servidor no es válida (ej. https://api.midominio.com).')
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ErrorServidor('La dirección debe empezar por http:// o https://.')
    const nueva = limpiarUrl(u.origin + u.pathname)
    if (nueva !== this.direccion) await this.olvidar() // la sesión era del otro servidor: aquí no hay que revocarla
    this.direccion = nueva
    if (this.archivoUrl) {
      await mkdir(dirname(this.archivoUrl), { recursive: true })
      await writeFile(this.archivoUrl, JSON.stringify({ url: nueva }, null, 2) + '\n', 'utf8')
    }
    return this.estado()
  }

  private cargar(): Promise<void> {
    this.cargado ??= (async () => {
      const g = await this.almacen?.leer()
      if (g) {
        this.token = g.token
        this.email = g.usuario
        this.persistente = g.persistente
      }
    })()
    return this.cargado
  }

  async estado(): Promise<EstadoSesion> {
    await this.cargar()
    return {
      activa: !!this.token,
      ...(this.email ? { email: this.email } : {}),
      ...(this.usuarioId ? { usuarioId: this.usuarioId } : {}),
      servidor: this.url,
      persistente: this.persistente
    }
  }

  async iniciar(email: string, password: string): Promise<EstadoSesion> {
    return this.establecer(await this.peticion<RespuestaSesion>('POST', '/auth/login', { email, password }, false))
  }

  /** Crea la cuenta: no abre sesión, el servidor manda un código al correo. */
  registrar(email: string, password: string): Promise<RespuestaPaso> {
    return this.peticion<RespuestaPaso>('POST', '/auth/register', { email, password }, false)
  }

  /** Activa la cuenta: el servidor exige el código del correo y la contraseña con la que se registró. */
  async verificar(email: string, code: string, password: string): Promise<EstadoSesion> {
    return this.establecer(await this.peticion<RespuestaSesion>('POST', '/auth/verify', { email, code, password }, false))
  }

  reenviarVerificacion(email: string): Promise<RespuestaPaso> {
    return this.peticion<RespuestaPaso>('POST', '/auth/verify/resend', { email }, false)
  }

  olvidePassword(email: string): Promise<RespuestaPaso> {
    return this.peticion<RespuestaPaso>('POST', '/auth/password/forgot', { email }, false)
  }

  /** Nueva contraseña con el código del correo: el servidor cierra las demás sesiones y abre una. */
  async restablecer(email: string, code: string, password: string): Promise<EstadoSesion> {
    return this.establecer(await this.peticion<RespuestaSesion>('POST', '/auth/password/reset', { email, code, password }, false))
  }

  /** Cambia la contraseña; el servidor cierra la sesión en los demás equipos (en este sigue abierta). */
  async cambiarPassword(actual: string, nueva: string): Promise<void> {
    await this.peticion('POST', '/auth/password', { actual, nueva })
  }

  /** Cabeceras con las que el servidor reconoce este equipo en «Dispositivos conectados» (ver `identificarEquipo`). */
  private equipo: Record<string, string> = {}

  /**
   * Identifica este equipo ante el servidor en cada petición con sesión: id de «Mis equipos», nombre, sistema y versión de la app.
   * El nombre va codificado: una cabecera HTTP no admite «ñ» ni tildes tal cual.
   */
  identificarEquipo(e: { id: string; nombre: string; plataforma: string; version: string }): void {
    this.equipo = { 'x-odesk-equipo': e.id, 'x-odesk-equipo-nombre': encodeURIComponent(e.nombre.slice(0, 120)), 'x-odesk-plataforma': e.plataforma, 'x-odesk-version': e.version }
  }

  /** Sesiones abiertas de la cuenta (`actual` = la de este equipo). */
  dispositivos(): Promise<SesionDispositivo[]> {
    return this.peticion<SesionDispositivo[]>('GET', '/auth/sessions')
  }

  /** Cierra la sesión de otro dispositivo: su token deja de valer al momento. */
  async cerrarDispositivo(id: string): Promise<void> {
    await this.peticion('DELETE', `/auth/sessions/${encodeURIComponent(id)}`)
  }

  /** Cierra la sesión en todos los dispositivos menos en este. */
  cerrarOtros(): Promise<{ cerradas: number }> {
    return this.peticion<{ cerradas: number }>('POST', '/auth/sessions/close-others', {})
  }

  /** Cierra la sesión en todos los equipos (también en este). */
  async cerrarTodas(): Promise<EstadoSesion> {
    await this.peticion('POST', '/auth/logout-all', {}).catch(() => undefined)
    return this.olvidar()
  }

  /** Cambia el código de un solo uso de Google por la sesión del servidor y la deja iniciada. */
  async canjearGoogle(code: string): Promise<EstadoSesion> {
    return this.establecer(await this.peticion<RespuestaSesion>('POST', '/auth/google/exchange', { code }, false))
  }

  /** ¿El servidor tiene configurado el login con Google? */
  async googleDisponible(): Promise<boolean> {
    return (await this.peticion<{ disponible: boolean }>('GET', '/auth/google/disponible', undefined, false)).disponible
  }

  private async establecer(r: RespuestaSesion): Promise<EstadoSesion> {
    this.token = r.token
    this.email = r.usuario.email
    this.usuarioId = r.usuario.id
    this.persistente = (await this.almacen?.guardar(r.token, r.usuario.email)) ?? false
    this.cargado = Promise.resolve()
    return this.estado()
  }

  /** Cierra la sesión: la revoca en el servidor (si responde) y olvida el token aquí. */
  async cerrar(): Promise<EstadoSesion> {
    await this.cargar()
    if (this.token) await this.peticion('POST', '/auth/logout', {}).catch(() => undefined)
    return this.olvidar()
  }

  /** Olvida el token sin avisar al servidor (ya no vale, o el servidor no responde). */
  private async olvidar(): Promise<EstadoSesion> {
    this.token = undefined
    this.email = undefined
    this.usuarioId = undefined
    this.persistente = false
    this.cargado = Promise.resolve()
    await this.almacen?.borrar()
    return this.estado()
  }

  get<T>(ruta: string): Promise<T> {
    return this.peticion<T>('GET', ruta)
  }
  post<T>(ruta: string, cuerpo?: unknown): Promise<T> {
    return this.peticion<T>('POST', ruta, cuerpo)
  }
  put<T>(ruta: string, cuerpo?: unknown): Promise<T> {
    return this.peticion<T>('PUT', ruta, cuerpo)
  }
  delete<T = void>(ruta: string, cuerpo?: unknown): Promise<T> {
    return this.peticion<T>('DELETE', ruta, cuerpo)
  }

  /** Descarga un archivo con sesión (el contenido llega entero en memoria: úsalo solo para adjuntos acotados por el servidor). */
  descargar(ruta: string, espera = 90_000): Promise<{ datos: Uint8Array; tipo: string }> {
    return this.peticion<{ datos: Uint8Array; tipo: string }>('GET', ruta, undefined, true, { bytes: true, espera })
  }

  /** Token de la sesión para abrir el WebSocket del chat. Solo para el proceso principal: la interfaz nunca lo ve. */
  async tokenActual(): Promise<string | undefined> {
    await this.cargar()
    return this.token
  }

  /** Envía datos binarios (p. ej. un audio) con sesión. `espera` es más larga que la de las peticiones JSON. */
  binario<T>(ruta: string, datos: Uint8Array, tipo: string, cabeceras: Record<string, string> = {}, espera = 90_000): Promise<T> {
    return this.peticion<T>('POST', ruta, undefined, true, { binario: { datos, tipo, cabeceras }, espera })
  }

  private async peticion<T>(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
    conSesion = true,
    { binario, bytes, espera = TIEMPO_MAX_MS }: { binario?: { datos: Uint8Array; tipo: string; cabeceras: Record<string, string> }; bytes?: boolean; espera?: number } = {}
  ): Promise<T> {
    await this.cargar()
    if (conSesion && !this.token) throw new ErrorSesion()
    // Contraseñas y token nunca por http hacia otra máquina (ODESK_PERMITIR_HTTP=1 lo permite, solo para pruebas en una red propia).
    if (!servidorSeguro(this.url) && process.env.ODESK_PERMITIR_HTTP !== '1') {
      throw new ErrorServidor(`El servidor ${this.url} no usa https: no se envían contraseñas ni tokens sin cifrar. Usa una dirección https://.`)
    }
    // Un corte puntual (conexión en reposo que el servidor ya cerró, cambio de red, reinicio del servidor) no debe tumbar la operación:
    // las lecturas se reintentan. Lo que escribe no se repite (podría aplicarse dos veces), y un tiempo agotado tampoco (ya esperó de sobra).
    const intentos = metodo === 'GET' ? ESPERAS_REINTENTO.length + 1 : 1
    let res: Response | undefined
    for (let i = 0; !res; i++) {
      try {
        res = await fetch(this.url + ruta, {
          method: metodo,
          headers: {
            ...(binario ? { 'content-type': binario.tipo, ...binario.cabeceras } : cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(conSesion && this.token ? { authorization: `Bearer ${this.token}`, ...this.equipo } : {})
          },
          ...(binario ? { body: new Uint8Array(binario.datos) } : cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
          signal: AbortSignal.timeout(espera)
        })
      } catch (err) {
        const agotado = err instanceof Error && err.name === 'TimeoutError'
        if (i + 1 < intentos && !agotado) {
          await new Promise((r) => setTimeout(r, ESPERAS_REINTENTO[i]))
          continue
        }
        console.warn(`Servidor: ${metodo} ${ruta.split('?')[0]} falló (${causaDe(err)})`)
        throw new ErrorServidor(`No se pudo conectar con el servidor (${this.url}). ¿Está en marcha?`)
      }
    }
    if (res.status === 401 && conSesion) {
      await this.olvidar() // token vencido o revocado
      this.alPerderSesion?.()
      throw new ErrorSesion('La sesión venció. Vuelve a iniciar sesión.')
    }
    if (!res.ok) {
      const e = await errorDe(res)
      throw new ErrorServidor(e.mensaje, res.status, e.codigo)
    }
    if (res.status === 204) return undefined as T
    if (bytes) return { datos: new Uint8Array(await res.arrayBuffer()), tipo: res.headers.get('content-type') ?? '' } as T
    return (await res.json()) as T
  }
}

/** Los errores de Nest vienen como { message: string | string[], codigo?: string }. */
async function errorDe(res: Response): Promise<{ mensaje: string; codigo?: string }> {
  try {
    const j = (await res.json()) as { message?: string | string[]; codigo?: unknown }
    const m = Array.isArray(j.message) ? j.message.join('; ') : j.message
    if (m) return { mensaje: m, ...(typeof j.codigo === 'string' ? { codigo: j.codigo } : {}) }
  } catch {
    // cuerpo no JSON
  }
  return { mensaje: `El servidor respondió ${res.status}` }
}

export const servidor = new ClienteServidor()
