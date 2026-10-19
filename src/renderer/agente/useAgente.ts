import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventoAgente, SolicitudAgente } from '@shared/core/agente'
import type { Adjunto } from '@shared/core/adjuntos'
import type { EstadoTurno, TurnoGuardado } from '@shared/core/sesion'
import { etiquetarEjecucion, limpiarEjecucion } from './solicitudes'

export type { EstadoTurno }

export interface Turno {
  clave: string
  ejecucionId?: string
  prompt: string
  modo: 'chat' | 'flujo' | 'grupo' | 'comando'
  destino: string // nombre del proyecto o grupo (para mostrar)
  raiz: string // nombre del agente cuyo `fin` cierra el turno
  eventos: EventoAgente[]
  parcial: string // texto que el modelo está escribiendo ahora mismo (streaming)
  estado: EstadoTurno
  error?: string
  proyectoId?: string
  autonomia?: 'preguntar' | 'ediciones' | 'autonomo'
  adjuntos?: Adjunto[]
  /** Pregunta lateral: respondida aparte mientras otra tarea seguía en marcha (no es parte del hilo principal). */
  lateral?: boolean
}

export interface OpcionesEnvio {
  solicitud: SolicitudAgente
  destino: string
  /** Archivos ya subidos (se envían por id y se muestran en el mensaje). */
  adjuntos?: Adjunto[]
}

export interface ContextoActual {
  tokens: number
  aprox: boolean // estimación (tras comprimir o al retomar) en vez de un dato real de la API
  modelo?: string // último modelo conocido del agente raíz
  ventana?: number // ventana real informada por el CLI (suscripción); si falta, se usa la del modelo
}

/** Lo que ocupa el contexto ahora: el dato real de la última llamada, o una estimación si aún no hay. */
export function contextoDe(turnos: readonly Turno[], estimado?: number): ContextoActual | undefined {
  let modelo: string | undefined
  for (let i = turnos.length - 1; i >= 0; i--) {
    const evs = turnos[i]!.eventos
    for (let j = evs.length - 1; j >= 0; j--) {
      const e = evs[j]!
      if (!modelo && (e.tipo === 'uso_contexto' || e.tipo === 'ruta') && e.modelo) modelo = e.modelo
      if (e.tipo === 'uso_contexto') return { tokens: e.tokens, aprox: false, ...((modelo ?? e.modelo) ? { modelo: modelo ?? e.modelo! } : {}), ...(e.ventana ? { ventana: e.ventana } : {}) }
      if (e.tipo === 'contexto') return { tokens: e.tokensDespues, aprox: true, ...(modelo ? { modelo } : {}) }
    }
  }
  return estimado !== undefined ? { tokens: estimado, aprox: true } : undefined
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
    case 'comando_salida':
      return { ...t, parcial: '', eventos: [...t.eventos, e], estado: e.ok ? 'completado' : 'fallido' }
    default:
      return { ...t, eventos: [...t.eventos, e] }
  }
}

// Conversación activa de cada proyecto (clave -> id de sesión), recordada entre reinicios en el almacenamiento del renderer.
const leerActiva = (clave: string): string | undefined => {
  try {
    return localStorage.getItem(clave) ?? undefined
  } catch {
    return undefined
  }
}
const guardarActiva = (clave: string, id: string | undefined): void => {
  try {
    if (id) localStorage.setItem(clave, id)
    else localStorage.removeItem(clave)
  } catch {
    /* sin almacenamiento: la conversación no se recordará al reiniciar */
  }
}
// Solo una instancia por clave recupera la conversación activa (dos celdas del mismo proyecto no deben compartirla).
const reclamadas = new Set<string>()
const reclamar = (clave: string): boolean => (reclamadas.has(clave) ? false : (reclamadas.add(clave), true))
const liberar = (clave: string): void => void reclamadas.delete(clave)

/**
 * Conversación con el agente. Cada llamada es independiente (una por celda o pantalla): solo atiende los eventos de las
 * ejecuciones que lanzó ella. Las confirmaciones pendientes van a un almacén global (`solicitudes.ts`).
 */
export function useAgente(opciones: { clave?: string } = {}) {
  const claveActiva = `asistente:activa:${opciones.clave ?? 'global'}`
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [sesionId, setSesionId] = useState<string | undefined>()
  const guardados = useRef(0) // cuántos turnos terminados ya están guardados
  const [contextoEstimado, setContextoEstimado] = useState<number | undefined>() // al retomar una conversación, hasta que haya un dato real
  const ref = useRef<Turno[]>([]) // fuente de verdad: los efectos secundarios no van dentro de actualizadores de estado
  // Los eventos pueden llegar antes de que `ejecutar` devuelva el id: se guardan solo mientras esta instancia tiene un envío en vuelo.
  const huerfanos = useRef(new Map<string, EventoAgente[]>())
  const enVuelo = useRef(0)
  const contador = useRef(0)
  const salidasPendientes = useRef<string[]>([]) // salidas de comandos `/`: el agente las ve en el siguiente mensaje

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
      if (e.tipo === 'comando_salida') salidasPendientes.current.push(`[Salida del comando /${e.nombre} (${e.ok ? 'correcto' : 'falló'}): ${e.linea}]\n${e.salida.slice(0, 4000)}`)
      actualizar((ts) => ts.map((t, j) => (j === i ? aplicar(t, e) : t)))
    },
    [actualizar]
  )

  useEffect(() => window.api.core.onEvento(procesar), [procesar])

  // Al montar: se retoma la conversación activa de este proyecto (sobrevive a cerrar la celda o reiniciar la app).
  useEffect(() => {
    if (!reclamar(claveActiva)) return // otra celda del mismo proyecto ya la tiene
    const id = leerActiva(claveActiva)
    if (id)
      void window.api.core.sesionObtener(id).then((s) => {
        if (!s) return guardarActiva(claveActiva, undefined)
        if (ref.current.length > 0) return // el usuario ya empezó otra cosa
        const recuperados: Turno[] = s.transcripcion.map((t, i) => ({ ...t, clave: `r${i}`, parcial: '' }))
        guardados.current = recuperados.length
        contador.current = recuperados.length
        actualizar(() => recuperados)
        setSesionId(s.id)
        setContextoEstimado(s.tokensContexto)
      })
    return () => liberar(claveActiva)
  }, [claveActiva, actualizar])

  // La conversación actual es la «activa» del proyecto hasta que se abra otra o se empiece una nueva.
  useEffect(() => {
    if (sesionId) guardarActiva(claveActiva, sesionId)
  }, [claveActiva, sesionId])

  // Lo que se ve en pantalla se guarda al terminar cada turno (para poder releerlo y retomarlo).
  useEffect(() => {
    const terminados = turnos.filter((t) => t.estado !== 'en_curso')
    if (!sesionId || terminados.length === guardados.current || terminados.length === 0) return
    guardados.current = terminados.length
    const pid = terminados.find((t) => t.proyectoId)?.proyectoId
    const lista: TurnoGuardado[] = terminados.map(({ clave: _c, ejecucionId: _e, parcial: _p, ...t }) => t)
    void window.api.core.sesionTranscripcion(sesionId, lista, pid).catch(() => undefined)
  }, [turnos, sesionId])

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
    async ({ solicitud: solicitudBase, destino, adjuntos }: OpcionesEnvio): Promise<void> => {
      const solicitud: SolicitudAgente = adjuntos?.length ? { ...solicitudBase, adjuntos: adjuntos.map((a) => a.id) } : solicitudBase
      const clave = `t${++contador.current}`
      const modo = solicitud.modo === 'flujo' ? 'flujo' : solicitud.grupoId ? 'grupo' : 'chat'
      const raiz = modo === 'flujo' ? 'flujo' : modo === 'grupo' ? 'coordinador' : (solicitud.agenteId ?? 'asistente')
      actualizar((ts) => [
        ...ts,
        { clave, prompt: solicitud.prompt, modo, destino, raiz, eventos: [], parcial: '', estado: 'en_curso', ...(solicitud.proyectoId ? { proyectoId: solicitud.proyectoId } : {}), ...(solicitud.autonomia && solicitud.autonomia !== 'preguntar' ? { autonomia: solicitud.autonomia } : {}), ...(adjuntos?.length ? { adjuntos } : {}) }
      ])
      enVuelo.current++
      try {
        // Las salidas de comandos `/` recientes se adjuntan al mensaje para que el agente sepa qué pasó.
        const contexto = salidasPendientes.current.splice(0).join('\n\n')
        const { ejecucionId, sesionId: sid } = await window.api.core.ejecutar({
          ...solicitud,
          ...(contexto ? { prompt: `${contexto}\n\n${solicitud.prompt}` } : {}),
          ...(sesionId ? { sesionId } : {})
        })
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

  /**
   * Pregunta lateral: se responde ya, en paralelo, sin cancelar ni esperar a la tarea en marcha (que sigue su curso).
   * Devuelve false si no hay una tarea en marcha a la que preguntar.
   */
  const preguntarAhora = useCallback(
    async (prompt: string, destino: string, proyectoId?: string): Promise<boolean> => {
      const principal = [...ref.current].reverse().find((t) => t.estado === 'en_curso' && !t.lateral && t.ejecucionId && t.modo === 'chat')
      if (!principal?.ejecucionId) return false
      const clave = `t${++contador.current}`
      actualizar((ts) => [
        ...ts,
        { clave, prompt, modo: 'chat', destino, raiz: 'asistente', eventos: [], parcial: '', estado: 'en_curso', lateral: true, ...(proyectoId ? { proyectoId } : {}) }
      ])
      enVuelo.current++
      try {
        const { ejecucionId } = await window.api.core.lateral(principal.ejecucionId, prompt)
        etiquetarEjecucion(ejecucionId, destino)
        const previos = huerfanos.current.get(ejecucionId) ?? []
        actualizar((ts) => ts.map((t) => (t.clave === clave ? previos.reduce(aplicar, { ...t, ejecucionId }) : t)))
      } catch (err) {
        const mensaje = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        actualizar((ts) => ts.map((t) => (t.clave === clave ? { ...t, estado: 'error', error: mensaje } : t)))
      } finally {
        if (--enVuelo.current === 0) huerfanos.current.clear()
      }
      return true
    },
    [actualizar]
  )

  /** Ejecuta un comando propio `/nombre` (tipo ejecutable); el resultado llega como un turno más. */
  const ejecutarComando = useCallback(
    async (o: { proyectoId: string; nombre: string; argumentos: string; destino: string }): Promise<void> => {
      const clave = `t${++contador.current}`
      actualizar((ts) => [
        ...ts,
        { clave, prompt: `/${o.nombre}${o.argumentos ? ` ${o.argumentos}` : ''}`, modo: 'comando', destino: o.destino, raiz: 'comando', eventos: [], parcial: '', estado: 'en_curso', proyectoId: o.proyectoId }
      ])
      enVuelo.current++
      try {
        const { ejecucionId } = await window.api.core.comandoEjecutar(o.proyectoId, o.nombre, o.argumentos)
        etiquetarEjecucion(ejecucionId, o.destino)
        const previos = huerfanos.current.get(ejecucionId) ?? []
        for (const p of previos) if (p.tipo === 'comando_salida') salidasPendientes.current.push(`[Salida del comando /${p.nombre} (${p.ok ? 'correcto' : 'falló'}): ${p.linea}]\n${p.salida.slice(0, 4000)}`)
        actualizar((ts) => ts.map((t) => (t.clave === clave ? previos.reduce(aplicar, { ...t, ejecucionId }) : t)))
      } catch (err) {
        const mensaje = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        actualizar((ts) => ts.map((t) => (t.clave === clave ? { ...t, estado: 'error', error: mensaje } : t)))
      } finally {
        if (--enVuelo.current === 0) huerfanos.current.clear()
      }
    },
    [actualizar]
  )

  /** Muestra un aviso (p. ej. un comando `/` desconocido) como un turno con error. */
  const avisar = useCallback(
    (prompt: string, mensaje: string, destino = ''): void => {
      actualizar((ts) => [...ts, { clave: `t${++contador.current}`, prompt, modo: 'comando', destino, raiz: 'comando', eventos: [], parcial: '', estado: 'error', error: mensaje }])
    },
    [actualizar]
  )

  const cancelar = useCallback((t: Turno): void => {
    if (t.ejecucionId) void window.api.core.cancelar(t.ejecucionId)
  }, [])

  /** La conversación actual queda en el historial; se empieza una nueva en blanco. */
  const nuevaConversacion = useCallback((): void => {
    guardarActiva(claveActiva, undefined)
    setSesionId(undefined)
    setContextoEstimado(undefined)
    guardados.current = 0
    actualizar(() => [])
  }, [actualizar, claveActiva])

  /** Retoma una conversación del historial (el modelo continúa con su contexto). */
  const abrirSesion = useCallback(
    async (id: string): Promise<void> => {
      const s = await window.api.core.sesionObtener(id)
      if (!s) return
      const recuperados: Turno[] = s.transcripcion.map((t, i) => ({ ...t, clave: `r${i}`, parcial: '' }))
      guardados.current = recuperados.length
      contador.current = recuperados.length
      actualizar(() => recuperados)
      setSesionId(s.id)
      setContextoEstimado(s.tokensContexto)
    },
    [actualizar]
  )

  /** Borra una conversación del historial; si era la actual, se vacía la pantalla. */
  const borrarSesion = useCallback(
    async (id: string): Promise<void> => {
      await window.api.core.sesionBorrar(id)
      if (id === sesionId) nuevaConversacion()
    },
    [nuevaConversacion, sesionId]
  )

  // Las preguntas laterales no cuentan: la tarea principal es la que bloquea «Enviar», «Nueva conversación», etc.
  const enCurso = turnos.some((t) => t.estado === 'en_curso' && !t.lateral)
  const contexto = contextoDe(turnos, contextoEstimado)
  const tokensSesion = turnos.reduce((s, t) => s + t.eventos.reduce((x, e) => (e.tipo === 'fin' ? x + e.resultado.uso.tokensEntrada + e.resultado.uso.tokensSalida : x), 0), 0)
  return {
    contexto,
    tokensSesion, turnos, enCurso, sesionId, enviar, preguntarAhora, ejecutarComando, avisar, cancelar, nuevaConversacion, abrirSesion, borrarSesion }
}

export type Agente = ReturnType<typeof useAgente>
