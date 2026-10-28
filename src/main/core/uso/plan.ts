import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UsoPlan, VentanaPlan } from '@shared/core/uso'

/** Mismo punto que consulta `/usage` de Claude Code. Solo lectura; el token nunca se guarda, registra ni se envía a otro sitio. */
const URL_USO = 'https://api.anthropic.com/api/oauth/usage'
const BETA_OAUTH = 'oauth-2025-04-20'
const ESPERA_MS = 10_000

interface Credenciales {
  token: string
  caduca?: number
  tipo?: string
}

/**
 * Sesión de Claude Code de una carpeta de configuración (`~/.claude` o la de otra cuenta). En macOS el CLI la guarda en el llavero
 * y no hay archivo: entonces no se puede consultar el plan.
 */
async function leerCredenciales(carpeta: string): Promise<Credenciales | undefined> {
  const texto = await readFile(join(carpeta, '.credentials.json'), 'utf8').catch(() => undefined)
  if (!texto) return undefined
  const o = (JSON.parse(texto) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown; subscriptionType?: unknown } }).claudeAiOauth
  if (typeof o?.accessToken !== 'string' || !o.accessToken) return undefined
  return { token: o.accessToken, ...(typeof o.expiresAt === 'number' ? { caduca: o.expiresAt } : {}), ...(typeof o.subscriptionType === 'string' ? { tipo: o.subscriptionType } : {}) }
}

const ventana = (v: unknown): VentanaPlan | undefined => {
  if (!v || typeof v !== 'object') return undefined
  const { utilization, resets_at } = v as { utilization?: unknown; resets_at?: unknown }
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return undefined
  const reinicio = typeof resets_at === 'string' ? Date.parse(resets_at) : NaN
  return { porcentaje: Math.min(100, Math.max(0, Math.round(utilization))), ...(Number.isNaN(reinicio) ? {} : { reinicio }) }
}

/** Traduce la respuesta de la API (`utilization` en %, `resets_at` ISO) a lo que pinta la interfaz. */
export function interpretarUsoPlan(json: unknown): Pick<UsoPlan, 'cincoHoras' | 'semana' | 'semanaOpus' | 'semanaSonnet'> {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const salida: Pick<UsoPlan, 'cincoHoras' | 'semana' | 'semanaOpus' | 'semanaSonnet'> = {}
  const c = ventana(o.five_hour)
  const s = ventana(o.seven_day)
  const so = ventana(o.seven_day_opus)
  const ss = ventana(o.seven_day_sonnet)
  if (c) salida.cincoHoras = c
  if (s) salida.semana = s
  if (so) salida.semanaOpus = so
  if (ss) salida.semanaSonnet = ss
  return salida
}

export type ResultadoPlan = { ok: true; datos: Omit<UsoPlan, 'cuenta'> } | { ok: false; error: string; reintentarEn?: number }

/** Consulta el uso del plan con la sesión guardada en `carpeta`. No renueva la sesión (eso lo hace el CLI al usarse). */
export async function consultarUsoPlan(carpeta: string, pedir: typeof fetch = fetch, ahora: number = Date.now()): Promise<ResultadoPlan> {
  let cred: Credenciales | undefined
  try {
    cred = await leerCredenciales(carpeta)
  } catch {
    return { ok: false, error: 'No se pudo leer la sesión de Claude Code.' }
  }
  if (!cred) return { ok: false, error: process.platform === 'darwin' ? 'En macOS la sesión está en el llavero: el uso del plan no se puede consultar.' : 'Sin sesión de Claude Code en esta cuenta.' }
  if (cred.caduca && cred.caduca < ahora) return { ok: false, error: 'La sesión caducó: se renovará sola la próxima vez que uses Claude.' }
  let r: Response
  try {
    r = await pedir(URL_USO, { headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-beta': BETA_OAUTH, Accept: 'application/json' }, signal: AbortSignal.timeout(ESPERA_MS) })
  } catch {
    return { ok: false, error: 'Sin conexión con Anthropic.' }
  }
  if (r.status === 429) return { ok: false, error: 'Demasiadas consultas: se reintenta en unos minutos.', reintentarEn: 5 * 60_000 }
  if (r.status === 401 || r.status === 403) return { ok: false, error: 'La sesión no es válida para consultar el uso.' }
  if (!r.ok) return { ok: false, error: `Anthropic respondió ${r.status}.` }
  const datos = interpretarUsoPlan(await r.json().catch(() => ({})))
  return { ok: true, datos: { ...datos, ...(cred.tipo ? { tipo: cred.tipo } : {}), actualizado: ahora } }
}
