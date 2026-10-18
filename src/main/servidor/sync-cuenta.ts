import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EstadoTarea, Tarea } from '@shared/tareas'
import { ErrorSesion, type ClienteServidor } from './cliente'

/** Mismo patrón que acepta el servidor: solo documentos de cuenta conocidos (nada fuera de la carpeta de datos). */
export const ID_DOC_CUENTA =
  /^(?:(?:memoria|permisos)\/[A-Za-z0-9_-]{1,64}\.json|preferencias\.json|proveedores\.json|mcp\.json|tareas\/[A-Za-z0-9_-]{1,64}|tareas-estados)$/

export interface DocLocal {
  data: Record<string, unknown>
  /** Cuándo cambió aquí (ms). Solo decide los conflictos: si cambió en los dos lados, gana el más reciente. */
  mtime: number
}

/** De dónde salen y adónde van los documentos de cuenta. */
export interface FuenteCuenta {
  /** ¿Es esta fuente la dueña del documento? */
  maneja(id: string): boolean
  listar(): Promise<Map<string, DocLocal>>
  /** `null` = se borró en otro equipo. */
  /** Devuelve `false` si no se aplicó (p. ej. el usuario rechazó el cambio): el documento queda como estaba y no se da por sincronizado. */
  aplicar(id: string, data: Record<string, unknown> | null): Promise<void | false>
}

interface DocRemoto {
  id: string
  data: Record<string, unknown> | null
  deleted: boolean
  updatedAt: number
}

/** Lo último sincronizado de cada documento: `hash` del contenido (`null` = borrado) y su `updatedAt` en el servidor. */
interface Estado {
  docs: Record<string, { hash: string | null; updatedAt: number }>
  /** Cursor del servidor de la última pasada: la siguiente pide solo lo que cambió después. */
  cursor?: number
}

/** Margen al pedir «desde el cursor»: cubre lo que se guardó mientras se respondía la pasada anterior (repetirlo no hace daño). */
const SOLAPE_MS = 10_000

export interface ResumenSync {
  subidos: number
  bajados: number
  borrados: number
}

export const hashDe = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex')

async function escribirAtomico(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  const tmp = `${ruta}.${process.pid}.sync.tmp`
  await writeFile(tmp, contenido, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, ruta)
}

/**
 * Sincroniza los datos de la cuenta (no de un proyecto) con el servidor comparando cada documento local con lo último
 * sincronizado: lo que cambió aquí se sube, lo que cambió allí se baja, y si cambió en los dos lados gana lo más reciente. Los
 * borrados viajan como marcas. En el primer contacto de un equipo con la cuenta gana siempre lo del servidor (un equipo recién
 * instalado no pisa la configuración de la cuenta con sus valores por defecto).
 */
export class SincronizadorCuenta {
  private enCurso?: Promise<ResumenSync>

  constructor(
    private readonly cliente: ClienteServidor,
    private readonly archivoEstado: string,
    private readonly fuentes: FuenteCuenta[]
  ) {}

  private async leerEstado(): Promise<Estado | undefined> {
    try {
      const e = JSON.parse(await readFile(this.archivoEstado, 'utf8')) as Partial<Estado>
      return { docs: e.docs ?? {}, ...(typeof e.cursor === 'number' ? { cursor: e.cursor } : {}) }
    } catch {
      return undefined
    }
  }

  private fuenteDe(id: string): FuenteCuenta | undefined {
    return ID_DOC_CUENTA.test(id) ? this.fuentes.find((f) => f.maneja(id)) : undefined
  }

  /** Una pasada completa. Si ya hay una en curso, espera a esa. */
  sincronizar(): Promise<ResumenSync> {
    this.enCurso ??= this.pasada().finally(() => (this.enCurso = undefined))
    return this.enCurso
  }

  private async pasada(): Promise<ResumenSync> {
    const resumen: ResumenSync = { subidos: 0, bajados: 0, borrados: 0 }
    const previo = await this.leerEstado()
    const primera = !previo
    // La primera vez se baja todo; después, solo lo que cambió en el servidor desde la última pasada.
    const desde = previo?.cursor !== undefined ? `?since=${Math.max(0, previo.cursor - SOLAPE_MS)}` : ''
    const r = await this.cliente.get<{ cursor: number; docs: DocRemoto[] }>(`/me/docs${desde}`)
    const remotos = new Map(r.docs.filter((d) => ID_DOC_CUENTA.test(d.id)).map((d) => [d.id, d]))
    const locales = new Map<string, DocLocal>()
    for (const f of this.fuentes) for (const [id, d] of await f.listar()) if (ID_DOC_CUENTA.test(id)) locales.set(id, d)
    const estado: Estado = previo ?? { docs: {} }

    for (const id of new Set([...remotos.keys(), ...locales.keys(), ...Object.keys(estado.docs)])) {
      const fuente = this.fuenteDe(id)
      if (!fuente) continue
      const rem = remotos.get(id)
      const l = locales.get(id)
      const e = estado.docs[id]
      const hashLocal = l ? hashDe(l.data) : null
      const cambioLocal = l ? !e || e.hash !== hashLocal : !!e && e.hash !== null
      const cambioRemoto = !!rem && (!e || rem.updatedAt > e.updatedAt)
      let ganaRemoto = cambioRemoto && !cambioLocal
      if (cambioRemoto && cambioLocal) ganaRemoto = primera || rem!.updatedAt >= (l?.mtime ?? 0)

      if (ganaRemoto) {
        const datos = rem!.deleted ? null : rem!.data
        if (datos === null && !l) {
          estado.docs[id] = { hash: null, updatedAt: rem!.updatedAt }
          continue
        }
        if ((await fuente.aplicar(id, datos)) === false) continue
        estado.docs[id] = { hash: datos === null ? null : hashDe(datos), updatedAt: rem!.updatedAt }
        if (datos === null) resumen.borrados++
        else resumen.bajados++
      } else if (cambioLocal) {
        const cuando = Math.max(l?.mtime ?? Date.now(), (e?.updatedAt ?? 0) + 1, (rem?.updatedAt ?? 0) + 1)
        if (l) {
          const res = await this.cliente.put<{ aplicado: boolean }>('/me/docs', { id, data: l.data, updatedAt: cuando })
          if (res.aplicado) {
            estado.docs[id] = { hash: hashLocal, updatedAt: cuando }
            resumen.subidos++
          }
        } else {
          const res = await this.cliente.delete<{ aplicado: boolean }>('/me/docs', { id, updatedAt: cuando })
          if (res.aplicado) estado.docs[id] = { hash: null, updatedAt: cuando }
        }
      } else if (rem && !e) {
        estado.docs[id] = { hash: rem.deleted ? null : hashDe(rem.data), updatedAt: rem.updatedAt } // ya coinciden
      }
    }
    estado.cursor = r.cursor
    await escribirAtomico(this.archivoEstado, JSON.stringify(estado) + '\n')
    return resumen
  }
}

// ---------------------------------------------------------------- fuentes

/** Proveedores y servidores MCP viajan SIN sus claves (`env`): esas van cifradas en la bóveda. */
function sinClaves(id: string, data: unknown): Record<string, unknown> {
  if (id === 'proveedores.json' && Array.isArray(data)) {
    return { lista: data.map((p: Record<string, unknown>) => ({ ...p, env: {} })) }
  }
  if (id === 'mcp.json' && data && typeof data === 'object') {
    const d = data as { servidores?: Record<string, Record<string, unknown>> }
    const servidores = Object.fromEntries(Object.entries(d.servidores ?? {}).map(([n, s]) => [n, { ...s, env: {} }]))
    return { ...d, servidores }
  }
  return data as Record<string, unknown>
}

/** Al aplicar lo que llega: se conservan las claves que este equipo ya tenía. */
function conClavesLocales(id: string, remoto: Record<string, unknown>, local: unknown): unknown {
  if (id === 'proveedores.json') {
    const anteriores = new Map((Array.isArray(local) ? local : []).map((p: { id?: string; env?: unknown }) => [p.id, p.env]))
    const lista = Array.isArray(remoto.lista) ? (remoto.lista as Record<string, unknown>[]) : []
    return lista.map((p) => ({ ...p, env: anteriores.get(p.id as string) ?? {} }))
  }
  if (id === 'mcp.json') {
    const previos = ((local ?? {}) as { servidores?: Record<string, { env?: unknown }> }).servidores ?? {}
    const servidores = (remoto.servidores ?? {}) as Record<string, Record<string, unknown>>
    return { ...remoto, servidores: Object.fromEntries(Object.entries(servidores).map(([n, s]) => [n, { ...s, env: previos[n]?.env ?? {} }])) }
  }
  return remoto
}

/** Comandos que este equipo ejecutaría y que el documento remoto añade o cambia (proveedores y servidores MCP), en texto legible. */
export function comandosNuevos(id: string, remoto: Record<string, unknown>, local: unknown): string[] {
  const cambios: string[] = []
  if (id === 'proveedores.json') {
    const previos = new Map((Array.isArray(local) ? local : []).map((p: { id?: string; comando?: string }) => [p.id, p.comando]))
    const lista = Array.isArray(remoto.lista) ? (remoto.lista as { id?: string; nombre?: string; comando?: string }[]) : []
    for (const p of lista) if (previos.get(p.id) !== p.comando) cambios.push(`Proveedor «${p.nombre ?? p.id}»: ${p.comando}`)
  } else if (id === 'mcp.json') {
    const previos = ((local ?? {}) as { servidores?: Record<string, { comando?: string; args?: string[]; cwd?: string }> }).servidores ?? {}
    const servidores = (remoto.servidores ?? {}) as Record<string, { comando?: string; args?: string[]; cwd?: string; deshabilitado?: boolean }>
    for (const [n, s] of Object.entries(servidores)) {
      const a = previos[n]
      const igual = a && a.comando === s.comando && JSON.stringify(a.args ?? []) === JSON.stringify(s.args ?? []) && (a.cwd ?? '') === (s.cwd ?? '')
      if (!igual) cambios.push(`Servidor MCP «${n}»: ${[s.comando, ...(s.args ?? [])].join(' ')}`)
    }
  }
  return cambios
}

/**
 * Archivos de cuenta de `~/.odesk-agent`: memoria y permisos (un archivo por documento), preferencias, proveedores y
 * servidores MCP. `alAplicar` avisa tras escribir uno que llegó de otro equipo (p. ej. para olvidar una caché).
 */
export class FuenteArchivos implements FuenteCuenta {
  constructor(
    private readonly dir: string,
    private readonly alAplicar?: (id: string) => void,
    /** Si se da, se le pregunta antes de aplicar un comando nuevo o cambiado que vino del servidor (se ejecutaría en este equipo). */
    private readonly confirmar?: (cambios: string[]) => Promise<boolean>
  ) {}

  /** Versiones remotas ya rechazadas (por hash): no se vuelve a preguntar hasta que el servidor tenga otra. */
  private readonly rechazadas = new Map<string, string>()

  maneja(id: string): boolean {
    return !id.startsWith('tareas')
  }

  async listar(): Promise<Map<string, DocLocal>> {
    const salida = new Map<string, DocLocal>()
    const candidatos = ['preferencias.json', 'proveedores.json', 'mcp.json']
    for (const carpeta of ['memoria', 'permisos']) {
      try {
        for (const n of await readdir(join(this.dir, carpeta))) if (n.endsWith('.json')) candidatos.push(`${carpeta}/${n}`)
      } catch {
        // la carpeta aún no existe
      }
    }
    for (const id of candidatos) {
      if (!ID_DOC_CUENTA.test(id)) continue
      try {
        const ruta = join(this.dir, id)
        const [texto, info] = await Promise.all([readFile(ruta, 'utf8'), stat(ruta)])
        const data = sinClaves(id, JSON.parse(texto))
        if (data && typeof data === 'object' && !Array.isArray(data)) salida.set(id, { data, mtime: Math.floor(info.mtimeMs) })
      } catch {
        // no existe o no es JSON válido: no se sube
      }
    }
    return salida
  }

  async aplicar(id: string, data: Record<string, unknown> | null): Promise<void | false> {
    if (!ID_DOC_CUENTA.test(id)) return
    const ruta = join(this.dir, id)
    if (data === null) await rm(ruta, { force: true })
    else {
      let local: unknown
      try {
        local = JSON.parse(await readFile(ruta, 'utf8'))
      } catch {
        local = undefined
      }
      if (this.confirmar) {
        const cambios = comandosNuevos(id, data, local)
        if (cambios.length) {
          const h = hashDe(data)
          if (this.rechazadas.get(id) === h) return false
          if (!(await this.confirmar(cambios))) {
            this.rechazadas.set(id, h)
            return false
          }
          this.rechazadas.delete(id)
        }
      }
      await escribirAtomico(ruta, JSON.stringify(conClavesLocales(id, data, local), null, 2) + '\n')
    }
    this.alAplicar?.(id)
  }
}

/** Lo mínimo que la fuente necesita del servicio de tareas. */
export interface TareasCuenta {
  leer(): Promise<{ tareas: Tarea[]; estados: EstadoTarea[] }>
  fusionar(remotas: Tarea[]): Promise<number>
  quitarRemotas(borradas: { id: string; hasta: number }[], soloSinProyecto?: boolean): Promise<number>
  fijarEstados(estados: EstadoTarea[]): Promise<boolean>
}

/**
 * Tareas que no son de un proyecto (sueltas o solo de grupo) y las columnas del tablero. Las de proyecto van con el proyecto
 * (`Sincronizador`).
 */
export class FuenteTareas implements FuenteCuenta {
  constructor(private readonly tareas: TareasCuenta) {}

  maneja(id: string): boolean {
    return id.startsWith('tareas')
  }

  async listar(): Promise<Map<string, DocLocal>> {
    const d = await this.tareas.leer()
    const salida = new Map<string, DocLocal>()
    for (const t of d.tareas) if (!t.proyectoId) salida.set(`tareas/${t.id}`, { data: t as unknown as Record<string, unknown>, mtime: t.actualizada })
    salida.set('tareas-estados', { data: { estados: d.estados }, mtime: 0 })
    return salida
  }

  async aplicar(id: string, data: Record<string, unknown> | null): Promise<void> {
    if (id === 'tareas-estados') {
      if (data && Array.isArray(data.estados)) await this.tareas.fijarEstados(data.estados as EstadoTarea[])
      return
    }
    const tareaId = id.slice('tareas/'.length)
    if (data === null) await this.tareas.quitarRemotas([{ id: tareaId, hasta: Number.MAX_SAFE_INTEGER }], true)
    else if (data.id === tareaId) await this.tareas.fusionar([data as unknown as Tarea])
  }
}

/** Para los bucles: un error de sesión no es un fallo (se reintenta cuando se vuelva a entrar). */
export const esErrorDeSesion = (err: unknown): boolean => err instanceof ErrorSesion
