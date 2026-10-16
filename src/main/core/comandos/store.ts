import { basename } from 'node:path'
import { COMANDOS_INCLUIDOS, type ComandoUsuario } from '@shared/core/comandos'

export { dividirArgumentos, expandirPlantilla } from '@shared/core/comandos'
import { esDestructiva } from '../guardrails/destructivo'
import { AlmacenJson, validarId } from '../memory/almacen'
import { INTERPRETES } from '../permisos/reglas'

export const AMBITO_GLOBAL = 'global'
const NOMBRE = /^[a-z][a-z0-9_-]{0,31}$/
const MAX_COMANDOS = 100

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

interface Documento {
  comandos: ComandoUsuario[]
}

/** Comandos propios por proyecto (más globales) en ~/.centro-proyectos/comandos/ (0600). El del proyecto manda sobre el global. */
export class ComandosStore {
  private readonly almacen: AlmacenJson<Documento>

  constructor(dir: string) {
    this.almacen = new AlmacenJson<Documento>(dir, 0o600)
  }

  async listar(ambito: string = AMBITO_GLOBAL): Promise<ComandoUsuario[]> {
    return (await this.almacen.leer(validarId(ambito)))?.comandos ?? []
  }

  async efectivos(proyectoId?: string): Promise<ComandoUsuario[]> {
    const globales = await this.listar(AMBITO_GLOBAL)
    if (!proyectoId || proyectoId === AMBITO_GLOBAL) return globales
    const propios = await this.listar(proyectoId)
    return [...propios, ...globales.filter((g) => !propios.some((p) => p.nombre === g.nombre))]
  }

  async guardar(c: ComandoUsuario, ambito: string = AMBITO_GLOBAL): Promise<ComandoUsuario[]> {
    const limpio: ComandoUsuario = {
      nombre: c.nombre.trim(),
      descripcion: c.descripcion.trim(),
      tipo: c.tipo,
      ...(c.tipo === 'prompt' ? { plantilla: c.plantilla ?? '' } : { comando: c.comando ?? [], argumentos: c.argumentos === true, permitido: c.permitido === true })
    }
    const motivo = validarComando(limpio)
    if (motivo) throw new Error(motivo)
    const doc = await this.almacen.actualizar(validarId(ambito), (actual) => {
      const resto = (actual?.comandos ?? []).filter((x) => x.nombre !== limpio.nombre)
      if (resto.length >= MAX_COMANDOS) throw new Error('Demasiados comandos: elimina alguno')
      return { comandos: [...resto, limpio].sort((a, b) => a.nombre.localeCompare(b.nombre)) }
    })
    return doc?.comandos ?? []
  }

  async eliminar(nombre: string, ambito: string = AMBITO_GLOBAL): Promise<ComandoUsuario[]> {
    const doc = await this.almacen.actualizar(validarId(ambito), (actual) => (actual ? { comandos: actual.comandos.filter((x) => x.nombre !== nombre) } : undefined))
    return doc?.comandos ?? []
  }
}
