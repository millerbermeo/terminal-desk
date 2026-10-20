import type { CredencialEfectiva } from '@shared/credenciales'
import type { ResultadoHerramienta } from '@shared/core/herramientas'
import { esArchivoSensible } from '@shared/github'
import { HERRAMIENTAS_CREDENCIALES } from '@shared/credenciales-herramientas'
import { HERRAMIENTAS_GIT } from '@shared/git-herramientas'
import { HERRAMIENTAS_GITHUB } from '@shared/github-herramientas'
import { HERRAMIENTAS_ODESK } from '@shared/herramientas-odesk'
import { HERRAMIENTAS_TAREAS } from '@shared/tareas-herramientas'
import type { ServicioGitHub } from '../github/servicio'
import { ejecutarHerramientaTareas } from './tareas/herramientas'
import type { ServicioTareas } from './tareas/servicio'
import { Repositorio, type ProveedorCredenciales } from './git/repositorio'
import { validarEntrada, type Herramienta } from './tools/registro'

export interface ContextoOdesk {
  /** Proyecto de la conversación: valor por defecto de `proyecto_id`. */
  proyectoId?: string | undefined
}

export type EjecutorOdesk = (nombre: string, entrada: unknown, ctx?: ContextoOdesk) => Promise<ResultadoHerramienta>

export interface ServiciosOdesk {
  tareas: ServicioTareas
  github: ServicioGitHub
  carpetaDe(proyectoId: string): Promise<string>
  credenciales?: ProveedorCredenciales
  /** Credenciales de prueba locales del proyecto (y su grupo). */
  credencialesPrueba?: (proyectoId: string) => Promise<CredencialEfectiva[]>
}

const MAX_SALIDA = 30_000
type Entrada = Record<string, unknown>
const aTexto = (v: unknown): string => {
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  return t.length > MAX_SALIDA ? t.slice(0, MAX_SALIDA) + '\n[… recortado: acota la consulta]' : t
}
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

const NOMBRES_ESTADO: Record<string, string> = { M: 'modificado', A: 'añadido', D: 'eliminado', R: 'renombrado', C: 'copiado', T: 'tipo cambiado', U: 'conflicto', '.': '' }

async function ejecutarGit(s: ServiciosOdesk, nombre: string, e: Entrada, proyectoId: string): Promise<unknown> {
  const repo = new Repositorio(await s.carpetaDe(proyectoId), s.credenciales)
  switch (nombre) {
    case 'git_estado': {
      const x = await repo.estado()
      if (!x.repo) return { repo: false, mensaje: 'Esta carpeta no es un repositorio git.' }
      return {
        rama: x.rama ?? `(commit suelto ${x.desacoplado ?? ''})`,
        ...(x.upstream ? { sigue_a: x.upstream, por_enviar: x.adelante, por_traer: x.atras } : { sin_rama_remota: true }),
        sin_commits: x.sinCommits,
        ...(x.operacion ? { operacion_en_curso: x.operacion } : {}),
        preparados: x.archivos.filter((a) => !a.conflicto && a.indice !== '.').slice(0, 200).map((a) => ({ ruta: a.ruta, estado: NOMBRES_ESTADO[a.indice] })),
        sin_preparar: x.archivos.filter((a) => !a.conflicto && !a.sinSeguimiento && a.trabajo !== '.').slice(0, 200).map((a) => ({ ruta: a.ruta, estado: NOMBRES_ESTADO[a.trabajo] })),
        nuevos_sin_seguimiento: x.archivos.filter((a) => a.sinSeguimiento).slice(0, 200).map((a) => a.ruta),
        en_conflicto: x.archivos.filter((a) => a.conflicto).map((a) => a.ruta),
        remotos: x.remotos,
        ...(x.truncado ? { aviso: 'Hay muchos archivos: solo se listan los primeros.' } : {})
      }
    }
    case 'git_diff': {
      const preparado = e.preparado === true
      const d = e.ruta ? await repo.diff(String(e.ruta), preparado) : await repo.diffGlobal(preparado)
      if (d.binario) return 'Archivo binario: no hay diferencia que mostrar.'
      return d.texto.trim() ? d.texto : preparado ? 'No hay nada preparado.' : 'No hay cambios sin preparar (los archivos nuevos sin seguimiento se piden por su ruta).'
    }
    case 'git_historial': {
      const limite = Math.min(Math.max(Math.trunc(Number(e.limite) || 15), 1), 100)
      const { commits } = await repo.historial({ limite, ...(e.ruta ? { ruta: String(e.ruta) } : {}) })
      return commits.map((c) => ({ hash: c.corto, autor: c.autor, fecha: c.fecha.slice(0, 10), asunto: c.asunto, ...(c.refs.length ? { refs: c.refs.map((r) => r.nombre) } : {}) }))
    }
    case 'git_ramas':
      return (await repo.ramas()).map((r) => ({ nombre: r.nombre, ...(r.actual ? { actual: true } : {}), ...(r.remota ? { remota: true } : {}), ...(r.adelante ? { por_enviar: r.adelante } : {}), ...(r.atras ? { por_traer: r.atras } : {}), ultimo_commit: r.asunto }))
    case 'git_preparar': {
      const rutas = lista(e.rutas)
      if (e.todo === true) {
        const sensibles = (await repo.estado()).archivos.filter((a) => esArchivoSensible(a.ruta)).map((a) => a.ruta)
        if (sensibles.length) throw new Error(`No preparo todo: hay archivos que parecen secretos (${sensibles.join(', ')}). Pasa las rutas de lo que sí toca; esos archivos prepáralos tú si de verdad deben ir al repositorio.`)
        await repo.preparar()
        return 'Todo preparado.'
      }
      if (rutas.length === 0) throw new Error('Indica las rutas a preparar, o todo: true.')
      const sensibles = rutas.filter(esArchivoSensible)
      if (sensibles.length) throw new Error(`Parecen archivos con secretos (${sensibles.join(', ')}): no los preparo. Si de verdad deben ir al repositorio, prepáralos tú desde Versiones.`)
      await repo.preparar(rutas)
      return `Preparados: ${rutas.join(', ')}`
    }
    case 'git_commit': {
      const antes = await repo.estado()
      const sensibles = antes.archivos.filter((a) => !a.conflicto && a.indice !== '.' && esArchivoSensible(a.ruta)).map((a) => a.ruta)
      if (sensibles.length) throw new Error(`Hay archivos que parecen secretos entre los preparados (${sensibles.join(', ')}). Quítalos del commit (Versiones → Cambios) antes de confirmar.`)
      const r = await repo.commit(String(e.mensaje ?? ''))
      return { hash: r.hash, archivos: antes.archivos.filter((a) => !a.conflicto && a.indice !== '.').length, rama: r.estado.rama }
    }
    case 'git_crear_rama': {
      const x = await repo.crearRama(String(e.nombre ?? ''), undefined, e.cambiar !== false)
      return { rama_actual: x.rama }
    }
    case 'git_cambiar_rama':
      return { rama_actual: (await repo.cambiarRama(String(e.nombre ?? ''))).rama }
    case 'git_traer': {
      const r = await repo.traer(false)
      return { mensaje: r.mensaje.split('\n').slice(-3).join(' ').trim() || 'Al día.', conflictos: r.conflictos, por_traer: r.estado.atras }
    }
    case 'git_enviar': {
      const r = await repo.enviar()
      return { mensaje: r.mensaje.split('\n').filter(Boolean).slice(-2).join(' ').trim() || 'Enviado.', rama: r.estado.rama, por_enviar: r.estado.adelante }
    }
  }
  throw new Error(`Herramienta de git desconocida: ${nombre}`)
}

async function ejecutarGitHub(s: ServiciosOdesk, nombre: string, e: Entrada, proyectoId: string): Promise<unknown> {
  const g = s.github
  switch (nombre) {
    case 'github_estado':
      return g.estado(proyectoId)
    case 'github_listar_prs':
      return (await g.prs(proyectoId, e.estado as 'open' | 'closed' | 'all' | undefined)).map(({ cuerpo: _c, ...p }) => p)
    case 'github_listar_issues':
      return g.issues(proyectoId, e.estado as 'open' | 'closed' | 'all' | undefined)
    case 'github_estado_ci':
      return g.ci(proyectoId, e.ref)
    case 'github_crear_pr': {
      const { cuerpo: _c, ...pr } = await g.crearPr({ proyectoId, titulo: e.titulo, cuerpo: e.cuerpo, base: e.base, borrador: e.borrador })
      return pr
    }
    case 'github_crear_issue':
      return g.crearIssue({ proyectoId, titulo: e.titulo, cuerpo: e.cuerpo, etiquetas: e.etiquetas })
    case 'github_comentar':
      return g.comentar(proyectoId, e.numero, e.texto)
    case 'github_crear_repo': {
      const x = await g.crearRepo({ proyectoId, nombre: e.nombre, descripcion: e.descripcion, privado: e.privado, organizacion: e.organizacion })
      return { repo: x.repo?.completo, url: x.repo?.url, privado: x.repo?.privado }
    }
  }
  throw new Error(`Herramienta de GitHub desconocida: ${nombre}`)
}

/**
 * Un único punto de entrada para todas las herramientas de la aplicación (tareas, git y GitHub): lo usan el registro del núcleo (modo
 * API) y el servidor MCP (suscripción y terminales ✦). Valida la entrada y nunca lanza: los fallos vuelven como resultado con `error`.
 */
async function ejecutarCredenciales(s: ServiciosOdesk, nombre: string, entrada: unknown, ctx: ContextoOdesk): Promise<ResultadoHerramienta> {
  const def = HERRAMIENTAS_CREDENCIALES.find((h) => h.nombre === nombre)!
  const motivo = validarEntrada(def.esquema, entrada ?? {})
  if (motivo) return { texto: `Entrada inválida para ${nombre}: ${motivo}`, error: true }
  const e = (entrada ?? {}) as Entrada
  const proyectoId = (typeof e.proyecto_id === 'string' && e.proyecto_id ? e.proyecto_id : ctx.proyectoId) ?? ''
  if (!proyectoId) return { texto: 'Indica proyecto_id (usa listar_proyectos): esta conversación no está ligada a un proyecto.', error: true }
  const todas = await (s.credencialesPrueba ?? (async () => []))(proyectoId)
  if (nombre === 'credenciales_listar') {
    if (!todas.length) return { texto: 'No hay credenciales de prueba guardadas en este equipo para este proyecto.' }
    return { texto: aTexto(todas.map((c) => ({ nombre: c.nombre, ambito: c.origen, ...(c.notas ? { notas: c.notas } : {}), campos: c.campos.map((f) => f.clave) }))) }
  }
  const buscado = String(e.nombre).trim().toLowerCase()
  const c = todas.find((x) => x.nombre.toLowerCase() === buscado)
  if (!c) return { texto: `No hay una credencial llamada «${String(e.nombre)}». Disponibles: ${todas.map((x) => x.nombre).join(', ') || '(ninguna)'}.`, error: true }
  return { texto: aTexto({ nombre: c.nombre, ...(c.notas ? { notas: c.notas } : {}), campos: Object.fromEntries(c.campos.map((f) => [f.clave, f.valor])) }) }
}

export function crearEjecutorOdesk(s: ServiciosOdesk): EjecutorOdesk {
  return async (nombre, entrada, ctx = {}) => {
    if (HERRAMIENTAS_TAREAS.some((h) => h.nombre === nombre)) return ejecutarHerramientaTareas(s.tareas, nombre, entrada, ctx)
    if (HERRAMIENTAS_CREDENCIALES.some((h) => h.nombre === nombre)) return ejecutarCredenciales(s, nombre, entrada, ctx)
    const def = [...HERRAMIENTAS_GIT, ...HERRAMIENTAS_GITHUB].find((h) => h.nombre === nombre)
    if (!def) return { texto: `Herramienta desconocida: ${nombre}`, error: true }
    const motivo = validarEntrada(def.esquema, entrada ?? {})
    if (motivo) return { texto: `Entrada inválida para ${nombre}: ${motivo}`, error: true }
    const e = (entrada ?? {}) as Entrada
    const proyectoId = (typeof e.proyecto_id === 'string' && e.proyecto_id ? e.proyecto_id : ctx.proyectoId) ?? ''
    if (!proyectoId) return { texto: 'Indica proyecto_id (usa listar_proyectos): esta conversación no está ligada a un proyecto.', error: true }
    try {
      const r = nombre.startsWith('github_') ? await ejecutarGitHub(s, nombre, e, proyectoId) : await ejecutarGit(s, nombre, e, proyectoId)
      return { texto: aTexto(r) }
    } catch (err) {
      return { texto: (err as Error).message, error: true }
    }
  }
}

/** Las herramientas de la aplicación para el registro del núcleo (modo API); el riesgo de cada una decide si pide confirmación. */
export function herramientasOdesk(ejecutor: EjecutorOdesk): Herramienta[] {
  return HERRAMIENTAS_ODESK.map((def) => ({
    nombre: def.nombre,
    descripcion: def.descripcion,
    esquema: def.esquema,
    riesgo: def.riesgo,
    ejecutar: (entrada, ctx) => ejecutor(def.nombre, entrada, { proyectoId: ctx.proyectoId })
  }))
}
