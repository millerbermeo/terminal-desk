import { METODOS, peticionVacia, nuevoId, type Autenticacion, type CuerpoPeticion, type MetodoHttp, type ParClave, type PeticionApi, type VariableEntorno } from '@shared/api'

const MAX_URL = 8192
const MAX_CUERPO = 5_000_000
const MAX_PARES = 200

const texto = (v: unknown, max: number, campo: string): string => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new Error(`«${campo}» debe ser texto.`)
  if (v.length > max) throw new Error(`«${campo}» es demasiado largo.`)
  return v
}

function pares(v: unknown, campo: string): ParClave[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new Error(`«${campo}» debe ser una lista.`)
  if (v.length > MAX_PARES) throw new Error(`Demasiadas filas en «${campo}».`)
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : nuevoId(), clave: texto(o.clave, 2000, campo), valor: texto(o.valor, 100_000, campo), activo: o.activo !== false }
  })
}

/** Valida (y normaliza) una petición que llega de la interfaz: tipos, tamaños y valores permitidos. */
export function sanearPeticion(entrada: unknown): PeticionApi {
  if (entrada === null || typeof entrada !== 'object') throw new Error('Petición no válida.')
  const e = entrada as Record<string, unknown>
  const base = peticionVacia()
  if (!METODOS.includes(e.metodo as MetodoHttp)) throw new Error('Método HTTP no válido.')
  let cuerpo: CuerpoPeticion = { tipo: 'ninguno' }
  const c = (e.cuerpo ?? {}) as Record<string, unknown>
  if (c.tipo === 'json' || c.tipo === 'texto') cuerpo = { tipo: c.tipo, texto: texto(c.texto, MAX_CUERPO, 'cuerpo') }
  else if (c.tipo === 'formulario') cuerpo = { tipo: 'formulario', campos: pares(c.campos, 'formulario') }
  let auth: Autenticacion = { tipo: 'ninguna' }
  const a = (e.auth ?? {}) as Record<string, unknown>
  if (a.tipo === 'bearer') auth = { tipo: 'bearer', token: texto(a.token, 20_000, 'token') }
  else if (a.tipo === 'basica') auth = { tipo: 'basica', usuario: texto(a.usuario, 2000, 'usuario'), clave: texto(a.clave, 2000, 'clave') }
  else if (a.tipo === 'clave-api') auth = { tipo: 'clave-api', nombre: texto(a.nombre, 500, 'nombre'), valor: texto(a.valor, 20_000, 'valor'), en: a.en === 'consulta' ? 'consulta' : 'cabecera' }
  const o = (e.opciones ?? {}) as Record<string, unknown>
  const tiempo = typeof o.tiempoMs === 'number' && Number.isFinite(o.tiempoMs) ? Math.min(Math.max(Math.round(o.tiempoMs), 1000), 300_000) : base.opciones.tiempoMs
  return {
    metodo: e.metodo as MetodoHttp,
    url: texto(e.url, MAX_URL, 'URL'),
    consulta: pares(e.consulta, 'parámetros'),
    cabeceras: pares(e.cabeceras, 'cabeceras'),
    cuerpo,
    auth,
    opciones: { seguirRedirecciones: o.seguirRedirecciones !== false, ignorarCertificado: o.ignorarCertificado === true, tiempoMs: tiempo }
  }
}

export function sanearVariables(v: unknown): VariableEntorno[] {
  if (!Array.isArray(v)) throw new Error('Las variables deben ser una lista.')
  if (v.length > MAX_PARES) throw new Error('Demasiadas variables.')
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    const clave = texto(o.clave, 200, 'variable').trim()
    if (clave && !/^[\w.-]+$/.test(clave)) throw new Error(`Nombre de variable no válido: «${clave}» (usa letras, números, «_», «-» y «.»).`)
    return { id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : nuevoId(), clave, valor: texto(o.valor, 100_000, 'variable'), activa: o.activa !== false }
  })
}

export function nombreValido(v: unknown, campo: string): string {
  const n = texto(v, 120, campo).trim()
  if (!n) throw new Error(`Pon un nombre a ${campo}.`)
  return n
}
