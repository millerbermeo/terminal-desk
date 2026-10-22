import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CLAVE_AJUSTES, limpiarAjustes, type AjustesAsistente } from '@shared/ajustes'
import { DIR } from './proyectos'

const rutaDe = (clave: string): string => join(DIR, 'ajustes', `${clave}.json`)

function validar(clave: unknown): string {
  if (typeof clave !== 'string' || !CLAVE_AJUSTES.test(clave)) throw new Error('Ajustes: clave no válida')
  return clave.toLowerCase()
}

export async function leerAjustes(clave: string): Promise<AjustesAsistente> {
  try {
    return limpiarAjustes(JSON.parse(await readFile(rutaDe(validar(clave)), 'utf8')))
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Ajustes:')) throw err
    return {} // aún no hay archivo, o no se puede leer: valores por defecto
  }
}

let cola: Promise<unknown> = Promise.resolve()

/** Cambia solo los campos dados (`null` = volver al valor por defecto). Las escrituras van en cola y son atómicas. */
export function fijarAjustes(clave: string, cambios: { modelo?: string | null; autonomia?: string | null; esfuerzo?: string | null }): Promise<AjustesAsistente> {
  const p = cola.then(async () => {
    const id = validar(clave)
    const actual = await leerAjustes(id)
    const nuevo: Record<string, unknown> = { ...actual }
    for (const campo of ['modelo', 'autonomia', 'esfuerzo'] as const) {
      const valor = cambios[campo]
      if (valor === undefined) continue
      if (valor === null) delete nuevo[campo]
      else if (limpiarAjustes({ [campo]: valor })[campo] !== undefined) nuevo[campo] = valor // un valor inválido no cambia nada
    }
    const limpio = limpiarAjustes(nuevo)
    const ruta = rutaDe(id)
    await mkdir(dirname(ruta), { recursive: true })
    const tmp = `${ruta}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(limpio, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, ruta)
    return limpio
  })
  cola = p.catch(() => undefined)
  return p
}
