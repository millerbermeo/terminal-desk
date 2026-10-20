/**
 * Credenciales de prueba: datos para probar en local (usuarios, claves de API de sandbox, URLs, tokens…). Viven SOLO en este equipo
 * (`~/.odesk-agent/credenciales/`): no se sincronizan con la cuenta ni con la bóveda ni llegan al servidor.
 */
export type TipoAmbitoCredenciales = 'proyecto' | 'grupo'

export interface AmbitoCredenciales {
  tipo: TipoAmbitoCredenciales
  id: string
}

export interface CampoCredencial {
  clave: string
  valor: string
  /** Se oculta en la interfaz (••••) hasta pulsar «mostrar». */
  secreto?: boolean
}

export interface CredencialPrueba {
  id: string
  nombre: string
  notas?: string
  campos: CampoCredencial[]
  actualizada: number
}

export type EntradaCredencial = Omit<CredencialPrueba, 'id' | 'actualizada'> & { id?: string }

/** Una credencial tal como la ve quien consulta el proyecto: de qué ámbito viene (la del proyecto tapa a la del grupo con el mismo nombre). */
export interface CredencialEfectiva extends CredencialPrueba {
  origen: TipoAmbitoCredenciales
}

export interface OperacionesCredenciales {
  listar: { entrada: { ambito: AmbitoCredenciales }; salida: CredencialPrueba[] }
  guardar: { entrada: { ambito: AmbitoCredenciales; credencial: EntradaCredencial }; salida: CredencialPrueba[] }
  eliminar: { entrada: { ambito: AmbitoCredenciales; id: string }; salida: CredencialPrueba[] }
}
export type NombreOperacionCredenciales = keyof OperacionesCredenciales

export const MAX_CAMPOS = 50
const MAX_NOMBRE = 100
const MAX_CLAVE = 80
const MAX_VALOR = 10_000
const MAX_NOTAS = 2_000

export const ID_AMBITO = /^[A-Za-z0-9_-]{1,80}$/

const cadena = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Normaliza una credencial recibida (de la interfaz o del disco); null si no tiene nombre. */
export function limpiarCredencial(v: unknown, id: string, ahora: number): CredencialPrueba | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const nombre = cadena(o.nombre, MAX_NOMBRE).trim()
  if (!nombre) return null
  const campos: CampoCredencial[] = []
  for (const c of Array.isArray(o.campos) ? o.campos.slice(0, MAX_CAMPOS) : []) {
    if (!c || typeof c !== 'object') continue
    const clave = cadena((c as Record<string, unknown>).clave, MAX_CLAVE).trim()
    if (!clave) continue
    campos.push({ clave, valor: cadena((c as Record<string, unknown>).valor, MAX_VALOR), ...((c as Record<string, unknown>).secreto === true ? { secreto: true } : {}) })
  }
  const notas = cadena(o.notas, MAX_NOTAS).trim()
  return { id, nombre, ...(notas ? { notas } : {}), campos, actualizada: typeof o.actualizada === 'number' ? o.actualizada : ahora }
}
