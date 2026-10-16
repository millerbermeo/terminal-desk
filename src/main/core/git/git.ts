import { execFile } from 'node:child_process'

export interface ResultadoGit {
  ok: boolean
  stdout: string
  stderr: string
}

/** Ejecuta git sin shell. Nunca lanza: el llamador decide qué hacer con `ok`. */
export function git(cwd: string, args: readonly string[], o: { senal?: AbortSignal; timeoutMs?: number } = {}): Promise<ResultadoGit> {
  return new Promise((resolver) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: o.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // nunca pedir credenciales por consola
        ...(o.senal ? { signal: o.senal } : {})
      },
      (err, stdout, stderr) => resolver({ ok: !err, stdout: stdout.toString(), stderr: stderr.toString() || (err?.message ?? '') })
    )
  })
}

/** Como `git` pero lanza con el mensaje de error de git. */
export async function gitOk(cwd: string, args: readonly string[], o?: { senal?: AbortSignal; timeoutMs?: number }): Promise<string> {
  const r = await git(cwd, args, o)
  if (!r.ok) throw new Error(`git ${args[0]}: ${r.stderr.trim() || 'falló'}`)
  return r.stdout
}
