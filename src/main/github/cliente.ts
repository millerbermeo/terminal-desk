import type { CheckCI, Issue, PullRequest, RepoGitHub, ResumenCI } from '@shared/github'

export const API_GITHUB = 'https://api.github.com'

/** Error de la API de GitHub ya traducido a algo que diga qué hacer. */
export class ErrorGitHub extends Error {
  constructor(mensaje: string, readonly estado?: number) {
    super(mensaje)
    this.name = 'ErrorGitHub'
  }
}

type Json = Record<string, unknown>
const cadena = (v: unknown, defecto = ''): string => (typeof v === 'string' ? v : defecto)
const numero = (v: unknown, defecto = 0): number => (typeof v === 'number' ? v : defecto)
const obj = (v: unknown): Json => (v !== null && typeof v === 'object' ? (v as Json) : {})

/** Traduce una respuesta de error de GitHub (cuerpo JSON y cabeceras) a un mensaje en español. */
export function explicarErrorGitHub(estado: number, cuerpo: unknown, cab: { get(n: string): string | null }): string {
  const c = obj(cuerpo)
  const mensaje = cadena(c.message)
  const detalles = (Array.isArray(c.errors) ? c.errors : []).map((e) => (typeof e === 'string' ? e : cadena(obj(e).message) || [cadena(obj(e).field), cadena(obj(e).code)].filter(Boolean).join(' '))).filter(Boolean)
  const extra = detalles.length ? `\n${detalles.join('\n')}` : ''
  if (estado === 401) return 'El token de GitHub no es válido o ha caducado. Crea uno nuevo y vuelve a conectar.'
  if (estado === 403 || estado === 429) {
    if (cab.get('x-ratelimit-remaining') === '0') {
      const reinicio = Number(cab.get('x-ratelimit-reset'))
      return `GitHub limitó las peticiones${reinicio ? `: se restablece a las ${new Date(reinicio * 1000).toLocaleTimeString()}` : ''}.`
    }
    const falta = cab.get('x-accepted-oauth-scopes')
    return `Tu token no tiene permiso para esto${falta ? ` (necesita: ${falta})` : ''}. ${mensaje}`.trim()
  }
  if (estado === 404) return 'No existe o tu token no tiene acceso (los repositorios privados necesitan el permiso «repo»).'
  if (estado === 422) {
    if (/pull request already exists/i.test(mensaje + extra)) return `Ya hay un pull request abierto para esa rama.${extra}`
    if (/already exists/i.test(mensaje + extra)) return `Ya existe con ese nombre.${extra}`
    if (/No commits between|has no history in common/i.test(mensaje + extra)) return 'No hay diferencias entre las dos ramas: no hay nada que proponer.'
    return `GitHub rechazó los datos: ${mensaje}${extra}`
  }
  return `GitHub respondió ${estado}${mensaje ? `: ${mensaje}` : ''}${extra}`
}

/** Cliente de la API REST de GitHub. El token solo viaja en la cabecera Authorization hacia el servidor configurado. */
export class ClienteGitHub {
  /**
   * `renovar`: pide un token nuevo cuando GitHub responde 401 (token caducado); si devuelve uno distinto, la petición se repite una vez.
   */
  constructor(
    private token: string,
    private readonly base: string = API_GITHUB,
    private readonly renovar?: () => Promise<string | undefined>
  ) {}

  async pedir<T>(metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', ruta: string, o: { cuerpo?: unknown; consulta?: Record<string, string | number | undefined> } = {}, reintento = false): Promise<T> {
    const url = new URL(this.base.replace(/\/$/, '') + ruta)
    for (const [k, v] of Object.entries(o.consulta ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
    let r: Response
    try {
      r = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'OdeskAgent',
          ...(o.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(o.cuerpo !== undefined ? { body: JSON.stringify(o.cuerpo) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(25_000)
      })
    } catch (err) {
      const e = err as Error & { name?: string; cause?: { code?: string } }
      if (e.name === 'TimeoutError') throw new ErrorGitHub('GitHub no respondió a tiempo.', undefined)
      throw new ErrorGitHub(`No se pudo conectar con GitHub (${e.cause?.code ?? e.message}). Revisa tu conexión.`, undefined)
    }
    const texto = await r.text()
    let cuerpo: unknown = undefined
    try {
      cuerpo = texto ? JSON.parse(texto) : undefined
    } catch {
      /* respuesta que no es JSON */
    }
    if (r.status === 401 && this.renovar && !reintento) {
      const nuevo = await this.renovar().catch(() => undefined)
      if (nuevo && nuevo !== this.token) {
        this.token = nuevo
        return this.pedir<T>(metodo, ruta, o, true)
      }
    }
    if (!r.ok) throw new ErrorGitHub(explicarErrorGitHub(r.status, cuerpo, r.headers), r.status)
    return cuerpo as T
  }
}

// ------------------------------------------------------------------ mapeo de las respuestas

export function aRepo(j: unknown): RepoGitHub {
  const r = obj(j)
  const completo = cadena(r.full_name)
  return {
    id: numero(r.id),
    nombre: cadena(r.name),
    completo,
    descripcion: cadena(r.description),
    privado: r.private === true,
    url: cadena(r.html_url),
    urlHttps: cadena(r.clone_url),
    urlSsh: cadena(r.ssh_url),
    ramaPorDefecto: cadena(r.default_branch, 'main'),
    actualizado: cadena(r.pushed_at) || cadena(r.updated_at)
  }
}

export function aPr(j: unknown): PullRequest {
  const p = obj(j)
  const estado = p.merged_at || p.merged === true ? 'fusionada' : p.state === 'closed' ? 'cerrada' : 'abierta'
  return {
    numero: numero(p.number),
    titulo: cadena(p.title),
    estado,
    borrador: p.draft === true,
    autor: cadena(obj(p.user).login),
    rama: cadena(obj(p.head).ref),
    base: cadena(obj(p.base).ref),
    url: cadena(p.html_url),
    actualizada: cadena(p.updated_at),
    ...(typeof p.body === 'string' ? { cuerpo: p.body } : {}),
    ...(p.mergeable === null || typeof p.mergeable === 'boolean' ? { fusionable: p.mergeable as boolean | null } : {})
  }
}

export function aIssue(j: unknown): Issue {
  const i = obj(j)
  return {
    numero: numero(i.number),
    titulo: cadena(i.title),
    estado: i.state === 'closed' ? 'cerrada' : 'abierta',
    autor: cadena(obj(i.user).login),
    etiquetas: (Array.isArray(i.labels) ? i.labels : []).map((l) => (typeof l === 'string' ? l : cadena(obj(l).name))).filter(Boolean),
    url: cadena(i.html_url),
    actualizada: cadena(i.updated_at),
    comentarios: numero(i.comments)
  }
}

/** Une los «check runs» (Actions y apps) y los estados clásicos de un commit en un solo resumen. */
export function resumirCI(checkRuns: unknown, estadoCombinado: unknown): ResumenCI {
  const checks: CheckCI[] = []
  for (const c of Array.isArray(obj(checkRuns).check_runs) ? (obj(checkRuns).check_runs as unknown[]) : []) {
    const r = obj(c)
    const conclusion = cadena(r.conclusion)
    const estado: CheckCI['estado'] =
      r.status !== 'completed' ? 'pendiente' : ['success'].includes(conclusion) ? 'exito' : ['neutral', 'skipped'].includes(conclusion) ? 'omitido' : 'fallo'
    checks.push({ nombre: cadena(r.name), estado, ...(cadena(r.html_url) ? { url: cadena(r.html_url) } : {}) })
  }
  for (const s of Array.isArray(obj(estadoCombinado).statuses) ? (obj(estadoCombinado).statuses as unknown[]) : []) {
    const e = obj(s)
    const estado: CheckCI['estado'] = e.state === 'success' ? 'exito' : e.state === 'pending' ? 'pendiente' : 'fallo'
    checks.push({ nombre: cadena(e.context), estado, ...(cadena(e.target_url) ? { url: cadena(e.target_url) } : {}) })
  }
  const estado = checks.some((c) => c.estado === 'fallo') ? 'fallo' : checks.some((c) => c.estado === 'pendiente') ? 'pendiente' : checks.some((c) => c.estado === 'exito') ? 'exito' : 'ninguno'
  return { estado, checks }
}
