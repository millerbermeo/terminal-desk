/**
 * Cliente API integrado: tipos, contrato tipado y lógica pura (variables de entorno, URL final, cURL).
 * Las peticiones se ejecutan en el proceso principal (sin CORS, con acceso a localhost).
 */

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export const METODOS: readonly MetodoHttp[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export interface ParClave {
  id: string
  clave: string
  valor: string
  activo: boolean
}

export type CuerpoPeticion =
  | { tipo: 'ninguno' }
  | { tipo: 'json'; texto: string }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'formulario'; campos: ParClave[] }

export type Autenticacion =
  | { tipo: 'ninguna' }
  | { tipo: 'bearer'; token: string }
  | { tipo: 'basica'; usuario: string; clave: string }
  | { tipo: 'clave-api'; nombre: string; valor: string; en: 'cabecera' | 'consulta' }

export interface OpcionesPeticion {
  seguirRedirecciones: boolean
  /** Acepta certificados no confiables (servidores locales con https autofirmado). */
  ignorarCertificado: boolean
  tiempoMs: number
}

export interface PeticionApi {
  metodo: MetodoHttp
  url: string
  consulta: ParClave[]
  cabeceras: ParClave[]
  cuerpo: CuerpoPeticion
  auth: Autenticacion
  opciones: OpcionesPeticion
}

export interface PeticionGuardada {
  id: string
  nombre: string
  peticion: PeticionApi
  actualizada: number
}

export interface Coleccion {
  id: string
  nombre: string
  peticiones: PeticionGuardada[]
}

export interface VariableEntorno {
  id: string
  clave: string
  valor: string
  activa: boolean
}

export interface Entorno {
  id: string
  nombre: string
  variables: VariableEntorno[]
}

export interface EntradaHistorial {
  id: string
  fecha: number
  metodo: MetodoHttp
  url: string
  estado?: number
  ms?: number
  error?: string
  peticion: PeticionApi
}

export interface DatosApi {
  colecciones: Coleccion[]
  entornos: Entorno[]
  entornoActivo?: string
  historial: EntradaHistorial[]
}

export interface CuerpoRespuesta {
  tipo: 'texto' | 'imagen' | 'binario'
  texto?: string
  /** Imágenes pequeñas, para previsualizarlas. */
  base64?: string
  /** El cuerpo era más grande de lo que se muestra o se descarga. */
  truncado: boolean
}

export interface RespuestaApi {
  envioId: string
  estado: number
  texto: string
  urlFinal: string
  redirecciones: string[]
  cabeceras: [string, string][]
  tipoContenido: string
  bytes: number
  ms: number
  cuerpo: CuerpoRespuesta
}

interface Base {
  _?: never
}

export interface OperacionesApi {
  datos: { entrada: Base; salida: DatosApi }
  enviar: { entrada: { peticion: PeticionApi; envioId: string }; salida: RespuestaApi }
  cancelar: { entrada: { envioId: string }; salida: boolean }
  /** Pasa las variables del entorno activo y devuelve la petición como comando cURL. */
  curl: { entrada: { peticion: PeticionApi }; salida: string }
  guardarPeticion: { entrada: { coleccionId: string; id?: string; nombre: string; peticion: PeticionApi }; salida: { datos: DatosApi; id: string } }
  eliminarPeticion: { entrada: { coleccionId: string; id: string }; salida: DatosApi }
  guardarColeccion: { entrada: { id?: string; nombre: string }; salida: { datos: DatosApi; id: string } }
  eliminarColeccion: { entrada: { id: string }; salida: DatosApi }
  guardarEntorno: { entrada: { id?: string; nombre: string; variables: VariableEntorno[] }; salida: { datos: DatosApi; id: string } }
  eliminarEntorno: { entrada: { id: string }; salida: DatosApi }
  fijarEntorno: { entrada: { id?: string }; salida: DatosApi }
  limpiarHistorial: { entrada: Base; salida: DatosApi }
  /** Guarda en un archivo (diálogo del sistema) el cuerpo de una respuesta reciente. */
  guardarRespuesta: { entrada: { envioId: string }; salida: { ruta?: string } }
}

export type NombreOperacionApi = keyof OperacionesApi

// ------------------------------------------------------------------ lógica pura

let contador = 0
export const nuevoId = (): string => `${Date.now().toString(36)}${(++contador).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const par = (clave = '', valor = '', activo = true): ParClave => ({ id: nuevoId(), clave, valor, activo })

export const peticionVacia = (): PeticionApi => ({
  metodo: 'GET',
  url: '',
  consulta: [],
  cabeceras: [],
  cuerpo: { tipo: 'ninguno' },
  auth: { tipo: 'ninguna' },
  opciones: { seguirRedirecciones: true, ignorarCertificado: false, tiempoMs: 30_000 }
})

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g

/** Sustituye `{{variable}}`; las que no existen se dejan tal cual. */
export function sustituirVariables(texto: string, vars: Readonly<Record<string, string>>): string {
  return texto.replace(VARIABLE, (completo, nombre: string) => (Object.hasOwn(vars, nombre) ? vars[nombre]! : completo))
}

/** Variables entorno activas como mapa (las desactivadas y las de clave vacía no cuentan). */
export function variablesDe(entorno: Entorno | undefined): Record<string, string> {
  const m: Record<string, string> = {}
  for (const v of entorno?.variables ?? []) if (v.activa && v.clave.trim()) m[v.clave.trim()] = v.valor
  return m
}

/** Nombres de variable usados en la petición que no están definidos (la petición no funcionará tal cual). */
export function variablesSinResolver(p: PeticionApi, vars: Readonly<Record<string, string>>): string[] {
  const textos: string[] = [p.url]
  for (const x of [...p.consulta, ...p.cabeceras]) if (x.activo) textos.push(x.clave, x.valor)
  if (p.cuerpo.tipo === 'json' || p.cuerpo.tipo === 'texto') textos.push(p.cuerpo.texto)
  if (p.cuerpo.tipo === 'formulario') for (const x of p.cuerpo.campos) if (x.activo) textos.push(x.clave, x.valor)
  if (p.auth.tipo === 'bearer') textos.push(p.auth.token)
  if (p.auth.tipo === 'basica') textos.push(p.auth.usuario, p.auth.clave)
  if (p.auth.tipo === 'clave-api') textos.push(p.auth.nombre, p.auth.valor)
  const faltan = new Set<string>()
  for (const t of textos) for (const m of t.matchAll(VARIABLE)) if (!Object.hasOwn(vars, m[1]!)) faltan.add(m[1]!)
  return [...faltan]
}

export interface PeticionResuelta {
  metodo: MetodoHttp
  url: string
  cabeceras: [string, string][]
  cuerpo: string | null
  opciones: OpcionesPeticion
}

const activos = (l: ParClave[]): ParClave[] => l.filter((x) => x.activo && x.clave.trim() !== '')
const codificar = (s: string): string => encodeURIComponent(s)

/** Aplica el entorno y construye la petición final: URL con sus parámetros, cabeceras (incluida la autenticación) y cuerpo. */
export function resolverPeticion(p: PeticionApi, vars: Readonly<Record<string, string>>): PeticionResuelta {
  const sub = (t: string): string => sustituirVariables(t, vars)
  const cabeceras: [string, string][] = activos(p.cabeceras).map((h) => [sub(h.clave).trim(), sub(h.valor)])
  const tiene = (n: string): boolean => cabeceras.some(([k]) => k.toLowerCase() === n.toLowerCase())

  const consulta: [string, string][] = activos(p.consulta).map((q) => [sub(q.clave), sub(q.valor)])
  if (p.auth.tipo === 'clave-api' && p.auth.en === 'consulta' && p.auth.nombre.trim()) consulta.push([sub(p.auth.nombre), sub(p.auth.valor)])
  if (p.auth.tipo === 'bearer' && p.auth.token.trim() && !tiene('Authorization')) cabeceras.push(['Authorization', `Bearer ${sub(p.auth.token).trim()}`])
  if (p.auth.tipo === 'basica' && (p.auth.usuario || p.auth.clave) && !tiene('Authorization')) cabeceras.push(['Authorization', `Basic ${btoa(unescape(encodeURIComponent(`${sub(p.auth.usuario)}:${sub(p.auth.clave)}`)))}`])
  if (p.auth.tipo === 'clave-api' && p.auth.en === 'cabecera' && p.auth.nombre.trim() && !tiene(sub(p.auth.nombre))) cabeceras.push([sub(p.auth.nombre).trim(), sub(p.auth.valor)])

  let url = sub(p.url).trim().replace(/#.*$/, '')
  if (consulta.length) url += (url.includes('?') ? (/[?&]$/.test(url) ? '' : '&') : '?') + consulta.map(([k, v]) => `${codificar(k)}=${codificar(v)}`).join('&')

  let cuerpo: string | null = null
  const sinCuerpo = p.metodo === 'GET' || p.metodo === 'HEAD'
  if (!sinCuerpo) {
    if (p.cuerpo.tipo === 'json') {
      cuerpo = sub(p.cuerpo.texto)
      if (!tiene('Content-Type')) cabeceras.push(['Content-Type', 'application/json'])
    } else if (p.cuerpo.tipo === 'texto') {
      cuerpo = sub(p.cuerpo.texto)
      if (!tiene('Content-Type')) cabeceras.push(['Content-Type', 'text/plain; charset=utf-8'])
    } else if (p.cuerpo.tipo === 'formulario') {
      cuerpo = activos(p.cuerpo.campos).map((c) => `${codificar(sub(c.clave))}=${codificar(sub(c.valor))}`).join('&')
      if (!tiene('Content-Type')) cabeceras.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
    if (cuerpo === '') cuerpo = null
  }
  return { metodo: p.metodo, url, cabeceras, cuerpo, opciones: p.opciones }
}

const comilla = (t: string): string => `'${t.replace(/'/g, `'\\''`)}'`

/** La petición como comando cURL (para pegarlo en una terminal o compartirlo). */
export function generarCurl(r: PeticionResuelta): string {
  const partes = ['curl']
  if (r.metodo !== 'GET') partes.push(r.metodo === 'HEAD' ? '-I' : `-X ${r.metodo}`)
  partes.push(comilla(r.url))
  for (const [k, v] of r.cabeceras) partes.push(`-H ${comilla(`${k}: ${v}`)}`)
  if (r.cuerpo !== null) partes.push(`--data-raw ${comilla(r.cuerpo)}`)
  if (r.opciones.seguirRedirecciones) partes.push('-L')
  if (r.opciones.ignorarCertificado) partes.push('-k')
  return partes.join(' ')
}

/** Divide una línea de comandos como lo haría un shell (comillas simples, dobles, $'…' y continuaciones con «\»). */
export function dividirComando(texto: string): string[] {
  const t = texto.replace(/\\\r?\n/g, ' ').trim()
  const salida: string[] = []
  let actual = ''
  let hay = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!
    if (/\s/.test(c)) {
      if (hay) {
        salida.push(actual)
        actual = ''
        hay = false
      }
      continue
    }
    hay = true
    if (c === "'") {
      const f = t.indexOf("'", i + 1)
      if (f < 0) throw new Error('Comilla simple sin cerrar.')
      actual += t.slice(i + 1, f)
      i = f
    } else if (c === '"') {
      let j = i + 1
      for (; j < t.length && t[j] !== '"'; j++) actual += t[j] === '\\' && /["\\$`]/.test(t[j + 1] ?? '') ? t[++j]! : t[j]!
      if (j >= t.length) throw new Error('Comilla doble sin cerrar.')
      i = j
    } else if (c === '$' && t[i + 1] === "'") {
      let j = i + 2
      for (; j < t.length && t[j] !== "'"; j++) {
        if (t[j] === '\\') {
          const n = t[++j]
          actual += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : (n ?? '')
        } else actual += t[j]
      }
      i = j
    } else if (c === '\\' && i + 1 < t.length) actual += t[++i]
    else actual += c
  }
  if (hay) salida.push(actual)
  return salida
}

/** Convierte un comando cURL (lo que copia el navegador o la documentación de una API) en una petición. */
export function analizarCurl(texto: string): PeticionApi {
  const tokens = dividirComando(texto)
  if (tokens[0] === 'curl') tokens.shift()
  const p = peticionVacia()
  const datos: string[] = []
  let metodo: MetodoHttp | undefined
  let url = ''
  const sigue = (i: number, flag: string): string => {
    const v = tokens[i + 1]
    if (v === undefined) throw new Error(`Falta el valor de ${flag}.`)
    return v
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const [flag, pegado] = t.startsWith('--') && t.includes('=') ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : [t, undefined]
    const valor = (): string => (pegado !== undefined ? pegado : (i++, sigue(i - 1, flag)))
    switch (flag) {
      case '-X':
      case '--request': {
        const m = valor().toUpperCase()
        if (!METODOS.includes(m as MetodoHttp)) throw new Error(`Método no soportado: ${m}`)
        metodo = m as MetodoHttp
        break
      }
      case '-H':
      case '--header': {
        const h = valor()
        const k = h.indexOf(':')
        if (k > 0) p.cabeceras.push(par(h.slice(0, k).trim(), h.slice(k + 1).trim()))
        break
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        datos.push(valor())
        break
      case '--data-urlencode':
        datos.push(valor())
        break
      case '-u':
      case '--user': {
        const u = valor()
        const k = u.indexOf(':')
        p.auth = { tipo: 'basica', usuario: k < 0 ? u : u.slice(0, k), clave: k < 0 ? '' : u.slice(k + 1) }
        break
      }
      case '-A':
      case '--user-agent':
        p.cabeceras.push(par('User-Agent', valor()))
        break
      case '-b':
      case '--cookie':
        p.cabeceras.push(par('Cookie', valor()))
        break
      case '-e':
      case '--referer':
        p.cabeceras.push(par('Referer', valor()))
        break
      case '-I':
      case '--head':
        metodo = 'HEAD'
        break
      case '-k':
      case '--insecure':
        p.opciones.ignorarCertificado = true
        break
      case '-L':
      case '--location':
        p.opciones.seguirRedirecciones = true
        break
      case '--url':
        url = valor()
        break
      case '-F':
      case '--form':
        throw new Error('Los formularios multipart (-F) aún no están soportados.')
      case '--max-time':
      case '-m': {
        const s = Number(valor())
        if (Number.isFinite(s) && s > 0) p.opciones.tiempoMs = Math.round(s * 1000)
        break
      }
      case '--compressed':
      case '-s':
      case '--silent':
      case '-S':
      case '-v':
      case '--verbose':
      case '-i':
      case '--include':
        break
      default:
        if (t.startsWith('-')) {
          if (/^-[A-Za-z]$/.test(t) || t.startsWith('--')) throw new Error(`Opción de cURL no soportada: ${t}`)
          throw new Error(`Opciones de cURL combinadas no soportadas: ${t}`)
        }
        if (url) throw new Error(`Hay más de una dirección: ${url} y ${t}`)
        url = t
    }
  }
  if (!url) throw new Error('No encuentro la dirección en el comando.')
  p.url = url
  p.metodo = metodo ?? (datos.length ? 'POST' : 'GET')
  if (datos.length) {
    const crudo = datos.join('&')
    const tipo = p.cabeceras.find((h) => h.clave.toLowerCase() === 'content-type')?.valor.toLowerCase() ?? ''
    if (tipo.includes('x-www-form-urlencoded') || (!tipo && /^[^{[\s][^\n]*=/.test(crudo) && !/^\s*[{[]/.test(crudo))) {
      p.cuerpo = { tipo: 'formulario', campos: crudo.split('&').filter(Boolean).map((kv) => { const k = kv.indexOf('='); const d = (s: string): string => { try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s } }; return par(d(k < 0 ? kv : kv.slice(0, k)), d(k < 0 ? '' : kv.slice(k + 1))) }) }
      p.cabeceras = p.cabeceras.filter((h) => h.clave.toLowerCase() !== 'content-type')
    } else if (tipo.includes('json') || /^\s*[{[]/.test(crudo)) {
      p.cuerpo = { tipo: 'json', texto: crudo }
      p.cabeceras = p.cabeceras.filter((h) => h.clave.toLowerCase() !== 'content-type' || !tipo.includes('json'))
    } else p.cuerpo = { tipo: 'texto', texto: crudo }
  }
  return p
}

export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Si el texto es JSON válido, lo devuelve analizado (si no, `undefined`). */
export function analizarJson(texto: string): { valor: unknown } | undefined {
  const t = texto.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[' && t[0] !== '"' && !/^-?\d/.test(t) && !/^(true|false|null)$/.test(t))) return undefined
  try {
    return { valor: JSON.parse(t) as unknown }
  } catch {
    return undefined
  }
}

export const colorEstado = (estado: number): 'ok' | 'redireccion' | 'cliente' | 'servidor' | 'otro' =>
  estado >= 200 && estado < 300 ? 'ok' : estado >= 300 && estado < 400 ? 'redireccion' : estado >= 400 && estado < 500 ? 'cliente' : estado >= 500 ? 'servidor' : 'otro'
