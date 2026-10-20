import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { ID_AMBITO, limpiarCredencial, type AmbitoCredenciales, type CredencialEfectiva, type CredencialPrueba, type EntradaCredencial, type OperacionesCredenciales } from '@shared/credenciales'
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
    return []
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
