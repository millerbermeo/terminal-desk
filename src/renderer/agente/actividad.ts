import type { EventoAgente } from '@shared/core/agente'

/**
 * Cómo se ve el trabajo del Asistente mientras ocurre: cada herramienta con un nombre humano, un icono por categoría
 * y el dato que importa (archivo, comando, tarea…) en vez de `mcp__servidor__herramienta {json}`; y las herramientas
 * seguidas agrupadas en una línea de tiempo. Funciones puras (se prueban sin interfaz).
 */

export type Categoria = 'leer' | 'buscar' | 'editar' | 'terminal' | 'web' | 'navegador' | 'tareas' | 'memoria' | 'git' | 'agente' | 'movil' | 'otra'

export interface DescripcionHerramienta {
  categoria: Categoria
  /** Qué hace, en español y en infinitivo («Leer archivo», «Comentar tarea»). */
  titulo: string
  /** El dato clave (ruta, comando, patrón, tarea…), ya recortado. */
  detalle: string
  /** Mientras está en curso («Leyendo archivo»). */
  enCurso: string
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const recortar = (s: string, max = 90): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
/** Las rutas largas se leen mejor por el final: `…/tenant/chatbot/chatbot.service.ts`. */
const ruta = (v: unknown): string => {
  const r = texto(v)
  const partes = r.split('/').filter(Boolean)
  return partes.length > 3 ? '…/' + partes.slice(-3).join('/') : r
}

interface Conocida {
  categoria: Categoria
  titulo: string
  enCurso: string
  detalle?: (e: Record<string, unknown>) => string
}

const CONOCIDAS: Record<string, Conocida> = {
  Read: { categoria: 'leer', titulo: 'Leer archivo', enCurso: 'Leyendo archivo', detalle: (e) => ruta(e.file_path) },
  NotebookRead: { categoria: 'leer', titulo: 'Leer notebook', enCurso: 'Leyendo notebook', detalle: (e) => ruta(e.notebook_path) },
  LS: { categoria: 'leer', titulo: 'Listar carpeta', enCurso: 'Listando carpeta', detalle: (e) => ruta(e.path) },
  Glob: { categoria: 'buscar', titulo: 'Buscar archivos', enCurso: 'Buscando archivos', detalle: (e) => texto(e.pattern) },
  Grep: { categoria: 'buscar', titulo: 'Buscar en el código', enCurso: 'Buscando en el código', detalle: (e) => texto(e.pattern) + (e.path ? `  ·  ${ruta(e.path)}` : '') },
  ToolSearch: { categoria: 'buscar', titulo: 'Cargar herramientas', enCurso: 'Cargando herramientas', detalle: (e) => texto(e.query) },
  Edit: { categoria: 'editar', titulo: 'Editar archivo', enCurso: 'Editando archivo', detalle: (e) => ruta(e.file_path) },
  MultiEdit: { categoria: 'editar', titulo: 'Editar archivo', enCurso: 'Editando archivo', detalle: (e) => ruta(e.file_path) },
  Write: { categoria: 'editar', titulo: 'Escribir archivo', enCurso: 'Escribiendo archivo', detalle: (e) => ruta(e.file_path) },
  NotebookEdit: { categoria: 'editar', titulo: 'Editar notebook', enCurso: 'Editando notebook', detalle: (e) => ruta(e.notebook_path) },
  Bash: { categoria: 'terminal', titulo: 'Ejecutar comando', enCurso: 'Ejecutando comando', detalle: (e) => texto(e.description) || texto(e.command) },
  BashOutput: { categoria: 'terminal', titulo: 'Leer salida del comando', enCurso: 'Leyendo salida del comando' },
  KillShell: { categoria: 'terminal', titulo: 'Detener comando', enCurso: 'Deteniendo comando' },
  WebFetch: { categoria: 'web', titulo: 'Leer página web', enCurso: 'Leyendo página web', detalle: (e) => texto(e.url) },
  WebSearch: { categoria: 'web', titulo: 'Buscar en la web', enCurso: 'Buscando en la web', detalle: (e) => texto(e.query) },
  Agent: { categoria: 'agente', titulo: 'Delegar en un agente', enCurso: 'Trabajando con un agente', detalle: (e) => texto(e.description) || texto(e.subagent_type) },
  Task: { categoria: 'agente', titulo: 'Delegar en un agente', enCurso: 'Trabajando con un agente', detalle: (e) => texto(e.description) || texto(e.subagent_type) },
  Skill: { categoria: 'agente', titulo: 'Cargar skill', enCurso: 'Cargando skill', detalle: (e) => texto(e.skill) || texto(e.command) },
  AskUserQuestion: { categoria: 'agente', titulo: 'Preguntarte', enCurso: 'Esperando tu respuesta' }
}

/** Herramienta de un servidor MCP: `mcp__servidor__herramienta`. */
function partesMcp(nombre: string): { servidor: string; herramienta: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(nombre)
  return m ? { servidor: m[1]!, herramienta: m[2]! } : null
}

function categoriaMcp(servidor: string, herramienta: string): Categoria {
  const h = herramienta.toLowerCase()
  const s = servidor.toLowerCase()
  if (/tarea|columna/.test(h)) return 'tareas'
  if (/memoria/.test(h)) return 'memoria'
  if (/^(git|github)_|_(commit|rama|pr|push|pull)$/.test(h)) return 'git'
  if (/^movil_/.test(h)) return 'movil'
  if (/^navegador_|^browser_/.test(h) || /playwright|devtools|chrome/.test(s)) return 'navegador'
  if (/^terminal_/.test(h)) return 'terminal'
  if (/leer|read|listar|list|get|obtener|buscar|search/.test(h)) return 'leer'
  return 'otra'
}

/** `comentar_tarea` → «Comentar tarea»; `browser_take_screenshot` → «Take screenshot». */
function humanizar(herramienta: string): string {
  const t = herramienta.replace(/^(browser|navegador|movil)_/, '').replace(/[_-]+/g, ' ').trim()
  return t ? t[0]!.toUpperCase() + t.slice(1) : herramienta
}

/** Gerundio aproximado del primer verbo («Comentar tarea» → «Comentando tarea»). */
function gerundio(titulo: string): string {
  const [v, ...resto] = titulo.split(' ')
  if (!v) return titulo
  const g = /ar$/i.test(v) ? v.slice(0, -2) + 'ando' : /[ei]r$/i.test(v) ? v.slice(0, -2) + 'iendo' : null
  return g ? [g, ...resto].join(' ') : titulo
}

/** El dato clave de una herramienta MCP: tarea, título, ruta, url, consulta… lo primero que haya. */
function detalleMcp(e: Record<string, unknown>): string {
  const tarea = texto(e.tarea) || texto(e.tarea_id) || texto(e.id)
  const partes: string[] = []
  if (tarea) partes.push(/^\d+$/.test(tarea) ? `#${tarea}` : tarea)
  for (const k of ['titulo', 'title', 'estado', 'nombre', 'name', 'url', 'query', 'consulta', 'ruta', 'path', 'mensaje', 'texto', 'text', 'element']) {
    const v = texto(e[k])
    if (v) {
      partes.push(k === 'ruta' || k === 'path' ? ruta(v) : v)
      break
    }
  }
  return partes.join(' · ')
}

export function describirHerramienta(nombre: string, entrada: Record<string, unknown>): DescripcionHerramienta {
  const c = CONOCIDAS[nombre]
  if (c) return { categoria: c.categoria, titulo: c.titulo, enCurso: c.enCurso, detalle: recortar(c.detalle?.(entrada) ?? '') }
  const mcp = partesMcp(nombre)
  if (mcp) {
    const titulo = humanizar(mcp.herramienta)
    return { categoria: categoriaMcp(mcp.servidor, mcp.herramienta), titulo, enCurso: gerundio(titulo), detalle: recortar(detalleMcp(entrada)) }
  }
  return { categoria: 'otra', titulo: nombre, enCurso: nombre, detalle: recortar(detalleMcp(entrada)) }
}

type Inicio = Extract<EventoAgente, { tipo: 'herramienta_inicio' }>
type Fin = Extract<EventoAgente, { tipo: 'herramienta_fin' }>

export interface PasoHerramienta {
  inicio: Inicio
  fin?: Fin
}

/** Lo que se pinta de un turno: eventos sueltos o un grupo de herramientas seguidas. */
export type ElementoTurno = { tipo: 'evento'; evento: EventoAgente; indice: number } | { tipo: 'herramientas'; pasos: PasoHerramienta[]; indice: number }

/** Eventos que no se pintan: no cortan un grupo de herramientas. */
const INVISIBLES = new Set<EventoAgente['tipo']>(['herramienta_fin', 'paso', 'inicio', 'uso_contexto', 'texto_delta'])

/**
 * Agrupa las herramientas seguidas (sin texto entre medias) de un turno. `TodoWrite` no entra: es el plan y se pinta
 * aparte. Cada paso lleva su fin, si ya llegó.
 */
export function agruparEventos(eventos: EventoAgente[]): ElementoTurno[] {
  const fines = new Map<string, Fin>()
  for (const e of eventos) if (e.tipo === 'herramienta_fin') fines.set(e.llamada.id, e)
  const salida: ElementoTurno[] = []
  let grupo: Extract<ElementoTurno, { tipo: 'herramientas' }> | null = null
  eventos.forEach((e, i) => {
    if (INVISIBLES.has(e.tipo)) return
    if (e.tipo === 'herramienta_inicio' && e.llamada.nombre !== 'TodoWrite') {
      const paso: PasoHerramienta = { inicio: e, ...(fines.has(e.llamada.id) ? { fin: fines.get(e.llamada.id)! } : {}) }
      if (grupo && grupo.pasos[0]!.inicio.profundidad === e.profundidad) grupo.pasos.push(paso)
      else salida.push((grupo = { tipo: 'herramientas', pasos: [paso], indice: i }))
      return
    }
    // El plan se actualiza sin cortar el grupo (cada llamada a TodoWrite trae la lista completa y se pinta una vez).
    if (e.tipo === 'herramienta_inicio' && grupo) {
      salida.push({ tipo: 'evento', evento: e, indice: i })
      return
    }
    grupo = null
    salida.push({ tipo: 'evento', evento: e, indice: i })
  })
  return salida
}

/** Lo que el Asistente está haciendo ahora mismo (para la barra viva del turno). */
export function actividadActual(eventos: EventoAgente[], escribiendo: boolean): { texto: string; categoria?: Categoria } {
  const fines = new Set(eventos.flatMap((e) => (e.tipo === 'herramienta_fin' ? [e.llamada.id] : [])))
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i]!
    if (e.tipo === 'solicitud_humana') return { texto: 'Esperando tu confirmación' }
    if (e.tipo === 'herramienta_inicio' && e.llamada.nombre !== 'TodoWrite' && !fines.has(e.llamada.id)) {
      const d = describirHerramienta(e.llamada.nombre, e.llamada.entrada)
      return { texto: d.detalle ? `${d.enCurso} · ${d.detalle}` : d.enCurso, categoria: d.categoria }
    }
    if (e.tipo === 'texto' || e.tipo === 'herramienta_fin') break
  }
  return { texto: escribiendo ? 'Escribiendo' : 'Pensando' }
}

/** Pasos que lleva el turno (herramientas, sin el plan). */
export const contarPasos = (eventos: EventoAgente[]): number => eventos.filter((e) => e.tipo === 'herramienta_inicio' && e.llamada.nombre !== 'TodoWrite').length

/** `75_000` ms → «1:15». */
export const duracion = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
