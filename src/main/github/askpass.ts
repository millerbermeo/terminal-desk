import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const POSIX = `#!/bin/sh
# Lo usa git (GIT_ASKPASS) para autenticarse con GitHub. El token llega por la variable de entorno del proceso de git:
# nunca está escrito en este archivo.
case "$1" in
  *sername*) printf '%s\\n' 'x-access-token' ;;
  *) printf '%s\\n' "$ODESK_GITHUB_TOKEN" ;;
esac
`

const WINDOWS = `@echo off\r
rem Lo usa git (GIT_ASKPASS) para autenticarse con GitHub. El token llega por la variable de entorno, no está en este archivo.\r
echo %~1 | findstr /i "Username" >nul && (echo x-access-token) || (echo %ODESK_GITHUB_TOKEN%)\r
`

/** Crea (si hace falta) el script que le da a git las credenciales de GitHub; devuelve su ruta. */
export async function asegurarAskpass(dir: string): Promise<string> {
  const windows = process.platform === 'win32'
  const ruta = join(dir, windows ? 'askpass-github.cmd' : 'askpass-github.sh')
  const contenido = windows ? WINDOWS : POSIX
  const actual = await readFile(ruta, 'utf8').catch(() => undefined)
  if (actual !== contenido) {
    await mkdir(dir, { recursive: true })
    await writeFile(ruta, contenido, { mode: 0o700 })
    if (!windows) await chmod(ruta, 0o700)
  }
  return ruta
}
