import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { claveDeDuplicado, contextoSeguro, MAX_MENSAJE, MAX_STACK, sanear, type EntradaRegistro } from '@shared/registro'

const MAX_ARCHIVO = 2 * 1024 * 1024 // al pasar de 2 MB se rota a `.1` (solo se guarda uno)
const MAX_PENDIENTES = 200
const LOTE = 50
const VENTANA_DUPLICADOS_MS = 10_000
const MAX_REPETIDOS = 3 // el mismo error más de 3 veces en la ventana se cuenta, no se repite

export interface OpcionesRegistro {
  /** Archivo de texto donde se anota todo (con rotación). */
  archivo: string
  /** Cola de lo aún no subido: sobrevive a un cierre de la app. */
  archivoPendientes: string
  /** Envía un lote a la cuenta; debe lanzar si no se pudo (sin sesión, sin red…). */
  subir: (entradas: EntradaRegistro[]) => Promise<void>
  version: string
  plataforma: string
  /** Carpeta personal (para quitarla de rutas y mensajes). */
  casa?: string
  /** Contexto común a todos los registros (versión de Electron, memoria…). */
  contexto?: () => Record<string, unknown>
  ahora?: () => number
  /** Cada cuánto se reintenta subir (ms). */
  cadaMs?: number
  /** Espera tras un error antes de subirlo (ms): agrupa ráfagas. */
  esperaErrorMs?: number
}

/**
 * Registro técnico del escritorio: escribe cada suceso en un archivo local (rotado) y lo sube por lotes a la cuenta para poder analizarlo.
 * Nunca lanza ni bloquea la app: si no hay sesión o red, se queda en cola (acotada) y se reintenta.
 */
export class Registro {
  private cola: EntradaRegistro[] = []
  private ultimos = new Map<string, { desde: number; n: number }>()
  private temporizador?: NodeJS.Timeout
  private subiendo = false
  private escritura: Promise<void> = Promise.resolve()
  private readonly ahora: () => number

  constructor(private readonly o: OpcionesRegistro) {
    this.ahora = o.ahora ?? Date.now
  }

  /** Recupera la cola de la vez anterior (por si la app se cerró sin subirla) y arranca el reintento periódico. */
  async iniciar(): Promise<void> {
    try {
      const guardada = JSON.parse(await readFile(this.o.archivoPendientes, 'utf8')) as EntradaRegistro[]
      if (Array.isArray(guardada)) this.cola = guardada.filter((e) => e && typeof e.message === 'string').slice(-MAX_PENDIENTES)
    } catch {
      // aún no hay cola guardada
    }
    this.temporizador = setInterval(() => void this.vaciar(), this.o.cadaMs ?? 60_000)
    this.temporizador.unref?.()
    if (this.cola.length) void this.vaciar()
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
  }

  /** Anota un suceso. Devuelve enseguida; el resto ocurre en segundo plano. */
  registrar(e: { level: EntradaRegistro['level']; source: string; kind: string; message: unknown; stack?: unknown; context?: Record<string, unknown> }): void {
    try {
      const t = this.ahora()
      const entrada: EntradaRegistro = {
        level: e.level,
        source: sanear(e.source, 32),
        kind: sanear(e.kind, 64),
        message: sanear(e.message, MAX_MENSAJE, this.o.casa),
        ...(e.stack ? { stack: sanear(e.stack, MAX_STACK, this.o.casa) } : {}),
        context: contextoSeguro({ ...this.o.contexto?.(), ...e.context }, this.o.casa),
        at: t
      }
      const clave = claveDeDuplicado(entrada)
      const previo = this.ultimos.get(clave)
      if (previo && t - previo.desde < VENTANA_DUPLICADOS_MS) {
        previo.n++
        if (previo.n > MAX_REPETIDOS) return // ráfaga: no se repite
      } else {
        this.ultimos.set(clave, { desde: t, n: 1 })
        if (this.ultimos.size > 200) this.ultimos.clear()
      }
      this.anotarEnArchivo(entrada)
      this.cola.push(entrada)
      if (this.cola.length > MAX_PENDIENTES) this.cola.splice(0, this.cola.length - MAX_PENDIENTES)
      this.guardarCola()
      this.programar(e.level === 'error' ? (this.o.esperaErrorMs ?? 5000) : (this.o.cadaMs ?? 60_000))
    } catch {
      // el registro nunca debe romper la app
    }
  }

  private programar(ms: number): void {
    const t = setTimeout(() => void this.vaciar(), ms)
    t.unref?.()
  }

  private anotarEnArchivo(e: EntradaRegistro): void {
    const linea = `${new Date(e.at).toISOString()} ${e.level.toUpperCase()} [${e.source}/${e.kind}] ${e.message.replace(/\n/g, ' ⏎ ')}${e.stack ? `\n${e.stack}` : ''}\n`
    this.escritura = this.escritura.then(async () => {
      try {
        await mkdir(dirname(this.o.archivo), { recursive: true })
        const tam = await stat(this.o.archivo).then((s) => s.size, () => 0)
        if (tam > MAX_ARCHIVO) {
          await rm(`${this.o.archivo}.1`, { force: true })
          await rename(this.o.archivo, `${this.o.archivo}.1`)
        }
        await appendFile(this.o.archivo, linea, { encoding: 'utf8', mode: 0o600 })
      } catch {
        // sin disco: queda la cola en memoria
      }
    })
  }

  private guardarCola(): void {
    const copia = JSON.stringify(this.cola)
    this.escritura = this.escritura.then(async () => {
      try {
        await mkdir(dirname(this.o.archivoPendientes), { recursive: true })
        await writeFile(this.o.archivoPendientes, copia, { encoding: 'utf8', mode: 0o600 })
      } catch {
        // idem
      }
    })
  }

  /** Sube lo pendiente por lotes; lo que falle se queda para el próximo intento. */
  async vaciar(): Promise<void> {
    if (this.subiendo || this.cola.length === 0) return
    this.subiendo = true
    try {
      while (this.cola.length > 0) {
        const lote = this.cola.slice(0, LOTE)
        await this.o.subir(lote)
        this.cola.splice(0, lote.length)
        this.guardarCola()
      }
    } catch {
      // sin sesión o sin red: se reintenta en el próximo ciclo
    } finally {
      this.subiendo = false
    }
  }

  /** Para pruebas y diagnóstico. */
  pendientes(): number {
    return this.cola.length
  }

  /** Espera a que se terminen de escribir los archivos. */
  async asentar(): Promise<void> {
    await this.escritura
  }
}
