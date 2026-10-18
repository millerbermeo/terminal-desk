import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { carpetaIgnorada, motivoOmitir } from './reglas'

const aPosix = (p: string): string => p.split(sep).join('/')

export interface OpcionesVigilante {
  raiz: string
  /** Un archivo (o una carpeta que desapareció) cambió. Ruta relativa con `/`. Ya agrupado: una ráfaga de eventos del mismo archivo llega una vez. */
  alCambio: (ruta: string) => void
  /** Git cambió de rama o fusionó algo (cambió `HEAD`): lo que cambie a continuación lo hizo git. */
  alGit: () => void
  /** De estas carpetas (rutas relativas), las que `.gitignore` excluye. */
  ignoradasPorGit: (carpetas: string[]) => Promise<Set<string>>
  /** Máximo de carpetas vigiladas por proyecto (cada una es un «watch» del sistema; hay un límite global). */
  maxCarpetas?: number
  /** Tiempo máximo para recorrer el proyecto al empezar. */
  presupuestoMs?: number
  debounceMs?: number
}

export interface InicioVigilante {
  carpetas: number
  /** El proyecto tiene más carpetas de las que se pueden vigilar (o tardó demasiado en recorrerse): solo se vigilan las más cercanas a la raíz. */
  limitada: boolean
}

const EVENTOS_GIT = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD'])

/**
 * Vigila un proyecto entero con un «watch» por carpeta (no recursivo): así puede saltarse `node_modules`, las carpetas generadas y lo que
 * excluye `.gitignore`, que el modo recursivo de Node no permite. Recorre desde la raíz hacia abajo, de modo que si el proyecto es enorme
 * quedan vigiladas las carpetas más cercanas. Las carpetas nuevas se añaden solas.
 */
export class VigilanteProyecto {
  private readonly vigiladas = new Map<string, FSWatcher>()
  private readonly pendientes = new Map<string, NodeJS.Timeout>()
  private watcherGit?: FSWatcher
  private detenido = false
  private limitada = false

  constructor(private readonly o: OpcionesVigilante) {}

  get carpetas(): number {
    return this.vigiladas.size
  }

  async iniciar(): Promise<InicioVigilante> {
    await this.recorrer([''], false, Date.now())
    try {
      this.watcherGit = watch(join(this.o.raiz, '.git'), { persistent: false }, (_ev, nombre) => {
        if (nombre && EVENTOS_GIT.has(nombre.toString())) this.o.alGit()
      })
      this.watcherGit.on('error', () => this.watcherGit?.close())
    } catch {
      // sin .git: no hay nada de git que detectar
    }
    return { carpetas: this.vigiladas.size, limitada: this.limitada }
  }

  /** Recorre por niveles. Con `emitir`, los archivos que ya hay en carpetas recién descubiertas se notifican (se crearon antes de poder vigilarlas). */
  private async recorrer(inicio: string[], emitir: boolean, desde: number): Promise<void> {
    const max = this.o.maxCarpetas ?? 2000
    const presupuesto = this.o.presupuestoMs ?? 4000
    let nivel = inicio
    while (nivel.length && !this.detenido) {
      const siguiente: string[] = []
      for (const rel of nivel) {
        if (this.detenido) return
        if (this.vigiladas.has(rel)) continue
        if (this.vigiladas.size >= max || Date.now() - desde > presupuesto) {
          this.limitada = true
          return
        }
        if (!this.vigilar(rel)) continue
        let entradas
        try {
          entradas = await readdir(join(this.o.raiz, rel), { withFileTypes: true })
        } catch {
          continue
        }
        const subcarpetas: string[] = []
        for (const e of entradas) {
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) {
            if (!carpetaIgnorada(e.name)) subcarpetas.push(r)
          } else if (emitir && e.isFile()) this.o.alCambio(r)
        }
        const ignoradas = subcarpetas.length ? await this.o.ignoradasPorGit(subcarpetas).catch(() => new Set<string>()) : new Set<string>()
        for (const s of subcarpetas) if (!ignoradas.has(s)) siguiente.push(s)
      }
      nivel = siguiente
    }
  }

  private vigilar(rel: string): boolean {
    try {
      const w = watch(join(this.o.raiz, rel), { persistent: false }, (_ev, nombre) => {
        if (nombre) this.evento(rel ? `${rel}/${aPosix(nombre.toString())}` : aPosix(nombre.toString()))
      })
      w.on('error', () => {
        w.close()
        if (this.vigiladas.get(rel) === w) this.vigiladas.delete(rel)
      })
      this.vigiladas.set(rel, w)
      return true
    } catch {
      this.limitada = true // sin «watches» disponibles en el sistema (ENOSPC) o la carpeta desapareció
      return false
    }
  }

  private evento(rel: string): void {
    if (this.detenido || motivoOmitir(rel) === 'temporal') return
    clearTimeout(this.pendientes.get(rel))
    this.pendientes.set(
      rel,
      setTimeout(() => {
        this.pendientes.delete(rel)
        void this.atender(rel)
      }, this.o.debounceMs ?? 400)
    )
  }

  private async atender(rel: string): Promise<void> {
    if (this.detenido) return
    const info = await stat(join(this.o.raiz, rel)).catch(() => undefined)
    if (info?.isDirectory()) {
      const nombre = rel.split('/').at(-1)!
      if (carpetaIgnorada(nombre) || this.vigiladas.has(rel)) return
      if ((await this.o.ignoradasPorGit([rel]).catch(() => new Set<string>())).has(rel)) return
      await this.recorrer([rel], true, Date.now())
      return
    }
    if (!info) {
      // Desapareció: si era una carpeta vigilada, se dejan de vigilar ella y las de dentro.
      for (const [r, w] of [...this.vigiladas]) {
        if (r === rel || r.startsWith(`${rel}/`)) {
          w.close()
          this.vigiladas.delete(r)
        }
      }
    }
    this.o.alCambio(rel)
  }

  detener(): void {
    this.detenido = true
    for (const t of this.pendientes.values()) clearTimeout(t)
    this.pendientes.clear()
    for (const w of this.vigiladas.values()) w.close()
    this.vigiladas.clear()
    this.watcherGit?.close()
  }
}
