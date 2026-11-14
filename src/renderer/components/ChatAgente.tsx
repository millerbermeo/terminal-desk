import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EventoAgente } from '@shared/core/agente'
import { LIMITES_ADJUNTOS, type Adjunto } from '@shared/core/adjuntos'
import { COMANDOS_CLAUDE, COMANDOS_INCLUIDOS, NOMBRES_CLAUDE_CODE, PLANTILLAS_INCLUIDAS, expandirPlantilla, type ComandoUsuario } from '@shared/core/comandos'
import type { ModoAutonomia } from '@shared/core/permisos'
import type { DatosProyectos } from '@shared/modelos'
import type { EstadoTarea, Tarea } from '@shared/tareas'
import type { Agente, Turno } from '../agente/useAgente'
import { useCuenta } from '../agente/cuenta'
import { ESFUERZOS_AJUSTE, type AjustesAsistente, type Esfuerzo } from '@shared/ajustes'
import type { ContextoUso } from '@shared/core/uso'
import { useModelos } from '../agente/uso'
import { AdjuntosAgente } from './AdjuntosAgente'
import { BarraRama } from './BarraRama'
import { confirmar } from '../confirmar'
import { BarraUso } from './BarraUso'
import { GestionProyecto } from './GestionProyecto'
import { EstadoVacio } from './EstadoVacio'
import { HistorialAgente } from './HistorialAgente'
import { IconoArchivo, IconoCampana, IconoCampanaTachada, IconoCarpeta, IconoChispa, IconoCerrar, IconoClip, IconoMas, IconoReloj, IconoTareas } from './Iconos'
import { fijarNotificaciones, useNotificaciones } from '../agente/notificaciones'
import { aplicarMencion, detectarMencion, opcionesMencion } from '../agente/menciones'
import { aplicarMencionTarea, detectarMencionTarea, opcionesTarea, pedirImplementar } from '../agente/tareas-chat'
import { NOMBRE_PRIORIDAD } from './Tareas'
import { SolicitudesChat } from './ModalSolicitud'
import { useGrabadora } from '../agente/grabadora'
import { BarraGrabacion, BotonMicrofono } from './GrabadorVoz'
import { alExterno, tomarExternos } from '../agente/externos'
import { Cargando } from './Cargando'

interface Props {
  agente: Agente
  /** Pantalla global: permite elegir proyecto o grupo. */
  datos?: DatosProyectos
  /** Celda de un proyecto: el destino está fijado y no se muestra el selector. */
  proyectoFijo?: { id: string; nombre: string }
}

const ESTADO: Record<Turno['estado'], string> = {
  en_curso: 'en curso',
  completado: 'completado',
  limite_pasos: 'límite de pasos',
  cancelado: 'cancelado',
  error: 'error',
  rechazado: 'rechazado',
  fallido: 'fallido'
}

const NODOS: Record<string, string> = { planificacion: 'Planificación', aprobacion: 'Aprobación', generacion: 'Generación', pruebas: 'Verificación', confirmacion: 'Confirmación' }
/** Una sola vez: lo que se había elegido antes y estaba solo en este navegador (`localStorage`) pasa a los ajustes de la cuenta. */
async function migrarAjustesLocales(clave: string, vacios: AjustesAsistente): Promise<AjustesAsistente> {
  try {
    const kModelo = `asistente:modelo:${clave}`
    const kAutonomia = `asistente:autonomia:${clave}`
    const modelo = localStorage.getItem(kModelo)
    const autonomia = localStorage.getItem(kAutonomia)
    localStorage.removeItem(kModelo)
    localStorage.removeItem(kAutonomia)
    const cambios = { ...(modelo && modelo !== 'auto' ? { modelo } : {}), ...(autonomia && autonomia !== 'preguntar' ? { autonomia } : {}) }
    return Object.keys(cambios).length ? await window.api.ajustes.fijar(clave, cambios) : vacios
  } catch {
    return vacios
  }
}

const resumirEntrada = (e: Record<string, unknown>): string => {
  const t = JSON.stringify(e)
  return t.length > 120 ? t.slice(0, 120) + '…' : t
}

interface Etapa {
  texto: string
  estado: 'pending' | 'in_progress' | 'completed'
}

/** Etapas de una llamada a `TodoWrite` (la entrada viene del modelo: se lee con cuidado). */
function etapasDe(entrada: Record<string, unknown>): Etapa[] {
  const lista = Array.isArray(entrada.todos) ? entrada.todos : []
  return lista.flatMap((t): Etapa[] => {
    if (!t || typeof t !== 'object') return []
    const o = t as Record<string, unknown>
    const estado = o.status === 'completed' || o.status === 'in_progress' ? o.status : 'pending'
    const texto = String((estado === 'in_progress' && o.activeForm) || o.content || '').trim()
    return texto ? [{ texto, estado }] : []
  })
}

/** Plan de la tarea: etapas hechas, la que está en curso y las pendientes. */
function PlanVista({ etapas }: { etapas: Etapa[] }) {
  const hechas = etapas.filter((x) => x.estado === 'completed').length
  return (
    <div className="ag-plan" role="group" aria-label="Plan de la tarea">
      <div className="ag-plan-cab">
        <strong>Plan</strong>
        <span className="chip">
          {hechas} de {etapas.length}
        </span>
        <progress value={hechas} max={etapas.length} aria-label="Progreso del plan" />
      </div>
      <ol>
        {etapas.map((x, i) => (
          <li key={i} className={x.estado}>
            <span className="ag-plan-marca" aria-hidden="true">
              {x.estado === 'completed' ? '✓' : x.estado === 'in_progress' ? '▸' : '○'}
            </span>
            <span>{x.texto}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Convierte los eventos de un turno en elementos visibles (une el inicio y el fin de cada herramienta). */
function Linea({ e, todos }: { e: EventoAgente; todos: EventoAgente[] }) {
  const sangria = { marginLeft: Math.min(e.profundidad, 3) * 14 }
  switch (e.tipo) {
    case 'ruta':
      return (
        <div className="ag-chips">
          <span className="chip">modelo {e.modelo}</span>
          <span className="chip">complejidad {e.complejidad}</span>
          <span className="chip" title="Señales que usó el router">{e.razon}</span>
          {e.sugerirFlujo && <span className="chip chip-aviso">conviene el flujo con plan y aprobación</span>}
        </div>
      )
    case 'flujo_nodo':
      return <div className="ag-nodo">{NODOS[e.nodo] ?? e.nodo}{e.intento > 1 ? ` · intento ${e.intento}` : ''}</div>
    case 'texto':
      return (
        <div className="ag-burbuja" style={sangria}>
          <div className="ag-quien">{e.agente}</div>
          <div className="ag-texto">{e.texto}</div>
        </div>
      )
    case 'herramienta_inicio': {
      if (e.llamada.nombre === 'TodoWrite') {
        // El plan se pinta una vez por turno, con su estado más reciente (cada llamada trae la lista completa).
        const ultimo = todos.filter((x) => x.tipo === 'herramienta_inicio' && x.llamada.nombre === 'TodoWrite').at(-1)
        const etapas = ultimo === e ? etapasDe(e.llamada.entrada) : []
        return etapas.length ? <PlanVista etapas={etapas} /> : null
      }
      const fin = todos.find((x): x is Extract<EventoAgente, { tipo: 'herramienta_fin' }> => x.tipo === 'herramienta_fin' && x.llamada.id === e.llamada.id)
      return (
        <details className={`ag-herramienta${fin?.resultado.error ? ' error' : ''}`} style={sangria}>
          <summary>
            <span className="ag-estado">{fin ? (fin.resultado.error ? '✗' : '✓') : '…'}</span>
            <strong>{e.llamada.nombre}</strong>
            <code>{resumirEntrada(e.llamada.entrada)}</code>
          </summary>
          <pre>{fin ? fin.resultado.texto : 'ejecutando…'}</pre>
        </details>
      )
    }
    case 'a2a':
      return (
        <div className="ag-a2a" style={sangria}>
          <strong>{e.de}</strong> → <strong>{e.a}</strong> <span>({e.fase})</span>
          <div>{e.texto.length > 300 ? e.texto.slice(0, 300) + '…' : e.texto}</div>
        </div>
      )
    case 'guardrail':
      return <div className="ag-guardrail">🛡 Guardrail bloqueó «{e.herramienta}»: {e.motivo}</div>
    case 'solicitud_humana':
      return <div className="ag-nota">Esperando tu confirmación: {e.clase === 'plan' ? 'plan' : e.clase === 'confirmacion' ? 'resultado' : e.clase === 'pregunta' ? 'una respuesta tuya' : e.herramienta}</div>
    case 'worktree':
      return (
        <div className="ag-worktree">
          ⎇ <strong>{e.accion}</strong> <code>{e.rama}</code>
          {e.detalle && <span> — {e.detalle}</span>}
        </div>
      )
    case 'contexto':
      return <div className="ag-nota">Contexto comprimido ({e.estrategia}){e.tokensAntes > 0 ? `: ${e.tokensAntes}${e.tokensDespues > 0 ? ` → ${e.tokensDespues}` : ''} tokens` : ''}</div>
    case 'cuenta_cambiada':
      return (
        <div className="ag-nota">
          Límite de uso alcanzado en «{e.de}»{e.hasta ? ` (se renueva ${new Date(e.hasta).toLocaleString()})` : ''}. {e.continua ? `Sigo la tarea con «${e.a}» desde donde quedó, sin repetir lo ya hecho.` : `Continúo con «${e.a}».`}
        </div>
      )
    case 'contexto_compactado':
      return (
        <div className="ag-nota">
          ♻ Conversación continuada en una sesión nueva con un resumen
          {e.motivo === 'contexto' ? ` (el contexto llegó a ${Math.round(e.tokensAntes / 1000)} k tokens)` : e.motivo === 'imagenes' ? ` (había ${e.imagenes} imágenes en el contexto)` : e.motivo === 'modelo' ? ' (cambiaste de modelo: la caché del contexto es por modelo)' : e.motivo === 'cuenta' ? ' (cambiaste de cuenta: la caché del contexto es por cuenta)' : ' (la caché del contexto caducó tras un rato sin usarla)'}
          {e.conModelo ? '' : ' — resumen básico: el modelo no respondió'}. Así cada mensaje gasta muchos menos tokens.
        </div>
      )
    case 'aviso_consumo':
      return (
        <div className="ag-nota">
          ⚠ {e.motivo === 'contexto' ? `El contexto de esta conversación ya es grande (${Math.round((e.tokens ?? 0) / 1000)} k tokens) y se reenvía en cada mensaje.` : `Esta respuesta consumió ${(e.costo ?? 0).toFixed(2)} USD a precio de lista.`}{' '}
          Si cambias de tema, abre una conversación nueva.
        </div>
      )
    case 'aprobacion_automatica':
      return <div className="ag-nota">✓ {e.clase === 'plan' ? 'Plan' : 'Acción'} aprobado automáticamente ({e.motivo})</div>
    case 'continuacion_automatica':
      return (
        <div className="ag-nota">
          ↻ Topó el límite de pasos de una sola respuesta; sigue sola (ronda {e.ronda} de {e.max}).
        </div>
      )
    case 'comando_salida':
      return (
        <details className={`ag-herramienta${e.ok ? '' : ' error'}`} open>
          <summary>
            <span className="ag-estado">{e.ok ? '✓' : '✗'}</span>
            <strong>/{e.nombre}</strong>
            <code>{e.linea}</code>
            <span className="chip">{e.duracionMs} ms</span>
          </summary>
          <pre>{e.salida}</pre>
        </details>
      )
    case 'flujo_fin':
      return <div className={`ag-final ${e.estado === 'completado' ? 'ok' : 'mal'}`}>Flujo {e.estado}: {e.resumen}</div>
    case 'fin':
      return e.profundidad === 0 ? (
        <div className="ag-uso">
          {e.agente} · {e.resultado.pasos} pasos · {e.resultado.uso.tokensEntrada + e.resultado.uso.tokensSalida} tokens
        </div>
      ) : null
    default:
      return null
  }
}

const HERRAMIENTAS_QUE_EDITAN = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Lo ya ocurrido en un turno. Memoizado: mientras el modelo escribe, cada trozo de texto cambia solo `parcial` (la lista
 * `eventos` es la misma), así que no se vuelven a pintar las herramientas y burbujas anteriores.
 */
const EventosTurno = memo(function EventosTurno({ eventos }: { eventos: EventoAgente[] }) {
  return (
    <>
      {eventos.map((e, i) => (
        <Linea key={i} e={e} todos={eventos} />
      ))}
    </>
  )
})

/** Memoizado: un turno terminado no se repinta cuando otro recibe texto (los manejadores son estables y reciben el turno). */
const TurnoVista = memo(function TurnoVista({ t, onCancelar, onDeshacer }: { t: Turno; onCancelar: (t: Turno) => void; onDeshacer: (t: Turno) => void }) {
  const editoArchivos = t.estado !== 'en_curso' && !t.lateral && Boolean(t.mensajeId) && t.eventos.some((e) => e.tipo === 'herramienta_inicio' && HERRAMIENTAS_QUE_EDITAN.has(e.llamada.nombre))
  return (
    <article className="ag-turno">
      <div className="ag-usuario">
        <div className="ag-quien">
          Tú · {t.destino} {t.lateral && <span className="chip" title="Respondida aparte: la tarea principal sigue su curso">pregunta lateral</span>} {t.modo !== 'chat' && t.modo !== 'comando' && <span className="chip">{t.modo === 'flujo' ? 'flujo de desarrollo' : 'grupo (A2A)'}</span>}
          {t.autonomia && <span className="chip chip-aviso" title="Se ejecutó con menos confirmaciones">{t.autonomia === 'autonomo' ? 'autónomo' : 'acepta ediciones'}</span>}
        </div>
        <div className="ag-texto">{t.prompt}</div>
        {t.adjuntos && <AdjuntosAgente adjuntos={t.adjuntos} />}
      </div>
      <EventosTurno eventos={t.eventos} />
      {t.parcial && (
        <div className="ag-burbuja parcial">
          <div className="ag-quien">{t.raiz}</div>
          <div className="ag-texto">{t.parcial}</div>
        </div>
      )}
      {t.error && <div className={`ag-final ${t.estado === 'limite_pasos' || t.estado === 'cancelado' ? 'aviso' : 'mal'}`}>{t.error}</div>}
      <div className="ag-pie">
        <span className={`chip estado-${t.estado}`}>{ESTADO[t.estado]}</span>
        {t.estado === 'en_curso' && (
          <button onClick={() => onCancelar(t)} disabled={!t.ejecucionId}>
            Cancelar
          </button>
        )}
        {editoArchivos && (
          <button onClick={() => onDeshacer(t)} title="Devuelve los archivos a como estaban antes de este mensaje (y deshace lo de los siguientes)">
            ↩ Deshacer cambios
          </button>
        )}
      </div>
    </article>
  )
})

const IconoTraspaso = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="8" height="10" rx="2" />
    <path d="M14 9h7m-3-3 3 3-3 3" />
    <path d="M7 14v3a2 2 0 0 0 2 2h9" />
  </svg>
)

export function ChatAgente({ datos, agente, proyectoFijo }: Props) {
  const [destino, setDestino] = useState('')
  const [modo, setModo] = useState<'chat' | 'flujo'>('chat')
  const [aislado, setAislado] = useState(true)
  const [texto, setTexto] = useState('')
  const [verHistorial, setVerHistorial] = useState(false)
  const notificar = useNotificaciones()
  const [gestion, setGestion] = useState<'permisos' | 'comandos' | null>(null)
  const [comandos, setComandos] = useState<ComandoUsuario[]>([])
  const [seleccion, setSeleccion] = useState(0)
  const [sugOculta, setSugOculta] = useState(false)
  const [pendientes, setPendientes] = useState<Adjunto[]>([])
  const [subiendo, setSubiendo] = useState(0)
  const [errorAdjunto, setErrorAdjunto] = useState('')
  const [cola, setCola] = useState<{ prompt: string; adjuntos: Adjunto[] }[]>([]) // mensajes escritos mientras el agente trabaja
  const [arrastrando, setArrastrando] = useState(false)
  const areaTexto = useRef<HTMLTextAreaElement>(null)
  const [cursor, setCursor] = useState(0)
  const [archivosProyecto, setArchivosProyecto] = useState<string[] | null>(null) // para las menciones «@»
  const [mencionOculta, setMencionOculta] = useState(false)
  const [selMencion, setSelMencion] = useState(0)
  const [tareasChat, setTareasChat] = useState<Tarea[] | null>(null) // para «#» y el botón de tareas
  const [estadosTareas, setEstadosTareas] = useState<EstadoTarea[]>([])
  const [verTareas, setVerTareas] = useState(false)
  const [mencionTareaOculta, setMencionTareaOculta] = useState(false)
  const [selTarea, setSelTarea] = useState(0)
  const cursorPendiente = useRef<number | null>(null)
  const selector = useRef<HTMLInputElement>(null)
  const modelos = useModelos()
  const { cuenta } = useCuenta()
  const conSuscripcion = cuenta?.proveedor === 'suscripcion'
  // Modelo y autonomía por proyecto: viven en la cuenta (`ajustes/<proyecto>.json`, se sincronizan con tus demás equipos).
  const claveAjustes = proyectoFijo?.id ?? 'global'
  const [modeloSel, setModeloSel] = useState<string>('auto')
  const [autonomia, setAutonomiaEstado] = useState<ModoAutonomia>('preguntar')
  const [esfuerzo, setEsfuerzoEstado] = useState<Esfuerzo | 'auto'>('auto')
  const versionAjustes = useRef(0) // sube con cada cambio hecho aquí: una lectura que empezó antes se descarta
  const releerAjustes = useRef<() => Promise<void>>(async () => undefined)
  useEffect(() => {
    let vigente = true
    const leer = async (migrar: boolean): Promise<void> => {
      const version = versionAjustes.current
      let a = await window.api.ajustes.leer(claveAjustes).catch(() => ({}) as AjustesAsistente)
      if (migrar && a.modelo === undefined && a.autonomia === undefined) a = await migrarAjustesLocales(claveAjustes, a)
      if (!vigente || version !== versionAjustes.current) return
      setModeloSel(a.modelo ?? 'auto')
      setAutonomiaEstado(a.autonomia ?? 'preguntar')
      setEsfuerzoEstado(a.esfuerzo ?? 'auto')
    }
    releerAjustes.current = () => leer(false)
    void leer(true)
    const alVolver = (): void => void leer(false)
    window.addEventListener('focus', alVolver)
    const cada = window.setInterval(alVolver, 20_000)
    return () => {
      vigente = false
      window.removeEventListener('focus', alVolver)
      clearInterval(cada)
    }
  }, [claveAjustes])
  // Un modelo recordado que ya no está disponible vuelve al modo automático.
  useEffect(() => {
    if (modeloSel !== 'auto' && modelos.length > 0 && !modelos.some((m) => m.id === modeloSel)) setModeloSel('auto')
  }, [modelos, modeloSel])
  const cambiarModelo = (id: string): void => {
    versionAjustes.current++
    setModeloSel(id)
    // Al terminar de guardar se vuelve a subir la versión: una lectura que empezó mientras se guardaba trae el valor viejo y se descarta.
    void window.api.ajustes.fijar(claveAjustes, { modelo: id === 'auto' ? null : id }).catch(() => undefined).finally(() => void versionAjustes.current++)
  }
  const cambiarAutonomia = async (nuevo: ModoAutonomia): Promise<void> => {
    if (nuevo === 'autonomo' && !(await confirmar({ titulo: 'Activar el modo autónomo', tono: 'aviso', etiqueta: 'Activar', texto: 'El agente escribirá archivos, ejecutará typecheck, lint y pruebas, y (en el Flujo) aprobará el plan sin preguntarte, con un límite de tokens.\n\nSeguirá pidiendo confirmación para lo destructivo (borrar, git push…), para comandos desconocidos y para aceptar el resultado del Flujo.\n\nLo más seguro es usarlo con el Flujo aislado en una rama.\n\nEste modo solo vale en este equipo: no se sincroniza con tu cuenta.' }))) return
    versionAjustes.current++
    setAutonomiaEstado(nuevo)
    void window.api.ajustes.fijar(claveAjustes, { autonomia: nuevo }).catch(() => undefined).finally(() => void versionAjustes.current++)
  }
  const cambiarEsfuerzo = (nuevo: Esfuerzo | 'auto'): void => {
    versionAjustes.current++
    setEsfuerzoEstado(nuevo)
    void window.api.ajustes.fijar(claveAjustes, { esfuerzo: nuevo === 'auto' ? null : nuevo }).catch(() => undefined).finally(() => void versionAjustes.current++)
  }
  // Uso real del contexto (lo informa el CLI mientras su proceso sigue vivo): se pide al terminar cada respuesta.
  const [detalleCtx, setDetalleCtx] = useState<ContextoUso | undefined>()
  const sesionActual = agente.sesionId
  const tokensCtx = agente.contexto?.tokens
  useEffect(() => {
    if (!sesionActual || agente.enCurso) return
    let vigente = true
    void window.api.core.contextoUso(sesionActual).then((d) => vigente && setDetalleCtx(d), () => undefined)
    return () => {
      vigente = false
    }
  }, [sesionActual, agente.enCurso, tokensCtx])
  useEffect(() => setDetalleCtx(undefined), [sesionActual])
  /** Deshace los cambios de archivos de la IA desde un turno: primero dice cuáles, y solo si el usuario acepta, los restaura. */
  const deshacer = async (t: Turno): Promise<void> => {
    if (!sesionActual || !t.mensajeId) return
    try {
      const previo = await window.api.core.rebobinar(sesionActual, t.mensajeId, true)
      if (!previo.puede) return agente.avisar('Deshacer cambios', previo.error ?? 'No hay un punto de control para ese mensaje.', t.destino)
      if (previo.archivos.length === 0) return agente.avisar('Deshacer cambios', 'Ese mensaje y los siguientes no cambiaron ningún archivo con las herramientas de edición.', t.destino)
      const nombres = previo.archivos.slice(0, 12).map((a) => `• ${a.split(/[\\/]/).slice(-3).join('/')}`).join('\n')
      if (!(await confirmar({ titulo: 'Deshacer cambios de archivos', tono: 'aviso', etiqueta: 'Deshacer', texto: `Estos archivos volverán a como estaban antes de este mensaje (también se deshace lo de los mensajes posteriores):\n\n${nombres}${previo.archivos.length > 12 ? `\n… y ${previo.archivos.length - 12} más` : ''}\n\nLos archivos creados después se borran. No cubre lo que se hizo con comandos de terminal.` }))) return
      const r = await window.api.core.rebobinar(sesionActual, t.mensajeId, false)
      if (!r.puede) agente.avisar('Deshacer cambios', r.error ?? 'No se pudo deshacer.', t.destino)
    } catch (err) {
      agente.avisar('Deshacer cambios', (err as Error).message, t.destino)
    }
  }
  // Manejadores estables para `TurnoVista` (memoizado): siempre llaman a la versión más reciente.
  const accionesTurno = useRef({ cancelar: (t: Turno): void => void agente.cancelar(t), deshacer })
  useEffect(() => {
    accionesTurno.current = { cancelar: (t) => void agente.cancelar(t), deshacer }
  })
  const cancelarTurno = useCallback((t: Turno): void => accionesTurno.current.cancelar(t), [])
  const deshacerTurno = useCallback((t: Turno): void => void accionesTurno.current.deshacer(t), [])
  const fin = useRef<HTMLDivElement>(null)

  const grupoSeleccionado = !proyectoFijo && destino.startsWith('g:')
  const proyecto = proyectoFijo ?? (destino.startsWith('p:') ? datos?.proyectos.find((p) => p.id === destino.slice(2)) : undefined)
  const etiqueta = useMemo(() => {
    if (grupoSeleccionado) return datos?.grupos.find((g) => g.id === destino.slice(2))?.nombre ?? 'grupo'
    return proyecto?.nombre ?? 'sin proyecto'
  }, [datos?.grupos, destino, grupoSeleccionado, proyecto])

  // Auto-scroll solo si el usuario está pegado al final; si subió, se respeta su posición.
  const hilo = useRef<HTMLDivElement>(null)
  const pegado = useRef(true)
  const nTurnos = useRef(0)
  const [verBajar, setVerBajar] = useState(false)

  const alScroll = () => {
    const el = hilo.current
    if (!el) return
    const cerca = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    pegado.current = cerca
    setVerBajar(!cerca)
  }

  const irAbajo = () => {
    pegado.current = true
    setVerBajar(false)
    // Salto inmediato: un desplazamiento suave se queda corto mientras sigue llegando texto y sus eventos de scroll lo «despegan» otra vez.
    if (hilo.current) hilo.current.scrollTop = hilo.current.scrollHeight
  }

  useEffect(() => {
    const el = hilo.current
    if (!el) return
    // Un turno nuevo (p. ej. el usuario envía) vuelve a pegar al final.
    if (agente.turnos.length > nTurnos.current) pegado.current = true
    nTurnos.current = agente.turnos.length
    if (pegado.current) el.scrollTop = el.scrollHeight
  }, [agente.turnos])

  useEffect(() => {
    if (modo === 'flujo' && (!proyecto || conSuscripcion)) setModo('chat')
  }, [modo, proyecto, conSuscripcion])

  // Comandos propios del proyecto (más globales) para el autocompletado y la ejecución de `/nombre`.
  useEffect(() => {
    if (gestion === null) void window.api.core.comandosEfectivos(proyecto?.id).then(setComandos).catch(() => setComandos([]))
  }, [proyecto?.id, gestion])

  const sugerencias = useMemo(() => {
    const m = /^\/([a-z0-9_-]*)$/.exec(texto)
    if (!m || sugOculta) return []
    return [
      ...COMANDOS_INCLUIDOS.map((c) => ({ nombre: c.nombre, uso: c.uso as string, descripcion: c.descripcion as string, propio: false, oficial: false })),
      // Los oficiales de Claude Code que pasan por su CLI solo funcionan con la suscripción.
      ...COMANDOS_CLAUDE.filter((c) => c.ejecuta === 'app' || conSuscripcion).map((c) => ({ nombre: c.nombre, uso: c.uso, descripcion: c.descripcion, propio: false, oficial: true })),
      ...comandos.map((c) => ({ nombre: c.nombre, uso: `/${c.nombre}${c.tipo === 'ejecutable' && c.argumentos ? ' <argumentos>' : c.tipo === 'prompt' ? ' [texto]' : ''}`, descripcion: c.descripcion, propio: true, oficial: false }))
    ].filter((c) => c.nombre.startsWith(m[1]!))
  }, [texto, comandos, sugOculta, conSuscripcion])

  // Menciones «@archivo»: solo con un proyecto elegido. La lista de archivos se pide al empezar a escribir la mención.
  const mencion = useMemo(() => (proyecto && !mencionOculta ? detectarMencion(texto, cursor) : null), [proyecto, mencionOculta, texto, cursor])
  const abierta = mencion !== null
  const proyectoId = proyecto?.id
  useEffect(() => {
    if (!abierta || !proyectoId) return
    let vigente = true
    void window.api.archivos.listarTodos(proyectoId).then((r) => vigente && setArchivosProyecto(r)).catch(() => vigente && setArchivosProyecto([]))
    return () => {
      vigente = false
      setArchivosProyecto(null)
    }
  }, [abierta, proyectoId])
  const opciones = useMemo(() => (mencion && archivosProyecto ? opcionesMencion(archivosProyecto, mencion.consulta) : []), [mencion, archivosProyecto])
  const elegirMencion = (i: number): void => {
    const o = opciones[i]
    if (!mencion || !o) return
    const r = aplicarMencion(texto, cursor, mencion, o.ruta, o.carpeta)
    cursorPendiente.current = r.cursor
    setTexto(r.texto)
    setCursor(r.cursor)
    setSelMencion(0)
  }
  // Tareas «#N»: las abiertas del proyecto y las sueltas de su grupo. Al nombrarlas, el núcleo manda su ficha completa a la IA.
  const mencionTarea = useMemo(() => (proyecto && !mencionTareaOculta && !abierta ? detectarMencionTarea(texto, cursor) : null), [proyecto, mencionTareaOculta, abierta, texto, cursor])
  const necesitaTareas = !!proyectoId && (verTareas || mencionTarea !== null)
  useEffect(() => {
    if (!necesitaTareas || !proyectoId) return
    let vigente = true
    const cargar = (): void =>
      void Promise.all([window.api.tareas.operar('paraAsistente', { proyectoId }), window.api.tareas.operar('estados', {})])
        .then(([t, e]) => vigente && (setTareasChat(t), setEstadosTareas(e)))
        .catch(() => vigente && setTareasChat([]))
    cargar()
    const quitar = window.api.tareas.onCambio(cargar)
    return () => {
      vigente = false
      quitar()
      setTareasChat(null)
    }
  }, [necesitaTareas, proyectoId])
  const opcionesTareas = useMemo(() => (mencionTarea && tareasChat ? opcionesTarea(tareasChat, mencionTarea.consulta) : []), [mencionTarea, tareasChat])
  const elegirTarea = (i: number): void => {
    const t = opcionesTareas[i]
    if (!mencionTarea || !t) return
    const r = aplicarMencionTarea(texto, cursor, mencionTarea, t)
    cursorPendiente.current = r.cursor
    setTexto(r.texto)
    setCursor(r.cursor)
    setSelTarea(0)
  }
  const nombreEstadoTarea = (id: string): string => estadosTareas.find((e) => e.id === id)?.nombre ?? id
  /** Desde el panel de tareas: «Mencionar» añade «#N» donde está el cursor; «Implementar» deja escrita la petición completa. */
  const insertarTarea = (t: Tarea, implementar: boolean): void => {
    setVerTareas(false)
    if (implementar) {
      const nuevo = pedirImplementar(t)
      cursorPendiente.current = nuevo.length
      setTexto(nuevo)
      setCursor(nuevo.length)
      return
    }
    const antes = texto.slice(0, cursor)
    const insertado = `${antes && !/\s$/.test(antes) ? ' ' : ''}#${t.numero} `
    const nuevo = antes + insertado + texto.slice(cursor)
    cursorPendiente.current = antes.length + insertado.length
    setTexto(nuevo)
    setCursor(antes.length + insertado.length)
  }

  // Dictado por voz: la transcripción literal queda en el campo, donde estaba el cursor, para editarla. Nunca se envía solo.
  const voz = useGrabadora((d) => {
    const pos = Math.min(cursor, texto.length)
    const antes = texto.slice(0, pos)
    const despues = texto.slice(pos)
    const prefijo = antes && !/\s$/.test(antes) ? ' ' : ''
    const sufijo = despues && !/^\s/.test(despues) ? ' ' : ''
    const nuevo = antes + prefijo + d.texto + sufijo + despues
    cursorPendiente.current = antes.length + prefijo.length + d.texto.length
    setTexto(nuevo)
    setCursor(cursorPendiente.current)
  })
  // Tras insertar, el cursor se coloca después de lo insertado (el texto del campo se actualiza en el siguiente render).
  useEffect(() => {
    if (cursorPendiente.current === null) return
    areaTexto.current?.setSelectionRange(cursorPendiente.current, cursorPendiente.current)
    areaTexto.current?.focus()
    cursorPendiente.current = null
  }, [texto])

  /** Sube los archivos (imágenes, PDFs, texto) al almacén; el proceso principal los valida por su contenido. */
  const subir = async (archivos: File[]): Promise<void> => {
    if (archivos.length === 0) return
    setErrorAdjunto('')
    try {
      if (!localStorage.getItem('asistente:aviso-adjuntos')) {
        if (!(await confirmar({ titulo: 'Adjuntar archivos', tono: 'info', etiqueta: 'Entendido, continuar', texto: 'Los archivos que adjuntes se envían a la API de Anthropic junto con tu mensaje.\n\nNo se puede detectar si una imagen o un PDF contienen credenciales: no adjuntes nada confidencial.' }))) return
        localStorage.setItem('asistente:aviso-adjuntos', '1')
      }
    } catch {
      /* sin almacenamiento: se avisará de nuevo la próxima vez */
    }
    const errores: string[] = []
    let hueco = LIMITES_ADJUNTOS.porMensaje - pendientes.length
    for (const f of archivos) {
      if (hueco <= 0) {
        errores.push(`Máximo ${LIMITES_ADJUNTOS.porMensaje} archivos por mensaje`)
        break
      }
      setSubiendo((n) => n + 1)
      try {
        const a = await window.api.core.adjuntoSubir(f.name || 'captura.png', new Uint8Array(await f.arrayBuffer()))
        setPendientes((p) => [...p, a])
        hueco--
      } catch (err) {
        errores.push((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      } finally {
        setSubiendo((n) => n - 1)
      }
    }
    if (errores.length) setErrorAdjunto([...new Set(errores)].join(' · '))
  }
  const quitar = (a: Adjunto): void => {
    setPendientes((p) => p.filter((x) => x.id !== a.id))
    void window.api.core.adjuntoEliminar(a.id)
  }

  const lanzar = (prompt: string, forzarFlujo = false, adjuntos: Adjunto[] = pendientes): void => {
    if (adjuntos === pendientes) {
      setPendientes([])
      setErrorAdjunto('')
    }
    void agente.enviar({
      ...(adjuntos.length ? { adjuntos } : {}),
      destino: etiqueta,
      solicitud: {
        prompt,
        ...(proyecto ? { proyectoId: proyecto.id } : {}),
        ...(grupoSeleccionado ? { grupoId: destino.slice(2) } : {}),
        ...(autonomia !== 'preguntar' ? { autonomia } : {}),
        ...(modeloSel !== 'auto' ? { modelo: modeloSel } : {}),
        ...(esfuerzo !== 'auto' ? { esfuerzo } : {}),
        ...(modo === 'flujo' || forzarFlujo ? { modo: 'flujo' as const, aislado } : {})
      }
    })
  }

  /** `/comando argumentos`: comandos de la aplicación y comandos propios. */
  const comandoSlash = (linea: string): void => {
    const m = /^\/([a-z0-9_-]+)\s*([\s\S]*)$/i.exec(linea)
    const nombre = m?.[1]?.toLowerCase() ?? ''
    const resto = (m?.[2] ?? '').trim()
    const aviso = (mensaje: string): void => agente.avisar(linea, mensaje, etiqueta)
    switch (nombre) {
      case 'flujo':
        if (!proyecto) return aviso('El flujo necesita un proyecto: abre el asistente desde la celda de un proyecto o elígelo en el selector.')
        if (!resto) return aviso('Uso: /flujo <petición>')
        return lanzar(resto, true)
      case 'plan':
        if (!proyecto) return aviso('El plan necesita un proyecto: abre el asistente desde la celda de un proyecto o elígelo en el selector.')
        if (!resto) return aviso('Uso: /plan <funcionalidad>')
        return lanzar(expandirPlantilla(PLANTILLAS_INCLUIDAS.plan!, resto))
      case 'tareas':
        if (!proyecto) return aviso('Elige un proyecto para revisar sus tareas.')
        return lanzar(PLANTILLAS_INCLUIDAS.tareas!)
      case 'chat':
        return setModo('chat')
      case 'modo':
        if (resto === 'preguntar' || resto === 'ediciones' || resto === 'autonomo') return void cambiarAutonomia(resto)
        return aviso('Uso: /modo preguntar | ediciones | autonomo')
      case 'nueva':
        return void pedirNuevaConversacion()
      case 'historial':
        return setVerHistorial(true)
      case 'permisos':
      case 'comandos':
        return setGestion(nombre)
      case 'ayuda':
        setSugOculta(false)
        return setTexto('/')
    }
    const oficial = COMANDOS_CLAUDE.find((x) => x.nombre === nombre)
    if (oficial?.ejecuta === 'app') {
      if (nombre === 'help') {
        setSugOculta(false)
        return setTexto('/')
      }
      if (nombre === 'clear') return void pedirNuevaConversacion()
      return aviso('Aquí no hay nada que cerrar: usa ＋ para otra conversación o cierra la pestaña del asistente.')
    }
    if (oficial) {
      if (!conSuscripcion) return aviso(`«/${nombre}» es de Claude Code y se ejecuta con tu suscripción: cambia a «Suscripción» en la barra de cuenta.`)
      if (grupoSeleccionado) return aviso(`«/${nombre}» trabaja sobre un proyecto, no sobre un grupo: elige un proyecto.`)
      // Va tal cual al CLI (sin plantillas ni adjuntos delante) y se muestra lo que responde.
      return void agente.enviar({
        destino: etiqueta,
        solicitud: { prompt: linea, ...(proyecto ? { proyectoId: proyecto.id } : {}), ...(autonomia !== 'preguntar' ? { autonomia } : {}), ...(modeloSel !== 'auto' ? { modelo: modeloSel } : {}), ...(esfuerzo !== 'auto' ? { esfuerzo } : {}) }
      })
    }
    if (NOMBRES_CLAUDE_CODE.has(nombre)) return aviso(`«/${nombre}» es un comando de Claude Code que necesita su terminal interactiva y no está disponible en el Asistente. Puedes usarlo en una terminal con Claude Code.`)
    if (PLANTILLAS_INCLUIDAS[nombre]) {
      if (!proyecto) return aviso(`«/${nombre}» trabaja sobre un proyecto: abre el asistente desde la celda de un proyecto o elígelo en el selector.`)
      return lanzar(expandirPlantilla(PLANTILLAS_INCLUIDAS[nombre]!, resto))
    }
    const c = comandos.find((x) => x.nombre === nombre)
    if (!c) return aviso(`No existe el comando «/${nombre}». Escribe /ayuda para ver la lista, o créalo con /comandos.`)
    if (c.tipo === 'prompt') return lanzar(expandirPlantilla(c.plantilla ?? '', resto))
    if (!proyecto) return aviso(`«/${nombre}» se ejecuta en un proyecto: elige uno primero.`)
    void agente.ejecutarComando({ proyectoId: proyecto.id, nombre, argumentos: resto, destino: etiqueta })
  }

  const enviar = (): void => {
    const prompt = texto.trim() || (pendientes.length ? 'Revisa los archivos adjuntos.' : '')
    if (!prompt || subiendo > 0) return
    setTexto('')
    if (agente.enCurso) {
      // El agente está trabajando: el mensaje espera su turno y se envía solo al terminar.
      setCola((c) => [...c, { prompt, adjuntos: pendientes }])
      setPendientes([])
      return
    }
    if (prompt.startsWith('/')) return comandoSlash(prompt)
    lanzar(prompt)
  }

  // Mensajes de otro asistente por MCP (`asistente_enviar`): entran como si los hubiera escrito la persona (sin comandos `/`, para que no
  // cambien ajustes) y, si el Asistente está ocupado, a la cola. Solo en la celda de un proyecto.
  const recibirExternos = useRef<() => void>(() => undefined)
  recibirExternos.current = () => {
    if (!proyectoFijo) return
    const l = tomarExternos(proyectoFijo.id)
    if (!l.length) return
    const primero = agente.enCurso ? undefined : l.shift()
    if (l.length) setCola((c) => [...c, ...l.map((prompt) => ({ prompt, adjuntos: [] as Adjunto[] }))])
    if (primero) lanzar(primero, false, [])
  }
  // Antes de enviarlos se releen los ajustes del proyecto (otro asistente pudo cambiarlos con ajustes_fijar, y al montar la celda aún no
  // han cargado): el envío espera a que se pinten con ellos (`turnoExterno`), para que `lanzar` use el modelo y la autonomía correctos.
  const [turnoExterno, setTurnoExterno] = useState(0)
  useEffect(() => {
    if (turnoExterno) recibirExternos.current()
  }, [turnoExterno])
  useEffect(() => {
    if (!proyectoFijo) return
    const preparar = (): void => void releerAjustes.current().finally(() => setTurnoExterno((n) => n + 1))
    preparar()
    return alExterno((id) => id === proyectoFijo.id && preparar())
  }, [proyectoFijo?.id])

  /** Responde ya, en paralelo, sin interrumpir la tarea en marcha (a diferencia de «Encolar», que espera a que termine). */
  const preguntarAhora = (): void => {
    const prompt = texto.trim()
    if (!prompt || prompt.startsWith('/')) return
    setTexto('')
    void agente.preguntarAhora(prompt, etiqueta, proyecto?.id).then((ok) => {
      // Nada consultable (p. ej. un flujo, o acabó justo ahora): se encola como un mensaje normal, nunca en paralelo.
      if (!ok) setCola((c) => [...c, { prompt, adjuntos: [] }])
    })
  }

  const quitarDeCola = (i: number): void => {
    for (const a of cola[i]?.adjuntos ?? []) void window.api.core.adjuntoEliminar(a.id)
    setCola((c) => c.filter((_, j) => j !== i))
  }

  const despacharSiguiente = (): void => {
    const [sig, ...resto] = cola
    if (!sig) return
    setCola(resto)
    if (sig.prompt.startsWith('/')) return comandoSlash(sig.prompt)
    lanzar(sig.prompt, false, sig.adjuntos)
  }

  /** Empezar otra conversación pregunta cómo: en blanco o con el contexto compactado de la actual (que queda en el historial). */
  const [elegirNueva, setElegirNueva] = useState(false)
  const pedirNuevaConversacion = async (): Promise<void> => {
    if (agente.enCurso) return agente.avisar('/nueva', 'Espera a que termine la tarea en curso (o cancélala) para empezar una conversación nueva.', etiqueta)
    if (agente.turnos.length === 0) return
    setElegirNueva(true)
  }
  /** Nueva conversación que hereda lo importante de la actual (objetivo, decisiones, archivos, estado y pendientes). */
  const nuevaConContexto = async (): Promise<void> => {
    setElegirNueva(false)
    if (agente.enCurso) return agente.avisar('/nueva', 'Espera a que termine la tarea en curso (o cancélala) para pasar su contexto a una conversación nueva.', etiqueta)
    try {
      await agente.nuevaConContexto()
    } catch (err) {
      agente.avisar('/nueva', `No se pudo pasar el contexto: ${(err as Error).message}`, etiqueta)
    }
  }

  const completar = (nombre: string): void => {
    setTexto(`/${nombre} `)
    setSugOculta(true)
  }

  const actual = agente.turnos.filter((t) => !t.lateral).at(-1) // una pregunta lateral no decide si la cola avanza
  // Al terminar bien el turno en marcha, sale el siguiente de la cola. Si se canceló o falló, la cola espera a que el usuario decida.
  useEffect(() => {
    if (!agente.enCurso && cola.length > 0 && actual?.estado === 'completado') despacharSiguiente()
  })
  return (
    <div
      className={`ag-chat${arrastrando ? ' arrastrando' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setArrastrando(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault()
        setArrastrando(false)
        void subir([...e.dataTransfer.files])
      }}
    >
      {cuenta?.proveedor === 'suscripcion' && !cuenta.sesion && (
        <div className="ag-cuenta sin-sesion">
          <span className="ag-cuenta-estado">Sin sesión de Claude: configúrala en «Proveedores de IA».</span>
        </div>
      )}
      {proyecto && <BarraRama proyectoId={proyecto.id} ocupadoAgente={agente.enCurso} />}
      {arrastrando && <div className="ag-soltar">Suelta para adjuntar (imágenes, PDF o texto)</div>}
      {verHistorial && (
        <HistorialAgente
          {...(proyecto ? { proyectoId: proyecto.id } : {})}
          {...(agente.sesionId ? { activaId: agente.sesionId } : {})}
          deshabilitado={agente.enCurso}
          onAbrir={(id) => void agente.abrirSesion(id)}
          onBorrar={(id) => void agente.borrarSesion(id)}
          onCerrar={() => setVerHistorial(false)}
        />
      )}
      {gestion && <GestionProyecto {...(proyecto ? { proyectoId: proyecto.id, nombre: proyecto.nombre } : {})} inicial={gestion} onCerrar={() => setGestion(null)} />}
      {elegirNueva && (
        <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && setElegirNueva(false)} onKeyDown={(e) => e.key === 'Escape' && setElegirNueva(false)}>
          <div className="modal ag-nueva" role="dialog" aria-modal="true" aria-label="Nueva conversación">
            <h3>Nueva conversación</h3>
            <p className="ag-nueva-sub">La actual se guarda en el 🕘 Historial. ¿Cómo quieres empezar la nueva?</p>
            <div className="ag-nueva-opciones">
              <button className="ag-nueva-opcion recomendada" autoFocus onClick={() => void nuevaConContexto()} disabled={!agente.sesionId}>
                <span className="ag-nueva-icono"><IconoTraspaso /></span>
                <strong>Con el contexto</strong>
                <span>Se compacta lo importante (objetivo, decisiones, archivos, estado y pendientes) y la nueva lo hereda. Menos tokens, sin perder el hilo.</span>
              </button>
              <button
                className="ag-nueva-opcion"
                onClick={() => {
                  setElegirNueva(false)
                  agente.nuevaConversacion()
                }}
              >
                <span className="ag-nueva-icono"><IconoMas /></span>
                <strong>En blanco</strong>
                <span>Empieza de cero, sin nada de esta conversación.</span>
              </button>
            </div>
            <div className="cfg-acciones">
              <button onClick={() => setElegirNueva(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      <div
        className="ag-hilo"
        ref={hilo}
        onScroll={alScroll}
        onWheel={(e) => { if (e.deltaY < 0) pegado.current = false }}
      >
        {agente.herencia && agente.turnos.length === 0 && (
          <div className="ag-herencia">
            <div className="ag-herencia-cab">
              <span className="ag-herencia-icono" aria-hidden="true">⇢</span>
              <div>
                <strong>Contexto heredado</strong>
                <span>de «{agente.herencia.titulo}» · se enviará con tu primer mensaje{agente.herencia.conModelo ? '' : ' (resumen de respaldo: el modelo no respondió)'}</span>
              </div>
              <button className="ag-icono" onClick={agente.quitarHerencia} aria-label="Quitar contexto heredado" title="Quitar: empezar en blanco">
                <IconoCerrar />
              </button>
            </div>
            <details>
              <summary>Ver y editar el resumen</summary>
              <textarea className="ag-herencia-texto" rows={10} value={agente.herencia.resumen} onChange={(e) => agente.editarHerencia(e.target.value)} />
            </details>
          </div>
        )}
        {agente.turnos.length === 0 && !agente.herencia && (
          <EstadoVacio
            icono={<IconoChispa />}
            titulo="Asistente de desarrollo"
            texto="Elige un proyecto y pregunta. El router escoge el modelo según la complejidad; escribir archivos o ejecutar comandos siempre te pide confirmación. «Flujo» planifica, te pide aprobar el plan, genera en una rama aislada, verifica y te pide aceptar el resultado."
            pistas={['/plan <funcionalidad>', '/tareas', '/flujo <petición>', '/ayuda']}
          />
        )}
        {agente.turnos.map((t) => (
          <TurnoVista key={t.clave} t={t} onCancelar={cancelarTurno} onDeshacer={deshacerTurno} />
        ))}
        <div ref={fin} />
        {verBajar && (
          <button type="button" className="ag-ir-abajo" onClick={irAbajo} aria-label="Ir al final" title="Ir al final">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
        )}
      </div>
      <SolicitudesChat ejecuciones={agente.turnos.map((t) => t.ejecucionId)} />
      <div className="ag-compositor">
        <div className="ag-opciones">
          {!proyectoFijo && datos && (
            <select value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Destino">
              <option value="">Sin proyecto</option>
              {datos.proyectos.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.nombre}
                </option>
              ))}
              {datos.grupos.map((g) => (
                <option key={g.id} value={`g:${g.id}`}>
                  Grupo «{g.nombre}» (un agente por submódulo)
                </option>
              ))}
            </select>
          )}
          <div className="segmentado" role="group" aria-label="Modo">
            <button className={modo === 'chat' ? 'on' : ''} onClick={() => setModo('chat')}>
              Chat
            </button>
            <button className={modo === 'flujo' ? 'on' : ''} disabled={!proyecto || conSuscripcion} onClick={() => setModo('flujo')} title={conSuscripcion ? 'El flujo solo está disponible con la clave de API' : proyecto ? 'Plan → aprobación → generación → verificación → confirmación' : 'Elige un proyecto'}>
              Flujo
            </button>
          </div>
          <select
            className="ag-modelo"
            value={modeloSel}
            onChange={(e) => cambiarModelo(e.target.value)}
            aria-label="Modelo"
            title="Modelo que responde. En automático el router elige según la complejidad de cada petición."
          >
            <option value="auto">Modelo: automático</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
                {m.ventana ? ` · ${m.ventana >= 1_000_000 ? `${m.ventana / 1_000_000}M` : `${Math.round(m.ventana / 1000)}k`}` : ''}
              </option>
            ))}
          </select>
          <select
            className={`ag-autonomia ${autonomia}`}
            value={autonomia}
            onChange={(e) => void cambiarAutonomia(e.target.value as ModoAutonomia)}
            aria-label="Autonomía"
            title="Cuánto te pregunta el agente. Lo destructivo siempre pregunta."
          >
            <option value="preguntar">Preguntar todo</option>
            <option value="ediciones">Aceptar ediciones</option>
            <option value="autonomo">Autónomo</option>
          </select>
          <select
            className="ag-modelo"
            value={esfuerzo}
            onChange={(e) => cambiarEsfuerzo(e.target.value as Esfuerzo | 'auto')}
            aria-label="Esfuerzo de razonamiento"
            title="Cuánto piensa el modelo antes de responder (solo suscripción). Menos esfuerzo = respuestas más rápidas y menos tokens; más = mejor en problemas difíciles."
          >
            <option value="auto">Esfuerzo: automático</option>
            {ESFUERZOS_AJUSTE.map((x) => (
              <option key={x} value={x}>
                Esfuerzo: {{ low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' }[x]}
              </option>
            ))}
          </select>
          {modo === 'flujo' && (
            <label className="ag-check" title="Trabaja en un git worktree propio; tu árbol de trabajo no se toca">
              <input type="checkbox" checked={aislado} onChange={(e) => setAislado(e.target.checked)} /> Aislar en rama git
            </label>
          )}
          <span className="ag-espacio" />
          {proyecto && (
            <button className="ag-icono" onClick={() => setVerTareas((v) => !v)} aria-expanded={verTareas} aria-label="Tareas" title="Tareas del proyecto y su grupo: menciónalas o pide que el Asistente implemente una (también escribiendo «#»)">
              <IconoTareas />
            </button>
          )}
          <BotonMicrofono voz={voz} />
          <button className="ag-icono" onClick={() => selector.current?.click()} disabled={pendientes.length >= LIMITES_ADJUNTOS.porMensaje} title="Adjuntar imágenes, PDF o archivos de texto (también puedes pegarlos o arrastrarlos)" aria-label="Adjuntar archivos">
            <IconoClip />
          </button>
          <button
            className={`ag-icono${notificar ? '' : ' apagado'}`}
            onClick={() => fijarNotificaciones(!notificar)}
            aria-pressed={notificar}
            aria-label="Notificaciones"
            title={notificar ? 'Notificaciones activadas: te aviso cuando el Asistente termina de responder (si no estás mirando el chat). Pulsa para desactivarlas.' : 'Notificaciones desactivadas. Pulsa para que te avise cuando el Asistente termine de responder.'}
          >
            {notificar ? <IconoCampana /> : <IconoCampanaTachada />}
          </button>
          <button className="ag-icono" onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial} aria-label="Historial" title="Historial: conversaciones guardadas">
            <IconoReloj />
          </button>
          <button
            className={`ag-icono${agente.traspasando ? ' girando' : ''}`}
            onClick={() => void nuevaConContexto()}
            disabled={agente.enCurso || agente.traspasando || !agente.sesionId || agente.turnos.length === 0}
            aria-label="Nueva conversación con contexto"
            title={agente.traspasando ? 'Compactando el contexto…' : 'Nueva conversación con contexto: resume lo importante de esta y empieza otra que lo hereda (esta queda en el historial)'}
          >
            {agente.traspasando ? <span className="ag-giro" aria-hidden="true" /> : <IconoTraspaso />}
          </button>
          <button className="ag-icono" onClick={() => void pedirNuevaConversacion()} disabled={agente.enCurso || agente.turnos.length === 0} aria-label="Nueva conversación" title="Nueva conversación: la actual queda guardada en el historial">
            <IconoMas />
          </button>
          <input
            ref={selector}
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yml,.yaml,.toml,.xml,.html,.css,.sql,.log,.sh,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.go,.rs,.java,.kt,.c,.h,.cpp,.hpp,.cs,.php,.rb,.swift,.vue,.svelte,.ini,.conf,.diff,.patch"
            onChange={(e) => {
              void subir([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>
        <AdjuntosAgente adjuntos={pendientes} onQuitar={quitar} />
        {subiendo > 0 && <div className="cfg-nota">Subiendo archivo…</div>}
        {errorAdjunto && <div className="cfg-error" role="alert">{errorAdjunto}</div>}
        <BarraGrabacion voz={voz} />
        <div className="ag-entrada">
          {sugerencias.length > 0 && (
            <div className="ag-sugerencias" role="listbox" aria-label="Comandos">
              {sugerencias.map((c, i) => (
                <button key={`${c.propio}-${c.oficial}-${c.nombre}`} role="option" aria-selected={i === seleccion} className={i === seleccion ? 'sel' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => completar(c.nombre)}>
                  <strong className={c.propio ? 'propio' : ''}>{c.uso}</strong>
                  {c.oficial && <span className="chip" title="Comando oficial de Claude Code">Claude Code</span>}
                  <small>{c.descripcion}</small>
                </button>
              ))}
            </div>
          )}
          {abierta && sugerencias.length === 0 && (archivosProyecto === null || opciones.length > 0) && (
            <div className="ag-sugerencias ag-menciones" role="listbox" aria-label="Archivos del proyecto">
              {archivosProyecto === null ? (
                <div className="ag-sug-vacio">Buscando archivos…</div>
              ) : (
                opciones.map((o, i) => {
                  const nombre = o.ruta.split('/').pop() ?? o.ruta
                  const dir = o.ruta.includes('/') ? o.ruta.slice(0, o.ruta.lastIndexOf('/')) : ''
                  return (
                    <button key={o.ruta + o.carpeta} role="option" aria-selected={i === selMencion} className={i === selMencion ? 'sel' : ''} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSelMencion(i)} onClick={() => elegirMencion(i)}>
                      <span className="ag-sug-ico" aria-hidden>{o.carpeta ? <IconoCarpeta /> : <IconoArchivo />}</span>
                      <strong>{nombre}{o.carpeta ? '/' : ''}</strong>
                      {dir && <small>{dir}/</small>}
                    </button>
                  )
                })
              )}
            </div>
          )}
          {mencionTarea && sugerencias.length === 0 && (tareasChat === null || opcionesTareas.length > 0) && (
            <div className="ag-sugerencias ag-menciones" role="listbox" aria-label="Tareas del proyecto">
              {tareasChat === null ? (
                <div className="ag-sug-vacio">Buscando tareas…</div>
              ) : (
                opcionesTareas.map((t, i) => (
                  <button key={t.id} role="option" aria-selected={i === selTarea} className={i === selTarea ? 'sel' : ''} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSelTarea(i)} onClick={() => elegirTarea(i)}>
                    <span className="ag-sug-ico tarea-num" aria-hidden>#{t.numero}</span>
                    <strong>{t.titulo}</strong>
                    <small>{nombreEstadoTarea(t.estado)} · {NOMBRE_PRIORIDAD[t.prioridad]}</small>
                  </button>
                ))
              )}
            </div>
          )}
          {verTareas && sugerencias.length === 0 && !mencionTarea && (
            <div className="ag-sugerencias ag-tareas" role="dialog" aria-label="Tareas para el Asistente">
              {tareasChat === null ? (
                <div className="ag-sug-vacio"><Cargando variante="enLinea" texto="Cargando tareas…" /></div>
              ) : tareasChat.length === 0 ? (
                <div className="ag-sug-vacio">No hay tareas abiertas en este proyecto ni en su grupo.</div>
              ) : (
                tareasChat.map((t) => (
                  <div key={t.id} className="ag-tarea-fila">
                    <button className="ag-tarea-ref" onMouseDown={(e) => e.preventDefault()} onClick={() => insertarTarea(t, false)} title="Mencionarla en el mensaje (la IA recibe su ficha completa)">
                      <span className="tarea-num">#{t.numero}</span>
                      <strong>{t.titulo}</strong>
                      <small>{nombreEstadoTarea(t.estado)} · {NOMBRE_PRIORIDAD[t.prioridad]}</small>
                    </button>
                    <button className="ag-tarea-hacer" onMouseDown={(e) => e.preventDefault()} onClick={() => insertarTarea(t, true)} title="Escribe la petición para que el Asistente la haga de principio a fin">
                      Implementar
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
          {cola.length > 0 && (
            <ul className="ag-cola" aria-label="Mensajes en cola">
              {cola.map((m, i) => (
                <li key={i}>
                  <span className="ag-cola-n">{i + 1}</span>
                  <span className="ag-cola-texto">{m.prompt}</span>
                  {m.adjuntos.length > 0 && <small>{m.adjuntos.length} archivo(s)</small>}
                  <button onClick={() => quitarDeCola(i)} aria-label="Quitar de la cola" title="Quitar de la cola">×</button>
                </li>
              ))}
              {!agente.enCurso && (
                <li className="ag-cola-pausa">
                  <span>Cola en pausa (el turno anterior no terminó bien).</span>
                  <button onClick={despacharSiguiente}>Enviar ahora</button>
                </li>
              )}
            </ul>
          )}
          <textarea
            ref={areaTexto}
            rows={2}
            value={texto}
            placeholder={pendientes.length > 0 ? 'Mensaje opcional: pulsa Enter para enviar solo los archivos…' : modo === 'flujo' ? 'Describe el cambio que quieres…' : 'Pregunta o pide algo…  (Ctrl+Enter envía · «/» comandos · «@» archivos · «#» tareas · pega o arrastra archivos)'}
            onPaste={(e) => {
              const archivos = [...e.clipboardData.files]
              if (archivos.length) {
                e.preventDefault()
                void subir(archivos)
              }
            }}
            onChange={(e) => {
              setTexto(e.target.value)
              setCursor(e.target.selectionStart)
              setSugOculta(false)
              setSeleccion(0)
              setMencionOculta(false)
              setSelMencion(0)
              setMencionTareaOculta(false)
              setSelTarea(0)
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (mencionTarea && opcionesTareas.length > 0 && sugerencias.length === 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  return setSelTarea((s) => (s + (e.key === 'ArrowDown' ? 1 : opcionesTareas.length - 1)) % opcionesTareas.length)
                }
                if ((e.key === 'Tab' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault()
                  return elegirTarea(Math.min(selTarea, opcionesTareas.length - 1))
                }
              }
              if (mencionTarea && e.key === 'Escape') return setMencionTareaOculta(true)
              if (verTareas && e.key === 'Escape') return setVerTareas(false)
              if (abierta && opciones.length > 0 && sugerencias.length === 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  return setSelMencion((s) => (s + (e.key === 'ArrowDown' ? 1 : opciones.length - 1)) % opciones.length)
                }
                if ((e.key === 'Tab' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault()
                  return elegirMencion(Math.min(selMencion, opciones.length - 1))
                }
              }
              if (abierta && e.key === 'Escape') return setMencionOculta(true)
              if (sugerencias.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  return setSeleccion((s) => (s + (e.key === 'ArrowDown' ? 1 : sugerencias.length - 1)) % sugerencias.length)
                }
                if ((e.key === 'Tab' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  return completar(sugerencias[Math.min(seleccion, sugerencias.length - 1)]!.nombre)
                }
                if (e.key === 'Escape') return setSugOculta(true)
              }
              // Con archivos adjuntos el mensaje es opcional: Enter (sin texto) los envía solos.
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !texto.trim() && pendientes.length > 0 && sugerencias.length === 0) {
                e.preventDefault()
                return enviar()
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                enviar()
              }
            }}
          />
          {agente.enCurso && (
            <button onClick={preguntarAhora} disabled={!texto.trim() || texto.trim().startsWith('/') || subiendo > 0} title="Responde ya, en paralelo y sin interrumpir lo que está haciendo (solo suscripción, en solo lectura)">
              Preguntar ahora
            </button>
          )}
          <button className="primario" onClick={enviar} disabled={(!texto.trim() && pendientes.length === 0) || subiendo > 0} title={agente.enCurso ? 'El agente está trabajando: el mensaje se enviará al terminar (o usa «Preguntar ahora»)' : undefined}>
            {agente.enCurso ? 'Encolar' : !texto.trim() && pendientes.length > 0 ? 'Enviar archivos' : 'Enviar'}
          </button>
        </div>
        <BarraUso {...(detalleCtx ? { detalle: detalleCtx } : {})} {...(agente.contexto ? { contexto: agente.contexto } : {})} {...(modeloSel !== 'auto' ? { modelo: modeloSel } : {})} modelos={modelos} tokensSesion={agente.tokensSesion} />
      </div>
    </div>
  )
}
