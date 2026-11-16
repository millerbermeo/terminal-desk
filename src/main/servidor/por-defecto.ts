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
 * Sin ninguno de los dos no hay servidor por defecto: la app lo pide en el primer arranque y lo guarda en `servidor.json`.
 */
export function servidorPorDefecto(o: { rutaApp: string; env?: NodeJS.ProcessEnv }): string | undefined {
  const delEntorno = (o.env ?? process.env).ODESK_SERVIDOR_POR_DEFECTO?.trim()
  if (delEntorno && esUrlHttp(delEntorno)) return delEntorno
  try {
    const delArchivo = readFileSync(join(o.rutaApp, '..', 'servidor-por-defecto.txt'), 'utf8').trim()
    if (esUrlHttp(delArchivo)) return delArchivo
  } catch {
    // sin archivo: no es una copia hecha con el instalador
  }
  return undefined
}
