import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaseSolicitud, DecisionHumana, EventoAgente, SolicitudAgente } from '@shared/core/agente'

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

export interface Solicitud {
  solicitudId: string
  ejecucionId: string
  agente: string
  clase: ClaseSolicitud
  contenido: string
  detalle?: string
  destructivo?: boolean
  herramienta?: string
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
      return { ...t, parcial: '', eventos: [...t.eventos, e] }
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
 * Estado de la conversación con el agente: se suscribe una sola vez a los eventos del núcleo (viven en App para que no se
 * pierdan al cambiar de pantalla) y mantiene los turnos y las solicitudes de confirmación pendientes.
 */
export function useAgente() {
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [sesionId, setSesionId] = useState<string | undefined>()
  // Los eventos pueden llegar antes de que `ejecutar` devuelva el id: se guardan hasta saber a qué turno pertenecen.
  const huerfanos = useRef(new Map<string, EventoAgente[]>())
  const contador = useRef(0)

  const procesar = useCallback((e: EventoAgente): void => {
    if (e.tipo === 'solicitud_humana') {
      setSolicitudes((s) => [
        ...s,
        {
          solicitudId: e.solicitudId, ejecucionId: e.ejecucionId, agente: e.agente, clase: e.clase, contenido: e.contenido,
          ...(e.detalle ? { detalle: e.detalle } : {}), ...(e.destructivo ? { destructivo: true } : {}), ...(e.herramienta ? { herramienta: e.herramienta } : {})
        }
      ])
    }
    setTurnos((ts) => {
      const i = ts.findIndex((t) => t.ejecucionId === e.ejecucionId)
      if (i < 0) {
        const cola = huerfanos.current.get(e.ejecucionId) ?? []
        huerfanos.current.set(e.ejecucionId, [...cola, e])
        return ts
      }
      const nuevo = aplicar(ts[i]!, e)
      return ts.map((t, j) => (j === i ? nuevo : t))
    })
  }, [])

  useEffect(() => window.api.core.onEvento(procesar), [procesar])

  // Una ejecución que terminó (o se canceló) ya no espera respuestas.
  useEffect(() => {
    setSolicitudes((s) => {
      const vivas = s.filter((x) => {
        const t = turnos.find((y) => y.ejecucionId === x.ejecucionId)
        return !t || t.estado === 'en_curso'
      })
      return vivas.length === s.length ? s : vivas
    })
  }, [turnos])

  const enviar = useCallback(
    async ({ solicitud, destino }: OpcionesEnvio): Promise<void> => {
      const clave = `t${++contador.current}`
      const modo = solicitud.modo === 'flujo' ? 'flujo' : solicitud.grupoId ? 'grupo' : 'chat'
      const raiz = modo === 'flujo' ? 'flujo' : modo === 'grupo' ? 'coordinador' : (solicitud.agenteId ?? 'asistente')
      setTurnos((ts) => [...ts, { clave, prompt: solicitud.prompt, modo, destino, raiz, eventos: [], parcial: '', estado: 'en_curso' }])
      try {
        const { ejecucionId, sesionId: sid } = await window.api.core.ejecutar({ ...solicitud, ...(sesionId ? { sesionId } : {}) })
        setSesionId(sid)
        const previos = huerfanos.current.get(ejecucionId) ?? []
        huerfanos.current.delete(ejecucionId)
        setTurnos((ts) => ts.map((t) => (t.clave === clave ? previos.reduce(aplicar, { ...t, ejecucionId }) : t)))
      } catch (err) {
        const mensaje = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        setTurnos((ts) => ts.map((t) => (t.clave === clave ? { ...t, estado: 'error', error: mensaje } : t)))
      }
    },
    [sesionId]
  )

  const cancelar = useCallback((t: Turno): void => {
    if (t.ejecucionId) void window.api.core.cancelar(t.ejecucionId)
  }, [])

  const responder = useCallback((s: Solicitud, decision: DecisionHumana): void => {
    setSolicitudes((x) => x.filter((y) => y.solicitudId !== s.solicitudId))
    void window.api.core.responder(s.solicitudId, decision)
  }, [])

  const nuevaConversacion = useCallback((): void => {
    if (sesionId) void window.api.core.sesionBorrar(sesionId)
    setSesionId(undefined)
    setTurnos([])
  }, [sesionId])

  const enCurso = turnos.some((t) => t.estado === 'en_curso')
  return { turnos, solicitudes, enCurso, sesionId, enviar, cancelar, responder, nuevaConversacion }
}

export type Agente = ReturnType<typeof useAgente>
