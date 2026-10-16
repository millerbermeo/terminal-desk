import type { Uso } from '@shared/core/agente'
import type { LimiteApi, LimitesApi, ResumenUso, UsoModelo } from '@shared/core/uso'
import { AlmacenJson } from '../memory/almacen'
import type { PeticionLLM, ProveedorLLM, RespuestaLLM } from '../agents/llm/proveedor'

const DIAS_RETENIDOS = 35
const vacio = (): UsoModelo => ({ entrada: 0, salida: 0, llamadas: 0 })

/** Fecha local YYYY-MM-DD. */
export const diaLocal = (ms: number = Date.now()): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function limite(h: Headers, prefijo: string): LimiteApi | undefined {
  const l = Number(h.get(`${prefijo}-limit`))
  const r = Number(h.get(`${prefijo}-remaining`))
  if (!h.get(`${prefijo}-limit`) || !Number.isFinite(l) || !Number.isFinite(r)) return undefined
  const reinicio = h.get(`${prefijo}-reset`)
  return { limite: l, restante: Math.max(0, r), ...(reinicio && !Number.isNaN(Date.parse(reinicio)) ? { reinicio } : {}) }
}

/** Límites de tasa de las cabeceras `anthropic-ratelimit-*`; undefined si la respuesta no los trae. */
export function leerLimites(h: Headers, ahora: number = Date.now()): LimitesApi | undefined {
  const l: LimitesApi = { actualizado: ahora }
  const s = limite(h, 'anthropic-ratelimit-requests')
  const t = limite(h, 'anthropic-ratelimit-tokens')
  const e = limite(h, 'anthropic-ratelimit-input-tokens')
  const o = limite(h, 'anthropic-ratelimit-output-tokens')
  if (s) l.solicitudes = s
  if (t) l.tokens = t
  if (e) l.entrada = e
  if (o) l.salida = o
  return s || t || e || o ? l : undefined
}

interface Documento {
  dias: Record<string, Record<string, UsoModelo>>
}

/**
 * Cuánto consume esta aplicación y cuánto margen queda según la API. Es lo que se puede saber con una clave de API normal:
 * el saldo y la facturación de la cuenta solo están en la consola de Anthropic (o en la API de administración, con otra clave).
 */
export class Medidor {
  private readonly almacen: AlmacenJson<Documento>
  private datos: Documento = { dias: {} }
  private cargado: Promise<void>
  private limites: LimitesApi | undefined
  private readonly oyentes = new Set<(r: ResumenUso) => void>()
  private aviso: NodeJS.Timeout | undefined

  constructor(dir: string, private readonly ahora: () => number = Date.now) {
    this.almacen = new AlmacenJson<Documento>(dir)
    this.cargado = this.almacen.leer('uso').then((d) => {
      if (d) this.datos = d
    }, () => undefined)
  }

  /** Suma una llamada al modelo a las cuentas de hoy. */
  async registrar(modelo: string, uso: Uso): Promise<void> {
    await this.cargado
    const dia = diaLocal(this.ahora())
    const m = ((this.datos.dias[dia] ??= {})[modelo] ??= vacio())
    m.entrada += uso.tokensEntrada
    m.salida += uso.tokensSalida
    m.llamadas++
    const limite = diaLocal(this.ahora() - DIAS_RETENIDOS * 86_400_000)
    for (const d of Object.keys(this.datos.dias)) if (d < limite) delete this.datos.dias[d]
    const copia = structuredClone(this.datos)
    await this.almacen.actualizar('uso', () => copia).catch(() => undefined)
    this.avisar()
  }

  /** Cabeceras de una respuesta de la API. */
  cabeceras(h: Headers): void {
    const l = leerLimites(h, this.ahora())
    if (!l) return
    this.limites = l
    this.avisar()
  }

  async resumen(): Promise<ResumenUso> {
    await this.cargado
    const dia = diaLocal(this.ahora())
    const sumar = (dias: Record<string, UsoModelo>[]): UsoModelo =>
      dias.flatMap((d) => Object.values(d)).reduce((t, u) => ({ entrada: t.entrada + u.entrada, salida: t.salida + u.salida, llamadas: t.llamadas + u.llamadas }), vacio())
    const hoy = this.datos.dias[dia] ?? {}
    const desde = diaLocal(this.ahora() - 6 * 86_400_000)
    return {
      dia,
      hoy: structuredClone(hoy),
      total: sumar([hoy]),
      ultimos7Dias: sumar(Object.entries(this.datos.dias).filter(([d]) => d >= desde).map(([, v]) => v)),
      ...(this.limites ? { limites: this.limites } : {})
    }
  }

  /** Avisa a quien escuche (con un pequeño retardo para agrupar ráfagas de llamadas). */
  suscribir(cb: (r: ResumenUso) => void): () => void {
    this.oyentes.add(cb)
    return () => this.oyentes.delete(cb)
  }

  private avisar(): void {
    if (this.aviso || this.oyentes.size === 0) return
    this.aviso = setTimeout(() => {
      this.aviso = undefined
      void this.resumen().then((r) => this.oyentes.forEach((o) => o(r)))
    }, 200)
  }
}

/** Decorador del modelo: apunta los tokens de cada llamada, por modelo. */
export class LlmMedido implements ProveedorLLM {
  constructor(
    private readonly interno: ProveedorLLM,
    private readonly medidor: Medidor,
    private readonly modeloPorDefecto: string
  ) {}

  async completar(p: PeticionLLM): Promise<RespuestaLLM> {
    const r = await this.interno.completar(p)
    void this.medidor.registrar(p.modelo ?? this.modeloPorDefecto, r.uso)
    return r
  }
}
