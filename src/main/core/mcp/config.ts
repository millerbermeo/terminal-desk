import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DIR } from '../../proyectos'

const ARCHIVO = join(DIR, 'mcp.json')

const ServidorSchema = z.object({
  comando: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
  deshabilitado: z.boolean().default(false),
  /** Riesgo asignado a TODAS las herramientas del servidor (no se puede saber lo que hacen). */
  riesgo: z.enum(['lectura', 'escritura', 'ejecucion']).default('ejecucion')
})

export const ConfigMcpSchema = z.object({
  servidores: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), ServidorSchema).default({})
})

export type ServidorMcpConfig = z.infer<typeof ServidorSchema>
export type ConfigMcp = z.infer<typeof ConfigMcpSchema>

export function analizarConfigMcp(crudo: unknown): ConfigMcp {
  return ConfigMcpSchema.parse(crudo)
}

/**
 * Servidores que Odesk Agent trae de serie para todos los proyectos. Lo que el usuario declare en mcp.json con el mismo nombre
 * manda (para cambiar los args o apagarlo: `"playwright": { "comando": "npx", "deshabilitado": true }`).
 */
const SERVIDORES_DE_SERIE: Record<string, ServidorMcpConfig> = {
  // Navegador controlado por la IA (pruebas de UI, capturas, scraping), con ventana visible: se ve en directo lo que hace. `--isolated`:
  // cada sesión lanza su propio Chromium con perfil temporal, así varias conversaciones pueden usarlo a la vez sin chocar por el perfil.
  // (El navegador integrado de Odesk tiene además sus propias herramientas `navegador_*` en el servidor «odesk».)
  // «escritura»: en suscripción se permite desde «Aceptar ediciones» (en «Preguntar» no hay quien confirme); en modo API sigue pidiendo confirmación.
  playwright: { comando: 'npx', args: ['-y', '@playwright/mcp@latest', '--isolated'], env: {}, deshabilitado: false, riesgo: 'escritura' },
  // Chrome DevTools sobre el MISMO navegador que abre Playwright (ver `navegadorCompartido`): consola, red (peticiones, respuestas,
  // códigos), DOM, rendimiento. No lanza Chrome propio: se conecta por CDP al Chromium de Playwright de esa conversación.
  'chrome-devtools': { comando: 'npx', args: ['-y', 'chrome-devtools-mcp@latest', '--no-usage-statistics'], env: {}, deshabilitado: false, riesgo: 'escritura' }
}

const PUERTO_BASE = 20_000
const PUERTOS = 10_000

/** Puerto CDP estable por conversación (cambiarlo relanzaría el proceso persistente del CLI en cada mensaje). */
export function puertoNavegador(clave: string): number {
  return PUERTO_BASE + (createHash('sha1').update(clave).digest().readUInt32BE(0) % PUERTOS)
}

const mismosArgs = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Une Playwright y Chrome DevTools en un solo navegador: el Chromium de Playwright abre además un puerto de depuración (solo
 * 127.0.0.1) y chrome-devtools-mcp se conecta a él (`--browserUrl`). La conexión es perezosa: hasta que Playwright abre una página,
 * las herramientas de DevTools responden «Could not connect to Chrome». Solo si ambos son los de serie (sin args propios en mcp.json).
 */
export async function navegadorCompartido(servidores: Record<string, ServidorMcpConfig>, clave: string, dir: string = DIR): Promise<Record<string, ServidorMcpConfig>> {
  const pw = servidores.playwright
  const dt = servidores['chrome-devtools']
  const seriePw = SERVIDORES_DE_SERIE.playwright!
  const serieDt = SERVIDORES_DE_SERIE['chrome-devtools']!
  if (!pw || !dt || pw.deshabilitado || dt.deshabilitado) return servidores
  if (!mismosArgs(pw.args, seriePw.args) || !mismosArgs(dt.args, serieDt.args)) return servidores
  const puerto = puertoNavegador(clave)
  const archivo = join(dir, 'mcp', `playwright-cdp-${puerto}.json`)
  try {
    await stat(archivo)
  } catch {
    await mkdir(join(dir, 'mcp'), { recursive: true })
    const tmp = `${archivo}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ browser: { launchOptions: { args: [`--remote-debugging-port=${puerto}`, '--remote-debugging-address=127.0.0.1'] } } }, null, 2) + '\n', 'utf8')
    await rename(tmp, archivo)
  }
  return {
    ...servidores,
    playwright: { ...pw, args: [...pw.args, '--config', archivo] },
    'chrome-devtools': { ...dt, args: [...dt.args, '--browserUrl', `http://127.0.0.1:${puerto}`] }
  }
}

export function conServidoresDeSerie(config: ConfigMcp): ConfigMcp {
  return { servidores: { ...SERVIDORES_DE_SERIE, ...config.servidores } }
}

/** Lee ~/.odesk-agent/mcp.json (+ servidores de serie); si no existe lo crea vacío (0600: `env` puede llevar claves). */
export async function leerConfigMcp(): Promise<ConfigMcp> {
  try {
    return conServidoresDeSerie(analizarConfigMcp(JSON.parse(await readFile(ARCHIVO, 'utf8'))))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`mcp.json inválido: ${(err as Error).message}`, { cause: err })
    const vacia = analizarConfigMcp({})
    await mkdir(DIR, { recursive: true })
    await writeFile(ARCHIVO, JSON.stringify(vacia, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') await chmod(ARCHIVO, 0o600)
    return conServidoresDeSerie(vacia)
  }
}
