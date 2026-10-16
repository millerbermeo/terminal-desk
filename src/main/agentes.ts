import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { Activaciones, BibliotecaAgentes, Recurso } from '@shared/modelos'
import type { DestinoActivacion, ResultadoRecurso } from '@shared/ipc'
import { activosDe, slug } from '@shared/agentes'
import { DIR, leerProyectos } from './proyectos'

const ARCHIVO = join(DIR, 'agentes.json')
const SESIONES = join(DIR, 'sesiones')
const MODELOS = new Set(['', 'inherit', 'sonnet', 'opus', 'haiku'])
const HERRAMIENTA = /^[A-Za-z][\w:*()./ -]{0,60}$/
const DIAS_RETENCION = 14

const vacia = (): BibliotecaAgentes => ({ recursos: [], activaciones: { proyectos: {}, grupos: {} } })

async function escribir(b: BibliotecaAgentes): Promise<void> {
  await mkdir(DIR, { recursive: true })
  await writeFile(ARCHIVO, JSON.stringify(b, null, 2) + '\n', 'utf8')
}

function normalizarActivaciones(a: Partial<Activaciones> | undefined): Activaciones {
  const limpio = (m: Record<string, unknown> | undefined): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(m ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []])
    )
  return { proyectos: limpio(a?.proyectos), grupos: limpio(a?.grupos) }
}

export async function leerBiblioteca(): Promise<BibliotecaAgentes> {
  try {
    const crudo = JSON.parse(await readFile(ARCHIVO, 'utf8')) as Partial<BibliotecaAgentes>
    const recursos = (crudo.recursos ?? []).filter(
      (r): r is Recurso => !!r && typeof r.id === 'string' && (r.tipo === 'agente' || r.tipo === 'skill') && typeof r.nombre === 'string'
    )
    return { recursos, activaciones: normalizarActivaciones(crudo.activaciones) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('agentes.json inválido:', err)
    return vacia()
  }
}

let cola: Promise<unknown> = Promise.resolve()
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const p = cola.then(fn, fn)
  cola = p.catch(() => undefined)
  return p
}

export function guardarRecurso(entrada: Recurso): Promise<ResultadoRecurso> {
  return enCola(async () => {
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

    const b = await leerBiblioteca()
    if (b.recursos.some((r) => r.id !== entrada.id && r.tipo === entrada.tipo && slug(r.nombre) === nombreSlug)) {
      return { ok: false, mensaje: `Ya existe ${entrada.tipo === 'agente' ? 'un agente' : 'una skill'} con ese nombre` }
    }

    const nuevo: Recurso = {
      id: entrada.id || randomUUID().slice(0, 8),
      tipo: entrada.tipo,
      nombre,
      descripcion,
      contenido,
      ambito: entrada.ambito,
      ...(entrada.ambito === 'proyecto' ? { proyectoId: entrada.proyectoId } : {}),
      ...(entrada.tipo === 'agente' ? { herramientas, modelo: entrada.modelo ?? '' } : {})
    }
    const i = b.recursos.findIndex((r) => r.id === nuevo.id)
    if (i >= 0) b.recursos[i] = nuevo
    else b.recursos.push(nuevo)
    if (nuevo.ambito === 'proyecto') quitarActivaciones(b.activaciones, nuevo.id) // un individual no se activa a mano
    await escribir(b)
    return { ok: true, biblioteca: b }
  })
}

function quitarActivaciones(a: Activaciones, id: string): void {
  for (const m of [a.proyectos, a.grupos]) for (const k of Object.keys(m)) m[k] = m[k].filter((x) => x !== id)
}

export function eliminarRecurso(id: string): Promise<BibliotecaAgentes> {
  return enCola(async () => {
    const b = await leerBiblioteca()
    b.recursos = b.recursos.filter((r) => r.id !== id)
    quitarActivaciones(b.activaciones, id)
    await escribir(b)
    return b
  })
}

export function activarRecurso(destino: DestinoActivacion, recursoId: string, activo: boolean): Promise<BibliotecaAgentes> {
  return enCola(async () => {
    const b = await leerBiblioteca()
    const recurso = b.recursos.find((r) => r.id === recursoId)
    if (!recurso || recurso.ambito !== 'compartido') return b // solo los compartidos se activan a mano
    const mapa = destino.tipo === 'grupo' ? b.activaciones.grupos : b.activaciones.proyectos
    const actuales = new Set(mapa[destino.id] ?? [])
    if (activo) actuales.add(recursoId)
    else actuales.delete(recursoId)
    mapa[destino.id] = [...actuales]
    await escribir(b)
    return b
  })
}

// ---------------------------------------------------------------- plugin por proyecto

const esClaude = (comando: string): boolean => {
  const bin = basename(comando.trim().split(/\s+/)[0] ?? '').toLowerCase()
  return bin === 'claude' || bin === 'claude.exe' || bin === 'claude.cmd'
}

const citar = (ruta: string): string =>
  process.platform === 'win32' ? `"${ruta}"` : `'${ruta.replace(/'/g, `'\\''`)}'`

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
async function construirPlugin(proyectoId: string): Promise<string | null> {
  const datos = await leerProyectos()
  const proyecto = datos.proyectos.find((p) => p.id === proyectoId)
  if (!proyecto) return null
  const activos = activosDe(await leerBiblioteca(), proyecto).map((a) => a.recurso)
  if (activos.length === 0) return null

  const agentes = activos.filter((r) => r.tipo === 'agente')
  const skills = activos.filter((r) => r.tipo === 'skill')
  const nombres = new Map([...nombresUnicos(agentes), ...nombresUnicos(skills)])

  const archivos: Record<string, string> = {
    '.claude-plugin/plugin.json':
      JSON.stringify(
        { name: 'centro', version: '1.0.0', description: `Agentes y skills de ODESK AI para ${proyecto.nombre}`, author: { name: 'ODESK AI' } },
        null,
        2
      ) + '\n'
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

/**
 * Si el proveedor es Claude Code y el proyecto tiene agentes o skills activos, añade `--plugin-dir`.
 * Una terminal normal (o `claude` escrito a mano) no pasa por aquí y no carga nada.
 */
export async function comandoConAgentes(comando: string, proyectoId?: string): Promise<string> {
  if (!proyectoId || !esClaude(comando)) return comando
  try {
    const dir = await construirPlugin(proyectoId)
    return dir ? `${comando} --plugin-dir ${citar(dir)}` : comando
  } catch (err) {
    console.error('No se pudieron preparar los agentes:', err)
    return comando // mejor abrir Claude sin agentes que no abrirlo
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
