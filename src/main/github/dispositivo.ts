/**
 * Inicio de sesión de GitHub con el «flujo de dispositivo» (OAuth): la app pide un código, el usuario lo escribe en github.com/login/device
 * y la app consulta hasta recibir el token. No hace falta secreto de cliente ni servidor de redirección: solo el Client ID de una OAuth App.
 */

export class ErrorDispositivo extends Error {
  constructor(
    mensaje: string,
    readonly motivo: 'denegado' | 'expirado' | 'cancelado' | 'configuracion' | 'red' = 'red'
  ) {
    super(mensaje)
    this.name = 'ErrorDispositivo'
  }
}

export interface CodigoPedido {
  deviceCode: string
  codigoUsuario: string
  urlVerificacion: string
  /** Segundos entre consultas que pide GitHub. */
  intervalo: number
  /** Segundos de vigencia. */
  expiraEn: number
}

/** Permisos que usa la app: repositorios y pull requests (`repo`), flujos de CI (`workflow`) y el nombre del usuario. */
export const PERMISOS_OAUTH = 'repo workflow read:user'

type Json = Record<string, unknown>
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const numero = (v: unknown, defecto: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : defecto)

async function enviar(url: string, cuerpo: Record<string, string>, f: typeof fetch): Promise<Json> {
  let r: Response
  try {
    r = await f(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(cuerpo).toString(),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new ErrorDispositivo(`No se pudo conectar con GitHub: ${(err as Error).message}`, 'red')
  }
  let j: unknown
  try {
    j = await r.json()
  } catch {
    throw new ErrorDispositivo(`GitHub respondió ${r.status} con algo que no se entiende.`, 'red')
  }
  return j !== null && typeof j === 'object' ? (j as Json) : {}
}

/** Explica el error que devuelve GitHub al pedir el código. */
function errorDeCodigo(j: Json): ErrorDispositivo {
  const e = texto(j.error)
  if (e === 'device_flow_disabled') return new ErrorDispositivo('Esa OAuth App no tiene activado el «Device Flow». Actívalo en GitHub → Settings → Developer settings → OAuth Apps → tu app.', 'configuracion')
  if (e === 'incorrect_client_credentials' || e === 'unauthorized_client') return new ErrorDispositivo('GitHub no reconoce ese Client ID. Revísalo en la página de tu OAuth App.', 'configuracion')
  return new ErrorDispositivo(`GitHub rechazó la solicitud${texto(j.error_description) ? `: ${texto(j.error_description)}` : e ? ` (${e})` : ''}.`, 'configuracion')
}

export async function pedirCodigo(base: string, clientId: string, f: typeof fetch = fetch): Promise<CodigoPedido> {
  const j = await enviar(`${base.replace(/\/$/, '')}/login/device/code`, { client_id: clientId, scope: PERMISOS_OAUTH }, f)
  if (!texto(j.device_code) || !texto(j.user_code) || !texto(j.verification_uri)) throw errorDeCodigo(j)
  return {
    deviceCode: texto(j.device_code),
    codigoUsuario: texto(j.user_code),
    urlVerificacion: texto(j.verification_uri),
    intervalo: numero(j.interval, 5),
    expiraEn: numero(j.expires_in, 900)
  }
}

/** El token que entrega GitHub. Con «Expire user access tokens» activado trae también `refresh` y sus duraciones (en segundos). */
export interface ConcesionToken {
  token: string
  refresh?: string
  expiraEn?: number
  refrescaEn?: number
}

function concesionDe(j: Json): ConcesionToken | undefined {
  if (!texto(j.access_token)) return undefined
  return {
    token: texto(j.access_token),
    ...(texto(j.refresh_token) ? { refresh: texto(j.refresh_token) } : {}),
    ...(typeof j.expires_in === 'number' && j.expires_in > 0 ? { expiraEn: j.expires_in } : {}),
    ...(typeof j.refresh_token_expires_in === 'number' && j.refresh_token_expires_in > 0 ? { refrescaEn: j.refresh_token_expires_in } : {})
  }
}

/**
 * Pide un token de acceso nuevo con el `refresh` (cada uso entrega otro `refresh` y el anterior deja de valer). Si GitHub lo exige para
 * esa app se manda el secreto del cliente (`ODESK_GITHUB_CLIENT_SECRET`); con el flujo de dispositivo normalmente no hace falta.
 */
export async function refrescarToken(base: string, clientId: string, refresh: string, o: { secreto?: string; fetch?: typeof fetch } = {}): Promise<ConcesionToken> {
  const j = await enviar(
    `${base.replace(/\/$/, '')}/login/oauth/access_token`,
    { client_id: clientId, grant_type: 'refresh_token', refresh_token: refresh, ...(o.secreto ? { client_secret: o.secreto } : {}) },
    o.fetch ?? fetch
  )
  const c = concesionDe(j)
  if (c) return c
  const e = texto(j.error)
  if (e === 'bad_refresh_token') throw new ErrorDispositivo('La sesión de GitHub caducó o se usó en otro equipo. Vuelve a iniciar sesión.', 'expirado')
  if (e === 'incorrect_client_credentials') throw new ErrorDispositivo('GitHub pide el secreto de la OAuth App para renovar la sesión (define ODESK_GITHUB_CLIENT_SECRET) o desactiva «Expire user access tokens» en la app.', 'configuracion')
  throw errorDeCodigo(j)
}

export interface OpcionesEspera {
  señal?: AbortSignal
  /** Pausa entre consultas (se sustituye en las pruebas). */
  esperar?: (ms: number) => Promise<void>
  fetch?: typeof fetch
}

const pausa = (ms: number, señal?: AbortSignal): Promise<void> =>
  new Promise((ok, no) => {
    if (señal?.aborted) return no(new ErrorDispositivo('Inicio de sesión cancelado.', 'cancelado'))
    const t = setTimeout(() => {
      señal?.removeEventListener('abort', alAbortar)
      ok()
    }, ms)
    const alAbortar = (): void => {
      clearTimeout(t)
      no(new ErrorDispositivo('Inicio de sesión cancelado.', 'cancelado'))
    }
    señal?.addEventListener('abort', alAbortar, { once: true })
  })

/** Consulta hasta que el usuario autorice (devuelve el token) o el código caduque, se rechace o se cancele. */
export async function esperarToken(base: string, clientId: string, codigo: Pick<CodigoPedido, 'deviceCode' | 'intervalo' | 'expiraEn'>, o: OpcionesEspera = {}): Promise<ConcesionToken> {
  const f = o.fetch ?? fetch
  const dormir = o.esperar ?? ((ms: number) => pausa(ms, o.señal))
  let intervalo = codigo.intervalo
  let transcurrido = 0
  while (transcurrido <= codigo.expiraEn) {
    if (o.señal?.aborted) throw new ErrorDispositivo('Inicio de sesión cancelado.', 'cancelado')
    await dormir(intervalo * 1000)
    transcurrido += intervalo
    const j = await enviar(`${base.replace(/\/$/, '')}/login/oauth/access_token`, { client_id: clientId, device_code: codigo.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, f)
    const concesion = concesionDe(j)
    if (concesion) return concesion
    switch (texto(j.error)) {
      case 'authorization_pending':
        break
      case 'slow_down':
        intervalo = numero(j.interval, intervalo + 5)
        break
      case 'expired_token':
        throw new ErrorDispositivo('El código caducó. Vuelve a empezar.', 'expirado')
      case 'access_denied':
        throw new ErrorDispositivo('Cancelaste la autorización en GitHub.', 'denegado')
      default:
        throw errorDeCodigo(j)
    }
  }
  throw new ErrorDispositivo('El código caducó. Vuelve a empezar.', 'expirado')
}
