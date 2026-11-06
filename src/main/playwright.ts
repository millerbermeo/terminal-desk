import { spawn } from 'node:child_process'
import { entornoSuscripcion, cargarPathShell } from './core/suscripcion'

const WINDOWS = process.platform === 'win32'
const CADA_MS = 24 * 60 * 60_000
const TIMEOUT_MS = 15 * 60_000

let enCurso: Promise<void> | undefined

/**
 * Deja instalado el Chromium que usa el servidor MCP de Playwright. `@playwright/mcp` no lo descarga solo y exige la revisión exacta de
 * su propia versión de Playwright, así que se instala con el mismo paquete (`playwright-core install`, que no hace nada si ya está).
 */
export function instalarNavegadorPlaywright(): Promise<void> {
  enCurso ??= (async () => {
    await cargarPathShell()
    await npx(['-y', '-p', '@playwright/mcp@latest', 'playwright-core', 'install', 'chromium'])
    // Chrome DevTools MCP (de serie, sobre el mismo Chromium): se deja en la caché de npx para que el primer uso no espere la descarga.
    await npx(['-y', 'chrome-devtools-mcp@latest', '--version'])
  })().finally(() => {
    enCurso = undefined
  })
  return enCurso
}

function npx(args: string[]): Promise<void> {
  return new Promise<void>((res) => {
    const hijo = spawn(WINDOWS ? 'npx.cmd' : 'npx', args, {
      env: entornoSuscripcion(),
      stdio: 'ignore',
      ...(WINDOWS ? { shell: true } : {})
    })
    const timer = setTimeout(() => hijo.kill(), TIMEOUT_MS)
    hijo.on('error', () => res()) // sin npx/Node: Playwright tampoco arrancaría; no es un error de la app
    hijo.on('close', () => {
      clearTimeout(timer)
      res()
    })
  })
}

/** Al arrancar (instalación nueva o actualizada) y una vez al día: descarga el navegador sin bloquear nada ni lanzar. */
export function mantenerNavegadorPlaywright(): void {
  if (process.env.ODESK_SIN_PLAYWRIGHT === '1') return
  void instalarNavegadorPlaywright().catch(() => undefined)
  setInterval(() => void instalarNavegadorPlaywright().catch(() => undefined), CADA_MS).unref()
}
