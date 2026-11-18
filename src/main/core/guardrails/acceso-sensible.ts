import { esArchivoSensible } from '@shared/github'

/**
 * Accesos del Asistente a variables de entorno y credenciales (locales o de producción) que exigen la contraseña del equipo
 * (`hitl/permiso-cli.ts#pedirContrasena`). Se pueden hacer, pero solo con una persona delante que demuestre ser el dueño del equipo:
 * lo que se lea va al modelo. Conservador a propósito: un falso positivo cuesta escribir la contraseña; un falso negativo, un secreto.
 */

/** Archivo de credenciales por nombre (`.env`, `.env.production`, claves, `credentials`…), sin mirar su contenido. */
export const rutaSensible = (ruta: string): boolean => Boolean(ruta) && esArchivoSensible(ruta.replace(/\\/g, '/'))

/** Rutas sensibles fuera del proyecto que no se reconocen por el nombre del archivo solo. */
const RUTAS_FIJAS = /(^|[\s'"=:/])(~|\$HOME|\$\{HOME\})?\/?(\.aws\/(credentials|config)|\.ssh\/id_[a-z0-9]+(?!\.pub)\b|\.docker\/config\.json|\.kube\/config|\.config\/gcloud\/|\.azure\/|\.git-credentials|\.netrc|\.npmrc|\.pypirc|\.pgpass)|\/proc\/[^\s/]+\/environ\b|\/etc\/(shadow|gshadow)\b/

/** Palabras de un comando que nombran un archivo sensible (`.env`, `config/.env.production`, `id_rsa`…). */
const PALABRA = /[^\s'"`;|&<>()=]+/g

/**
 * Programas que vuelcan variables o secretos (locales, de la nube o de producción). Cada entrada: regex sobre el comando y motivo.
 * Los que solo listan NOMBRES (p. ej. `gh secret list`) no están.
 */
const VOLCADOS: readonly [RegExp, string][] = [
  [/(^|[;&|(`]\s*|\$\(\s*)(printenv|export\s+-p|declare\s+-[a-z]*x|set)(\s*($|[;&|)>])|\s+[A-Za-z_])/, 'muestra variables de entorno'],
  [/(^|[;&|(`]\s*|\$\(\s*)env\s*($|[;&|)>])/, 'muestra variables de entorno'],
  [/\$\{?[A-Za-z_]*(SECRET|TOKEN|PASSW(OR)?D|PASS\b|PWD_|API_?KEY|PRIVATE|CREDENTIAL|DATABASE_URL|DB_URL|_DSN)[A-Za-z_]*\}?/i, 'lee una variable con un secreto'],
  [/(^|[\s;&|(])(source|\.)\s+\S*\.env\b/, 'carga un archivo .env'],
  // Volcar el entorno desde un intérprete (no buscar `process.env` en el código: eso no lee ningún valor).
  [/\b(node|bun|deno)\b[^|;&]*\s-(e|p|-eval|-print)\b[^|;&]*\bprocess\.env\b|\bpython3?\b[^|;&]*\s-c\b[^|;&]*\bos\.environ\b|\bdotenv\s+(-e|get|list|run\s+.*\b(env|printenv)\b)/, 'muestra variables de entorno desde un intérprete'],
  [/\b(vercel|netlify)\s+env\s+(pull|ls|get)\b/, 'descarga variables de un despliegue'],
  [/\bheroku\s+config(\s|$)(?!.*\bconfig:(set|unset)\b)/, 'muestra la configuración de Heroku'],
  [/\brailway\s+(variables|vars)\b/, 'muestra variables de Railway'],
  [/\bfly(ctl)?\s+(ssh|console)\b.*\benv\b/, 'muestra variables de Fly.io'],
  [/\bkubectl\b.*\bget\s+secrets?\b|\bkubectl\b.*\bdescribe\s+secrets?\b|\bkubectl\s+exec\b.*\b(env|printenv)\b/, 'lee secretos de Kubernetes'],
  [/\bdocker\s+(inspect|exec\b.*\b(env|printenv)\b)|\bdocker\s+compose\s+config\b/, 'muestra variables de contenedores'],
  [/\baws\s+(secretsmanager\s+get-secret-value|ssm\s+get-parameters?\b.*--with-decryption|configure\s+(get|export-credentials)|sts\s+get-session-token)\b/, 'lee secretos de AWS'],
  [/\bgcloud\s+(secrets\s+versions\s+access|auth\s+(print-access-token|print-identity-token))\b/, 'lee secretos de Google Cloud'],
  [/\baz\s+keyvault\s+secret\s+show\b|\baz\s+account\s+get-access-token\b/, 'lee secretos de Azure'],
  [/\b(vault\s+(kv\s+get|read)|doppler\s+secrets|op\s+(read|item\s+get)|infisical\s+(export|secrets)|sops\s+(-d|--decrypt|decrypt))\b/, 'lee un gestor de secretos'],
  [/\bgh\s+auth\s+token\b|\bgit\s+credential\s+fill\b|\bsecurity\s+find-generic-password\b.*-w|\bsecret-tool\s+lookup\b/, 'lee un token guardado']
]

/** Por qué un comando de `Bash` accede a credenciales o variables de entorno, o `null` si no lo hace. */
export function motivoBashSensible(comando: string): string | null {
  const c = comando.trim()
  if (!c) return null
  for (const palabra of c.match(PALABRA) ?? []) {
    if (rutaSensible(palabra)) return `usa el archivo sensible «${palabra}»`
  }
  if (RUTAS_FIJAS.test(c)) return 'lee un archivo de credenciales del sistema'
  for (const [re, motivo] of VOLCADOS) if (re.test(c)) return motivo
  return null
}

/** Búsqueda con `Grep` que entra en archivos sensibles (ruta o filtro de nombres). */
export function grepSensible(entrada: Record<string, unknown>): string | null {
  const ruta = typeof entrada.path === 'string' ? entrada.path : ''
  const glob = typeof entrada.glob === 'string' ? entrada.glob : ''
  if (rutaSensible(ruta)) return `busca dentro de «${ruta}»`
  if (/(^|[/{,*])\.env\b|\b(credentials|secrets)\b|\.(pem|key)\b|id_rsa/i.test(glob) && !/\.(example|sample|template)\b/.test(glob)) return `busca en archivos sensibles («${glob}»)`
  return null
}
