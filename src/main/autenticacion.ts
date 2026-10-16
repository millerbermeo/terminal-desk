import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'

export type ResultadoAuth = { ok: true } | { ok: false; motivo: 'incorrecta' | 'no-disponible' }

const SCRIPT_WINDOWS = `
$p = [Console]::In.ReadLine()
Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$c = New-Object System.DirectoryServices.AccountManagement.PrincipalContext('Machine', $env:COMPUTERNAME)
if ($c.ValidateCredentials($env:USERNAME, $p)) { exit 0 } else { exit 1 }
`

/**
 * Verifica la contraseña del usuario del sistema. La contraseña viaja solo por stdin
 * del proceso hijo (nunca en argumentos ni en variables de entorno) y no se guarda.
 * - Linux/macOS: `sudo -S -k -v` (requiere que el usuario pueda usar sudo).
 * - Windows: PowerShell + ValidateCredentials.
 */
export function verificarPassword(password: string): Promise<ResultadoAuth> {
  if (!password) return Promise.resolve({ ok: false, motivo: 'incorrecta' })

  const [cmd, args] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_WINDOWS]]
      : ['sudo', ['-S', '-k', '-v', '-p', '']]

  return new Promise((res) => {
    let stderr = ''
    let terminado = false
    const fin = (r: ResultadoAuth): void => {
      if (terminado) return
      terminado = true
      clearTimeout(limite)
      res(r)
    }
    const hijo = spawn(cmd, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, LC_ALL: 'C', USERNAME: userInfo().username }
    })
    const limite = setTimeout(() => {
      hijo.kill('SIGKILL')
      fin({ ok: false, motivo: 'no-disponible' })
    }, 15000)

    hijo.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    hijo.on('error', () => fin({ ok: false, motivo: 'no-disponible' }))
    hijo.on('close', (codigo) => {
      if (codigo === 0) return fin({ ok: true })
      const sinSudo = /not in the sudoers|may not run sudo|not allowed|command not found/i.test(stderr)
      fin({ ok: false, motivo: sinSudo ? 'no-disponible' : 'incorrecta' })
    })
    hijo.stdin.on('error', () => undefined)
    hijo.stdin.end(password + '\n')
  })
}
