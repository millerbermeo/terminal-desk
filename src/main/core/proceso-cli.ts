import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  argumentosCli,
  CanalControl,
  entornoEjecucion,
  LectorTurno,
  lectorDeLineas,
  rutaClaude,
  type ControlProceso,
  type EntradaTurno,
  type OpcionesEjecucion,
  type OpcionesProceso,
  type SalidaEjecucion
} from './suscripcion'

/**
 * Proceso del CLI que sigue vivo entre mensajes de una conversación, como hace la extensión de Claude Code para VS Code (SDK de agentes):
 * un solo `claude` con entrada y salida stream-json atiende todos los turnos. Frente a lanzar uno por mensaje con `--resume`:
 *  - no se paga el arranque (CLI, plugins, servidores MCP) en cada mensaje;
 *  - se puede interrumpir un turno sin matar el proceso (`interrupt`), preguntar algo aparte (`side_question`), consultar el uso real del
 *    contexto (`get_context_usage`) y deshacer los cambios de archivos (`rewind_files`).
 * Se cierra solo tras un rato sin uso, y hay un máximo de procesos vivos (cada uno ocupa cientos de MB).
 */

const WINDOWS = process.platform === 'win32'

const entero = (v: string | undefined, porDefecto: number): number => {
  const n = Number(v)
  return v?.trim() && Number.isFinite(n) && n > 0 ? n : porDefecto
}

/** El proceso ya había terminado: quien llama puede lanzar otro y repetir (el mensaje no llegó a enviarse). */
export class ProcesoCerrado extends Error {}

const vivos = new Set<ProcesoCli>()
// Si la app termina de golpe, que no queden CLIs huérfanos esperando en su entrada.
process.once('exit', () => {
  for (const p of vivos) p.matar()
})

/** Huella de lo que fija el proceso (argumentos, carpeta y cuenta): si cambia hay que lanzar otro; el id de sesión a reanudar no cuenta. */
export function firmaProceso(o: OpcionesProceso): string {
  return createHash('sha1')
    .update(JSON.stringify([argumentosCli({ ...o, reanudar: undefined } as OpcionesProceso, true), o.cwd, o.carpetaCuenta ?? '']))
    .digest('hex')
}

export class ProcesoCli implements ControlProceso {
  private readonly canal: CanalControl
  private turno: { lector: LectorTurno; terminar: (codigo: number | null) => void } | undefined
  private cola: Promise<unknown> = Promise.resolve()
  private temporizador: NodeJS.Timeout | undefined
  private errores = ''
  vivo = true
  /** Última vez que se usó (turno, consulta o creación): decide a cuál cerrar si hay demasiados. */
  ultimoUso = Date.now()
  /** Huella del último contexto dinámico que se le envió (solo se reenvía si cambió). */
  dinamico: string | undefined

  private constructor(
    private readonly hijo: ChildProcess,
    readonly firma: string,
    private readonly inactividadMs: number,
    private readonly alCerrar: () => void
  ) {
    vivos.add(this)
    // Un CLI en espera no debe mantener vivo el proceso de la app (ni de los tests); las pipes tampoco.
    hijo.unref()
    for (const s of [hijo.stdin, hijo.stdout, hijo.stderr]) (s as unknown as { unref?: () => void } | null)?.unref?.()
    this.canal = new CanalControl((linea) => this.escribir(linea))
    hijo.stdin!.on('error', () => undefined)
    hijo.stdout!.on('data', lectorDeLineas((m) => void (this.canal.recibir(m) || this.turno?.lector.procesar(m))))
    hijo.stderr!.on('data', (d: Buffer) => (this.errores = (this.errores + d.toString('utf8')).slice(-2000)))
    hijo.on('error', (err) => {
      this.errores += err.message
      this.terminado(-1)
    })
    hijo.on('close', (codigo) => this.terminado(codigo))
    this.armarInactividad()
  }

  static async crear(o: OpcionesProceso, firma: string, inactividadMs: number, alCerrar: () => void): Promise<ProcesoCli> {
    const bin = await rutaClaude()
    if (!bin) throw new Error('No encuentro el CLI «claude».')
    const hijo = spawn(bin, argumentosCli(o, true), { cwd: o.cwd, env: entornoEjecucion(o.carpetaCuenta), stdio: ['pipe', 'pipe', 'pipe'], ...(WINDOWS ? { shell: true } : {}) })
    return new ProcesoCli(hijo, firma, inactividadMs, alCerrar)
  }

  private escribir(linea: string): boolean {
    if (!this.vivo || !this.hijo.stdin?.writable) return false
    this.hijo.stdin.write(linea)
    return true
  }

  private terminado(codigo: number | null): void {
    if (!this.vivo) return
    this.vivo = false
    vivos.delete(this)
    clearTimeout(this.temporizador)
    this.canal.cerrar()
    this.turno?.terminar(codigo)
    this.alCerrar()
  }

  private armarInactividad(): void {
    clearTimeout(this.temporizador)
    if (!this.vivo || this.inactividadMs <= 0) return
    this.temporizador = setTimeout(() => this.cerrar(), this.inactividadMs)
    this.temporizador.unref()
  }

  get ocupado(): boolean {
    return this.turno !== undefined
  }

  /** Un turno (mensaje → resultado). Los turnos de un mismo proceso se atienden de uno en uno. */
  ejecutar(o: EntradaTurno & { mensajeId?: string }): Promise<SalidaEjecucion> {
    const correr = (): Promise<SalidaEjecucion> => {
      if (!this.vivo) throw new ProcesoCerrado()
      clearTimeout(this.temporizador)
      this.ultimoUso = Date.now()
      return new Promise<SalidaEjecucion>((res) => {
        let matar: NodeJS.Timeout | undefined
        let hecho = false
        const alAbortar = (): void => {
          this.interrumpir()
          // Si no hace caso en unos segundos, se mata (el siguiente mensaje lanzará otro y reanudará la conversación).
          matar = setTimeout(() => this.matar(), 4000)
          matar.unref()
        }
        const terminar = (codigo: number | null): void => {
          if (hecho) return
          hecho = true
          this.turno = undefined
          clearTimeout(matar)
          o.senal.removeEventListener('abort', alAbortar)
          this.ultimoUso = Date.now()
          this.armarInactividad()
          res(lector.finalizar(codigo, this.errores))
        }
        const lector = new LectorTurno(o, (l) => void this.escribir(l), () => terminar(0), () => this.interrumpir())
        this.turno = { lector, terminar }
        o.senal.addEventListener('abort', alAbortar, { once: true })
        lector.iniciar()
        const entrada = o.prefijoPrompt ? `${o.prefijoPrompt}\n\n${o.prompt}` : o.prompt
        const enviado = this.escribir(JSON.stringify({ type: 'user', ...(o.mensajeId ? { uuid: o.mensajeId } : {}), message: { role: 'user', content: entrada } }) + '\n')
        if (!enviado) {
          this.turno = undefined
          o.senal.removeEventListener('abort', alAbortar)
          hecho = true
          throw new ProcesoCerrado()
        }
        if (o.senal.aborted) alAbortar()
      })
    }
    const p = this.cola.then(correr, correr)
    this.cola = p.catch(() => undefined)
    return p
  }

  control<T = unknown>(request: Record<string, unknown>, esperaMs?: number): Promise<T> {
    this.ultimoUso = Date.now()
    return this.canal.enviar<T>(request, esperaMs)
  }

  interrumpir(): void {
    void this.canal.enviar({ subtype: 'interrupt' }, 2000).catch(() => undefined)
  }

  /** Cierre amable: se cierra la entrada y el CLI termina lo que lleve; si no sale en unos segundos, se mata. */
  cerrar(): void {
    if (!this.vivo) return
    this.hijo.stdin?.end()
    const t = setTimeout(() => this.matar(), 3000)
    t.unref()
  }

  matar(): void {
    this.hijo.kill()
  }
}

/** Procesos vivos por conversación (clave = id de la conversación de la app). */
export class ProcesosCli {
  private readonly mapa = new Map<string, ProcesoCli>()

  constructor(
    private readonly maximo: number = entero(process.env.ODESK_MAX_PROCESOS, 4),
    private readonly inactividadMs: number = entero(process.env.ODESK_PROCESO_INACTIVO_MIN, 20) * 60_000
  ) {}

  get(clave: string): ProcesoCli | undefined {
    const p = this.mapa.get(clave)
    return p?.vivo ? p : undefined
  }

  get tamano(): number {
    return [...this.mapa.values()].filter((p) => p.vivo).length
  }

  /** El proceso de esa conversación si sigue vivo y con la misma configuración; si no, uno nuevo (cerrando el anterior y, si hay demasiados, el más antiguo sin uso). */
  async obtener(clave: string, o: OpcionesProceso): Promise<{ proceso: ProcesoCli; nuevo: boolean }> {
    const firma = firmaProceso(o)
    const actual = this.mapa.get(clave)
    if (actual?.vivo && actual.firma === firma) return { proceso: actual, nuevo: false }
    actual?.cerrar()
    this.mapa.delete(clave)
    const ociosos = [...this.mapa.entries()].filter(([, p]) => p.vivo && !p.ocupado).sort((a, b) => a[1].ultimoUso - b[1].ultimoUso)
    for (let i = 0; this.tamano >= this.maximo && i < ociosos.length; i++) {
      const [k, p] = ociosos[i]!
      p.cerrar()
      this.mapa.delete(k)
    }
    const proceso = await ProcesoCli.crear(o, firma, this.inactividadMs, () => {
      if (this.mapa.get(clave) === proceso) this.mapa.delete(clave)
    })
    this.mapa.set(clave, proceso)
    return { proceso, nuevo: true }
  }

  cerrar(clave: string): void {
    this.mapa.get(clave)?.cerrar()
    this.mapa.delete(clave)
  }

  cerrarTodos(): void {
    for (const p of this.mapa.values()) p.cerrar()
    this.mapa.clear()
  }
}

/** Igual que `ejecutarSuscripcion`, pero en el proceso persistente de la conversación (se lanza si hace falta; si se había cerrado, se repite una vez). */
export async function ejecutarEnProceso(pool: ProcesosCli, clave: string, o: OpcionesEjecucion): Promise<SalidaEjecucion> {
  for (let intento = 0; ; intento++) {
    const { proceso } = await pool.obtener(clave, o)
    o.alProceso?.(proceso)
    try {
      return await proceso.ejecutar(intento === 0 ? o : { ...o, omitirInicio: true })
    } catch (err) {
      if (!(err instanceof ProcesoCerrado) || intento >= 1) throw err
    }
  }
}
