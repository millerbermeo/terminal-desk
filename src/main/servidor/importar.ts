import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { agregarProyectos, DIR, leerProyectosLocales } from '../proyectos'

const LEGADO = 'proyectos.json'

/**
 * Una sola vez: pasa los proyectos del antiguo `proyectos.json` (rutas locales) a la cuenta del servidor, enlazando cada carpeta con
 * su `.odesk/project.json`. Después renombra el archivo a `proyectos.json.migrado` (no se borra). Si el servidor no responde se lanza el
 * error sin renombrar, para reintentar en el próximo acceso. Devuelve cuántos proyectos quedaron enlazados.
 */
export async function importarProyectosLocales(): Promise<number> {
  const locales = await leerProyectosLocales()
  if (locales.proyectos.length === 0) return 0
  const nombreGrupo = new Map(locales.grupos.map((g) => [g.id, g.nombre]))
  let enlazados = 0
  for (const p of locales.proyectos) {
    const grupo = p.grupo ? nombreGrupo.get(p.grupo) : undefined
    // Las carpetas que ya no existen o ya están enlazadas dan error de validación y se saltan; un fallo de conexión sí se propaga.
    const r = await agregarProyectos({ ...(grupo ? { grupoNuevo: grupo } : {}), proyectos: [{ nombre: p.nombre, ruta: p.ruta }] })
    if (r.errores.length === 0) enlazados++
  }
  await rename(join(DIR, LEGADO), join(DIR, `${LEGADO}.migrado`)).catch(() => undefined)
  return enlazados
}
