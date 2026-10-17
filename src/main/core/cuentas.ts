import { randomBytes } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CUENTA_PRINCIPAL = 'principal'

interface Datos {
  cuentas: { id: string; nombre: string }[]
  activa: string
  automatico: boolean
  /** id -> ms hasta los que se da por agotada. */
  limites: Record<string, number>
}

/** Carpeta de configuración del CLI de la cuenta principal (la que ya usa el usuario fuera de la app). */
export const carpetaPrincipal = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

/**
 * Cuentas de suscripción. La principal es la sesión que el CLI ya tiene (`~/.claude`, sin tocar nada); las demás viven en
 * `<dir>/<id>/` y se usan con `CLAUDE_CONFIG_DIR`, así que cada una guarda su propio inicio de sesión sin mezclarse.
 */
export class Cuentas {
  private cache?: Datos
  private cola: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly archivo: string,
    private readonly carpetas: string
  ) {}

  private async leer(): Promise<Datos> {
    if (this.cache) return this.cache
    let d: Datos = { cuentas: [], activa: CUENTA_PRINCIPAL, automatico: false, limites: {} }
    try {
      const j = JSON.parse(await readFile(this.archivo, 'utf8')) as Partial<Datos>
      d = {
        cuentas: Array.isArray(j.cuentas) ? j.cuentas.filter((c) => typeof c?.id === 'string' && typeof c.nombre === 'string') : [],
        activa: typeof j.activa === 'string' ? j.activa : CUENTA_PRINCIPAL,
        automatico: j.automatico === true,
        limites: j.limites && typeof j.limites === 'object' ? j.limites : {}
      }
    } catch {
      /* primer uso: solo la principal */
    }
    if (d.activa !== CUENTA_PRINCIPAL && !d.cuentas.some((c) => c.id === d.activa)) d.activa = CUENTA_PRINCIPAL
    this.cache = d
    return d
  }

  /** Serializa los cambios y los escribe de forma atómica. */
  private mutar<T>(f: (d: Datos) => T | Promise<T>): Promise<T> {
    const p = this.cola.then(async () => {
      const d = await this.leer()
      const r = await f(d)
      await mkdir(join(this.archivo, '..'), { recursive: true })
      const tmp = `${this.archivo}.tmp`
      await writeFile(tmp, JSON.stringify(d, null, 2), { mode: 0o600 })
      await rename(tmp, this.archivo)
      return r
    })
    this.cola = p.catch(() => undefined)
    return p
  }

  /** `undefined` para la principal: se usa el entorno del CLI tal cual. */
  carpetaDe(id: string): string | undefined {
    return id === CUENTA_PRINCIPAL ? undefined : join(this.carpetas, id)
  }

  /** Carpeta de configuración efectiva (la de la principal incluida), para localizar sesiones. */
  carpetaEfectiva(id: string): string {
    return this.carpetaDe(id) ?? carpetaPrincipal()
  }

  async listar(): Promise<{ id: string; nombre: string; principal: boolean; limiteHasta?: number }[]> {
    const d = await this.leer()
    const ahora = Date.now()
    const dato = (id: string, nombre: string): { id: string; nombre: string; principal: boolean; limiteHasta?: number } => {
      const hasta = d.limites[id]
      return { id, nombre, principal: id === CUENTA_PRINCIPAL, ...(hasta && hasta > ahora ? { limiteHasta: hasta } : {}) }
    }
    return [dato(CUENTA_PRINCIPAL, 'Principal'), ...d.cuentas.map((c) => dato(c.id, c.nombre))]
  }

  async activa(): Promise<string> {
    return (await this.leer()).activa
  }

  async automatico(): Promise<boolean> {
    return (await this.leer()).automatico
  }

  async agregar(nombre: string): Promise<string> {
    const limpio = nombre.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!limpio) throw new Error('Pon un nombre a la cuenta.')
    return this.mutar(async (d) => {
      if (limpio.toLowerCase() === 'principal' || d.cuentas.some((c) => c.nombre.toLowerCase() === limpio.toLowerCase())) throw new Error(`Ya hay una cuenta llamada «${limpio}».`)
      const id = `c-${randomBytes(4).toString('hex')}`
      await mkdir(join(this.carpetas, id), { recursive: true, mode: 0o700 })
      d.cuentas.push({ id, nombre: limpio })
      d.activa = id
      return id
    })
  }

  async quitar(id: string): Promise<void> {
    if (id === CUENTA_PRINCIPAL) throw new Error('La cuenta principal no se puede quitar.')
    await this.mutar(async (d) => {
      if (!d.cuentas.some((c) => c.id === id)) throw new Error('Cuenta desconocida.')
      d.cuentas = d.cuentas.filter((c) => c.id !== id)
      delete d.limites[id]
      if (d.activa === id) d.activa = CUENTA_PRINCIPAL
      // La carpeta es propia de la app (credenciales y sesiones de esa cuenta): se borra con ella.
      await rm(join(this.carpetas, id), { recursive: true, force: true })
    })
  }

  async activar(id: string): Promise<void> {
    await this.mutar((d) => {
      if (id !== CUENTA_PRINCIPAL && !d.cuentas.some((c) => c.id === id)) throw new Error('Cuenta desconocida.')
      d.activa = id
      // Elegirla a mano es una orden: se vuelve a intentar aunque se diera por agotada.
      delete d.limites[id]
    })
  }

  async fijarAutomatico(valor: boolean): Promise<void> {
    await this.mutar((d) => {
      d.automatico = valor
    })
  }

  async marcarLimite(id: string, hasta: number): Promise<void> {
    await this.mutar((d) => {
      d.limites[id] = hasta
    })
  }

  /** Cuentas candidatas para continuar (no agotadas, no ya probadas), en orden: primero las de la lista. */
  async candidatas(excluir: ReadonlySet<string>): Promise<string[]> {
    return (await this.listar()).filter((c) => !c.limiteHasta && !excluir.has(c.id)).map((c) => c.id)
  }
}

const existe = (ruta: string): Promise<boolean> => stat(ruta).then(() => true, () => false)

/**
 * Las conversaciones del CLI son archivos (`<config>/projects/<proyecto>/<sesión>.jsonl`) sin credenciales. Para continuar una
 * conversación con otra cuenta basta con copiar su archivo a la carpeta de esa cuenta: `--resume` la encuentra y no hay que
 * reenviar el historial (que costaría tokens). Devuelve si la sesión queda disponible en `hacia`.
 */
export async function llevarSesion(sesion: string, hacia: string, desde: readonly string[]): Promise<boolean> {
  if (!/^[\w-]+$/.test(sesion)) return false
  const buscar = async (raiz: string): Promise<{ proyecto: string } | undefined> => {
    let proyectos: string[]
    try {
      proyectos = await readdir(join(raiz, 'projects'))
    } catch {
      return undefined
    }
    for (const proyecto of proyectos) if (await existe(join(raiz, 'projects', proyecto, `${sesion}.jsonl`))) return { proyecto }
    return undefined
  }
  if (await buscar(hacia)) return true
  for (const origen of desde) {
    if (origen === hacia) continue
    const hallada = await buscar(origen)
    if (!hallada) continue
    const dirOrigen = join(origen, 'projects', hallada.proyecto)
    const dirDestino = join(hacia, 'projects', hallada.proyecto)
    await mkdir(dirDestino, { recursive: true })
    await cp(join(dirOrigen, `${sesion}.jsonl`), join(dirDestino, `${sesion}.jsonl`))
    // Resultados de herramientas y subagentes de esa sesión, si los hay.
    if (await existe(join(dirOrigen, sesion))) await cp(join(dirOrigen, sesion), join(dirDestino, sesion), { recursive: true })
    return true
  }
  return false
}
