import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DIR } from './proyectos'

/**
 * Caveman (https://github.com/JuliusBrussee/caveman): plugin de Claude Code que comprime las respuestas (~75 % menos tokens).
 * Es global: se carga con `--plugin-dir` en toda terminal de Claude Code y en el Asistente, con cualquier cuenta y proyecto.
 * La app mantiene su propia copia en `~/.odesk-agent/caveman/` y la actualiza sola desde GitHub; no toca el `~/.claude` de nadie.
 * Cada versión vive en una carpeta inmutable `v-<sha>` (una sesión en marcha puede estar leyéndola) y `actual.json` apunta a la vigente.
 */
export const REPO_CAVEMAN = 'https://github.com/JuliusBrussee/caveman'
export const CADA_MS = 6 * 3600 * 1000
const VERSIONES_A_CONSERVAR = 2
const ESPERA_REMOTO_MS = 30_000
const ESPERA_CLONADO_MS = 5 * 60_000

export interface EstadoCaveman {
  /** Commit de la copia vigente. */
  sha: string
  /** Última vez que se consultó GitHub (ms). */
  comprobadoEn: number
  /** Último fallo al actualizar (la copia vigente sigue sirviendo). */
  error?: string
}

export type EjecutarGit = (args: string[], opciones: { cwd?: string; espera: number }) => Promise<string>

const ejecutarGitReal: EjecutarGit = (args, { cwd, espera }) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: espera, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, salida, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split('\n').pop())) : resolve(salida.trim())
    )
  })

const existe = (ruta: string): Promise<boolean> => stat(ruta).then(() => true, () => false)
const esPlugin = (carpeta: string): Promise<boolean> => existe(join(carpeta, '.claude-plugin', 'plugin.json'))
const carpetaDe = (sha: string): string => `v-${sha.slice(0, 12)}`

export interface OpcionesCaveman {
  /** Carpeta de datos de la app (`~/.odesk-agent`). */
  dir: string
  /** Git inyectable (los tests no tocan la red). */
  git?: EjecutarGit
  /** Dónde buscar un Caveman ya instalado con `claude plugin install` para arrancar sin esperar al clonado. */
  inicioClaude?: string
  /** Desactivado (`ODESK_SIN_CAVEMAN=1`). */
  desactivado?: boolean
}

export class GestorCaveman {
  private readonly raiz: string
  private readonly git: EjecutarGit
  private enMarcha?: Promise<EstadoCaveman | undefined>

  constructor(private readonly o: OpcionesCaveman) {
    this.raiz = join(o.dir, 'caveman')
    this.git = o.git ?? ejecutarGitReal
  }

  private get archivoEstado(): string {
    return join(this.raiz, 'actual.json')
  }

  async estado(): Promise<EstadoCaveman | undefined> {
    try {
      const e = JSON.parse(await readFile(this.archivoEstado, 'utf8')) as Partial<EstadoCaveman>
      return typeof e.sha === 'string' && e.sha ? { sha: e.sha, comprobadoEn: Number(e.comprobadoEn) || 0, ...(e.error ? { error: e.error } : {}) } : undefined
    } catch {
      return undefined
    }
  }

  private async guardar(e: EstadoCaveman): Promise<void> {
    await mkdir(this.raiz, { recursive: true })
    const tmp = `${this.archivoEstado}.tmp-${randomUUID().slice(0, 6)}`
    await writeFile(tmp, JSON.stringify(e, null, 2) + '\n', 'utf8')
    await rename(tmp, this.archivoEstado)
  }

  /** Carpeta del plugin lista para `--plugin-dir`, o undefined si aún no hay copia (o está desactivado). */
  async rutaPlugin(): Promise<string | undefined> {
    if (this.o.desactivado) return undefined
    const e = await this.estado()
    if (!e) return undefined
    const carpeta = join(this.raiz, carpetaDe(e.sha))
    return (await esPlugin(carpeta)) ? carpeta : undefined
  }

  /** Consulta GitHub y, si hay un commit nuevo, lo descarga. Nunca lanza; las llamadas simultáneas comparten la misma ejecución. */
  actualizar(): Promise<EstadoCaveman | undefined> {
    if (this.o.desactivado) return Promise.resolve(undefined)
    this.enMarcha ??= this.actualizarAhora()
      .catch((err: unknown) => {
        console.error('Caveman no se pudo actualizar:', err)
        return undefined
      })
      .finally(() => {
        this.enMarcha = undefined
      })
    return this.enMarcha
  }

  private async actualizarAhora(): Promise<EstadoCaveman | undefined> {
    let actual = await this.estado()
    if (!actual || !(await this.rutaPlugin())) actual = await this.sembrar()
    try {
      const remoto = (await this.git(['ls-remote', REPO_CAVEMAN, 'HEAD'], { espera: ESPERA_REMOTO_MS })).split(/\s+/)[0] ?? ''
      if (!/^[0-9a-f]{40}$/.test(remoto)) throw new Error('Respuesta inesperada de GitHub')
      if (actual && actual.sha === remoto && (await this.rutaPlugin())) {
        const e = { sha: actual.sha, comprobadoEn: Date.now() }
        await this.guardar(e)
        return e
      }
      const sha = await this.descargar(remoto)
      const e = { sha, comprobadoEn: Date.now() }
      await this.guardar(e)
      await this.podar(sha)
      return e
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err)
      if (!actual) return undefined
      const e = { ...actual, error: mensaje.slice(0, 300) }
      await this.guardar(e).catch(() => undefined)
      return e
    }
  }

  /** Copia el Caveman que ya haya instalado Claude Code (si lo hay) para tenerlo disponible mientras se descarga el primero. */
  private async sembrar(): Promise<EstadoCaveman | undefined> {
    try {
      const inicio = this.o.inicioClaude ?? join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
      const lista = JSON.parse(await readFile(inicio, 'utf8')) as { plugins?: Record<string, { installPath?: string; gitCommitSha?: string }[]> }
      for (const [nombre, entradas] of Object.entries(lista.plugins ?? {})) {
        if (!nombre.startsWith('caveman@')) continue
        for (const { installPath, gitCommitSha } of entradas) {
          if (!installPath || !gitCommitSha || !/^[0-9a-f]{40}$/.test(gitCommitSha) || !(await esPlugin(installPath))) continue
          const destino = join(this.raiz, carpetaDe(gitCommitSha))
          if (!(await existe(destino))) await this.colocar(installPath, destino)
          const e = { sha: gitCommitSha, comprobadoEn: 0 }
          await this.guardar(e)
          return e
        }
      }
    } catch {
      // no hay Caveman instalado: se espera al clonado
    }
    return undefined
  }

  private async colocar(origen: string, destino: string): Promise<void> {
    await mkdir(this.raiz, { recursive: true })
    const tmp = `${destino}.tmp-${randomUUID().slice(0, 6)}`
    await cp(origen, tmp, { recursive: true, filter: (r) => !/[\\/]\.git$/.test(r) })
    try {
      await rename(tmp, destino)
    } catch {
      await rm(tmp, { recursive: true, force: true }) // otro proceso lo dejó a la vez: vale el suyo
    }
  }

  private async descargar(esperado: string): Promise<string> {
    await mkdir(this.raiz, { recursive: true })
    const tmp = join(this.raiz, `clon.tmp-${randomUUID().slice(0, 6)}`)
    try {
      await this.git(['clone', '--depth', '1', '--quiet', REPO_CAVEMAN, tmp], { espera: ESPERA_CLONADO_MS })
      const sha = (await this.git(['rev-parse', 'HEAD'], { cwd: tmp, espera: ESPERA_REMOTO_MS })) || esperado
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Commit no válido')
      if (!(await esPlugin(tmp))) throw new Error('El repositorio no trae .claude-plugin/plugin.json')
      await rm(join(tmp, '.git'), { recursive: true, force: true }) // la copia es de solo lectura: sin historial
        const destino = join(this.raiz, carpetaDe(sha))
      if (await existe(destino)) await rm(tmp, { recursive: true, force: true })
      else await rename(tmp, destino)
      return sha
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Borra las versiones viejas, pero deja las últimas por si una sesión sigue usando una anterior. */
  private async podar(vigente: string): Promise<void> {
    try {
      const versiones = await Promise.all(
        (await readdir(this.raiz))
          .filter((n) => n.startsWith('v-'))
          .map(async (n) => ({ n, t: (await stat(join(this.raiz, n))).mtimeMs }))
      )
      const sobran = versiones
        .filter((v) => v.n !== carpetaDe(vigente))
        .sort((a, b) => b.t - a.t)
        .slice(VERSIONES_A_CONSERVAR - 1)
      for (const v of sobran) await rm(join(this.raiz, v.n), { recursive: true, force: true })
      for (const n of await readdir(this.raiz)) if (n.includes('.tmp-')) await rm(join(this.raiz, n), { recursive: true, force: true })
    } catch {
      // limpieza de cortesía
    }
  }
}

/** Instancia de la app (datos en `~/.odesk-agent/caveman/`). `ODESK_SIN_CAVEMAN=1` lo apaga. */
export const caveman = new GestorCaveman({ dir: DIR, desactivado: process.env.ODESK_SIN_CAVEMAN === '1' })

/** Carpeta de Caveman para `--plugin-dir` (undefined mientras no se haya descargado la primera vez). */
export const pluginCaveman = (): Promise<string | undefined> => caveman.rutaPlugin().catch(() => undefined)

/** Descarga Caveman al arrancar y lo vuelve a comprobar cada `CADA_MS`, sin bloquear nada. */
export function mantenerCavemanActualizado(): void {
  void caveman.actualizar()
  setInterval(() => void caveman.actualizar(), CADA_MS).unref()
}
