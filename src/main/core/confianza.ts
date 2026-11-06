import { readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const enCola = new Map<string, Promise<void>>()
const confiadas = new Set<string>()

/**
 * Marca la carpeta como confiable en una cuenta secundaria (`CLAUDE_CONFIG_DIR`): `projects[<ruta>].hasTrustDialogAccepted = true` en su
 * `.claude.json`. Sin eso el CLI ignora los `permissions.allow` y `additionalDirectories` del `.claude/settings.json` del proyecto (y lo
 * avisa por stderr en cada arranque). En `-p` no hay diálogo que aceptar, y la persona ya eligió ese proyecto en la app.
 * La cuenta principal (`~/.claude`) no se toca. Nunca lanza: si falla, el CLI arranca igual que antes.
 */
export async function confiarCarpeta(carpetaCuenta: string | undefined, carpeta: string): Promise<void> {
  if (!carpetaCuenta) return
  const ruta = resolve(carpeta)
  const archivo = join(carpetaCuenta, '.claude.json')
  const clave = `${archivo}\0${ruta}`
  if (confiadas.has(clave)) return
  const previa = enCola.get(archivo) ?? Promise.resolve()
  const tarea = previa.then(async () => {
    let datos: Record<string, unknown>
    try {
      datos = JSON.parse(await readFile(archivo, 'utf8')) as Record<string, unknown>
    } catch {
      // Sin archivo (cuenta sin sesión aún) no hay nada que marcar; un JSON ilegible (a medio escribir por el CLI) no se pisa.
      return
    }
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return
    const proyectos = (datos.projects && typeof datos.projects === 'object' ? datos.projects : {}) as Record<string, Record<string, unknown>>
    if (proyectos[ruta]?.hasTrustDialogAccepted === true) {
      confiadas.add(clave)
      return
    }
    proyectos[ruta] = { ...(proyectos[ruta] ?? {}), hasTrustDialogAccepted: true }
    datos.projects = proyectos
    // Escritura atómica: el CLI lee este archivo al arrancar y no debe ver uno a medias.
    const tmp = `${archivo}.odesk-${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(datos, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, archivo)
    confiadas.add(clave)
  }).catch(() => undefined)
  enCola.set(archivo, tarea)
  await tarea
}
