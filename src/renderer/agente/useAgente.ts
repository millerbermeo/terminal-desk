import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventoAgente, SolicitudAgente } from '@shared/core/agente'
import { etiquetarEjecucion, limpiarEjecucion } from './solicitudes'

export type EstadoTurno = 'en_curso' | 'completado' | 'limite_pasos' | 'cancelado' | 'error' | 'rechazado' | 'fallido'

export interface Turno {
  clave: string
  ejecucionId?: string
  prompt: string
  modo: 'chat' | 'flujo' | 'grupo'
  destino: string // nombre del proyecto o grupo (para mostrar)
  raiz: string // nombre del agente cuyo `fin` cierra el turno
  eventos: EventoAgente[]
  parcial: string // texto que el modelo está escribiendo ahora mismo (streaming)
  estado: EstadoTurno
  error?: string
}

export interface OpcionesEnvio {
  solicitud: SolicitudAgente
  destino: string
}

/** Aplica un evento a un turno (el resultado de `fin`/`flujo_fin` cierra el turno). */
function aplicar(t: Turno, e: EventoAgente): Turno {
  switch (e.tipo) {
    case 'texto_delta':
      return { ...t, parcial: t.parcial + e.texto }
    case 'texto':
    case 'inicio':
    case 'paso':
      return { ...t, parcial: '', eventos: [...t.eventos, e] }
    case 'fin':
      return e.agente === t.raiz && t.modo !== 'flujo'
        ? { ...t, parcial: '', eventos: [...t.eventos, e], estado: e.resultado.estado, ...(e.resultado.error ? { error: e.resultado.error } : {}) }
        : { ...t, eventos: [...t.eventos, e] }
    case 'flujo_fin':
      return { ...t, parcial: '', eventos: [...t.eventos, e], estado: e.estado }
    default:
      return { ...t, eventos: [...t.eventos, e] }
  }
}

/**
 * Conversación con el agente. Cada llamada es independiente (una por celda o pantalla): solo atiende los eventos de las
 * ejecuciones que lanzó ella. Las confirmaciones pendientes van a un almacén global (`solicitudes.ts`).
 */
export function useAgente() {
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [sesionId, setSesionId] = useState<string | undefined>()
  const ref = useRef<Turno[]>([]) // fuente de verdad: los efectos secundarios no van dentro de actualizadores de estado
  // Los eventos pueden llegar antes de que `ejecutar` devuelva el id: se guardan solo mientras esta instancia tiene un envío en vuelo.
  const huerfanos = useRef(new Map<string, EventoAgente[]>())
  const enVuelo = useRef(0)
  const contador = useRef(0)

  const actualizar = useCallback((f: (ts: Turno[]) => Turno[]): void => {
    ref.current = f(ref.current)
    setTurnos(ref.current)
  }, [])

  const procesar = useCallback(
    (e: EventoAgente): void => {
      const i = ref.current.findIndex((t) => t.ejecucionId === e.ejecucionId)
      if (i < 0) {
        if (enVuelo.current > 0) huerfanos.current.set(e.ejecucionId, [...(huerfanos.current.get(e.ejecucionId) ?? []), e])
        return
      }
      actualizar((ts) => ts.map((t, j) => (j === i ? aplicar(t, e) : t)))
    },
    [actualizar]
  )

  useEffect(() => window.api.core.onEvento(procesar), [procesar])

  // Una ejecución que terminó (o se canceló) ya no espera confirmaciones.
  useEffect(() => {
    for (const t of turnos) if (t.ejecucionId && t.estado !== 'en_curso') limpiarEjecucion(t.ejecucionId)
  }, [turnos])

  // Si la celda se cierra con una ejecución en marcha, se cancela (no debe seguir pidiendo confirmaciones sin pantalla).
  useEffect(
    () => () => {
      for (const t of ref.current) if (t.estado === 'en_curso' && t.ejecucionId) void window.api.core.cancelar(t.ejecucionId)
    },
    []
  )

  const enviar = useCallback(
    async ({ solicitud, destino }: OpcionesEnvio): Promise<void> => {
      const clave = `t${++contador.current}`
      const modo = solicitud.modo === 'flujo' ? 'flujo' : solicitud.grupoId ? 'grupo' : 'chat'
      const raiz = modo === 'flujo' ? 'flujo' : modo === 'grupo' ? 'coordinador' : (solicitud.agenteId ?? 'asistente')
      actualizar((ts) => [...ts, { clave, prompt: solicitud.prompt, modo, destino, raiz, eventos: [], parcial: '', estado: 'en_curso' }])
      enVuelo.current++
      try {
        const { ejecucionId, sesionId: sid } = await window.api.core.ejecutar({ ...solicitud, ...(sesionId ? { sesionId } : {}) })
        setSesionId(sid)
        etiquetarEjecucion(ejecucionId, destino)
        const previos = huerfanos.current.get(ejecucionId) ?? []
        actualizar((ts) => ts.map((t) => (t.clave === clave ? previos.reduce(aplicar, { ...t, ejecucionId }) : t)))
      } catch (err) {
        const mensaje = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        actualizar((ts) => ts.map((t) => (t.clave === clave ? { ...t, estado: 'error', error: mensaje } : t)))
      } finally {
        if (--enVuelo.current === 0) huerfanos.current.clear()
      }
    },
    [actualizar, sesionId]
  )

  const cancelar = useCallback((t: Turno): void => {
    if (t.ejecucionId) void window.api.core.cancelar(t.ejecucionId)
  }, [])

  const nuevaConversacion = useCallback((): void => {
    if (sesionId) void window.api.core.sesionBorrar(sesionId)
    setSesionId(undefined)
    actualizar(() => [])
  }, [actualizar, sesionId])

  const enCurso = turnos.some((t) => t.estado === 'en_curso')
  return { turnos, enCurso, sesionId, enviar, cancelar, nuevaConversacion }
}

export type Agente = ReturnType<typeof useAgente>
