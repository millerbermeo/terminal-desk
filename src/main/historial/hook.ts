import { llamarTareas } from '../core/tareas/cliente'

/** Lo que manda un gancho de Claude Code a la app: qué archivo va a escribir (`antes`) o acaba de escribir (`despues`). */
export interface PeticionHookHistorial {
  momento: 'antes' | 'despues'
  ruta: string
  herramienta: string
  sesion?: string
}

/** Nombre con el que el servidor local distingue estas peticiones de las herramientas de tareas (no es una herramienta de la IA). */
export const HERRAMIENTA_HOOK_HISTORIAL = '__historial'

const MAX_ENTRADA = 2_000_000

/** La ruta del archivo que una herramienta de escritura de Claude Code va a tocar. */
export function rutaDeEntradaHook(entrada: unknown): string | undefined {
  const e = entrada !== null && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {}
  const v = [e.file_path, e.notebook_path, e.path].find((x): x is string => typeof x === 'string' && x !== '')
  return v
}

/** Convierte lo que Claude Code manda al gancho (JSON por la entrada estándar) en una petición, o `undefined` si no es una escritura. */
export function peticionDeHook(momento: 'antes' | 'despues', texto: string): PeticionHookHistorial | undefined {
  try {
    const j = JSON.parse(texto) as { tool_name?: unknown; tool_input?: unknown; session_id?: unknown }
    const ruta = rutaDeEntradaHook(j.tool_input)
    if (!ruta || typeof j.tool_name !== 'string') return undefined
    return { momento, ruta, herramienta: j.tool_name, ...(typeof j.session_id === 'string' ? { sesion: j.session_id } : {}) }
  } catch {
    return undefined
  }
}

/**
 * Gancho de Claude Code (PreToolUse / PostToolUse de las herramientas de escribir): avisa a la app de que va a cambiar un archivo o ya lo
 * cambió, para que el historial lo registre como hecho por la IA. Nunca falla ni bloquea a Claude: si la app no está abierta, no pasa nada.
 */
export async function ejecutarHookHistorial(momento: 'antes' | 'despues', entrada: AsyncIterable<Buffer | string>, dir: string, proyectoId?: string): Promise<void> {
  let texto = ''
  for await (const trozo of entrada) {
    texto += trozo.toString()
    if (texto.length > MAX_ENTRADA) return
  }
  const p = peticionDeHook(momento, texto)
  if (!p || !proyectoId) return
  await llamarTareas(dir, HERRAMIENTA_HOOK_HISTORIAL, p, proyectoId, 4000)
}
