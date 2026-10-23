import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TurnoGuardado } from '@shared/core/sesion'

/**
 * Control del consumo de tokens del Asistente por suscripción. El CLI `claude` reenvía TODO el contexto en cada llamada
 * (a precio de caché, pero se acumula): una conversación larga con capturas de pantalla llegó a 350 k tokens por llamada y
 * 87 M en 48 minutos. Aquí viven las piezas puras que lo evitan, igual que hace el propio Claude Code: medir con exactitud,
 * compactar antes de que el contexto crezca y rotar a una sesión nueva con un resumen cuando compactar ya no compensa.
 */

/** Consumo acumulado de un modelo en una sesión del CLI (`modelUsage` del resultado: el CLI lo ACUMULA al reanudar). */
export interface AcumuladoModelo {
  entrada: number // input + caché leída + caché creada
  salida: number
  cache: number // de `entrada`, lo leído de la caché
  costo: number
}

/** Lo que el CLI informa por modelo (nombres de su `modelUsage`). */
export interface UsoModeloCrudo {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUSD?: number
}

export const aAcumulado = (u: UsoModeloCrudo): AcumuladoModelo => ({
  entrada: (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0),
  salida: u.outputTokens ?? 0,
  cache: u.cacheReadInputTokens ?? 0,
  costo: u.costUSD ?? 0
})

/**
 * Lo consumido SOLO por esta ejecución. `modelUsage` suma toda la sesión reanudada: apuntarlo tal cual contaba cada turno
 * otra vez con todo lo anterior (el medidor llegó a marcar 101 M de entrada y 29 USD cuando lo real eran 15 M). Si el
 * acumulado baja (sesión nueva, o la compactación reinició el contador) se toma el valor actual completo.
 */
export function diferenciaUso(actual: AcumuladoModelo, previo?: AcumuladoModelo): AcumuladoModelo {
  if (!previo || actual.entrada < previo.entrada || actual.salida < previo.salida) return actual
  return {
    entrada: actual.entrada - previo.entrada,
    salida: actual.salida - previo.salida,
    cache: Math.max(0, actual.cache - previo.cache),
    costo: Math.max(0, actual.costo - previo.costo)
  }
}

/** Qué se sabe de la sesión del CLI que continúa una conversación de la app. */
export interface MetaSesionCli {
  /** Tokens que ocupó el contexto en la última llamada de la última ejecución. */
  contexto: number
  ventana?: number
  /** Imágenes leídas en esta sesión del CLI (cada una se queda en el contexto y se reenvía en cada llamada). */
  imagenes: number
  /** Cuándo terminó la última ejecución (ms): pasada la hora la caché del prompt caduca y reanudar cuesta el contexto entero. */
  ultimaActividad: number
  /** Acumulado que informó el CLI por modelo, para restar lo anterior (`diferenciaUso`). */
  acumulado: Record<string, AcumuladoModelo>
  /** Modelo y cuenta de suscripción con los que corrió la última ejecución: si cambian, la caché del prompt (por cuenta+modelo) queda fría. */
  modelo?: string
  cuenta?: string
  /** Resumen de la sesión anterior que aún no llegó a una sesión nueva (la ejecución que lo llevaba falló antes de guardarla). */
  pendiente?: string
  rotaciones: number
  /** Huella del último contexto dinámico (memoria, tareas, git) enviado a esta sesión: solo se reenvía si cambió. */
  hashDinamico?: string
  /** Aviso para el modelo en el próximo mensaje (p. ej. «el usuario deshizo los cambios de archivos»). */
  aviso?: string
  /** Ya se le puso título a la conversación. */
  titulado?: boolean
}

export const metaVacia = (): MetaSesionCli => ({ contexto: 0, imagenes: 0, ultimaActividad: 0, acumulado: {}, rotaciones: 0 })

export interface UmbralesRotacion {
  /** Contexto a partir del cual se abre una sesión nueva aunque el CLI no haya compactado. */
  contexto: number
  imagenes: number
  /** Inactividad tras la que la caché del prompt (1 h) ya caducó. */
  inactividadMs: number
  /** Con tan poco contexto no compensa resumir aunque la caché haya caducado. */
  contextoMinimoInactivo: number
}

const entero = (v: string | undefined, porDefecto: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && v?.trim() ? Math.floor(n) : porDefecto
}

export const umbralesDeEntorno = (env: NodeJS.ProcessEnv = process.env): UmbralesRotacion => ({
  contexto: entero(env.ODESK_ROTAR_CONTEXTO, 170_000),
  imagenes: entero(env.ODESK_ROTAR_IMAGENES, 10),
  inactividadMs: entero(env.ODESK_ROTAR_INACTIVIDAD_MIN, 55) * 60_000,
  contextoMinimoInactivo: entero(env.ODESK_ROTAR_INACTIVO_CONTEXTO, 90_000)
})

/**
 * En modo autónomo, cuántas veces seguidas se puede continuar solo tras topar el límite de pasos de una sola respuesta
 * (`MAX_PASOS_EJECUCION`) antes de parar y esperar a que el usuario lo pida a mano. Una tarea larga legítima (un
 * refactor grande) topa ese límite varias veces seguidas sin que sea un bucle; 0 vuelve al comportamiento de siempre
 * (parar en la primera vez).
 */
export const maxContinuarAutomatico = (env: NodeJS.ProcessEnv = process.env): number => entero(env.ODESK_MAX_CONTINUAR_AUTO, 6)

export type MotivoRotacion = 'contexto' | 'imagenes' | 'inactividad' | 'modelo' | 'cuenta'

/**
 * ¿Conviene abrir una sesión nueva con un resumen en vez de reanudar? (Un umbral en 0 lo desactiva.)
 * `actual.modelo`/`actual.cuenta` son con los que va a correr ESTA ejecución: la caché de prompt de la API es por cuenta+modelo,
 * así que reanudar con otro cualquiera de los dos cae en caché fría y cuesta el contexto entero, igual que la inactividad larga
 * (por eso comparte el mismo umbral mínimo: con poco contexto no compensa resumir).
 */
export function decidirRotacion(meta: MetaSesionCli | undefined, u: UmbralesRotacion, ahora: number = Date.now(), actual?: { modelo?: string; cuenta?: string }): MotivoRotacion | undefined {
  if (!meta) return undefined
  if (u.contexto > 0 && meta.contexto >= u.contexto) return 'contexto'
  if (u.imagenes > 0 && meta.imagenes >= u.imagenes) return 'imagenes'
  if (meta.contexto >= u.contextoMinimoInactivo) {
    if (actual?.modelo && meta.modelo && actual.modelo !== meta.modelo) return 'modelo'
    if (actual?.cuenta && meta.cuenta && actual.cuenta !== meta.cuenta) return 'cuenta'
  }
  if (u.inactividadMs > 0 && meta.ultimaActividad > 0 && ahora - meta.ultimaActividad >= u.inactividadMs && meta.contexto >= u.contextoMinimoInactivo) return 'inactividad'
  return undefined
}

/** Metadatos por conversación de la app. Escrituras en cola y atómicas: varias ejecuciones pueden terminar a la vez. */
export class MetaSesionesCli {
  private cola: Promise<unknown> = Promise.resolve()
  constructor(private readonly archivo: string) {}

  private async leer(): Promise<Record<string, MetaSesionCli>> {
    try {
      return JSON.parse(await readFile(this.archivo, 'utf8')) as Record<string, MetaSesionCli>
    } catch {
      return {}
    }
  }

  async obtener(sesionId: string): Promise<MetaSesionCli | undefined> {
    return (await this.leer())[sesionId]
  }

  /** Cambia la ficha de una conversación (la crea vacía si no existe). `undefined` la borra. */
  actualizar(sesionId: string, cambio: (previa: MetaSesionCli) => MetaSesionCli | undefined): Promise<void> {
    const hecho = this.cola.then(async () => {
      const datos = await this.leer()
      const nueva = cambio(datos[sesionId] ?? metaVacia())
      if (nueva) datos[sesionId] = nueva
      else delete datos[sesionId]
      await mkdir(join(this.archivo, '..'), { recursive: true })
      const tmp = `${this.archivo}.tmp`
      await writeFile(tmp, JSON.stringify(datos), { mode: 0o600 })
      await rename(tmp, this.archivo)
    })
    this.cola = hecho.catch(() => undefined)
    return hecho
  }
}

const MAX_PROMPT = 1_200
const MAX_RESPUESTA = 1_600
const MAX_HERRAMIENTAS = 14

const corto = (t: string, max: number): string => {
  const l = t.replace(/\s+/g, ' ').trim()
  return l.length > max ? `${l.slice(0, max)}…` : l
}

const objetivo = (entrada: Record<string, unknown> | undefined): string => {
  const v = entrada?.file_path ?? entrada?.path ?? entrada?.command ?? entrada?.pattern ?? entrada?.url
  return typeof v === 'string' ? corto(v, 90) : ''
}

/**
 * Digest de la conversación para resumirla: por turno lo que pidió el usuario, qué herramientas/archivos tocó la IA y lo
 * último que dijo. Los turnos recientes entran completos y los antiguos se descartan al pasar `maxCaracteres`.
 */
export function digestDeConversacion(turnos: readonly TurnoGuardado[], maxCaracteres = 48_000): string {
  const bloques: string[] = []
  turnos.forEach((t, i) => {
    if (t.lateral) return
    const textos = t.eventos.filter((e): e is Extract<typeof e, { tipo: 'texto' }> => e.tipo === 'texto').map((e) => e.texto)
    const herramientas = new Set<string>()
    for (const e of t.eventos) {
      if (e.tipo !== 'herramienta_inicio') continue
      const obj = objetivo(e.llamada.entrada)
      herramientas.add(obj ? `${e.llamada.nombre} ${obj}` : e.llamada.nombre)
    }
    const lista = [...herramientas]
    const lineas = [`### Turno ${i + 1}`, `Usuario: ${corto(t.prompt, MAX_PROMPT)}`]
    if (lista.length) lineas.push(`Herramientas (${lista.length}): ${lista.slice(-MAX_HERRAMIENTAS).join('; ')}`)
    const ultimo = textos.at(-1)
    if (ultimo) lineas.push(`Asistente: ${corto(ultimo, MAX_RESPUESTA)}`)
    if (t.estado === 'error' && t.error) lineas.push(`(terminó con error: ${corto(t.error, 200)})`)
    bloques.push(lineas.join('\n'))
  })
  const elegidos: string[] = []
  let total = 0
  for (let i = bloques.length - 1; i >= 0; i--) {
    if (total + bloques[i]!.length > maxCaracteres && elegidos.length > 0) break
    elegidos.unshift(bloques[i]!)
    total += bloques[i]!.length + 2
  }
  const omitidos = bloques.length - elegidos.length
  return (omitidos > 0 ? `(${omitidos} turnos anteriores omitidos)\n\n` : '') + elegidos.join('\n\n')
}

/** Instrucciones para el modelo que resume (modelo barato, sin herramientas). */
export const PROMPT_RESUMEN = [
  'Resume esta conversación entre un usuario y un asistente de programación para que OTRO asistente pueda continuarla sin ver el historial.',
  'Usa este formato, en español, máximo ~600 palabras, sin relleno:',
  '## Objetivo\n## Decisiones y hechos clave\n## Archivos y comandos relevantes\n## Estado actual\n## Pendiente',
  'Conserva rutas, nombres, errores y valores exactos que sigan importando; descarta lo ya resuelto sin consecuencias. No inventes nada que no esté en la conversación.'
].join('\n')

/** Resumen de emergencia si el modelo no responde: la cola del digest. */
export const resumenDeRespaldo = (digest: string, max = 6_000): string => (digest.length > max ? `…${digest.slice(-max)}` : digest)

/** Bloque que se antepone al primer mensaje de la sesión nueva. */
export const bloqueContextoPrevio = (resumen: string, motivo: MotivoRotacion): string =>
  [
    `<contexto_previo motivo="${motivo}">`,
    'Esta conversación venía de una sesión anterior que se cerró para no seguir arrastrando un contexto enorme (cada llamada lo reenvía entero y cuesta tokens).',
    'Resumen de lo hablado y hecho hasta ahora; si necesitas un detalle que no esté aquí, vuelve a leer el archivo o a ejecutar el comando en vez de suponerlo:',
    resumen.trim(),
    '</contexto_previo>'
  ].join('\n')

/** Tope de gasto de una ejecución en USD (`--max-budget-usd`); 0 lo desactiva. Una ejecución normal cuesta céntimos, no dólares. */
export const presupuestoTurnoUsd = (env: NodeJS.ProcessEnv = process.env): number => {
  const v = env.ODESK_PRESUPUESTO_TURNO_USD
  const n = Number(v)
  return v?.trim() && Number.isFinite(n) && n >= 0 ? n : 5
}

/** Contexto a partir del cual se avisa al usuario de que la conversación ya es cara de continuar. */
export const AVISO_CONTEXTO = 110_000
/** Gasto de una sola ejecución (USD a precio de lista) a partir del cual se avisa. */
export const AVISO_COSTO_TURNO = 1.5
