import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from './git'

/**
 * Tras mover la carpeta de datos, los worktrees de los agentes (`<datos>/worktrees/<proyecto>/<id>`) apuntan al repositorio y el
 * repositorio a ellos con rutas absolutas viejas. `git worktree repair` las rehace desde el repositorio principal, que no se movió.
 * Devuelve cuántos worktrees se repararon (los fallos se ignoran: un worktree huérfano no debe impedir arrancar).
 */
export async function repararWorktrees(dirDatos: string, proyectos: readonly { id: string; ruta: string }[]): Promise<number> {
  const base = join(dirDatos, 'worktrees')
  let porProyecto: string[]
  try {
    porProyecto = await readdir(base)
  } catch {
    return 0
  }
  let reparados = 0
  for (const id of porProyecto) {
    const proyecto = proyectos.find((p) => p.id === id)
    if (!proyecto) continue
    const rutas: string[] = []
    for (const w of await readdir(join(base, id)).catch(() => [] as string[])) {
      const ruta = join(base, id, w)
      if ((await stat(ruta).catch(() => undefined))?.isDirectory()) rutas.push(ruta)
    }
    if (rutas.length === 0) continue
    if ((await git(proyecto.ruta, ['worktree', 'repair', ...rutas])).ok) reparados += rutas.length
  }
  return reparados
}
