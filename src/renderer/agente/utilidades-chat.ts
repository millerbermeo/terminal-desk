import type { EventoAgente } from '@shared/core/agente'
import type { TurnoGuardado } from '@shared/core/sesion'

/** Lo mínimo de un turno que usan estas utilidades (sirve tanto para `Turno` como para `TurnoGuardado`). */
export type TurnoBasico = Pick<TurnoGuardado, 'prompt' | 'eventos' | 'estado' | 'destino'> & { lateral?: boolean; parcial?: string }

// ───────────────────────────── Texto de la respuesta ─────────────────────────────

/** Lo que el Asistente respondió en un turno (solo el agente principal), en el orden en que lo escribió. */
export function textoRespuesta(t: Pick<TurnoBasico, 'eventos' | 'parcial'>): string {
  const partes: string[] = t.eventos.flatMap((e: EventoAgente) => (e.tipo === 'texto' && e.profundidad === 0 ? [e.texto.trim()] : []))
  const texto = partes.filter(Boolean).join('\n\n')
  return texto || (t.parcial ?? '').trim()
}

// ───────────────────────────── Historial de prompts (flecha arriba) ─────────────────────────────

/** Lo que enviaste antes, del más viejo al más nuevo, sin vacíos ni repetidos seguidos ni preguntas laterales. */
export function promptsEnviados(turnos: readonly Pick<TurnoBasico, 'prompt' | 'lateral'>[]): string[] {
  const salida: string[] = []
  for (const t of turnos) {
    const p = t.prompt.trim()
    if (!p || t.lateral || salida.at(-1) === p) continue
    salida.push(p)
  }
  return salida
}

/**
 * Navega por el historial como una consola. `pasos` = cuántos mensajes atrás se está (0 = el borrador que se estaba escribiendo).
 * Devuelve los pasos nuevos y el texto a mostrar (`undefined` = no hay nada que navegar en esa dirección).
 */
export function navegarPrompts(prompts: readonly string[], pasos: number, direccion: 'arriba' | 'abajo', borrador: string): { pasos: number; texto: string } | undefined {
  if (prompts.length === 0) return undefined
  const nuevos = direccion === 'arriba' ? Math.min(prompts.length, pasos + 1) : Math.max(0, pasos - 1)
  if (nuevos === pasos) return undefined
  return { pasos: nuevos, texto: nuevos === 0 ? borrador : prompts[prompts.length - nuevos]! }
}

/** La flecha solo navega si el cursor está en la primera línea (arriba) o en la última (abajo): no estorba al editar texto largo. */
export function cursorEnBorde(texto: string, inicio: number, fin: number, direccion: 'arriba' | 'abajo'): boolean {
  if (inicio !== fin) return false
  return direccion === 'arriba' ? !texto.slice(0, inicio).includes('\n') : !texto.slice(inicio).includes('\n')
}

// ───────────────────────────── Buscar ─────────────────────────────

/** Sin mayúsculas ni acentos: «configuracion» encuentra «Configuración». */
export const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Texto donde se busca de un turno: lo que pediste y lo que respondió (no la salida de las herramientas). */
export const textoBuscable = (t: Pick<TurnoBasico, 'prompt' | 'eventos' | 'parcial'>): string => `${t.prompt}\n${textoRespuesta(t)}`

/** Posiciones de los turnos que contienen todas las palabras de la consulta. */
export function buscarEnTurnos(turnos: readonly Pick<TurnoBasico, 'prompt' | 'eventos' | 'parcial'>[], consulta: string): number[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return []
  const coincidencias: number[] = []
  turnos.forEach((t, i) => {
    const texto = normalizar(textoBuscable(t))
    if (palabras.every((p) => texto.includes(p))) coincidencias.push(i)
  })
  return coincidencias
}

// ───────────────────────────── Exportar ─────────────────────────────

const ETIQUETA_ESTADO: Record<string, string> = {
  en_curso: 'en curso',
  completado: 'completado',
  limite_pasos: 'límite de pasos',
  cancelado: 'cancelado',
  error: 'error',
  rechazado: 'rechazado',
  fallido: 'fallido'
}

/** La conversación como Markdown: lo que pediste y lo que respondió el Asistente (sin la salida de las herramientas). */
export function exportarMarkdown(opciones: { titulo: string; turnos: readonly TurnoBasico[]; fecha?: Date }): string {
  const fecha = (opciones.fecha ?? new Date()).toISOString().slice(0, 10)
  const lineas = [`# ${opciones.titulo.replace(/\s+/g, ' ').trim() || 'Conversación'}`, '', `_Exportada el ${fecha} · ${opciones.turnos.length} ${opciones.turnos.length === 1 ? 'mensaje' : 'mensajes'}_`, '']
  for (const t of opciones.turnos) {
    lineas.push(`## Tú${t.lateral ? ' (pregunta lateral)' : ''}`, '', t.prompt.trim() || '_(sin texto)_', '')
    const herramientas = t.eventos.filter((e) => e.tipo === 'herramienta_inicio').length
    const respuesta = textoRespuesta(t)
    lineas.push('## Asistente', '')
    lineas.push(respuesta || '_(sin respuesta de texto)_', '')
    const notas = [herramientas ? `${herramientas} ${herramientas === 1 ? 'acción' : 'acciones'}` : '', t.estado !== 'completado' ? (ETIQUETA_ESTADO[t.estado] ?? t.estado) : ''].filter(Boolean)
    if (notas.length) lineas.push(`_${notas.join(' · ')}_`, '')
  }
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Nombre de archivo seguro para guardar la conversación. */
export function nombreArchivoExportado(titulo: string, fecha = new Date()): string {
  const base = normalizar(titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'conversacion'
  return `${base}-${fecha.toISOString().slice(0, 10)}.md`
}

// ───────────────────────────── Costo antes de enviar ─────────────────────────────

/** Aproximación habitual: 4 caracteres por token. */
export const estimarTokens = (texto: string): number => Math.ceil(texto.length / 4)

export interface EstimacionEnvio {
  /** Tokens del mensaje nuevo. */
  entrada: number
  /** % de la ventana que ocupará el contexto después de enviarlo (sin la respuesta). */
  porcentajeDespues?: number
}

/** Cuántos tokens añade este mensaje y cuánto contexto quedará. No hay precio: el consumo real lo mide la barra de uso. */
export function estimarEnvio(texto: string, contexto?: { tokens: number; ventana?: number }): EstimacionEnvio {
  const entrada = estimarTokens(texto)
  return {
    entrada,
    ...(contexto?.ventana ? { porcentajeDespues: Math.min(100, Math.round(((contexto.tokens + entrada) / contexto.ventana) * 100)) } : {})
  }
}

// ───────────────────────────── Diff de las ediciones ─────────────────────────────

export interface CambioArchivo {
  /** Ruta tal como la pasó el modelo (normalmente absoluta). */
  ruta: string
  antes: string
  despues: string
  /** `Write` reemplaza el archivo entero: no se puede revertir sin conocer lo anterior. */
  reescribe: boolean
}

const cadena = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Cambios que describe la llamada a `Edit`, `MultiEdit` o `Write` (la entrada viene del modelo: se lee con cuidado). */
export function cambiosDeEdicion(nombre: string, entrada: Record<string, unknown>): CambioArchivo[] {
  const ruta = cadena(entrada.file_path)
  if (!ruta) return []
  if (nombre === 'Edit') {
    const antes = cadena(entrada.old_string)
    const despues = cadena(entrada.new_string)
    return antes !== undefined && despues !== undefined ? [{ ruta, antes, despues, reescribe: false }] : []
  }
  if (nombre === 'MultiEdit' && Array.isArray(entrada.edits)) {
    return entrada.edits.flatMap((x): CambioArchivo[] => {
      const o = (x ?? {}) as Record<string, unknown>
      const antes = cadena(o.old_string)
      const despues = cadena(o.new_string)
      return antes !== undefined && despues !== undefined ? [{ ruta, antes, despues, reescribe: false }] : []
    })
  }
  if (nombre === 'Write') {
    const contenido = cadena(entrada.content)
    return contenido !== undefined ? [{ ruta, antes: '', despues: contenido, reescribe: true }] : []
  }
  return []
}

export type ResultadoReversion = { ok: true; contenido: string } | { ok: false; motivo: 'ya-cambiado' | 'ambiguo' | 'sin-referencia' }

/** Deshace un cambio puntual sobre el contenido actual: solo si lo que puso el modelo aparece una única vez (si no, no adivina). */
export function revertirCambio(actual: string, antes: string, despues: string): ResultadoReversion {
  if (!despues) return { ok: false, motivo: 'sin-referencia' } // se borró texto: no hay dónde ponerlo de vuelta con seguridad
  const primero = actual.indexOf(despues)
  if (primero === -1) return { ok: false, motivo: 'ya-cambiado' }
  if (actual.indexOf(despues, primero + 1) !== -1) return { ok: false, motivo: 'ambiguo' }
  return { ok: true, contenido: actual.slice(0, primero) + antes + actual.slice(primero + despues.length) }
}

/** Ruta relativa a la carpeta del proyecto, o `undefined` si el archivo está fuera de ella. */
export function rutaRelativa(absoluta: string, raiz: string): string | undefined {
  const limpia = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = limpia(absoluta)
  const r = limpia(raiz)
  if (!r) return undefined
  if (a === r) return undefined
  return a.startsWith(r + '/') ? a.slice(r.length + 1) : undefined
}

// ───────────────────────────── Leer en voz alta ─────────────────────────────

/** Quita lo que suena mal al leerlo: código, enlaces y marcas de Markdown. */
export function limpiarParaVoz(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (bloque de código) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (enlace) ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ───────────────────────────── Fijar y etiquetar conversaciones ─────────────────────────────

export interface Organizacion {
  fijadas: string[]
  etiquetas: Record<string, string[]>
}

export const MAX_ETIQUETAS = 5
export const MAX_LARGO_ETIQUETA = 24
const CLAVE_ORGANIZACION = 'asistente:organizacion'

export const organizacionVacia = (): Organizacion => ({ fijadas: [], etiquetas: {} })

/** Lee lo guardado en este equipo (cualquier dato raro se ignora). */
export function leerOrganizacion(): Organizacion {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_ORGANIZACION) ?? 'null') as Partial<Organizacion> | null
    const fijadas = Array.isArray(crudo?.fijadas) ? crudo.fijadas.filter((x): x is string => typeof x === 'string') : []
    const etiquetas: Record<string, string[]> = {}
    for (const [id, lista] of Object.entries(crudo?.etiquetas ?? {})) {
      if (Array.isArray(lista)) etiquetas[id] = lista.filter((x): x is string => typeof x === 'string').slice(0, MAX_ETIQUETAS)
    }
    return { fijadas, etiquetas }
  } catch {
    return organizacionVacia()
  }
}

export function guardarOrganizacion(o: Organizacion): void {
  try {
    localStorage.setItem(CLAVE_ORGANIZACION, JSON.stringify(o))
  } catch {
    /* sin almacenamiento: vale hasta cerrar la app */
  }
}

export const alternarFijada = (o: Organizacion, id: string): Organizacion => ({ ...o, fijadas: o.fijadas.includes(id) ? o.fijadas.filter((x) => x !== id) : [id, ...o.fijadas] })

/** «trabajo, Urgente ,trabajo» -> ['trabajo','urgente']: sin repetidos, en minúscula, con tope de cantidad y de largo. */
export function parsearEtiquetas(texto: string): string[] {
  const vistas = new Set<string>()
  for (const parte of texto.split(/[,;\n]/)) {
    const e = parte.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_LARGO_ETIQUETA)
    if (e) vistas.add(e)
    if (vistas.size >= MAX_ETIQUETAS) break
  }
  return [...vistas]
}

export function ponerEtiquetas(o: Organizacion, id: string, texto: string): Organizacion {
  const lista = parsearEtiquetas(texto)
  const { [id]: _quitada, ...resto } = o.etiquetas
  return { ...o, etiquetas: lista.length ? { ...resto, [id]: lista } : resto }
}

/** Quita lo guardado de conversaciones que ya no existen. */
export function olvidarSesion(o: Organizacion, id: string): Organizacion {
  const { [id]: _quitada, ...resto } = o.etiquetas
  return { fijadas: o.fijadas.filter((x) => x !== id), etiquetas: resto }
}

interface SesionListable {
  id: string
  titulo: string
}

/** Fijadas primero (en el orden en que se fijaron, la última arriba); el resto conserva su orden. */
export function ordenarSesiones<T extends SesionListable>(lista: readonly T[], o: Organizacion): T[] {
  const rango = (id: string): number => {
    const i = o.fijadas.indexOf(id)
    return i === -1 ? Infinity : i
  }
  return lista.map((s, i) => ({ s, i })).sort((a, b) => rango(a.s.id) - rango(b.s.id) || a.i - b.i).map((x) => x.s)
}

/** Filtra por texto (título, etiquetas y, si se conoce, el contenido de la conversación) y por una etiqueta. */
export function filtrarSesiones<T extends SesionListable>(lista: readonly T[], o: Organizacion, filtro: { texto?: string; etiqueta?: string; contenido?: ReadonlyMap<string, string> }): T[] {
  const palabras = normalizar(filtro.texto ?? '').split(/\s+/).filter(Boolean)
  return lista.filter((s) => {
    if (filtro.etiqueta && !(o.etiquetas[s.id] ?? []).includes(filtro.etiqueta)) return false
    if (palabras.length === 0) return true
    const pajar = normalizar(`${s.titulo} ${(o.etiquetas[s.id] ?? []).join(' ')} ${filtro.contenido?.get(s.id) ?? ''}`)
    return palabras.every((p) => pajar.includes(p))
  })
}

/** Todas las etiquetas en uso, ordenadas. */
export const etiquetasEnUso = (o: Organizacion): string[] => [...new Set(Object.values(o.etiquetas).flat())].sort((a, b) => a.localeCompare(b))
