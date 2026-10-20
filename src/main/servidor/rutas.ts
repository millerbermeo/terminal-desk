import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface Archivo {
  version: 1
  rutas: Record<string, string>
}

/**
 * Dónde está cada proyecto **en este equipo** (id del servidor -> carpeta absoluta). El servidor no guarda rutas: cada computadora
 * conoce las suyas, y se rellenan al abrir una carpeta (por su `.odesk/project.json`).
 */
export class RutasLocales {
  private datos?: Record<string, string>
  private cola: Promise<unknown> = Promise.resolve()
  /** Se avisa tras cada cambio de rutas (proyecto agregado, movido o quitado), para que lo que depende de ellas no espere a su siguiente ronda. */
  alCambiar?: () => void

  constructor(private readonly archivo: string) {}

  private async cargar(): Promise<Record<string, string>> {
    if (this.datos) return this.datos
    try {
      const a = JSON.parse(await readFile(this.archivo, 'utf8')) as Partial<Archivo>
      this.datos = Object.fromEntries(Object.entries(a.rutas ?? {}).filter(([, v]) => typeof v === 'string'))
    } catch {
      this.datos = {}
    }
    return this.datos
  }

  private escribir<T>(fn: (d: Record<string, string>) => T): Promise<T> {
    const p = this.cola.then(async () => {
      const d = await this.cargar()
      const r = fn(d)
      await mkdir(dirname(this.archivo), { recursive: true })
      const tmp = `${this.archivo}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ version: 1, rutas: d } satisfies Archivo, null, 2) + '\n', 'utf8')
      await rename(tmp, this.archivo)
      try {
        this.alCambiar?.()
      } catch {
        /* el aviso no puede romper el guardado */
      }
      return r
    })
    this.cola = p.catch(() => undefined)
    return p
  }

  async todas(): Promise<Record<string, string>> {
    return { ...(await this.cargar()) }
  }

  async obtener(id: string): Promise<string | undefined> {
    return (await this.cargar())[id]
  }

  /** Asocia el proyecto con esta carpeta; si la carpeta ya estaba con otro id, la suelta (una carpeta = un proyecto). */
  fijar(id: string, ruta: string): Promise<void> {
    return this.escribir((d) => {
      for (const [otro, r] of Object.entries(d)) if (r === ruta && otro !== id) delete d[otro]
      d[id] = ruta
    })
  }

  quitar(id: string): Promise<void> {
    return this.escribir((d) => {
      delete d[id]
    })
  }
}
