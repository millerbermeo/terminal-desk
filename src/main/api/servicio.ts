import { randomUUID } from 'node:crypto'
import { generarCurl, resolverPeticion, variablesDe, type DatosApi, type EntradaHistorial, type PeticionApi, type RespuestaApi, type VariableEntorno } from '@shared/api'
import type { AlmacenJson } from '../core/memory/almacen'
import { clasificarCuerpo, ejecutarPeticion } from './cliente'
import { nombreValido, sanearPeticion, sanearVariables } from './validar'

const ID = 'datos'
const MAX_HISTORIAL = 100
const MAX_COLECCIONES = 100
const MAX_PETICIONES = 1000
const MAX_ENTORNOS = 50
const MAX_RECIENTES = 5
/** En el historial no se guardan cuerpos enormes. */
const MAX_CUERPO_HISTORIAL = 20_000

type Doc = DatosApi

const vacio = (): Doc => ({ colecciones: [], entornos: [], historial: [] })

function normalizar(d: Doc | undefined): Doc {
  if (!d) return vacio()
  return {
    colecciones: Array.isArray(d.colecciones) ? d.colecciones : [],
    entornos: Array.isArray(d.entornos) ? d.entornos : [],
    historial: Array.isArray(d.historial) ? d.historial : [],
    ...(d.entornoActivo ? { entornoActivo: d.entornoActivo } : {})
  }
}

function recortar(p: PeticionApi): PeticionApi {
  const c = p.cuerpo
  if ((c.tipo === 'json' || c.tipo === 'texto') && c.texto.length > MAX_CUERPO_HISTORIAL) return { ...p, cuerpo: { ...c, texto: c.texto.slice(0, MAX_CUERPO_HISTORIAL) } }
  return p
}

interface Reciente {
  envioId: string
  datos: Buffer
  nombre: string
}

/**
 * Cliente API: ejecuta las peticiones con el entorno activo y guarda colecciones, entornos e historial en
 * `~/.odesk-agent/api/datos.json` (0600: los entornos suelen llevar tokens).
 */
export class ServicioApi {
  private readonly activos = new Map<string, AbortController>()
  private readonly recientes: Reciente[] = []

  constructor(
    private readonly almacen: AlmacenJson<Doc>,
    private readonly guardarArchivo: (nombreSugerido: string, datos: Buffer) => Promise<string | undefined>
  ) {}

  private async leer(): Promise<Doc> {
    return normalizar(await this.almacen.leer(ID))
  }

  private async mutar<R>(f: (d: Doc) => R): Promise<{ datos: DatosApi; resultado: R }> {
    let resultado!: R
    const datos = await this.almacen.actualizar(ID, (actual) => {
      const d = normalizar(actual)
      resultado = f(d)
      return d
    })
    return { datos: normalizar(datos), resultado }
  }

  datos(): Promise<DatosApi> {
    return this.leer()
  }

  /** Reemplaza todos los datos (los que llegan de la bóveda de otro equipo) por la misma vía que cualquier otra escritura, sin pisar una en curso. */
  async reemplazar(nuevos: unknown): Promise<void> {
    await this.almacen.actualizar(ID, () => normalizar(nuevos as Doc))
  }

  async enviar(entrada: unknown, envioId: string): Promise<RespuestaApi> {
    if (typeof envioId !== 'string' || !envioId || envioId.length > 80) throw new Error('Identificador de envío no válido.')
    const peticion = sanearPeticion(entrada)
    if (!peticion.url.trim()) throw new Error('Escribe la URL de la petición.')
    const datos = await this.leer()
    const vars = variablesDe(datos.entornos.find((e) => e.id === datos.entornoActivo))
    const resuelta = resolverPeticion(peticion, vars)
    const control = new AbortController()
    this.activos.set(envioId, control)
    const entradaHistorial = (extra: Partial<EntradaHistorial>): EntradaHistorial => ({ id: randomUUID(), fecha: Date.now(), metodo: peticion.metodo, url: peticion.url, peticion: recortar(peticion), ...extra })
    try {
      const r = await ejecutarPeticion(resuelta, control.signal)
      const cuerpo = clasificarCuerpo(r.datos, r.tipoContenido, r.truncado)
      this.recientes.push({ envioId, datos: r.datos, nombre: nombreSugerido(r.urlFinal, r.tipoContenido) })
      if (this.recientes.length > MAX_RECIENTES) this.recientes.shift()
      await this.mutar((d) => void d.historial.unshift(entradaHistorial({ estado: r.estado, ms: r.ms })))
      await this.recortarHistorial()
      return { envioId, estado: r.estado, texto: r.texto, urlFinal: r.urlFinal, redirecciones: r.redirecciones, cabeceras: r.cabeceras, tipoContenido: r.tipoContenido, bytes: r.datos.length, ms: r.ms, cuerpo }
    } catch (err) {
      await this.mutar((d) => void d.historial.unshift(entradaHistorial({ error: (err as Error).message.slice(0, 300) }))).catch(() => undefined)
      await this.recortarHistorial().catch(() => undefined)
      throw err
    } finally {
      this.activos.delete(envioId)
    }
  }

  private async recortarHistorial(): Promise<void> {
    await this.mutar((d) => {
      if (d.historial.length > MAX_HISTORIAL) d.historial = d.historial.slice(0, MAX_HISTORIAL)
    })
  }

  cancelar(envioId: string): boolean {
    const c = this.activos.get(envioId)
    c?.abort()
    return Boolean(c)
  }

  async curl(entrada: unknown): Promise<string> {
    const datos = await this.leer()
    return generarCurl(resolverPeticion(sanearPeticion(entrada), variablesDe(datos.entornos.find((e) => e.id === datos.entornoActivo))))
  }

  async guardarRespuesta(envioId: string): Promise<{ ruta?: string }> {
    const r = this.recientes.find((x) => x.envioId === envioId)
    if (!r) throw new Error('Esa respuesta ya no está en memoria: vuelve a enviar la petición.')
    const ruta = await this.guardarArchivo(r.nombre, r.datos)
    return ruta ? { ruta } : {}
  }

  // ---------------------------------------------------------------- colecciones

  async guardarColeccion(id: string | undefined, nombre: unknown): Promise<{ datos: DatosApi; id: string }> {
    const n = nombreValido(nombre, 'la colección')
    const { datos, resultado } = await this.mutar((d) => {
      if (id) {
        const c = d.colecciones.find((x) => x.id === id)
        if (!c) throw new Error('La colección ya no existe.')
        c.nombre = n
        return id
      }
      if (d.colecciones.length >= MAX_COLECCIONES) throw new Error('Demasiadas colecciones.')
      const nuevo = randomUUID()
      d.colecciones.push({ id: nuevo, nombre: n, peticiones: [] })
      return nuevo
    })
    return { datos, id: resultado }
  }

  async eliminarColeccion(id: string): Promise<DatosApi> {
    return (await this.mutar((d) => void (d.colecciones = d.colecciones.filter((c) => c.id !== id)))).datos
  }

  async guardarPeticion(coleccionId: string, id: string | undefined, nombre: unknown, peticion: unknown): Promise<{ datos: DatosApi; id: string }> {
    const n = nombreValido(nombre, 'la petición')
    const p = sanearPeticion(peticion)
    const { datos, resultado } = await this.mutar((d) => {
      const c = d.colecciones.find((x) => x.id === coleccionId)
      if (!c) throw new Error('La colección ya no existe.')
      if (d.colecciones.reduce((t, x) => t + x.peticiones.length, 0) >= MAX_PETICIONES && !id) throw new Error('Demasiadas peticiones guardadas.')
      const existente = id ? c.peticiones.find((x) => x.id === id) : undefined
      if (existente) {
        existente.nombre = n
        existente.peticion = p
        existente.actualizada = Date.now()
        return existente.id
      }
      const nuevo = randomUUID()
      c.peticiones.push({ id: nuevo, nombre: n, peticion: p, actualizada: Date.now() })
      return nuevo
    })
    return { datos, id: resultado }
  }

  async eliminarPeticion(coleccionId: string, id: string): Promise<DatosApi> {
    return (await this.mutar((d) => {
      const c = d.colecciones.find((x) => x.id === coleccionId)
      if (c) c.peticiones = c.peticiones.filter((x) => x.id !== id)
    })).datos
  }

  // ---------------------------------------------------------------- entornos

  async guardarEntorno(id: string | undefined, nombre: unknown, variables: unknown): Promise<{ datos: DatosApi; id: string }> {
    const n = nombreValido(nombre, 'el entorno')
    const vars: VariableEntorno[] = sanearVariables(variables)
    const { datos, resultado } = await this.mutar((d) => {
      if (id) {
        const e = d.entornos.find((x) => x.id === id)
        if (!e) throw new Error('El entorno ya no existe.')
        e.nombre = n
        e.variables = vars
        return id
      }
      if (d.entornos.length >= MAX_ENTORNOS) throw new Error('Demasiados entornos.')
      const nuevo = randomUUID()
      d.entornos.push({ id: nuevo, nombre: n, variables: vars })
      if (!d.entornoActivo) d.entornoActivo = nuevo
      return nuevo
    })
    return { datos, id: resultado }
  }

  async eliminarEntorno(id: string): Promise<DatosApi> {
    return (await this.mutar((d) => {
      d.entornos = d.entornos.filter((e) => e.id !== id)
      if (d.entornoActivo === id) delete d.entornoActivo
    })).datos
  }

  async fijarEntorno(id: string | undefined): Promise<DatosApi> {
    return (await this.mutar((d) => {
      if (id && !d.entornos.some((e) => e.id === id)) throw new Error('El entorno ya no existe.')
      if (id) d.entornoActivo = id
      else delete d.entornoActivo
    })).datos
  }

  async limpiarHistorial(): Promise<DatosApi> {
    return (await this.mutar((d) => void (d.historial = []))).datos
  }
}

function nombreSugerido(url: string, tipo: string): string {
  try {
    const ruta = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (ruta && /\.[a-z0-9]{1,6}$/i.test(ruta)) return ruta
  } catch {
    /* sin nombre en la URL */
  }
  const t = tipo.toLowerCase()
  const ext = t.includes('json') ? 'json' : t.includes('html') ? 'html' : t.includes('xml') ? 'xml' : t.startsWith('image/') ? (t.split('/')[1]!.split(';')[0]!.replace('jpeg', 'jpg')) : t.startsWith('text/') ? 'txt' : 'bin'
  return `respuesta.${ext}`
}
