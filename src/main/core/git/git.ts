import { execFile } from 'node:child_process'

export interface ResultadoGit {
  ok: boolean
  stdout: string
  stderr: string
  /** Código de salida del proceso (`undefined` si no llegó a ejecutarse, p. ej. git no instalado). */
  codigo?: number
  /** git no está instalado o no se encuentra en el PATH. */
  sinGit?: boolean
}

export interface OpcionesGit {
  senal?: AbortSignal
  timeoutMs?: number
  /** Texto que se escribe por la entrada estándar (p. ej. el mensaje de un commit). */
  entrada?: string
  /** Códigos de salida que también cuentan como éxito (p. ej. `git diff --no-index` sale con 1 si hay diferencias). */
  okCodigos?: readonly number[]
  env?: Record<string, string>
}

/**
 * Ejecuta git sin shell. Nunca lanza: el llamador decide qué hacer con `ok`.
 * Nunca pide credenciales por consola y usa los mensajes en inglés para que se puedan analizar de forma estable.
 * Quien reciba rutas del usuario debe pasar `env: { GIT_LITERAL_PATHSPECS: '1' }` (sin comodines ni «magia» de pathspec).
 */
export function git(cwd: string, args: readonly string[], o: OpcionesGit = {}): Promise<ResultadoGit> {
  return new Promise((resolver) => {
    const hijo = execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: o.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANGUAGE: 'C', ...o.env },
        ...(o.senal ? { signal: o.senal } : {})
      },
      (err, stdout, stderr) => {
        const codigo = typeof (err as { code?: unknown } | null)?.code === 'number' ? ((err as { code: number }).code) : err ? undefined : 0
        const sinGit = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
        const ok = !err || (codigo !== undefined && (o.okCodigos?.includes(codigo) ?? false))
        resolver({ ok, stdout: stdout.toString(), stderr: stderr.toString() || (err && !ok ? err.message : ''), ...(codigo !== undefined ? { codigo } : {}), ...(sinGit ? { sinGit } : {}) })
      }
    )
    if (o.entrada !== undefined) {
      hijo.stdin?.on('error', () => undefined)
      hijo.stdin?.end(o.entrada)
    }
  })
}

/** Como `git` pero lanza con el mensaje de error de git. */
export async function gitOk(cwd: string, args: readonly string[], o?: OpcionesGit): Promise<string> {
  const r = await git(cwd, args, o)
  if (!r.ok) throw new Error(`git ${args[0]}: ${r.stderr.trim() || 'falló'}`)
  return r.stdout
}
