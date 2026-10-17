import { randomUUID } from 'node:crypto'
import type { LlamadaHerramienta } from '@shared/core/herramientas'
import type { NuevaRegla, ReglaPermiso } from '@shared/core/permisos'
import { esDestructiva } from '../guardrails/destructivo'
import { AlmacenJson, validarId } from '../memory/almacen'

export const AMBITO_GLOBAL = 'global'
const MAX_REGLAS = 200

/** Programas que ejecutan código arbitrario: con comodín equivaldrían a «permitir todo». */
export const INTERPRETES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3', 'perl', 'ruby', 'php',
  'lua', 'npx', 'pnpx', 'bunx', 'env', 'xargs', 'sudo', 'su', 'doas', 'eval', 'exec', 'nohup', 'timeout', 'watch', 'ssh', 'docker', 'podman', 'kubectl'
])

const tokens = (linea: string): string[] => linea.trim().split(/\s+/).filter(Boolean)

/** `pnpm test` exacto; `git commit *` admite cualquier argumento detrás (el comodín solo va al final). */
export function coincideComando(patron: string, comando: string, args: readonly string[]): boolean {
  const p = tokens(patron)
  if (p.length === 0) return false
  const real = [comando, ...args]
  if (p.at(-1) === '*') {
    const fijos = p.slice(0, -1)
    return fijos.length > 0 && real.length >= fijos.length && fijos.every((t, i) => t === real[i])
  }
  return p.length === real.length && p.every((t, i) => t === real[i])
}

export function coincideHerramienta(patron: string, nombre: string): boolean {
  return patron.endsWith('*') ? nombre.startsWith(patron.slice(0, -1)) : patron === nombre
}

export function coincide(r: Pick<ReglaPermiso, 'tipo' | 'patron'>, l: LlamadaHerramienta): boolean {
  if (r.tipo === 'herramienta') return coincideHerramienta(r.patron, l.nombre)
  if (l.nombre !== 'ejecutar_comando') return false
  const args = Array.isArray(l.entrada.args) ? l.entrada.args.map(String) : []
  return coincideComando(r.patron, String(l.entrada.comando ?? ''), args)
}

/**
 * Qué dicen las reglas de una llamada: `denegar` gana siempre; `permitir` nunca se aplica a acciones destructivas
 * (esas siempre piden confirmación); sin regla aplicable, `null` (se pregunta).
 */
export function decidir(reglas: readonly Pick<ReglaPermiso, 'tipo' | 'patron' | 'accion'>[], l: LlamadaHerramienta): 'permitir' | 'denegar' | null {
  if (reglas.some((r) => r.accion === 'denegar' && coincide(r, l))) return 'denegar'
  if (esDestructiva(l.nombre, l.entrada)) return null
  return reglas.some((r) => r.accion === 'permitir' && coincide(r, l)) ? 'permitir' : null
}

/** Motivo por el que una regla no es válida, o null. */
export function validarRegla(r: NuevaRegla): string | null {
  if (r.tipo !== 'comando' && r.tipo !== 'herramienta') return 'Tipo de regla inválido'
  if (r.accion !== 'permitir' && r.accion !== 'denegar') return 'Acción de regla inválida'
  const patron = r.patron.trim()
  if (!patron) return 'El patrón no puede estar vacío'
  if (patron.length > 200) return 'El patrón es demasiado largo'
  if (r.tipo === 'herramienta') {
    if (/\s/.test(patron)) return 'El nombre de la herramienta no puede llevar espacios'
    if (r.accion === 'permitir' && patron.replace(/\*/g, '') === '') return 'Permitir todas las herramientas no está permitido'
    return null
  }
  const t = tokens(patron)
  if (t.slice(0, -1).includes('*') || t[0] === '*') return 'El comodín «*» solo puede ir al final, detrás de un comando'
  const conComodin = t.at(-1) === '*'
  const fijos = conComodin ? t.slice(0, -1) : t
  if (r.accion === 'permitir') {
    if (conComodin && INTERPRETES.has(fijos[0]!)) return `«${fijos[0]}» ejecuta código arbitrario: permite el comando exacto, sin comodín`
    if (esDestructiva('ejecutar_comando', { comando: fijos[0], args: fijos.slice(1) })) return 'Es una acción destructiva o que sale de la máquina: siempre pedirá confirmación'
  }
  return null
}

interface Documento {
  reglas: ReglaPermiso[]
}

/** Reglas persistentes por proyecto (más una lista global), en ~/.odesk-agent/permisos/ (0600). */
export class PermisosStore {
  private readonly almacen: AlmacenJson<Documento>

  constructor(dir: string) {
    this.almacen = new AlmacenJson<Documento>(dir, 0o600)
  }

  async listar(ambito: string = AMBITO_GLOBAL): Promise<ReglaPermiso[]> {
    return (await this.almacen.leer(validarId(ambito)))?.reglas ?? []
  }

  /** Las del proyecto y las globales. */
  async efectivas(proyectoId?: string): Promise<ReglaPermiso[]> {
    const globales = await this.listar(AMBITO_GLOBAL)
    return proyectoId && proyectoId !== AMBITO_GLOBAL ? [...(await this.listar(proyectoId)), ...globales] : globales
  }

  async agregar(nueva: NuevaRegla, ambito: string = AMBITO_GLOBAL): Promise<ReglaPermiso[]> {
    const motivo = validarRegla(nueva)
    if (motivo) throw new Error(motivo)
    const regla: ReglaPermiso = { id: randomUUID().slice(0, 8), tipo: nueva.tipo, patron: nueva.patron.trim(), accion: nueva.accion, creada: new Date().toISOString() }
    const doc = await this.almacen.actualizar(validarId(ambito), (actual) => {
      const reglas = actual?.reglas ?? []
      if (reglas.some((r) => r.tipo === regla.tipo && r.patron === regla.patron && r.accion === regla.accion)) return { reglas }
      if (reglas.length >= MAX_REGLAS) throw new Error('Demasiadas reglas: elimina alguna')
      return { reglas: [...reglas, regla] }
    })
    return doc?.reglas ?? []
  }

  async eliminar(id: string, ambito: string = AMBITO_GLOBAL): Promise<ReglaPermiso[]> {
    const doc = await this.almacen.actualizar(validarId(ambito), (actual) => (actual ? { reglas: actual.reglas.filter((r) => r.id !== id) } : undefined))
    return doc?.reglas ?? []
  }
}

/** Regla exacta que corresponde a una llamada concreta (para «Permitir siempre»). Null si no se puede ofrecer. */
export function reglaDe(l: LlamadaHerramienta): NuevaRegla | null {
  if (esDestructiva(l.nombre, l.entrada)) return null
  if (l.nombre === 'ejecutar_comando') {
    const args = Array.isArray(l.entrada.args) ? l.entrada.args.map(String) : []
    const r: NuevaRegla = { tipo: 'comando', patron: [String(l.entrada.comando), ...args].join(' '), accion: 'permitir' }
    return validarRegla(r) ? null : r
  }
  const r: NuevaRegla = { tipo: 'herramienta', patron: l.nombre, accion: 'permitir' }
  return validarRegla(r) ? null : r
}
