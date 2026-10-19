import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { BibliotecaAgentes, Recurso } from '@shared/modelos'
import type { DestinoActivacion, ResultadoRecurso } from '@shared/ipc'
import { activosDe, slug } from '@shared/agentes'
import { DIR, leerProyectos } from './proyectos'
import { COMANDOS_BLOQUEADOS } from './core/suscripcion'
import { configMcpTareas } from './core/tareas/mcp-config'
import { ErrorServidor, ErrorSesion, servidor } from './servidor/cliente'

const SESIONES = join(DIR, 'sesiones')
const MODELOS = new Set(['', 'inherit', 'sonnet', 'opus', 'haiku'])
const HERRAMIENTA = /^[A-Za-z][\w:*()./ -]{0,60}$/
const DIAS_RETENCION = 14

interface RecursoApi {
  id: string
  kind: 'agente' | 'skill'
  name: string
  description: string
  content: string
  tools: string[] | null
  model: string | null
  scope: 'compartido' | 'proyecto'
  projectId: string | null
}
interface BibliotecaApi {
  resources: RecursoApi[]
  activations: { resourceId: string; targetType: 'proyecto' | 'grupo'; targetId: string }[]
}

function aRecurso(r: RecursoApi): Recurso {
  return {
    id: r.id,
    tipo: r.kind,
    nombre: r.name,
    descripcion: r.description,
    contenido: r.content,
    ambito: r.scope,
    ...(r.projectId ? { proyectoId: r.projectId } : {}),
    ...(r.kind === 'agente' ? { herramientas: r.tools ?? [], modelo: r.model ?? '' } : {})
  }
}

/** Biblioteca de agentes y skills de la cuenta, desde el servidor. */
export async function leerBiblioteca(): Promise<BibliotecaAgentes> {
  const b = await servidor.get<BibliotecaApi>('/agentes')
  const activaciones: BibliotecaAgentes['activaciones'] = { proyectos: {}, grupos: {} }
  for (const a of b.activations) {
    const mapa = a.targetType === 'grupo' ? activaciones.grupos : activaciones.proyectos
    ;(mapa[a.targetId] ??= []).push(a.resourceId)
  }
  return { recursos: b.resources.map(aRecurso), activaciones }
}

export async function guardarRecurso(entrada: Recurso): Promise<ResultadoRecurso> {
  const nombre = entrada.nombre.trim()
  const descripcion = entrada.descripcion.trim()
  const contenido = entrada.contenido.trim()
  const nombreSlug = slug(nombre)
  if (!nombre || !nombreSlug) return { ok: false, mensaje: 'Falta el nombre (usa letras o números)' }
  if (!descripcion) return { ok: false, mensaje: 'Falta la descripción: Claude la usa para decidir cuándo aplicarlo' }
  if (!contenido) return { ok: false, mensaje: entrada.tipo === 'agente' ? 'Falta el prompt del agente' : 'Faltan las instrucciones de la skill' }

  const herramientas = (entrada.herramientas ?? []).map((h) => h.trim()).filter(Boolean)
  if (entrada.tipo === 'agente') {
    const mala = herramientas.find((h) => !HERRAMIENTA.test(h))
    if (mala) return { ok: false, mensaje: `Herramienta no válida: ${mala}` }
    if (!MODELOS.has(entrada.modelo ?? '')) return { ok: false, mensaje: 'Modelo no válido' }
  }

  const proyectos = await leerProyectos()
  if (entrada.ambito === 'proyecto' && !proyectos.proyectos.some((p) => p.id === entrada.proyectoId)) {
    return { ok: false, mensaje: 'Elige el proyecto al que pertenece' }
  }

  const actual = await leerBiblioteca()
  if (actual.recursos.some((r) => r.id !== entrada.id && r.tipo === entrada.tipo && slug(r.nombre) === nombreSlug)) {
    return { ok: false, mensaje: `Ya existe ${entrada.tipo === 'agente' ? 'un agente' : 'una skill'} con ese nombre` }
  }

  try {
    await servidor.put('/agentes', {
      ...(entrada.id ? { id: entrada.id } : {}),
      kind: entrada.tipo,
      name: nombre,
      description: descripcion,
      content: contenido,
      scope: entrada.ambito,
      ...(entrada.ambito === 'proyecto' ? { projectId: entrada.proyectoId } : {}),
      ...(entrada.tipo === 'agente' ? { tools: herramientas, model: entrada.modelo ?? '' } : {})
    })
  } catch (err) {
    if (err instanceof ErrorSesion || !(err instanceof ErrorServidor)) throw err
    return { ok: false, mensaje: err.message }
  }
  return { ok: true, biblioteca: await leerBiblioteca() }
}

export async function eliminarRecurso(id: string): Promise<BibliotecaAgentes> {
  await servidor.delete(`/agentes/${encodeURIComponent(id)}`)
  return leerBiblioteca()
}

export async function activarRecurso(destino: DestinoActivacion, recursoId: string, activo: boolean): Promise<BibliotecaAgentes> {
  const b = await leerBiblioteca()
  const recurso = b.recursos.find((r) => r.id === recursoId)
  if (!recurso || recurso.ambito !== 'compartido') return b // solo los compartidos se activan a mano
  const cuerpo = { targetType: destino.tipo, targetId: destino.id, resourceId: recursoId }
  if (activo) await servidor.post('/agentes/activaciones', cuerpo)
  else await servidor.delete('/agentes/activaciones', cuerpo)
  return leerBiblioteca()
}

// ---------------------------------------------------------------- plugin por proyecto

const esClaude = (comando: string): boolean => {
  const bin = basename(comando.trim().split(/\s+/)[0] ?? '').toLowerCase()
  return bin === 'claude' || bin === 'claude.exe' || bin === 'claude.cmd'
}

const citar = (ruta: string, plataforma: NodeJS.Platform = process.platform): string =>
  plataforma === 'win32' ? `"${ruta}"` : `'${ruta.replace(/'/g, `'\\''`)}'`

/** Caracteres que `cmd` interpreta aun entre comillas (o que no se pueden escapar con fiabilidad dentro de `cmd /c "…"`). */
const PELIGROSO_EN_CMD = /[&|<>^%"!\r\n]/

/** Herramientas de Claude Code que escriben archivos (las que el historial local quiere ver). */
const HERRAMIENTAS_QUE_ESCRIBEN = 'Write|Edit|MultiEdit|NotebookEdit'

/**
 * Cómo lanza Claude Code el gancho del historial: el mismo programa que el servidor MCP (el propio Electron como Node) en modo
 * `hook-historial`, con el proyecto y la carpeta de datos en el entorno. Usa la sintaxis del shell de cada sistema.
 */
export function comandoGancho(
  mcp: NonNullable<ReturnType<typeof configMcpTareas>>,
  momento: 'pre' | 'post',
  plataforma: NodeJS.Platform = process.platform
): string | undefined {
  const m = Object.values(mcp.mcpServers)[0]
  if (!m) return undefined
  const env = Object.entries(m.env)
  if (plataforma === 'win32') {
    // Con una ruta que `cmd` interpretaría (p. ej. una carpeta con `&` o `%`) no hay gancho: el vigilante de archivos sigue registrando.
    if ([m.command, ...m.args, ...env.flat()].some((t) => PELIGROSO_EN_CMD.test(t))) return undefined
    const base = [m.command, ...m.args, 'hook-historial', momento].map((t) => citar(t, plataforma)).join(' ')
    return `cmd /c "${env.map(([k, v]) => `set "${k}=${v}"&& `).join('')}${base}"`
  }
  const base = [m.command, ...m.args, 'hook-historial', momento].map((t) => citar(t, plataforma)).join(' ')
  return `${env.map(([k, v]) => `${k}=${citar(v, plataforma)}`).join(' ')} ${base}`
}

/** `hooks/hooks.json` del plugin: avisa a la app antes y después de que Claude Code escriba un archivo del proyecto. */
export function configGanchosHistorial(mcp: NonNullable<ReturnType<typeof configMcpTareas>>): string | undefined {
  const pre = comandoGancho(mcp, 'pre')
  const post = comandoGancho(mcp, 'post')
  if (!pre || !post) return undefined
  const grupo = (command: string) => [{ matcher: HERRAMIENTAS_QUE_ESCRIBEN, hooks: [{ type: 'command', command, timeout: 10 }] }]
  return JSON.stringify({ description: 'Historial local de versiones de Odesk Agent', hooks: { PreToolUse: grupo(pre), PostToolUse: grupo(post) } }, null, 2) + '\n'
}

/** Los valores van como cadenas JSON (YAML válido): sin problemas con comillas, dos puntos ni saltos de línea. */
const campo = (clave: string, valor: string): string => `${clave}: ${JSON.stringify(valor)}`

function nombresUnicos(recursos: Recurso[]): Map<string, string> {
  const usados = new Set<string>()
  const salida = new Map<string, string>()
  for (const r of recursos) {
    const base = slug(r.nombre) || r.tipo
    let n = base
    for (let i = 2; usados.has(n); i++) n = `${base}-${i}`
    usados.add(n)
    salida.set(r.id, n)
  }
  return salida
}

/**
 * Genera (o reutiliza) un plugin de Claude Code con los agentes y skills activos del proyecto.
 * La carpeta lleva el hash del contenido: es inmutable, así que varias terminales o cambios de
 * configuración nunca pisan archivos que una sesión en marcha pueda estar leyendo.
 */
async function construirPlugin(proyectoId: string, conMcp = true): Promise<string | null> {
  const datos = await leerProyectos()
  const proyecto = datos.proyectos.find((p) => p.id === proyectoId)
  if (!proyecto) return null
  const activos = activosDe(await leerBiblioteca(), proyecto).map((a) => a.recurso)
  // Además de los agentes y skills, el plugin lleva el servidor MCP de tareas: Claude Code ve las tareas del proyecto.
  const mcp = conMcp ? configMcpTareas(proyectoId) : undefined
  if (activos.length === 0 && !mcp) return null

  const agentes = activos.filter((r) => r.tipo === 'agente')
  const skills = activos.filter((r) => r.tipo === 'skill')
  const nombres = new Map([...nombresUnicos(agentes), ...nombresUnicos(skills)])

  const archivos: Record<string, string> = {
    '.claude-plugin/plugin.json':
      JSON.stringify(
        { name: 'centro', version: '1.0.0', description: `Agentes y skills de Odesk Agent para ${proyecto.nombre}`, author: { name: 'Odesk Agent' } },
        null,
        2
      ) + '\n'
  }
  if (mcp) {
    archivos['.mcp.json'] = JSON.stringify(mcp, null, 2) + '\n'
    const ganchos = configGanchosHistorial(mcp)
    if (ganchos) archivos['hooks/hooks.json'] = ganchos
  }
  for (const a of agentes) {
    const cabecera = [campo('name', nombres.get(a.id)!), campo('description', a.descripcion)]
    if (a.herramientas?.length) cabecera.push(campo('tools', a.herramientas.join(', ')))
    if (a.modelo) cabecera.push(campo('model', a.modelo))
    archivos[`agents/${nombres.get(a.id)}.md`] = `---\n${cabecera.join('\n')}\n---\n\n${a.contenido}\n`
  }
  for (const s of skills) {
    const cabecera = [campo('name', nombres.get(s.id)!), campo('description', s.descripcion)]
    archivos[`skills/${nombres.get(s.id)}/SKILL.md`] = `---\n${cabecera.join('\n')}\n---\n\n${s.contenido}\n`
  }

  const hash = createHash('sha1').update(JSON.stringify(archivos)).digest('hex').slice(0, 10)
  const dir = join(SESIONES, `${slug(proyecto.id) || 'proyecto'}-${hash}`)
  try {
    await stat(join(dir, '.claude-plugin', 'plugin.json'))
    return dir // ya generado con este mismo contenido
  } catch {
    // hay que generarlo
  }
  const tmp = `${dir}.tmp-${process.pid}-${randomUUID().slice(0, 6)}`
  for (const [ruta, texto] of Object.entries(archivos)) {
    const destino = join(tmp, ruta)
    await mkdir(join(destino, '..'), { recursive: true })
    await writeFile(destino, texto, 'utf8')
  }
  try {
    await rename(tmp, dir)
  } catch {
    await rm(tmp, { recursive: true, force: true }) // otra terminal lo creó a la vez: vale el suyo
  }
  return dir
}

/** Carpetas de los demás proyectos del mismo grupo (vacío si el proyecto no tiene grupo): dentro de un grupo la IA ve y edita todos. */
export async function carpetasHermanas(proyectoId?: string): Promise<{ nombre: string; ruta: string }[]> {
  if (!proyectoId) return []
  try {
    const { proyectos } = await leerProyectos()
    const yo = proyectos.find((p) => p.id === proyectoId)
    if (!yo?.grupo) return []
    return proyectos.filter((p) => p.grupo === yo.grupo && p.id !== yo.id).map((p) => ({ nombre: p.nombre, ruta: p.ruta }))
  } catch {
    return []
  }
}

/**
 * Si el proveedor es Claude Code y el proyecto tiene agentes o skills activos, añade `--plugin-dir`.
 * Si el proyecto está en un grupo, añade `--add-dir` con las carpetas de los demás proyectos del grupo.
 * Una terminal normal (o `claude` escrito a mano) no pasa por aquí y no carga nada.
 */
export async function comandoConAgentes(comando: string, proyectoId?: string): Promise<string> {
  if (!proyectoId || !esClaude(comando)) return comando
  try {
    const dir = await construirPlugin(proyectoId)
    const hermanas = await carpetasHermanas(proyectoId)
    // En un grupo la terminal trabaja con libertad: edita y ejecuta sin pedir permiso en el proyecto y en los de su grupo.
    const conGrupo = hermanas.length
      ? `${comando} --add-dir ${hermanas.map((h) => citar(h.ruta)).join(' ')} --permission-mode acceptEdits --allowedTools ${['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].join(' ')} --disallowedTools ${COMANDOS_BLOQUEADOS.map((c) => citar(c)).join(' ')}`
      : comando
    return dir ? `${conGrupo} --plugin-dir ${citar(dir)}` : conGrupo
  } catch (err) {
    console.error('No se pudieron preparar los agentes:', err)
    return comando // mejor abrir Claude sin agentes que no abrirlo
  }
}

/**
 * Plugin solo con los agentes y skills activos (sin MCP ni ganchos: el Asistente ya pasa su propio `--mcp-config`).
 * Para `claude -p` del Asistente; devuelve undefined si no hay nada activo o falla.
 */
export async function pluginAgentesAsistente(proyectoId?: string): Promise<string | undefined> {
  if (!proyectoId) return undefined
  try {
    return (await construirPlugin(proyectoId, false)) ?? undefined
  } catch (err) {
    console.error('No se pudieron preparar los agentes del Asistente:', err)
    return undefined
  }
}

/** Borra los plugins generados hace más de DIAS_RETENCION días. */
export async function limpiarSesiones(): Promise<void> {
  try {
    const limite = Date.now() - DIAS_RETENCION * 24 * 3600 * 1000
    for (const nombre of await readdir(SESIONES)) {
      const ruta = join(SESIONES, nombre)
      if ((await stat(ruta)).mtimeMs < limite) await rm(ruta, { recursive: true, force: true })
    }
  } catch {
    // no existe todavía
  }
}
