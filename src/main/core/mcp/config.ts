import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DIR } from '../../proyectos'

const ARCHIVO = join(DIR, 'mcp.json')

const ServidorSchema = z.object({
  comando: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
  deshabilitado: z.boolean().default(false),
  /** Riesgo asignado a TODAS las herramientas del servidor (no se puede saber lo que hacen). */
  riesgo: z.enum(['lectura', 'escritura', 'ejecucion']).default('ejecucion')
})

export const ConfigMcpSchema = z.object({
  servidores: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), ServidorSchema).default({})
})

export type ServidorMcpConfig = z.infer<typeof ServidorSchema>
export type ConfigMcp = z.infer<typeof ConfigMcpSchema>

export function analizarConfigMcp(crudo: unknown): ConfigMcp {
  return ConfigMcpSchema.parse(crudo)
}

/** Lee ~/.odesk-agent/mcp.json; si no existe lo crea vacío (0600: `env` puede llevar claves). */
export async function leerConfigMcp(): Promise<ConfigMcp> {
  try {
    return analizarConfigMcp(JSON.parse(await readFile(ARCHIVO, 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`mcp.json inválido: ${(err as Error).message}`, { cause: err })
    const vacia = analizarConfigMcp({})
    await mkdir(DIR, { recursive: true })
    await writeFile(ARCHIVO, JSON.stringify(vacia, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') await chmod(ARCHIVO, 0o600)
    return vacia
  }
}
