import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const esUrlHttp = (v: string): boolean => {
  try {
    return /^https?:$/.test(new URL(v).protocol)
  } catch {
    return false
  }
}

/**
 * Servidor al que se conecta esta instalación cuando el usuario no ha elegido otro. De más a menos prioridad:
 * 1. `ODESK_SERVIDOR_POR_DEFECTO` (entorno);
 * 2. `servidor-por-defecto.txt`, que los instaladores (`install.sh`, `install.ps1`) dejan junto a la carpeta `repo/` de la instalación:
 *    el lanzador no es una app empaquetada, así que no hay otra forma de saber que es una copia instalada (y el acceso del menú
 *    Inicio de Windows arranca Electron directamente, sin variables);
 * 3. la app empaquetada (`.deb`, AppImage…): el servidor de producción.
 * En desarrollo (`pnpm dev`) no hay ninguno y se usa `http://localhost:3000`.
 */
export function servidorPorDefecto(o: { rutaApp: string; empaquetada: boolean; produccion: string; env?: NodeJS.ProcessEnv }): string | undefined {
  const delEntorno = (o.env ?? process.env).ODESK_SERVIDOR_POR_DEFECTO?.trim()
  if (delEntorno && esUrlHttp(delEntorno)) return delEntorno
  try {
    const delArchivo = readFileSync(join(o.rutaApp, '..', 'servidor-por-defecto.txt'), 'utf8').trim()
    if (esUrlHttp(delArchivo)) return delArchivo
  } catch {
    // sin archivo: no es una copia hecha con el instalador
  }
  return o.empaquetada ? o.produccion : undefined
}
