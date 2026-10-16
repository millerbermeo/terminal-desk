import type { EsquemaEntrada, HerramientaDef, Riesgo, ResultadoHerramienta } from '@shared/core/herramientas'

export interface ContextoHerramienta {
  cwd: string
  proyectoId?: string
  senal?: AbortSignal
}

/** Una skill/herramienta: definición para el modelo + implementación. */
export interface Herramienta extends HerramientaDef {
  riesgo: Riesgo
  /** Riesgo según la entrada (p. ej. un comando de solo lectura); si no existe se usa `riesgo`. */
  clasificar?(entrada: Record<string, unknown>): Riesgo
  ejecutar(entrada: Record<string, unknown>, ctx: ContextoHerramienta): Promise<ResultadoHerramienta>
}

const TIPOS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Valida la entrada contra el esquema (required + tipo/enum de cada propiedad). Devuelve el motivo o null. */
export function validarEntrada(esquema: EsquemaEntrada, entrada: unknown): string | null {
  if (!TIPOS.object!(entrada)) return 'la entrada debe ser un objeto'
  const obj = entrada as Record<string, unknown>
  for (const k of esquema.required ?? []) if (obj[k] === undefined) return `falta el parámetro «${k}»`
  for (const [k, def] of Object.entries(esquema.properties ?? {})) {
    const v = obj[k]
    if (v === undefined) continue
    if (def.type && TIPOS[def.type] && !TIPOS[def.type]!(v)) return `«${k}» debe ser ${def.type}`
    if (def.enum && !def.enum.includes(v)) return `«${k}» debe ser uno de: ${def.enum.join(', ')}`
  }
  return null
}

/** Ejecuta una herramienta validando la entrada; nunca lanza (los fallos vuelven como resultado con `error`). */
export async function ejecutarHerramienta(h: Herramienta, entrada: unknown, ctx: ContextoHerramienta): Promise<ResultadoHerramienta> {
  const motivo = validarEntrada(h.esquema, entrada)
  if (motivo) return { texto: `Entrada inválida para ${h.nombre}: ${motivo}`, error: true }
  try {
    return await h.ejecutar(entrada as Record<string, unknown>, ctx)
  } catch (err) {
    return { texto: `Error en ${h.nombre}: ${(err as Error).message}`, error: true }
  }
}

export class RegistroHerramientas {
  private readonly mapa = new Map<string, Herramienta>()

  registrar(h: Herramienta): void {
    if (this.mapa.has(h.nombre)) throw new Error(`Herramienta duplicada: ${h.nombre}`)
    this.mapa.set(h.nombre, h)
  }

  quitarPrefijo(prefijo: string): void {
    for (const n of [...this.mapa.keys()]) if (n.startsWith(prefijo)) this.mapa.delete(n)
  }

  obtener(nombre: string): Herramienta | undefined {
    return this.mapa.get(nombre)
  }

  /** Definiciones para el modelo; `permitidas` restringe por nombre (undefined = todas). */
  definiciones(permitidas?: readonly string[]): HerramientaDef[] {
    return [...this.mapa.values()]
      .filter((h) => !permitidas || permitidas.includes(h.nombre))
      .map(({ nombre, descripcion, esquema }) => ({ nombre, descripcion, esquema }))
  }

  /** Nunca lanza: los fallos vuelven al modelo como resultado con `error`. */
  async llamar(nombre: string, entrada: unknown, ctx: ContextoHerramienta): Promise<ResultadoHerramienta> {
    const h = this.mapa.get(nombre)
    if (!h) return { texto: `Herramienta desconocida: ${nombre}`, error: true }
    return ejecutarHerramienta(h, entrada, ctx)
  }
}
