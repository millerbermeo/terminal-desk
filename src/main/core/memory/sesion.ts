import type { EventoAgente, Mensaje, Uso } from '@shared/core/agente'
import type { ResumenSesion, SesionGuardada, TurnoGuardado } from '@shared/core/sesion'
import { redactarSecretos } from '../guardrails/secretos'
import { AlmacenJson } from './almacen'

/** Memoria de corto plazo: una conversación (contexto del modelo + lo que se ve en pantalla). */
export interface Sesion {
  id: string
  proyectoId?: string
  titulo: string
  creada: string // ISO
  mensajes: Mensaje[] // lo que se envía al modelo (puede estar comprimido)
  uso: Uso // acumulado de toda la sesión
  transcripcion: TurnoGuardado[] // lo que ve el usuario
  actualizada: string // ISO
}

const MAX_SESIONES_POR_PROYECTO = 50
const MAX_TEXTO_EVENTO = 20_000
const MAX_TEXTO_HERRAMIENTA = 4_000
const MAX_BYTES_TRANSCRIPCION = 1_500_000
// Eventos que aportan algo al releer una conversación (sin deltas de streaming ni pasos internos).
const EVENTOS_GUARDADOS = new Set(['ruta', 'flujo_nodo', 'texto', 'herramienta_inicio', 'herramienta_fin', 'a2a', 'guardrail', 'solicitud_humana', 'worktree', 'contexto', 'flujo_fin', 'aprobacion_automatica', 'fin'])

const recortar = (t: string, max: number): string => (t.length > max ? t.slice(0, max) + `… [+${t.length - max} caracteres]` : t)

function aligerar(e: EventoAgente): EventoAgente {
  switch (e.tipo) {
    case 'texto':
      return { ...e, texto: recortar(e.texto, MAX_TEXTO_EVENTO) }
    case 'herramienta_fin':
      return { ...e, resultado: { ...e.resultado, texto: recortar(e.resultado.texto, MAX_TEXTO_HERRAMIENTA) } }
    case 'fin': {
      // El resultado trae toda la conversación (`mensajes`): ya está guardada aparte, no se duplica.
      const { mensajes: _mensajes, ...resto } = e.resultado
      return { ...e, resultado: { ...resto, mensajes: [] } }
    }
    default:
      return e
  }
}

/** Deja la transcripción lista para guardar: solo eventos útiles, recortados, sin credenciales y de tamaño acotado. */
export function sanearTranscripcion(turnos: readonly TurnoGuardado[]): TurnoGuardado[] {
  let lista = turnos.map((t) => ({ ...t, eventos: t.eventos.filter((e) => EVENTOS_GUARDADOS.has(e.tipo)).map(aligerar) }))
  lista = JSON.parse(redactarSecretos(JSON.stringify(lista))) as TurnoGuardado[]
  while (lista.length > 1 && JSON.stringify(lista).length > MAX_BYTES_TRANSCRIPCION) lista = lista.slice(1) // se pierden los más antiguos
  return lista
}

const tituloDe = (turnos: readonly TurnoGuardado[]): string => {
  const t = (turnos[0]?.prompt ?? 'Conversación').replace(/\s+/g, ' ').trim()
  return t.length > 70 ? t.slice(0, 70) + '…' : t || 'Conversación'
}

const sinUso = (): Uso => ({ tokensEntrada: 0, tokensSalida: 0 })

export class MemoriaCortoPlazo {
  private readonly almacen: AlmacenJson<Sesion>

  constructor(dir: string) {
    this.almacen = new AlmacenJson<Sesion>(dir, 0o600) // contiene código y salidas del proyecto
  }

  obtener(id: string): Promise<Sesion | undefined> {
    return this.almacen.leer(id)
  }

  /** Contexto del modelo tras una ejecución; conserva título, fecha de creación y transcripción. */
  async guardar(id: string, mensajes: Mensaje[], uso: Uso, proyectoId?: string): Promise<void> {
    await this.almacen.actualizar(id, (previa) => {
      const pid = proyectoId ?? previa?.proyectoId
      return {
        id,
        ...(pid ? { proyectoId: pid } : {}),
        titulo: previa?.titulo ?? 'Conversación',
        creada: previa?.creada ?? new Date().toISOString(),
        mensajes,
        uso: {
          tokensEntrada: (previa?.uso.tokensEntrada ?? 0) + uso.tokensEntrada,
          tokensSalida: (previa?.uso.tokensSalida ?? 0) + uso.tokensSalida
        },
        transcripcion: previa?.transcripcion ?? [],
        actualizada: new Date().toISOString()
      }
    })
  }

  /** Lo que se ve en pantalla (solo turnos terminados). Crea la sesión si aún no existe y poda las más antiguas del proyecto. */
  async guardarTranscripcion(id: string, turnos: readonly TurnoGuardado[], proyectoId?: string): Promise<void> {
    const limpios = sanearTranscripcion(turnos)
    let nueva = false
    await this.almacen.actualizar(id, (previa) => {
      nueva = !previa
      const pid = proyectoId ?? previa?.proyectoId
      return {
        id,
        ...(pid ? { proyectoId: pid } : {}),
        titulo: previa && previa.titulo !== 'Conversación' ? previa.titulo : tituloDe(limpios),
        creada: previa?.creada ?? new Date().toISOString(),
        mensajes: previa?.mensajes ?? [],
        uso: previa?.uso ?? sinUso(),
        transcripcion: limpios,
        actualizada: new Date().toISOString()
      }
    })
    if (nueva) await this.podar(proyectoId)
  }

  async transcripcion(id: string): Promise<SesionGuardada | undefined> {
    const s = await this.almacen.leer(id)
    if (!s) return undefined
    return { id: s.id, titulo: s.titulo, ...(s.proyectoId ? { proyectoId: s.proyectoId } : {}), creada: s.creada, actualizada: s.actualizada, transcripcion: s.transcripcion }
  }

  /** Más recientes primero; sin `proyectoId` devuelve las de todos los proyectos. */
  async listar(proyectoId?: string): Promise<ResumenSesion[]> {
    const todas = (await Promise.all((await this.almacen.ids()).map((id) => this.almacen.leer(id).catch(() => undefined)))).filter(
      (s): s is Sesion => !!s && s.transcripcion.length > 0 && (!proyectoId || s.proyectoId === proyectoId)
    )
    return todas
      .sort((a, b) => b.actualizada.localeCompare(a.actualizada))
      .map((s) => ({
        id: s.id,
        titulo: s.titulo,
        ...(s.proyectoId ? { proyectoId: s.proyectoId } : {}),
        actualizada: s.actualizada,
        turnos: s.transcripcion.length,
        tokens: s.uso.tokensEntrada + s.uso.tokensSalida
      }))
  }

  private async podar(proyectoId?: string): Promise<void> {
    const sobran = (await this.listar(proyectoId)).filter((s) => (s.proyectoId ?? undefined) === (proyectoId ?? undefined)).slice(MAX_SESIONES_POR_PROYECTO)
    for (const s of sobran) await this.borrar(s.id)
  }

  async borrar(id: string): Promise<void> {
    await this.almacen.actualizar(id, () => undefined)
  }
}
