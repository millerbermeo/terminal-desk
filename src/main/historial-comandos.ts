import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { analizarHistorialShell, comandoRegistrable, sinRepetidos } from '@shared/sugerencias'

const MAX_PROPIOS = 5000
const MAX_DEVUELTOS = 4000
const MAX_LECTURA = 1024 * 1024 // de cada archivo de historial del shell solo se lee el final

/** Archivos de historial que dejan los shells (bash y zsh solo al cerrar la sesión; fish al momento). */
const ARCHIVOS_SHELL = ['.bash_history', '.zsh_history', join('.local', 'share', 'fish', 'fish_history')]

async function leerFinal(ruta: string): Promise<string> {
  try {
    const texto = await readFile(ruta, 'utf8')
    if (texto.length <= MAX_LECTURA) return texto
    const corte = texto.slice(-MAX_LECTURA)
    return corte.slice(corte.indexOf('\n') + 1) // sin la línea cortada por la mitad
  } catch {
    return ''
  }
}

/**
 * Comandos que el usuario ha escrito en las terminales, para sugerirlos mientras escribe. Guarda los que se ejecutan en la app
 * (`propios`, en un archivo 0600 de la carpeta de datos) y, solo en memoria, los que ya había en el historial del shell.
 */
export class HistorialComandos {
  private propios: string[] = [] // del más nuevo al más viejo
  private importados: string[] = [] // del más nuevo al más viejo
  private listo?: Promise<void>
  private escritura: Promise<void> = Promise.resolve()

  constructor(
    private readonly archivo: string,
    private readonly casa: string = homedir()
  ) {}

  private cargar(): Promise<void> {
    this.listo ??= (async () => {
      try {
        const guardado = JSON.parse(await readFile(this.archivo, 'utf8')) as unknown
        if (Array.isArray(guardado)) this.propios = guardado.filter((c): c is string => typeof c === 'string' && comandoRegistrable(c))
      } catch {
        // aún no hay archivo, o no se puede leer: se empieza vacío
      }
      const viejoAlNuevo: string[] = []
      for (const a of ARCHIVOS_SHELL) viejoAlNuevo.push(...analizarHistorialShell(await leerFinal(join(this.casa, a))))
      this.importados = viejoAlNuevo.reverse()
    })()
    return this.listo
  }

  /** Comandos del más reciente al más antiguo, sin repetidos. Lo ejecutado en la app va antes que lo importado del shell. */
  async lista(): Promise<string[]> {
    await this.cargar()
    return sinRepetidos([...this.propios, ...this.importados], MAX_DEVUELTOS)
  }

  async agregar(comando: string): Promise<void> {
    if (typeof comando !== 'string' || !comandoRegistrable(comando)) return
    await this.cargar()
    this.propios = [comando, ...this.propios.filter((c) => c !== comando)].slice(0, MAX_PROPIOS)
    const copia = this.propios
    this.escritura = this.escritura.then(async () => {
      try {
        await mkdir(dirname(this.archivo), { recursive: true })
        const tmp = `${this.archivo}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(copia) + '\n', { encoding: 'utf8', mode: 0o600 })
        await rename(tmp, this.archivo)
      } catch {
        // sin disco no hay sugerencias persistentes, pero la terminal sigue funcionando
      }
    })
    await this.escritura
  }
}
