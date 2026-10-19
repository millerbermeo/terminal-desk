/**
 * Control de versiones con git: tipos de las operaciones y lógica pura (la comparten main, renderer y tests).
 * El renderer nunca manda rutas de repositorio: solo el id del proyecto; main resuelve la carpeta.
 */

/** Código de estado de un archivo en el índice o en el árbol de trabajo (`.` = sin cambios). */
export type CodigoEstado = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '.'

export interface ArchivoCambio {
  ruta: string
  /** Ruta anterior (renombrados y copias). */
  anterior?: string
  /** Estado en el índice (lo que se confirmará). */
  indice: CodigoEstado
  /** Estado en el árbol de trabajo (lo que aún no se ha preparado). */
  trabajo: CodigoEstado
  conflicto: boolean
  sinSeguimiento: boolean
}

export type OperacionEnCurso = 'fusion' | 'rebase' | 'cherry-pick' | 'revert'

export interface EstadoGit {
  /** La carpeta del proyecto está dentro de un repositorio git. */
  repo: boolean
  raiz?: string
  /** Rama actual; ausente con HEAD desacoplado. */
  rama?: string
  /** Hash corto cuando HEAD está desacoplado (se está en un commit, no en una rama). */
  desacoplado?: string
  /** El repositorio aún no tiene ningún commit. */
  sinCommits: boolean
  upstream?: string
  adelante: number
  atras: number
  operacion?: OperacionEnCurso
  archivos: ArchivoCambio[]
  /** Hubo más archivos de los que se muestran (el estado se acota). */
  truncado?: boolean
  remotos: string[]
}

export interface RefCommit {
  tipo: 'cabeza' | 'rama' | 'remota' | 'etiqueta'
  nombre: string
}

export interface Commit {
  hash: string
  corto: string
  autor: string
  correo: string
  /** ISO 8601. */
  fecha: string
  padres: string[]
  refs: RefCommit[]
  asunto: string
}

export interface ArchivoCommit {
  ruta: string
  anterior?: string
  estado: string
  adiciones: number | null
  eliminaciones: number | null
}

export interface DetalleCommit {
  commit: Commit
  cuerpo: string
  archivos: ArchivoCommit[]
}

export interface Rama {
  /** Nombre corto (`main`, `origin/main`). */
  nombre: string
  remota: boolean
  actual: boolean
  upstream?: string
  adelante: number
  atras: number
  /** El upstream ya no existe en el remoto. */
  huerfana: boolean
  ultimo: string
  asunto: string
  fecha: string
}

export interface Remoto {
  nombre: string
  /** URL con las credenciales ocultas. */
  url: string
}

export interface Etiqueta {
  nombre: string
  /** Con mensaje (anotada) o ligera. */
  anotada: boolean
  commit: string
  fecha: string
  mensaje: string
  autor: string
}

export interface Stash {
  indice: number
  mensaje: string
  fecha: string
}

export interface Identidad {
  nombre?: string
  correo?: string
  /** Dónde está definida: en este repositorio o en la configuración global. */
  origen?: 'local' | 'global'
}

export interface DiffArchivo {
  texto: string
  binario: boolean
  truncado: boolean
}

export interface ResultadoRemoto {
  estado: EstadoGit
  mensaje: string
}

export interface ResultadoCambioConflicto extends ResultadoRemoto {
  /** Quedaron archivos en conflicto que hay que resolver. */
  conflictos: boolean
}

import type { DatosArchivoFusion, PrevisualizacionFusion, ResolucionFusion } from './fusion'

interface P {
  proyectoId: string
}

export interface OperacionesGit {
  estado: { entrada: P; salida: EstadoGit }
  iniciar: { entrada: P & { rama?: string }; salida: EstadoGit }
  diff: { entrada: P & { ruta: string; preparado?: boolean; hash?: string }; salida: DiffArchivo }
  /** Sin `rutas`, todo. */
  preparar: { entrada: P & { rutas?: string[] }; salida: EstadoGit }
  despreparar: { entrada: P & { rutas?: string[] }; salida: EstadoGit }
  /** Deshace los cambios de esas rutas (los archivos sin seguimiento se borran): no se puede recuperar. */
  descartar: { entrada: P & { rutas: string[] }; salida: EstadoGit }
  commit: { entrada: P & { mensaje: string; enmendar?: boolean }; salida: { hash: string; estado: EstadoGit } }
  historial: { entrada: P & { limite?: number; saltar?: number; rama?: string; todas?: boolean; ruta?: string }; salida: { commits: Commit[]; hayMas: boolean } }
  detalleCommit: { entrada: P & { hash: string }; salida: DetalleCommit }
  ramas: { entrada: P; salida: Rama[] }
  crearRama: { entrada: P & { nombre: string; desde?: string; cambiar?: boolean }; salida: EstadoGit }
  /** Con `remota`, crea la rama local que sigue a esa rama remota. */
  cambiarRama: { entrada: P & { nombre: string; remota?: boolean }; salida: EstadoGit }
  eliminarRama: { entrada: P & { nombre: string; forzar?: boolean }; salida: Rama[] }
  fusionar: { entrada: P & { rama: string }; salida: ResultadoCambioConflicto }
  /** Compara la rama actual con otra sin tocar nada: qué archivos trae, cuáles se fusionan solos y cuáles tienen conflictos. */
  fusionPrevia: { entrada: P & { origen: string }; salida: PrevisualizacionFusion }
  /** Las tres versiones (base común, rama actual y rama de origen) de un archivo, para el editor de fusión. */
  fusionArchivo: { entrada: P & { origen: string; ruta: string }; salida: DatosArchivoFusion }
  /**
   * Fusiona `origen` en la rama actual usando las resoluciones elegidas en el editor (por archivo: su texto, o la versión entera de una rama).
   * Deben cubrir todos los archivos en conflicto; si falta alguno no se toca nada. Con `confirmar` (por defecto) crea el commit de fusión.
   */
  fusionAplicar: { entrada: P & { origen: string; resoluciones: Record<string, ResolucionFusion>; mensaje?: string; confirmar?: boolean }; salida: { estado: EstadoGit; hash?: string } }
  revertir: { entrada: P & { hash: string }; salida: ResultadoCambioConflicto }
  /** Cancela la fusión, el revert, el cherry-pick o el rebase en curso. */
  abortar: { entrada: P; salida: EstadoGit }
  /** Continúa un rebase tras resolver los conflictos. */
  continuar: { entrada: P; salida: ResultadoCambioConflicto }
  remotos: { entrada: P; salida: Remoto[] }
  agregarRemoto: { entrada: P & { nombre: string; url: string }; salida: Remoto[] }
  obtener: { entrada: P & { remoto?: string }; salida: ResultadoRemoto }
  traer: { entrada: P & { rebase?: boolean }; salida: ResultadoCambioConflicto }
  enviar: { entrada: P & { remoto?: string }; salida: ResultadoRemoto }
  etiquetas: { entrada: P; salida: { etiquetas: Etiqueta[]; desdeUltima: number | null } }
  crearEtiqueta: { entrada: P & { nombre: string; mensaje?: string; commit?: string }; salida: Etiqueta[] }
  eliminarEtiqueta: { entrada: P & { nombre: string }; salida: Etiqueta[] }
  enviarEtiqueta: { entrada: P & { nombre: string; remoto?: string }; salida: string }
  stashes: { entrada: P; salida: Stash[] }
  guardarStash: { entrada: P & { mensaje?: string; incluirNoSeguidos?: boolean }; salida: { stashes: Stash[]; estado: EstadoGit } }
  aplicarStash: { entrada: P & { indice: number; quitar?: boolean }; salida: ResultadoCambioConflicto }
  eliminarStash: { entrada: P & { indice: number }; salida: Stash[] }
  identidad: { entrada: P; salida: Identidad }
  fijarIdentidad: { entrada: P & { nombre: string; correo: string; global?: boolean }; salida: Identidad }
}

export type NombreOperacionGit = keyof OperacionesGit

// ------------------------------------------------------------------ lógica pura

export const preparados = (e: EstadoGit): ArchivoCambio[] => e.archivos.filter((a) => !a.conflicto && a.indice !== '.')
/** Cambios sin preparar, incluidos los archivos nuevos sin seguimiento. */
export const sinPreparar = (e: EstadoGit): ArchivoCambio[] => e.archivos.filter((a) => !a.conflicto && (a.sinSeguimiento || a.trabajo !== '.'))
export const enConflicto = (e: EstadoGit): ArchivoCambio[] => e.archivos.filter((a) => a.conflicto)

export const nombreDeArchivo = (ruta: string): string => ruta.slice(ruta.lastIndexOf('/') + 1)
export const carpetaDeArchivo = (ruta: string): string => (ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/') + 1) : '')

/** Letra que se muestra junto al archivo y su significado. */
export const NOMBRE_ESTADO: Record<string, string> = {
  M: 'Modificado',
  A: 'Añadido',
  D: 'Eliminado',
  R: 'Renombrado',
  C: 'Copiado',
  T: 'Cambio de tipo',
  U: 'Sin seguimiento',
  '!': 'En conflicto'
}

export type TipoVersion = 'parche' | 'menor' | 'mayor'

const SEMVER = /^(v?)(\d+)\.(\d+)\.(\d+)$/

/**
 * Siguiente versión semántica a partir de las etiquetas existentes (se parte de la más alta; se conserva la «v» si se usa).
 * Sin etiquetas de versión se empieza en 0.0.1 / 0.1.0 / 1.0.0.
 */
export function siguienteVersion(etiquetas: readonly string[], tipo: TipoVersion): string {
  let mejor: { prefijo: string; v: [number, number, number] } | undefined
  for (const e of etiquetas) {
    const m = SEMVER.exec(e)
    if (!m) continue
    const v: [number, number, number] = [Number(m[2]), Number(m[3]), Number(m[4])]
    if (!mejor || v[0] > mejor.v[0] || (v[0] === mejor.v[0] && (v[1] > mejor.v[1] || (v[1] === mejor.v[1] && v[2] > mejor.v[2])))) mejor = { prefijo: m[1]!, v }
  }
  const prefijo = mejor?.prefijo ?? 'v'
  const [a, b, c] = mejor?.v ?? [0, 0, 0]
  if (!mejor) return `${prefijo}${tipo === 'mayor' ? '1.0.0' : tipo === 'menor' ? '0.1.0' : '0.0.1'}`
  return tipo === 'mayor' ? `${prefijo}${a + 1}.0.0` : tipo === 'menor' ? `${prefijo}${a}.${b + 1}.0` : `${prefijo}${a}.${b}.${c + 1}`
}

/** Motivo por el que una ruta relativa de repositorio no se acepta, o null. */
export function validarRutaRepo(ruta: unknown): string | null {
  if (typeof ruta !== 'string' || ruta.length === 0 || ruta.length > 4096) return 'Ruta inválida.'
  if (ruta.includes('\0') || ruta.includes('\n')) return 'Ruta inválida.'
  if (ruta.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(ruta) || ruta.startsWith('-')) return `Ruta no permitida: ${ruta}`
  if (ruta.split(/[\\/]/).includes('..')) return `La ruta no puede salir del repositorio: ${ruta}`
  return null
}

/** Nombre de rama o etiqueta aceptable (la comprobación definitiva la hace `git check-ref-format`). */
export function validarNombreRef(nombre: unknown): string | null {
  if (typeof nombre !== 'string') return 'Nombre inválido.'
  const n = nombre.trim()
  if (!n) return 'El nombre no puede estar vacío.'
  if (n.length > 200) return 'El nombre es demasiado largo.'
  if (n.startsWith('-') || n.startsWith('/') || n.endsWith('/') || n.endsWith('.') || n.endsWith('.lock')) return 'Nombre no válido para git.'
  if (/[\s~^:?*[\\]/.test(n) || [...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || n.includes('..') || n.includes('@{') || n.includes('//') || n === '@') return 'El nombre tiene caracteres que git no admite (espacios, ~ ^ : ? * [ \\ ..).'
  return null
}

// ------------------------------------------------------------------ diff

export type TipoLineaDiff = 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'info'

export interface LineaDiff {
  tipo: TipoLineaDiff
  texto: string
  viejo?: number
  nuevo?: number
}

export interface DiffAnalizado {
  lineas: LineaDiff[]
  adiciones: number
  eliminaciones: number
}

const CABECERA_HUNK = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Convierte un diff unificado en líneas con su numeración (la cabecera `diff --git…` queda como «meta»). */
export function analizarDiff(texto: string): DiffAnalizado {
  const lineas: LineaDiff[] = []
  let adiciones = 0
  let eliminaciones = 0
  let viejo = 0
  let nuevo = 0
  let enHunk = false
  const brutas = texto.split('\n')
  if (brutas.at(-1) === '') brutas.pop() // el texto termina en salto de línea
  for (const bruta of brutas) {
    if (bruta.startsWith('diff ')) {
      enHunk = false
      lineas.push({ tipo: 'meta', texto: bruta })
      continue
    }
    const h = CABECERA_HUNK.exec(bruta)
    if (h) {
      enHunk = true
      viejo = Number(h[1])
      nuevo = Number(h[2])
      lineas.push({ tipo: 'hunk', texto: bruta })
      continue
    }
    if (!enHunk) {
      if (bruta !== '') lineas.push({ tipo: 'meta', texto: bruta })
    } else if (bruta.startsWith('\\')) {
      lineas.push({ tipo: 'info', texto: bruta })
    } else if (bruta.startsWith('+')) {
      lineas.push({ tipo: 'add', texto: bruta.slice(1), nuevo: nuevo++ })
      adiciones++
    } else if (bruta.startsWith('-')) {
      lineas.push({ tipo: 'del', texto: bruta.slice(1), viejo: viejo++ })
      eliminaciones++
    } else {
      lineas.push({ tipo: 'ctx', texto: bruta.slice(1), viejo: viejo++, nuevo: nuevo++ })
    }
  }
  return { lineas, adiciones, eliminaciones }
}

/** «hace 3 días», «ayer»… a partir de una fecha ISO. */
export function fechaRelativa(iso: string, ahora = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((ahora - t) / 1000))
  if (s < 60) return 'hace un momento'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} días`
  const mes = Math.round(d / 30)
  if (mes < 12) return `hace ${mes} ${mes === 1 ? 'mes' : 'meses'}`
  const a = Math.round(mes / 12)
  return `hace ${a} ${a === 1 ? 'año' : 'años'}`
}
