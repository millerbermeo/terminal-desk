import { basename, normalize, sep } from 'node:path'

const PLANTILLA_ENV = /^\.env\.(example|sample|template|dist)$/i

const segmentos = (ruta: string): string[] => normalize(ruta).split(sep).filter((s) => s && s !== '.')

/** Archivos que suelen contener credenciales: ni se leen ni se escriben. */
export function rutaSensible(ruta: string): string | null {
  const nombre = basename(ruta)
  if (/^\.env(\..+)?$/i.test(nombre) && !PLANTILLA_ENV.test(nombre)) return 'archivo de variables de entorno'
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(nombre)) return 'archivo de claves o certificados'
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(nombre)) return 'clave privada SSH'
  if (/^(\.npmrc|\.netrc|\.git-credentials|\.pypirc)$/i.test(nombre)) return 'archivo de credenciales'
  if (segmentos(ruta).includes('.ssh') || segmentos(ruta).includes('.aws') || segmentos(ruta).includes('.gnupg')) return 'carpeta de credenciales'
  return null
}

/** Rutas que un agente no debe escribir nunca (además de las sensibles). */
export function rutaProtegidaEscritura(ruta: string): string | null {
  const segs = segmentos(ruta)
  if (segs.includes('.git')) return 'metadatos de git'
  if (segs.includes('node_modules')) return 'dependencias instaladas'
  return rutaSensible(ruta)
}
