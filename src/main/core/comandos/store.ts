import { readdir, readFile, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { COMANDOS_INCLUIDOS, type ComandoUsuario } from '@shared/core/comandos'

export { dividirArgumentos, expandirPlantilla } from '@shared/core/comandos'
import { esDestructiva } from '../guardrails/destructivo'
import { ErrorServidor, ErrorSesion, servidor } from '../../servidor/cliente'
import { INTERPRETES } from '../permisos/reglas'

export const AMBITO_GLOBAL = 'global'
const NOMBRE = /^[a-z][a-z0-9_-]{0,31}$/

/** Motivo por el que un comando no es válido, o null. */
export function validarComando(c: ComandoUsuario): string | null {
  if (!NOMBRE.test(c.nombre)) return 'El nombre debe empezar por una letra y usar solo a-z, 0-9, «-» y «_» (máx. 32)'
  if (COMANDOS_INCLUIDOS.some((i) => i.nombre === c.nombre)) return `«/${c.nombre}» es un comando de la aplicación`
  if (!c.descripcion.trim() || c.descripcion.length > 200) return 'La descripción es obligatoria (máx. 200 caracteres)'
  if (c.tipo === 'prompt') {
    if (!c.plantilla?.trim()) return 'La plantilla no puede estar vacía'
    if (c.plantilla.length > 4000) return 'La plantilla es demasiado larga (máx. 4000 caracteres)'
    return null
  }
  if (c.tipo !== 'ejecutable') return 'Tipo de comando inválido'
  const argv = c.comando ?? []
  if (argv.length === 0 || argv.some((t) => typeof t !== 'string' || !t || t.length > 500) || /\s/.test(argv[0]!)) return 'El comando debe ser un programa y sus argumentos (el programa no puede llevar espacios)'
  if (c.permitido) {
    if (esDestructiva('ejecutar_comando', { comando: argv[0], args: argv.slice(1) })) return 'Es una acción destructiva o que sale de la máquina: siempre pedirá confirmación, no puede ser «permitida»'
    if (c.argumentos && INTERPRETES.has(basename(argv[0]!))) return `«${argv[0]}» ejecuta código arbitrario: con argumentos libres no puede ser «permitido»`
  }
  return null
}

interface ComandoApi {
  id: string
  projectId: string | null
  name: string
  description: string
  type: 'prompt' | 'ejecutable'
  template: string | null
  command: string[] | null
  args: boolean
  allowed: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CACHE_MS = 2000

function ambitoValido(ambito: string): string {
  if (ambito !== AMBITO_GLOBAL && !UUID.test(ambito)) throw new Error('Ámbito inválido: debe ser «global» o el id de un proyecto de la cuenta')
  return ambito
}

function aComando(c: ComandoApi): ComandoUsuario {
  return {
    nombre: c.name,
    descripcion: c.description,
    tipo: c.type,
    ...(c.type === 'prompt' ? { plantilla: c.template ?? '' } : { comando: c.command ?? [], argumentos: c.args, permitido: c.allowed })
  }
}

/**
 * Comandos propios de la cuenta (globales y por proyecto), guardados en el servidor (`/comandos`): lo que se crea o edita aquí
 * lo ven todos los equipos. El del proyecto manda sobre el global. `dirLegado` es la carpeta JSON de versiones anteriores: sus
 * comandos se suben una vez y el archivo se aparta (`.migrado`).
 */
export class ComandosStore {
  private cache?: { en: number; lista: ComandoApi[] }
  private migrado = false

  constructor(private readonly dirLegado?: string) {}

  olvidar(): void {
    this.cache = undefined
  }

  private async todos(): Promise<ComandoApi[]> {
    if (this.cache && Date.now() - this.cache.en < CACHE_MS) return this.cache.lista
    const lista = (await servidor.get<{ commands: ComandoApi[] }>('/comandos')).commands
    this.cache = { en: Date.now(), lista }
    if (!this.migrado) {
      this.migrado = true
      if (await this.migrarLegado(lista)) {
        this.olvidar()
        return this.todos()
      }
    }
    return lista
  }

  /** Sube los comandos de los JSON antiguos que el servidor aún no tiene. `true` si subió alguno. */
  private async migrarLegado(existentes: ComandoApi[]): Promise<boolean> {
    if (!this.dirLegado) return false
    let subio = false
    try {
      for (const f of await readdir(this.dirLegado)) {
        if (!f.endsWith('.json')) continue
        const ambito = f.slice(0, -5)
        if (ambito !== AMBITO_GLOBAL && !UUID.test(ambito)) continue // proyectos antiguos sin id del servidor: no hay a dónde subirlos
        try {
          const doc = JSON.parse(await readFile(join(this.dirLegado, f), 'utf8')) as { comandos?: ComandoUsuario[] }
          for (const c of doc.comandos ?? []) {
            const ya = existentes.some((e) => e.name === c.nombre && (e.projectId ?? AMBITO_GLOBAL) === ambito)
            if (!ya && validarComando(c) === null) {
              await servidor.put('/comandos', this.cuerpo(c, ambito))
              subio = true
            }
          }
          await rename(join(this.dirLegado, f), join(this.dirLegado, `${f}.migrado`))
        } catch (err) {
          if (err instanceof ErrorServidor) throw err // sesión o red: se reintenta en la próxima lectura
        }
      }
    } catch (err) {
      if (err instanceof ErrorServidor) {
        this.migrado = false
        throw err
      }
    }
    return subio
  }

  private cuerpo(c: ComandoUsuario, ambito: string): Record<string, unknown> {
    return {
      name: c.nombre,
      description: c.descripcion,
      type: c.tipo,
      ...(ambito !== AMBITO_GLOBAL ? { projectId: ambito } : {}),
      ...(c.tipo === 'prompt' ? { template: c.plantilla ?? '' } : { command: c.comando ?? [], args: c.argumentos === true, allowed: c.permitido === true })
    }
  }

  async listar(ambito: string = AMBITO_GLOBAL): Promise<ComandoUsuario[]> {
    ambitoValido(ambito)
    return (await this.todos())
      .filter((c) => (c.projectId ?? AMBITO_GLOBAL) === ambito)
      .map(aComando)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  async efectivos(proyectoId?: string): Promise<ComandoUsuario[]> {
    const globales = await this.listar(AMBITO_GLOBAL)
    if (!proyectoId || proyectoId === AMBITO_GLOBAL) return globales
    const propios = await this.listar(proyectoId)
    return [...propios, ...globales.filter((g) => !propios.some((p) => p.nombre === g.nombre))]
  }

  async guardar(c: ComandoUsuario, ambito: string = AMBITO_GLOBAL): Promise<ComandoUsuario[]> {
    ambitoValido(ambito)
    const limpio: ComandoUsuario = {
      nombre: c.nombre.trim(),
      descripcion: c.descripcion.trim(),
      tipo: c.tipo,
      ...(c.tipo === 'prompt' ? { plantilla: c.plantilla ?? '' } : { comando: c.comando ?? [], argumentos: c.argumentos === true, permitido: c.permitido === true })
    }
    const motivo = validarComando(limpio)
    if (motivo) throw new Error(motivo)
    try {
      await servidor.put('/comandos', this.cuerpo(limpio, ambito))
    } catch (err) {
      if (err instanceof ErrorServidor && !(err instanceof ErrorSesion)) throw new Error(err.message, { cause: err })
      throw err
    } finally {
      this.olvidar()
    }
    return this.listar(ambito)
  }

  async eliminar(nombre: string, ambito: string = AMBITO_GLOBAL): Promise<ComandoUsuario[]> {
    ambitoValido(ambito)
    try {
      await servidor.delete('/comandos', { name: nombre, ...(ambito !== AMBITO_GLOBAL ? { projectId: ambito } : {}) })
    } catch (err) {
      if (!(err instanceof ErrorServidor) || err.estado !== 404) throw err // ya no existía: nada que borrar
    } finally {
      this.olvidar()
    }
    return this.listar(ambito)
  }
}
