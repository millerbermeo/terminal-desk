import { join, resolve } from 'node:path'
import { cp, mkdir, lstat, readdir, readFile, stat } from 'node:fs/promises'
import type { RecursoCarpeta, ResultadoCopia, SolicitudCopia } from '@shared/ipc'
import type { TipoRecurso } from '@shared/modelos'
import { leerProyectos } from './proyectos'

const MAX_CABECERA = 8000

/** `description` de la cabecera (frontmatter) de un agente o skill; vacío si no tiene o no se puede leer. */
async function descripcionDe(archivo: string): Promise<string> {
  try {
    const texto = (await readFile(archivo, 'utf8')).slice(0, MAX_CABECERA)
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)
    const l = m ? /^description:[ \t]*(.*)$/m.exec(m[1]!)?.[1]?.trim() : undefined
    if (!l) return ''
    if (l.startsWith('"')) {
      try {
        return String(JSON.parse(l))
      } catch {
        /* no era JSON: se usa tal cual */
      }
    }
    return l.replace(/^['"]|['"]$/g, '')
  } catch {
    return ''
  }
}

/** Una clave es el nombre del archivo (agente) o de la carpeta (skill): nunca una ruta. */
const claveValida = (clave: string): boolean => !!clave && clave !== '.' && clave !== '..' && !/[\\/\0]/.test(clave)

const rutaDe = (carpeta: string, tipo: TipoRecurso, clave: string): string =>
  join(carpeta, '.claude', tipo === 'agente' ? 'agents' : 'skills', clave)

/** Agentes (`.claude/agents/*.md`) y skills (`.claude/skills/<n>/SKILL.md`) que trae una carpeta de proyecto. */
export async function listarRecursosCarpeta(carpeta: string): Promise<RecursoCarpeta[]> {
  const entradas = (d: string) => readdir(d, { withFileTypes: true }).catch(() => [])
  const lista: RecursoCarpeta[] = []
  for (const e of await entradas(join(carpeta, '.claude', 'agents'))) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    lista.push({ tipo: 'agente', clave: e.name, nombre: e.name.slice(0, -3), descripcion: await descripcionDe(rutaDe(carpeta, 'agente', e.name)) })
  }
  for (const e of await entradas(join(carpeta, '.claude', 'skills'))) {
    if (!e.isDirectory()) continue
    const archivo = join(rutaDe(carpeta, 'skill', e.name), 'SKILL.md')
    if (!(await stat(archivo).catch(() => undefined))) continue
    lista.push({ tipo: 'skill', clave: e.name, nombre: e.name, descripcion: await descripcionDe(archivo) })
  }
  return lista.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre))
}

/**
 * Copia agentes y skills de la carpeta de un proyecto a la de otro. Nunca pisa lo que ya existe salvo `sobrescribir`; los enlaces
 * simbólicos no se siguen (una skill no puede sacar archivos de fuera de su carpeta). Cada elemento informa su propio resultado.
 */
export async function copiarRecursosCarpeta(origen: string, destino: string, items: SolicitudCopia['items'], sobrescribir: boolean): Promise<ResultadoCopia[]> {
  const o = resolve(origen)
  const d = resolve(destino)
  const salida: ResultadoCopia[] = []
  if (o === d) return items.map((i) => ({ tipo: i.tipo, clave: i.clave, estado: 'error', mensaje: 'El origen y el destino son el mismo proyecto' }))

  for (const { tipo, clave } of items) {
    const base = { tipo, clave }
    try {
      if (!claveValida(clave) || (tipo !== 'agente' && tipo !== 'skill')) throw new Error('Nombre no válido')
      const desde = rutaDe(o, tipo, clave)
      const hasta = rutaDe(d, tipo, clave)
      const info = await lstat(desde).catch(() => undefined)
      if (!info || info.isSymbolicLink()) throw new Error('No existe en el proyecto de origen')
      if (await lstat(hasta).catch(() => undefined)) {
        if (!sobrescribir) {
          salida.push({ ...base, estado: 'existe' })
          continue
        }
      }
      await mkdir(join(d, '.claude', tipo === 'agente' ? 'agents' : 'skills'), { recursive: true })
      await cp(desde, hasta, {
        recursive: true,
        force: sobrescribir,
        errorOnExist: !sobrescribir,
        filter: async (src) => !(await lstat(src)).isSymbolicLink()
      })
      salida.push({ ...base, estado: 'copiado' })
    } catch (err) {
      salida.push({ ...base, estado: 'error', mensaje: err instanceof Error ? err.message : String(err) })
    }
  }
  return salida
}

/** Resuelve los ids de proyecto a su carpeta en este equipo y copia (lo que llama el IPC). */
export async function copiarEntreProyectos(s: SolicitudCopia): Promise<ResultadoCopia[]> {
  const { proyectos } = await leerProyectos()
  const origen = proyectos.find((p) => p.id === s.origenId)
  const destino = proyectos.find((p) => p.id === s.destinoId)
  if (!origen || !destino) throw new Error('Proyecto de origen o destino no encontrado')
  return copiarRecursosCarpeta(origen.ruta, destino.ruta, s.items, !!s.sobrescribir)
}

export async function listarRecursosDeProyecto(proyectoId: string): Promise<RecursoCarpeta[]> {
  const { proyectos } = await leerProyectos()
  const p = proyectos.find((x) => x.id === proyectoId)
  return p ? listarRecursosCarpeta(p.ruta) : []
}
