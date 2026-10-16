import type { RegistroHerramientas } from '../registro'
import { escribirArchivo, leerArchivo, listarDirectorio } from './archivos'
import { ejecutarComando } from './terminal'

export function registrarIntegradas(registro: RegistroHerramientas): void {
  for (const h of [leerArchivo, listarDirectorio, escribirArchivo, ejecutarComando]) registro.registrar(h)
}
