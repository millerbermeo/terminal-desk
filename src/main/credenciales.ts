import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { ID_AMBITO, aplicarCambioCredencial, limpiarCredencial, type AmbitoCredenciales, type CambioCredencial, type TipoAmbitoCredenciales, type CredencialEfectiva, type CredencialPrueba, type EntradaCredencial, type OperacionesCredenciales } from '@shared/credenciales'
import { DIR, leerProyectos } from './proyectos'

interface Archivo {
  version: 1
  credenciales: CredencialPrueba[]
}

const CARPETA = join(DIR, 'credenciales')

function rutaDe(a: AmbitoCredenciales): string {
  if ((a?.tipo !== 'proyecto' && a?.tipo !== 'grupo') || typeof a.id !== 'string' || !ID_AMBITO.test(a.id)) throw new Error('Credenciales: ámbito no válido')
  return join(CARPETA, `${a.tipo}-${a.id}.json`)
}

let cola: Promise<unknown> = Promise.resolve()

/**
 * Credenciales de prueba de ESTE equipo, por proyecto o por grupo (`credenciales/<tipo>-<id>.json`, 0600). No están en la lista de
 * sincronización de cuenta ni de la bóveda: cada PC tiene las suyas. Al cambiar de cuenta se apartan con el resto de datos personales.
 */
export async function listarCredenciales(a: AmbitoCredenciales): Promise<CredencialPrueba[]> {
  try {
    const d = JSON.parse(await readFile(rutaDe(a), 'utf8')) as Partial<Archivo>
    return (Array.isArray(d.credenciales) ? d.credenciales : []).flatMap((c) => {
      const l = c && typeof c.id === 'string' ? limpiarCredencial(c, c.id, Date.now()) : null
      return l ? [l] : []
    })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Credenciales:')) throw err
    // Sin archivo todavía = lista vacía; cualquier otro fallo (permisos, JSON corrupto) NO debe parecer «vacío»: modificar() lo sobrescribiría.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('Credenciales: no se pudo leer el archivo de credenciales de este ámbito', { cause: err })
  }
}

function modificar(a: AmbitoCredenciales, fn: (actual: CredencialPrueba[]) => CredencialPrueba[]): Promise<CredencialPrueba[]> {
  const p = cola.then(async () => {
    const nuevo = fn(await listarCredenciales(a))
    const ruta = rutaDe(a)
    await mkdir(dirname(ruta), { recursive: true, mode: 0o700 })
    const tmp = `${ruta}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, credenciales: nuevo } satisfies Archivo, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, ruta)
    return nuevo
  })
  cola = p.catch(() => undefined)
  return p
}

export function guardarCredencial(a: AmbitoCredenciales, entrada: EntradaCredencial): Promise<CredencialPrueba[]> {
  return modificar(a, (actual) => {
    const id = entrada.id && actual.some((c) => c.id === entrada.id) ? entrada.id : randomUUID()
    const nueva = limpiarCredencial(entrada, id, Date.now())
    if (!nueva) throw new Error('Credenciales: pon un nombre')
    nueva.actualizada = Date.now()
    if (actual.some((c) => c.id !== id && c.nombre.toLowerCase() === nueva.nombre.toLowerCase())) throw new Error(`Credenciales: ya existe «${nueva.nombre}» aquí`)
    return actual.some((c) => c.id === id) ? actual.map((c) => (c.id === id ? nueva : c)) : [...actual, nueva]
  })
}

export const eliminarCredencial = (a: AmbitoCredenciales, id: string): Promise<CredencialPrueba[]> => modificar(a, (actual) => actual.filter((c) => c.id !== id))

/** Las del grupo del proyecto y las del propio proyecto; si se llaman igual, gana la del proyecto. */
export async function credencialesDe(proyectoId: string): Promise<CredencialEfectiva[]> {
  if (!ID_AMBITO.test(proyectoId)) return []
  // Sin sesión o sin servidor no se conoce el grupo: quedan las del propio proyecto.
  const proyecto = (await leerProyectos().catch(() => ({ proyectos: [] }))).proyectos.find((p) => p.id === proyectoId)
  const propias = await listarCredenciales({ tipo: 'proyecto', id: proyectoId })
  const delGrupo = proyecto?.grupo ? await listarCredenciales({ tipo: 'grupo', id: proyecto.grupo }) : []
  const nombres = new Set(propias.map((c) => c.nombre.toLowerCase()))
  return [
    ...propias.map((c): CredencialEfectiva => ({ ...c, origen: 'proyecto' })),
    ...delGrupo.filter((c) => !nombres.has(c.nombre.toLowerCase())).map((c): CredencialEfectiva => ({ ...c, origen: 'grupo' }))
  ]
}

/** Ámbitos donde puede haber credenciales de un proyecto: el propio y, si se conoce, su grupo. */
async function ambitosDe(proyectoId: string): Promise<{ proyecto: AmbitoCredenciales; grupo?: AmbitoCredenciales }> {
  if (!ID_AMBITO.test(proyectoId)) throw new Error('Credenciales: proyecto no válido')
  const p = (await leerProyectos().catch(() => ({ proyectos: [] }))).proyectos.find((x) => x.id === proyectoId)
  return { proyecto: { tipo: 'proyecto', id: proyectoId }, ...(p?.grupo ? { grupo: { tipo: 'grupo', id: p.grupo } } : {}) }
}

const igual = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Lo que hace la IA con `credenciales_guardar`: crea la credencial o actualiza la que ya se llama así. Sin `ambito`, actualiza donde
 * ya exista (primero el proyecto, luego el grupo) y, si es nueva, la crea en el proyecto.
 */
export async function guardarCredencialPorNombre(proyectoId: string, cambio: CambioCredencial, ambito?: TipoAmbitoCredenciales): Promise<{ credencial: CredencialPrueba; ambito: TipoAmbitoCredenciales; creada: boolean }> {
  const a = await ambitosDe(proyectoId)
  if (ambito === 'grupo' && !a.grupo) throw new Error('Credenciales: este proyecto no está en un grupo; guárdala en el proyecto')
  let destino = ambito === 'grupo' ? a.grupo! : a.proyecto
  if (!ambito && a.grupo && !(await listarCredenciales(a.proyecto)).some((c) => igual(c.nombre, cambio.nombre)) && (await listarCredenciales(a.grupo)).some((c) => igual(c.nombre, cambio.nombre))) destino = a.grupo
  let creada = false
  let nombreFinal = cambio.nombre
  const lista = await modificar(destino, (actual) => {
    const previa = actual.find((c) => igual(c.nombre, cambio.nombre))
    if (!previa && cambio.nombreNuevo) throw new Error(`Credenciales: no hay ninguna llamada «${cambio.nombre}» que renombrar`)
    if (!previa && !cambio.campos?.length) throw new Error('Credenciales: una credencial nueva necesita al menos un campo')
    creada = !previa
    const nueva = limpiarCredencial(aplicarCambioCredencial(previa, cambio), previa?.id ?? randomUUID(), Date.now())
    if (!nueva) throw new Error('Credenciales: pon un nombre')
    nueva.actualizada = Date.now()
    if (actual.some((c) => c.id !== nueva.id && igual(c.nombre, nueva.nombre))) throw new Error(`Credenciales: ya existe «${nueva.nombre}» aquí`)
    nombreFinal = nueva.nombre
    return previa ? actual.map((c) => (c.id === nueva.id ? nueva : c)) : [...actual, nueva]
  })
  return { credencial: lista.find((c) => igual(c.nombre, nombreFinal))!, ambito: destino.tipo, creada }
}

/** Lo que hace la IA con `credenciales_eliminar`: borra por nombre (la del proyecto antes que la del grupo, salvo que se indique). */
export async function eliminarCredencialPorNombre(proyectoId: string, nombre: string, ambito?: TipoAmbitoCredenciales): Promise<{ ambito: TipoAmbitoCredenciales } | undefined> {
  const a = await ambitosDe(proyectoId)
  for (const destino of ambito === 'grupo' ? [a.grupo] : ambito === 'proyecto' ? [a.proyecto] : [a.proyecto, a.grupo]) {
    if (!destino) continue
    let borrada = false
    await modificar(destino, (actual) => {
      const resto = actual.filter((c) => !igual(c.nombre, nombre))
      borrada = resto.length !== actual.length
      return resto
    })
    if (borrada) return { ambito: destino.tipo }
  }
  return undefined
}

export async function ejecutarOperacionCredenciales<K extends keyof OperacionesCredenciales>(op: K, entrada: OperacionesCredenciales[K]['entrada']): Promise<OperacionesCredenciales[K]['salida']> {
  switch (op) {
    case 'listar':
      return listarCredenciales((entrada as OperacionesCredenciales['listar']['entrada']).ambito)
    case 'guardar': {
      const e = entrada as OperacionesCredenciales['guardar']['entrada']
      return guardarCredencial(e.ambito, e.credencial)
    }
    case 'eliminar': {
      const e = entrada as OperacionesCredenciales['eliminar']['entrada']
      return eliminarCredencial(e.ambito, String(e.id))
    }
    default:
      throw new Error(`Credenciales: operación desconocida «${String(op)}»`)
  }
}
