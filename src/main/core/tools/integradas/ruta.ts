import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

function dentro(base: string, ruta: string): boolean {
  const r = relative(base, ruta)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

/** Resuelve `ruta` dentro de `cwd`; lanza si escapa (por `..` o por un enlace simbólico). */
export async function rutaSegura(cwd: string, ruta: string): Promise<string> {
  const base = await realpath(cwd)
  const destino = resolve(base, ruta)
  if (!dentro(base, destino)) throw new Error(`La ruta sale del proyecto: ${ruta}`)
  // Resolver enlaces del ancestro existente más cercano (el destino puede no existir aún).
  let existente = destino
  for (;;) {
    try {
      const real = await realpath(existente)
      if (!dentro(base, real)) throw new Error(`La ruta sale del proyecto: ${ruta}`)
      return destino
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const padre = dirname(existente)
      if (padre === existente) throw err
      existente = padre
    }
  }
}
