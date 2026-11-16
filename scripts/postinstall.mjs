/* global process, console */
// Prepara node-pty para Electron en cualquier sistema.
//
// node-pty 1.x usa N-API y trae binarios precompilados para Windows y macOS (x64 y arm64) en `prebuilds/`: ahí no hace falta
// compilar (ni tener Visual Studio Build Tools o Xcode). En Linux no trae binarios y hay que compilarlo con `electron-rebuild`
// (necesita python3, make y g++). `ODESK_RECOMPILAR_PTY=1` fuerza la compilación también en Windows/macOS.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
let raiz
try {
  raiz = dirname(require.resolve('node-pty/package.json'))
} catch {
  console.log('[postinstall] node-pty no está instalado; nada que preparar.')
  process.exit(0)
}

const precompilado = join(raiz, 'prebuilds', `${process.platform}-${process.arch}`)
const forzar = process.env.ODESK_RECOMPILAR_PTY === '1'

if (existsSync(precompilado) && !forzar) {
  // Una compilación vieja en build/ tendría prioridad sobre el binario precompilado: se quita para que se use este.
  rmSync(join(raiz, 'build'), { recursive: true, force: true })
  console.log(`[postinstall] node-pty: se usa el binario precompilado (${process.platform}-${process.arch}).`)
  process.exit(0)
}

console.log('[postinstall] node-pty: compilando para Electron…')
const r = spawnSync('electron-rebuild', ['-f', '-w', 'node-pty'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (r.status !== 0) {
  console.error(
    '[postinstall] No se pudo compilar node-pty.\n' +
      (process.platform === 'linux'
        ? '  Instala las herramientas de compilación: sudo apt install -y python3 make g++ (o build-essential).\n'
        : process.platform === 'darwin'
          ? '  Instala las herramientas de línea de comandos: xcode-select --install\n'
          : '  Instala «Visual Studio Build Tools» con la carga «Desarrollo para el escritorio con C++».\n') +
      '  Luego: pnpm exec electron-rebuild -f -w node-pty'
  )
  process.exit(r.status ?? 1)
}
