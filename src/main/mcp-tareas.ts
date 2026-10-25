/**
 * Servidor MCP de tareas. Lo lanza el CLI de Claude (`--mcp-config` o el plugin de la terminal) con el propio Electron en modo Node
 * (`ELECTRON_RUN_AS_NODE=1`); habla con la app por el socket local. No importa nada de Electron.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { llamarTareas } from './core/tareas/cliente'
import { servirMcpTareas } from './core/tareas/mcp-servidor'
import { ejecutarHookHistorial } from './historial/hook'
import { respuestaGanchoBash } from './core/guardrails/autonomo'

const dir = process.env.ODESK_DIR || join(homedir(), '.odesk-agent')
const proyectoId = process.env.ODESK_PROYECTO_ID || undefined

if (process.argv[2] === 'hook-bash') {
  // Gancho de Claude Code antes de cada comando: en terminales sin confirmación, deniega lo catastrófico. Un fallo nunca bloquea.
  let texto = ''
  process.stdin.on('data', (d) => (texto = (texto + d.toString()).slice(0, 2_000_000)))
  process.stdin.on('end', () => {
    try {
      const r = respuestaGanchoBash(texto)
      if (r) process.stdout.write(r)
    } finally {
      process.exit(0)
    }
  })
} else if (process.argv[2] === 'hook-historial') {
  // Gancho de Claude Code: el mismo programa, con otro modo (no es el servidor MCP).
  void ejecutarHookHistorial(process.argv[3] === 'pre' ? 'antes' : 'despues', process.stdin, dir, proyectoId)
    .catch(() => undefined)
    .finally(() => process.exit(0))
} else {
  void servirMcpTareas(process.stdin, process.stdout, (herramienta, entrada) => llamarTareas(dir, herramienta, entrada, proyectoId)).then(() => process.exit(0))
}
