import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventoAgente } from '@shared/core/agente'
import { LIMITES_ADJUNTOS, type Adjunto } from '@shared/core/adjuntos'
import { COMANDOS_CLAUDE, COMANDOS_INCLUIDOS, NOMBRES_CLAUDE_CODE, PLANTILLAS_INCLUIDAS, expandirPlantilla, type ComandoUsuario } from '@shared/core/comandos'
import type { ModoAutonomia } from '@shared/core/permisos'
import type { DatosProyectos } from '@shared/modelos'
import type { Agente, Turno } from '../agente/useAgente'
import { useCuenta } from '../agente/cuenta'
import type { AjustesAsistente } from '@shared/ajustes'
import { useModelos } from '../agente/uso'
import { AdjuntosAgente } from './AdjuntosAgente'
import { BarraRama } from './BarraRama'
import { confirmar } from '../confirmar'
import { BarraUso } from './BarraUso'
import { GestionProyecto } from './GestionProyecto'
import { EstadoVacio } from './EstadoVacio'
import { HistorialAgente } from './HistorialAgente'
import { IconoChispa } from './Iconos'
import { aplicarMencion, detectarMencion, opcionesMencion } from '../agente/menciones'
import { SolicitudesChat } from './ModalSolicitud'

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
      return <div className="ag-nota">Contexto comprimido ({e.estrategia}): {e.tokensAntes} → {e.tokensDespues} tokens</div>
    case 'cuenta_cambiada':
      return (
        <div className="ag-nota">
          Límite de uso alcanzado en «{e.de}»{e.hasta ? ` (se renueva ${new Date(e.hasta).toLocaleString()})` : ''}. Continúo con «{e.a}».
        </div>
      )
    case 'aprobacion_automatica':
      return <div className="ag-nota">✓ {e.clase === 'plan' ? 'Plan' : 'Acción'} aprobado automáticamente ({e.motivo})</div>
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

function TurnoVista({ t, onCancelar }: { t: Turno; onCancelar: () => void }) {
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
      {t.eventos.map((e, i) => (
        <Linea key={i} e={e} todos={t.eventos} />
      ))}
      {t.parcial && (
        <div className="ag-burbuja parcial">
          <div className="ag-quien">{t.raiz}</div>
          <div className="ag-texto">{t.parcial}</div>
        </div>
      )}
      {t.error && <div className="ag-final mal">{t.error}</div>}
      <div className="ag-pie">
        <span className={`chip estado-${t.estado}`}>{ESTADO[t.estado]}</span>
        {t.estado === 'en_curso' && (
          <button onClick={onCancelar} disabled={!t.ejecucionId}>
            Cancelar
          </button>
        )}
      </div>
    </article>
  )
}

export function ChatAgente({ datos, agente, proyectoFijo }: Props) {
  const [destino, setDestino] = useState('')
  const [modo, setModo] = useState<'chat' | 'flujo'>('chat')
  const [aislado, setAislado] = useState(true)
  const [texto, setTexto] = useState('')
  const [verHistorial, setVerHistorial] = useState(false)
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
  const cursorPendiente = useRef<number | null>(null)
  const selector = useRef<HTMLInputElement>(null)
  const modelos = useModelos()
  const { cuenta } = useCuenta()
  const conSuscripcion = cuenta?.proveedor === 'suscripcion'
  // Modelo y autonomía por proyecto: viven en la cuenta (`ajustes/<proyecto>.json`, se sincronizan con tus demás equipos).
  const claveAjustes = proyectoFijo?.id ?? 'global'
  const [modeloSel, setModeloSel] = useState<string>('auto')
  const [autonomia, setAutonomiaEstado] = useState<ModoAutonomia>('preguntar')
  const versionAjustes = useRef(0) // sube con cada cambio hecho aquí: una lectura que empezó antes se descarta
  useEffect(() => {
    let vigente = true
    const leer = async (migrar: boolean): Promise<void> => {
      const version = versionAjustes.current
      let a = await window.api.ajustes.leer(claveAjustes).catch(() => ({}) as AjustesAsistente)
      if (migrar && a.modelo === undefined && a.autonomia === undefined) a = await migrarAjustesLocales(claveAjustes, a)
      if (!vigente || version !== versionAjustes.current) return
      setModeloSel(a.modelo ?? 'auto')
      setAutonomiaEstado(a.autonomia ?? 'preguntar')
    }
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
  const fin = useRef<HTMLDivElement>(null)

  const grupoSeleccionado = !proyectoFijo && destino.startsWith('g:')
  const proyecto = proyectoFijo ?? (destino.startsWith('p:') ? datos?.proyectos.find((p) => p.id === destino.slice(2)) : undefined)
  const etiqueta = useMemo(() => {
    if (grupoSeleccionado) return datos?.grupos.find((g) => g.id === destino.slice(2))?.nombre ?? 'grupo'
    return proyecto?.nombre ?? 'sin proyecto'
  }, [datos?.grupos, destino, grupoSeleccionado, proyecto])

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' })
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
        solicitud: { prompt: linea, ...(proyecto ? { proyectoId: proyecto.id } : {}), ...(autonomia !== 'preguntar' ? { autonomia } : {}), ...(modeloSel !== 'auto' ? { modelo: modeloSel } : {}) }
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

  /** Empezar otra conversación pide confirmación: la actual no se pierde, queda en el historial. */
  const pedirNuevaConversacion = async (): Promise<void> => {
    if (agente.enCurso) return agente.avisar('/nueva', 'Espera a que termine la tarea en curso (o cancélala) para empezar una conversación nueva.', etiqueta)
    if (agente.turnos.length === 0) return
    if (await confirmar({ titulo: 'Nueva conversación', tono: 'info', etiqueta: 'Empezar nueva', texto: 'La conversación actual se guarda en el historial y empiezas una en blanco.\n\nPodrás volver a abrirla desde 🕘 Historial.' })) agente.nuevaConversacion()
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
      <div className="ag-hilo">
        {agente.turnos.length === 0 && (
          <EstadoVacio
            icono={<IconoChispa />}
            titulo="Asistente de desarrollo"
            texto="Elige un proyecto y pregunta. El router escoge el modelo según la complejidad; escribir archivos o ejecutar comandos siempre te pide confirmación. «Flujo» planifica, te pide aprobar el plan, genera en una rama aislada, verifica y te pide aceptar el resultado."
            pistas={['/plan <funcionalidad>', '/tareas', '/flujo <petición>', '/ayuda']}
          />
        )}
        {agente.turnos.map((t) => (
          <TurnoVista key={t.clave} t={t} onCancelar={() => agente.cancelar(t)} />
        ))}
        <div ref={fin} />
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
          {modo === 'flujo' && (
            <label className="ag-check" title="Trabaja en un git worktree propio; tu árbol de trabajo no se toca">
              <input type="checkbox" checked={aislado} onChange={(e) => setAislado(e.target.checked)} /> Aislar en rama git
            </label>
          )}
          <span className="ag-espacio" />
          <button className="ag-icono" onClick={() => selector.current?.click()} disabled={pendientes.length >= LIMITES_ADJUNTOS.porMensaje} title="Adjuntar imágenes, PDF o archivos de texto (también puedes pegarlos o arrastrarlos)" aria-label="Adjuntar archivos">
            📎
          </button>
          <button className="ag-icono" onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial} aria-label="Historial" title="Historial: conversaciones guardadas">
            🕘
          </button>
          <button className="ag-icono" onClick={() => void pedirNuevaConversacion()} disabled={agente.enCurso || agente.turnos.length === 0} aria-label="Nueva conversación" title="Nueva conversación: la actual queda guardada en el historial">
            ＋
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
                      <span className="ag-sug-ico" aria-hidden>{o.carpeta ? '📁' : '📄'}</span>
                      <strong>{nombre}{o.carpeta ? '/' : ''}</strong>
                      {dir && <small>{dir}/</small>}
                    </button>
                  )
                })
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
            placeholder={pendientes.length > 0 ? 'Mensaje opcional: pulsa Enter para enviar solo los archivos…' : modo === 'flujo' ? 'Describe el cambio que quieres…' : 'Pregunta o pide algo…  (Ctrl+Enter envía · «/» comandos · «@» archivos · pega o arrastra archivos)'}
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
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
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
        <BarraUso {...(agente.contexto ? { contexto: agente.contexto } : {})} {...(modeloSel !== 'auto' ? { modelo: modeloSel } : {})} modelos={modelos} tokensSesion={agente.tokensSesion} />
      </div>
    </div>
  )
}
