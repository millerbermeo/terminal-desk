/**
 * Comandos de arranque de un proyecto: los que hay que lanzar (en orden, uno por uno) para tener sus servicios en marcha
 * (API, frontend, base de datos, workers…). Viven SOLO en este equipo (`~/.odesk-agent/arranque/<proyecto>.json`).
 *
 * Aquí está la parte pura (validación, duplicados, orden, clasificación de quién ocupa un puerto) para poder probarla y usarla
 * igual desde main y desde la interfaz.
 */

/** Cuándo se considera «listo» un comando y se pasa al siguiente. */
export type EsperaListo = 'puerto' | 'texto' | 'tiempo' | 'nada'
export const ESPERAS: readonly EsperaListo[] = ['puerto', 'texto', 'tiempo', 'nada']

export interface ComandoArranque {
  id: string
  nombre: string
  /** Una sola línea, tal como se escribiría en la terminal. */
  comando: string
  /** Subcarpeta del proyecto donde se ejecuta (relativa, sin `..`); vacío = la raíz. */
  cwd?: string
  /** Puerto que el servicio abre: sirve para esperar a que esté listo y para detectar conflictos. */
  puerto?: number
  orden: number
  esperar: EsperaListo
  /** Con `esperar: 'texto'`: texto que debe aparecer en la salida (sin distinguir mayúsculas). */
  textoListo?: string
  /** `tiempo`: pausa fija. `puerto` y `texto`: máximo que se espera antes de dar el comando por fallido. */
  esperaMs: number
  /** Se lanza solo cada vez que se abre el proyecto en la app. */
  siempre: boolean
}

export type EntradaComandoArranque = Partial<Omit<ComandoArranque, 'orden'>> & { nombre: string; comando: string }

export const MAX_COMANDOS = 30
export const MAX_NOMBRE = 60
export const MAX_COMANDO = 2000
export const MAX_CARPETA = 200
export const MAX_TEXTO_LISTO = 200
export const ESPERA_MAX_MS = 600_000
export const ESPERA_PUERTO_MS = 90_000
export const ESPERA_TIEMPO_MS = 3_000

/** Valor por defecto de `esperaMs` según el modo de espera. */
export const esperaPorDefecto = (e: EsperaListo): number => (e === 'tiempo' ? ESPERA_TIEMPO_MS : e === 'nada' ? 0 : ESPERA_PUERTO_MS)

export const ID_PROYECTO_ARRANQUE = /^[A-Za-z0-9_-]{1,80}$/

export const normalizarEspacios = (s: string): string => s.trim().replace(/\s+/g, ' ')

/** `./api/`, `api\\` y `api//` son la misma carpeta; la raíz (`.`) es vacío. */
export function normalizarCarpeta(c: string | undefined): string {
  const limpio = (c ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
  return limpio === '.' ? '' : limpio
}

/** Dos comandos son «el mismo» si tienen el mismo texto (sin importar espacios ni mayúsculas) y se ejecutan en la misma carpeta. */
export const claveComando = (c: { comando: string; cwd?: string | undefined }): string => `${normalizarEspacios(c.comando).toLowerCase()}@@${normalizarCarpeta(c.cwd).toLowerCase()}`

/** ¿Tiene caracteres de control (salvo el tabulador si se permite)? Escritos en una terminal serían teclas (Ctrl+C, Esc…) u otras líneas. */
const hayControl = (s: string, permitirTab: boolean): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c < 32 && !(permitirTab && c === 9)) || c === 127) return true
  }
  return false
}

export function carpetaValida(c: string): string | null {
  if (c === '') return null
  if (c.startsWith('/') || c.startsWith('~') || /^[A-Za-z]:/.test(c)) return 'La carpeta debe ser relativa al proyecto'
  if (c.split('/').some((p) => p === '..')) return 'La carpeta no puede salir del proyecto («..»)'
  if (hayControl(c, false)) return 'La carpeta tiene caracteres no válidos'
  return null
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

export type ResultadoLimpiar = { ok: true; comando: Omit<ComandoArranque, 'orden'> } | { ok: false; mensaje: string }

/**
 * Normaliza y valida una entrada contra los demás comandos del proyecto (`otros`: sin el que se edita). Rechaza lo repetido:
 * el mismo comando en la misma carpeta, el mismo nombre o el mismo puerto.
 */
export function validarComando(entrada: unknown, otros: readonly ComandoArranque[], id: string): ResultadoLimpiar {
  if (!entrada || typeof entrada !== 'object') return { ok: false, mensaje: 'Comando no válido' }
  const o = entrada as Record<string, unknown>
  const nombre = normalizarEspacios(typeof o.nombre === 'string' ? o.nombre : '')
  if (!nombre) return { ok: false, mensaje: 'Pon un nombre' }
  if (nombre.length > MAX_NOMBRE) return { ok: false, mensaje: `El nombre admite ${MAX_NOMBRE} caracteres como máximo` }
  const crudo = (typeof o.comando === 'string' ? o.comando : '').trim()
  if (/[\r\n]/.test(crudo)) return { ok: false, mensaje: 'Un comando por entrada: pon cada línea como un comando aparte (se ejecutan en orden)' }
  if (hayControl(crudo, true)) return { ok: false, mensaje: 'El comando tiene caracteres de control no válidos' }
  const comando = normalizarEspacios(crudo)
  if (!comando) return { ok: false, mensaje: 'Escribe el comando' }
  if (comando.length > MAX_COMANDO) return { ok: false, mensaje: `El comando admite ${MAX_COMANDO} caracteres como máximo` }
  const cwd = normalizarCarpeta(typeof o.cwd === 'string' ? o.cwd : '')
  if (cwd.length > MAX_CARPETA) return { ok: false, mensaje: 'La carpeta es demasiado larga' }
  const errCarpeta = carpetaValida(cwd)
  if (errCarpeta) return { ok: false, mensaje: errCarpeta }

  const esperar: EsperaListo = ESPERAS.includes(o.esperar as EsperaListo) ? (o.esperar as EsperaListo) : o.puerto ? 'puerto' : 'nada'
  let puerto: number | undefined
  if (o.puerto !== undefined && o.puerto !== null && o.puerto !== '') {
    puerto = num(o.puerto)
    if (puerto === undefined || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535) return { ok: false, mensaje: 'El puerto debe ser un número entre 1 y 65535' }
  }
  if (esperar === 'puerto' && puerto === undefined) return { ok: false, mensaje: 'Para esperar al puerto hay que indicar cuál' }
  const textoListo = normalizarEspacios(typeof o.textoListo === 'string' ? o.textoListo : '')
  if (textoListo.length > MAX_TEXTO_LISTO) return { ok: false, mensaje: 'El texto de «listo» es demasiado largo' }
  if (esperar === 'texto' && !textoListo) return { ok: false, mensaje: 'Para esperar un texto hay que escribirlo' }
  if (esperar === 'texto' && comando.toLowerCase().includes(textoListo.toLowerCase())) return { ok: false, mensaje: 'Ese texto aparece en el propio comando (la terminal lo repite al escribirlo): elige uno que solo salga cuando el servicio arranque' }
  let esperaMs = num(o.esperaMs)
  if (esperaMs === undefined) esperaMs = esperaPorDefecto(esperar)
  esperaMs = Math.round(esperaMs)
  if (esperaMs < 0 || esperaMs > ESPERA_MAX_MS) return { ok: false, mensaje: `La espera debe estar entre 0 y ${ESPERA_MAX_MS / 1000} s` }
  if (esperar === 'puerto' || esperar === 'texto') esperaMs = Math.max(esperaMs, 1000)

  const clave = claveComando({ comando, cwd })
  for (const x of otros) {
    if (x.id === id) continue
    if (claveComando(x) === clave) return { ok: false, mensaje: `Ya existe «${x.nombre}» con ese mismo comando${cwd ? ` en ${cwd}` : ''}` }
    if (x.nombre.toLowerCase() === nombre.toLowerCase()) return { ok: false, mensaje: `Ya hay un comando llamado «${x.nombre}»` }
    if (puerto !== undefined && x.puerto === puerto) return { ok: false, mensaje: `El puerto ${puerto} ya lo usa «${x.nombre}» en este proyecto` }
  }
  return {
    ok: true,
    comando: {
      id,
      nombre,
      comando,
      ...(cwd ? { cwd } : {}),
      ...(puerto !== undefined ? { puerto } : {}),
      esperar,
      ...(esperar === 'texto' ? { textoListo } : {}),
      esperaMs,
      siempre: o.siempre === true
    }
  }
}

export const ordenar = (lista: readonly ComandoArranque[]): ComandoArranque[] => [...lista].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
export const renumerar = (lista: readonly ComandoArranque[]): ComandoArranque[] => ordenar(lista).map((c, i) => ({ ...c, orden: i }))

export type ResultadoAplicar = { ok: true; lista: ComandoArranque[]; comando: ComandoArranque } | { ok: false; mensaje: string }

/** Añade el comando al final o, si `entrada.id` ya existe, lo sustituye conservando su posición. */
export function aplicarComando(lista: readonly ComandoArranque[], entrada: unknown, nuevoId: () => string): ResultadoAplicar {
  const idEntrada = entrada && typeof entrada === 'object' && typeof (entrada as { id?: unknown }).id === 'string' ? (entrada as { id: string }).id : ''
  const previo = lista.find((c) => c.id === idEntrada)
  if (!previo && lista.length >= MAX_COMANDOS) return { ok: false, mensaje: `Un proyecto admite hasta ${MAX_COMANDOS} comandos de arranque` }
  const id = previo ? previo.id : nuevoId()
  const r = validarComando(entrada, lista, id)
  if (!r.ok) return r
  const comando: ComandoArranque = { ...r.comando, orden: previo ? previo.orden : lista.length }
  const nueva = renumerar(previo ? lista.map((c) => (c.id === id ? comando : c)) : [...lista, comando])
  return { ok: true, lista: nueva, comando: nueva.find((c) => c.id === id)! }
}

export const quitarComando = (lista: readonly ComandoArranque[], id: string): ComandoArranque[] => renumerar(lista.filter((c) => c.id !== id))

/** Lleva un comando a la posición `indice` (0 = el primero en arrancar). */
export function moverComando(lista: readonly ComandoArranque[], id: string, indice: number): ComandoArranque[] {
  const ord = ordenar(lista)
  const desde = ord.findIndex((c) => c.id === id)
  if (desde < 0) return renumerar(lista)
  const [c] = ord.splice(desde, 1)
  ord.splice(Math.max(0, Math.min(ord.length, Math.trunc(indice))), 0, c!)
  return ord.map((x, i) => ({ ...x, orden: i }))
}

/** Normaliza lo leído del disco: descarta lo que no es válido y los repetidos. */
export function limpiarLista(v: unknown): ComandoArranque[] {
  if (!Array.isArray(v)) return []
  const out: ComandoArranque[] = []
  for (const x of v.slice(0, MAX_COMANDOS)) {
    const id = x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : ''
    if (!id) continue
    const r = validarComando(x, out, id)
    if (r.ok) out.push({ ...r.comando, orden: num((x as { orden?: unknown }).orden) ?? out.length })
  }
  return renumerar(out)
}

/** Puerto que el propio comando indica (`--port 3000`, `-p 8080`, `PORT=4000`), para sugerirlo al crearlo. */
export function puertoSugerido(comando: string): number | undefined {
  const m = /(?:--port|--listen|-p)[= ]\s*(\d{2,5})\b/.exec(comando) ?? /\bPORT=(\d{2,5})\b/.exec(comando)
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined
}

/** Quita secuencias de escape ANSI (colores, cursor, títulos) de lo que escribe una terminal. */
// eslint-disable-next-line no-control-regex
export const sinAnsi = (s: string): string => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]/g, '')

export const contieneTexto = (salida: string, texto: string): boolean => texto !== '' && sinAnsi(salida).toLowerCase().includes(texto.toLowerCase())

// ---------- Estado en marcha ----------

export type EstadoComando = 'pendiente' | 'arrancando' | 'listo' | 'error' | 'detenido' | 'omitido'

export interface EstadoArranque {
  proyectoId: string
  comandoId: string
  estado: EstadoComando
  mensaje?: string
  /** Terminal donde corre (mientras exista). */
  ptyId?: string
  desde: number
}

/** Terminal que main acaba de abrir para un comando: la interfaz la muestra en la pestaña del proyecto. */
export interface TerminalArranque {
  proyectoId: string
  comandoId: string
  nombre: string
  ptyId: string
  cwd: string
}

export const enCurso = (e: EstadoComando): boolean => e === 'arrancando' || e === 'listo'

// ---------- Quién ocupa un puerto ----------

export interface ProcesoPuerto {
  pid: number
  proceso?: string
  /** Carpeta de trabajo del proceso, si se pudo leer. */
  cwd?: string
  /** Padres del proceso, del más cercano al más lejano. */
  ancestros: number[]
}

export type TipoPuerto = 'en-marcha' | 'mismo-proyecto' | 'otro-proyecto' | 'ajeno'

export interface PtyArranque {
  pid: number
  proyectoId: string
  comandoId: string
}

export interface ProyectoRuta {
  id: string
  nombre: string
  ruta: string
}

export interface ClasificacionPuerto {
  tipo: TipoPuerto
  proyectoId?: string
  proyectoNombre?: string
  /** Comando de arranque dueño del puerto, si se supo por la terminal que lo lanzó. */
  comandoId?: string
}

const unir = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** ¿`dir` es `base` o está dentro? */
export function dentroDe(dir: string, base: string): boolean {
  const d = unir(dir)
  const b = unir(base)
  return b !== '' && (d === b || d.startsWith(b + '/'))
}

/** Proyecto cuya carpeta contiene `dir` (el más específico si están anidados). */
export function proyectoDeCarpeta(dir: string, proyectos: readonly ProyectoRuta[]): ProyectoRuta | undefined {
  return proyectos.filter((p) => dentroDe(dir, p.ruta)).sort((a, b) => unir(b.ruta).length - unir(a.ruta).length)[0]
}

/**
 * ¿De quién es el proceso que escucha en un puerto? Primero se mira si cuelga de una terminal que abrió el arranque (la prueba más
 * fiable: pid o algún ancestro coincide) y, si no, por la carpeta de trabajo del proceso.
 */
export function clasificarPuerto(
  proceso: Pick<ProcesoPuerto, 'pid' | 'cwd' | 'ancestros'> | undefined,
  ctx: { proyectoId: string; comandoId: string; ptys: readonly PtyArranque[]; proyectos: readonly ProyectoRuta[] }
): ClasificacionPuerto {
  if (!proceso) return { tipo: 'ajeno' }
  const pids = new Set([proceso.pid, ...proceso.ancestros])
  const pty = ctx.ptys.find((p) => pids.has(p.pid))
  const nombreDe = (id: string): string | undefined => ctx.proyectos.find((p) => p.id === id)?.nombre
  if (pty) {
    const base = { proyectoId: pty.proyectoId, ...(nombreDe(pty.proyectoId) ? { proyectoNombre: nombreDe(pty.proyectoId)! } : {}), comandoId: pty.comandoId }
    if (pty.proyectoId !== ctx.proyectoId) return { tipo: 'otro-proyecto', ...base }
    return { tipo: pty.comandoId === ctx.comandoId ? 'en-marcha' : 'mismo-proyecto', ...base }
  }
  const p = proceso.cwd ? proyectoDeCarpeta(proceso.cwd, ctx.proyectos) : undefined
  if (!p) return { tipo: 'ajeno' }
  return { tipo: p.id === ctx.proyectoId ? 'mismo-proyecto' : 'otro-proyecto', proyectoId: p.id, proyectoNombre: p.nombre }
}

export type Resolucion = 'omitir' | 'liberar'

export interface ConflictoPuerto {
  comandoId: string
  comandoNombre: string
  puerto: number
  /** `configurado-en-otro`: ahora está libre, pero otro proyecto lo tiene en sus comandos (aviso). */
  tipo: TipoPuerto | 'configurado-en-otro'
  /** Impide arrancar mientras no se decida qué hacer (omitir o liberar el puerto). */
  bloquea: boolean
  pid?: number
  proceso?: string
  proyectoId?: string
  proyectoNombre?: string
  /** Nombre del comando del otro proyecto que usa (o tiene configurado) ese puerto. */
  otroComando?: string
  /** Se puede cerrar el proceso que lo ocupa (se conoce su pid). */
  puedeLiberar: boolean
}

/** Qué hacer con un puerto ocupado cuando nadie decidió nada: lo propio se da por «ya en marcha»; lo demás es un conflicto. */
export const bloqueaPuerto = (t: TipoPuerto): boolean => t === 'otro-proyecto' || t === 'ajeno'

/** Frase para mostrar un conflicto. */
export function describirConflicto(c: ConflictoPuerto): string {
  const quien = c.proyectoNombre ? `«${c.proyectoNombre}»${c.otroComando ? ` (${c.otroComando})` : ''}` : c.proceso ? `${c.proceso}${c.pid ? ` (pid ${c.pid})` : ''}` : c.pid ? `un proceso (pid ${c.pid})` : 'otro programa'
  switch (c.tipo) {
    case 'en-marcha':
      return `El puerto ${c.puerto} ya lo tiene este mismo comando en marcha`
    case 'mismo-proyecto':
      return `El puerto ${c.puerto} ya lo usa algo de este proyecto${c.otroComando ? ` (${c.otroComando})` : ''}`
    case 'otro-proyecto':
      return `El puerto ${c.puerto} está ocupado por ${quien}, de otro proyecto`
    case 'configurado-en-otro':
      return `El puerto ${c.puerto} también está configurado en ${quien}: no podrán estar en marcha a la vez`
    default:
      return `El puerto ${c.puerto} está ocupado por ${quien}, que no es de ningún proyecto de la app`
  }
}

// ---------- Operaciones (IPC) ----------

export type ResultadoGuardarArranque = { ok: true; comandos: ComandoArranque[]; avisos: string[] } | { ok: false; mensaje: string }
export type ResultadoArrancar = { ok: true; comandos: number } | { ok: false; mensaje: string }

export interface OperacionesArranque {
  listar: { entrada: { proyectoId: string }; salida: ComandoArranque[] }
  /** Estado de los comandos de un proyecto (o de todos si se omite). */
  estados: { entrada: { proyectoId?: string }; salida: EstadoArranque[] }
  guardar: { entrada: { proyectoId: string; comando: EntradaComandoArranque }; salida: ResultadoGuardarArranque }
  eliminar: { entrada: { proyectoId: string; id: string }; salida: ComandoArranque[] }
  mover: { entrada: { proyectoId: string; id: string; indice: number }; salida: ComandoArranque[] }
  /** Mira los puertos antes de arrancar y dice qué choca (con otro proyecto, con un programa ajeno…). No cambia nada. */
  revisar: { entrada: { proyectoId: string; ids?: string[] }; salida: ConflictoPuerto[] }
  /** Lanza los comandos (todos, o los `ids`) en orden, esperando a que cada uno esté listo. Devuelve ya; el avance llega por eventos. */
  arrancar: { entrada: { proyectoId: string; ids?: string[]; resoluciones?: Record<string, Resolucion>; continuarSiFalla?: boolean }; salida: ResultadoArrancar }
  detener: { entrada: { proyectoId: string; ids?: string[] }; salida: EstadoArranque[] }
  /** Lanza los marcados «siempre» (una vez por sesión de la app y proyecto; sin tocar procesos ajenos). */
  autoarrancar: { entrada: { proyectoId: string }; salida: ResultadoArrancar }
}
export type NombreOperacionArranque = keyof OperacionesArranque
