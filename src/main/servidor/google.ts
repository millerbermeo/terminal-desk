import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { EstadoSesion } from '@shared/sesion'
import { ErrorServidor, type ClienteServidor } from './cliente'

const ESPERA_MAX_MS = 3 * 60_000

const pagina = (titulo: string, texto: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Odesk Agent</title>` +
  `<body style="font-family:system-ui,sans-serif;background:#0d0e12;color:#e8e9ee;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><h2>${titulo}</h2><p style="color:#9a9cab">${texto}</p></div></body>`

/**
 * Login con Google para la app de escritorio. Abre un servidor HTTP solo en 127.0.0.1 y un puerto libre, manda al usuario al
 * navegador del sistema (`/auth/google?port=&nonce=`) y espera a que el backend lo redirija aquí con un código de un solo uso, que
 * se cambia por la sesión. El nonce impide aceptar una redirección que no empezó esta app.
 */
export async function iniciarSesionGoogle(
  cliente: ClienteServidor,
  abrirNavegador: (url: string) => Promise<void> | void,
  esperaMaxMs = ESPERA_MAX_MS
): Promise<EstadoSesion> {
  if (!(await cliente.googleDisponible())) {
    throw new ErrorServidor('El servidor no tiene configurado el login con Google (faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).')
  }
  const nonce = randomBytes(24).toString('base64url')
  let http: Server | undefined
  let temporizador: NodeJS.Timeout | undefined
  try {
    const codigo = await new Promise<string>((resolver, rechazar) => {
      http = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const code = url.searchParams.get('code')
        if (url.searchParams.get('nonce') !== nonce || !code) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(pagina('Solicitud no válida', 'Vuelve a intentarlo desde Odesk Agent.'))
          return
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina('Listo', 'Ya puedes cerrar esta pestaña y volver a Odesk Agent.'))
        resolver(code)
      })
      http.once('error', rechazar)
      http.listen(0, '127.0.0.1', () => {
        const puerto = (http!.address() as AddressInfo).port
        temporizador = setTimeout(() => rechazar(new ErrorServidor('Se agotó el tiempo esperando el acceso con Google.')), esperaMaxMs)
        const destino = `${cliente.url}/auth/google?port=${puerto}&nonce=${encodeURIComponent(nonce)}`
        Promise.resolve(abrirNavegador(destino)).catch(() => rechazar(new ErrorServidor('No se pudo abrir el navegador.')))
      })
    })
    return await cliente.canjearGoogle(codigo)
  } finally {
    if (temporizador) clearTimeout(temporizador)
    http?.close()
    http?.closeAllConnections()
  }
}
