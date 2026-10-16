import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Verificacion {
  nombre: 'typecheck' | 'lint' | 'test'
  comando: string[]
}

export interface ResultadoPruebas {
  ok: boolean
  salida: string
  omitidas?: boolean
  fallo?: string // nombre de la verificación que falló
}

export type EjecutorVerificacion = (cwd: string, comando: string[], senal?: AbortSignal) => Promise<{ ok: boolean; salida: string }>

const existe = (ruta: string): Promise<boolean> => access(ruta).then(() => true, () => false)

const ALIAS: Record<Verificacion['nombre'], string[]> = {
  typecheck: ['typecheck', 'type-check', 'check-types', 'tsc'],
  lint: ['lint'],
  test: ['test']
}

/**
 * Comprobaciones del propio proyecto, en orden: tipos, linter, pruebas. Salen de los scripts de package.json
 * (con el gestor que indique el lockfile), así que se usan las mismas herramientas que el equipo.
 */
export async function detectarVerificaciones(cwd: string): Promise<Verificacion[]> {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const gestor = (await existe(join(cwd, 'pnpm-lock.yaml'))) ? 'pnpm' : (await existe(join(cwd, 'yarn.lock'))) ? 'yarn' : 'npm'
    const salida: Verificacion[] = []
    for (const nombre of ['typecheck', 'lint', 'test'] as const) {
      const script = ALIAS[nombre].find((s) => scripts[s] && !/no test specified/i.test(scripts[s]!))
      if (script) salida.push({ nombre, comando: [gestor, 'run', script] })
    }
    return salida
  } catch {
    return []
  }
}

export const ejecutarVerificacion: EjecutorVerificacion = (cwd, comando, senal) =>
  new Promise((resolver) => {
    execFile(
      comando[0]!,
      comando.slice(1),
      { cwd, timeout: 300_000, maxBuffer: 8 * 1024 * 1024, ...(senal ? { signal: senal } : {}) },
      (err, stdout, stderr) => {
        const salida = `${stdout}\n${stderr}`.trim()
        resolver({ ok: !err, salida: salida.length > 8000 ? '[… recortado]\n' + salida.slice(-8000) : salida })
      }
    )
  })

/** Ejecuta las verificaciones en orden y se detiene en la primera que falla. */
export async function correrVerificaciones(
  cwd: string,
  verificaciones: readonly Verificacion[],
  ejecutar: EjecutorVerificacion,
  senal?: AbortSignal
): Promise<ResultadoPruebas> {
  if (verificaciones.length === 0) return { ok: true, omitidas: true, salida: 'Sin scripts de typecheck, lint ni test: no se pudo validar automáticamente.' }
  const partes: string[] = []
  for (const v of verificaciones) {
    const r = await ejecutar(cwd, v.comando, senal)
    if (!r.ok) return { ok: false, fallo: v.nombre, salida: `[${v.nombre}] falló:\n${r.salida}` }
    partes.push(`[${v.nombre}] ok`)
  }
  return { ok: true, salida: partes.join('\n') }
}
