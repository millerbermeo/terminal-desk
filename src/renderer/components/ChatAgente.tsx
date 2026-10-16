import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventoAgente } from '@shared/core/agente'
import { COMANDOS_INCLUIDOS, expandirPlantilla, type ComandoUsuario } from '@shared/core/comandos'
import type { ModoAutonomia } from '@shared/core/permisos'
import type { DatosProyectos } from '@shared/modelos'
import type { Agente, Turno } from '../agente/useAgente'
import { GestionProyecto } from './GestionProyecto'
import { HistorialAgente } from './HistorialAgente'

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
      return <div className="ag-nota">Esperando tu confirmación: {e.clase === 'plan' ? 'plan' : e.clase === 'confirmacion' ? 'resultado' : e.herramienta}</div>
    case 'worktree':
      return (
        <div className="ag-worktree">
          ⎇ <strong>{e.accion}</strong> <code>{e.rama}</code>
          {e.detalle && <span> — {e.detalle}</span>}
        </div>
      )
    case 'contexto':
      return <div className="ag-nota">Contexto comprimido ({e.estrategia}): {e.tokensAntes} → {e.tokensDespues} tokens</div>
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
          Tú · {t.destino} {t.modo !== 'chat' && t.modo !== 'comando' && <span className="chip">{t.modo === 'flujo' ? 'flujo de desarrollo' : 'grupo (A2A)'}</span>}
          {t.autonomia && <span className="chip chip-aviso" title="Se ejecutó con menos confirmaciones">{t.autonomia === 'autonomo' ? 'autónomo' : 'acepta ediciones'}</span>}
        </div>
        <div className="ag-texto">{t.prompt}</div>
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
  const claveAutonomia = `asistente:autonomia:${proyectoFijo?.id ?? 'global'}`
  const [autonomia, setAutonomiaEstado] = useState<ModoAutonomia>(() => {
    try {
      const v = localStorage.getItem(claveAutonomia)
      return v === 'ediciones' || v === 'autonomo' ? v : 'preguntar'
    } catch {
      return 'preguntar'
    }
  })
  const cambiarAutonomia = (nuevo: ModoAutonomia): void => {
    if (nuevo === 'autonomo' && !window.confirm('Modo autónomo: el agente escribirá archivos, ejecutará typecheck, lint y pruebas, y (en el Flujo) aprobará el plan sin preguntarte, con un límite de tokens.\n\nSeguirá pidiendo confirmación para lo destructivo (borrar, git push…), para comandos desconocidos y para aceptar el resultado del Flujo.\n\nLo más seguro es usarlo con el Flujo aislado en una rama. ¿Activarlo?')) return
    setAutonomiaEstado(nuevo)
    try {
      localStorage.setItem(claveAutonomia, nuevo)
    } catch {
      /* sin almacenamiento: no se recordará */
    }
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
    if (modo === 'flujo' && !proyecto) setModo('chat')
  }, [modo, proyecto])

  // Comandos propios del proyecto (más globales) para el autocompletado y la ejecución de `/nombre`.
  useEffect(() => {
    if (gestion === null) void window.api.core.comandosEfectivos(proyecto?.id).then(setComandos).catch(() => setComandos([]))
  }, [proyecto?.id, gestion])

  const sugerencias = useMemo(() => {
    const m = /^\/([a-z0-9_-]*)$/.exec(texto)
    if (!m || sugOculta) return []
    return [
      ...COMANDOS_INCLUIDOS.map((c) => ({ nombre: c.nombre, uso: c.uso as string, descripcion: c.descripcion as string, propio: false })),
      ...comandos.map((c) => ({ nombre: c.nombre, uso: `/${c.nombre}${c.tipo === 'ejecutable' && c.argumentos ? ' <argumentos>' : c.tipo === 'prompt' ? ' [texto]' : ''}`, descripcion: c.descripcion, propio: true }))
    ].filter((c) => c.nombre.startsWith(m[1]!))
  }, [texto, comandos, sugOculta])

  const lanzar = (prompt: string, forzarFlujo = false): void => {
    void agente.enviar({
      destino: etiqueta,
      solicitud: {
        prompt,
        ...(proyecto ? { proyectoId: proyecto.id } : {}),
        ...(grupoSeleccionado ? { grupoId: destino.slice(2) } : {}),
        ...(autonomia !== 'preguntar' ? { autonomia } : {}),
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
      case 'chat':
        return setModo('chat')
      case 'modo':
        if (resto === 'preguntar' || resto === 'ediciones' || resto === 'autonomo') return cambiarAutonomia(resto)
        return aviso('Uso: /modo preguntar | ediciones | autonomo')
      case 'nueva':
        return agente.nuevaConversacion()
      case 'historial':
        return setVerHistorial(true)
      case 'permisos':
      case 'comandos':
        return setGestion(nombre)
      case 'ayuda':
        setSugOculta(false)
        return setTexto('/')
    }
    const c = comandos.find((x) => x.nombre === nombre)
    if (!c) return aviso(`No existe el comando «/${nombre}». Escribe /ayuda para ver la lista, o créalo con /comandos.`)
    if (c.tipo === 'prompt') return lanzar(expandirPlantilla(c.plantilla ?? '', resto))
    if (!proyecto) return aviso(`«/${nombre}» se ejecuta en un proyecto: elige uno primero.`)
    void agente.ejecutarComando({ proyectoId: proyecto.id, nombre, argumentos: resto, destino: etiqueta })
  }

  const enviar = (): void => {
    const prompt = texto.trim()
    if (!prompt || agente.enCurso) return
    setTexto('')
    if (prompt.startsWith('/')) return comandoSlash(prompt)
    lanzar(prompt)
  }

  const completar = (nombre: string): void => {
    setTexto(`/${nombre} `)
    setSugOculta(true)
  }

  const actual = agente.turnos.at(-1)
  return (
    <div className="ag-chat">
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
          <div className="vacio">
            <strong>Asistente de desarrollo</strong>
            <span>
              Elige un proyecto y pregunta. El router escoge el modelo según la complejidad; escribir archivos o ejecutar comandos siempre te pide
              confirmación. «Flujo» planifica, te pide aprobar el plan, genera en una rama aislada, verifica y te pide aceptar el resultado.
            </span>
          </div>
        )}
        {agente.turnos.map((t) => (
          <TurnoVista key={t.clave} t={t} onCancelar={() => agente.cancelar(t)} />
        ))}
        <div ref={fin} />
      </div>
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
            <button className={modo === 'flujo' ? 'on' : ''} disabled={!proyecto} onClick={() => setModo('flujo')} title={proyecto ? 'Plan → aprobación → generación → verificación → confirmación' : 'Elige un proyecto'}>
              Flujo
            </button>
          </div>
          <div className="segmentado" role="group" aria-label="Autonomía">
            <button className={autonomia === 'preguntar' ? 'on' : ''} onClick={() => cambiarAutonomia('preguntar')} title="Pide confirmación para cada escritura y cada comando (salvo los que permitan tus reglas)">
              Preguntar
            </button>
            <button className={autonomia === 'ediciones' ? 'on' : ''} onClick={() => cambiarAutonomia('ediciones')} title="Los cambios en archivos del proyecto pasan solos; los comandos siguen preguntando">
              Ediciones
            </button>
            <button className={autonomia === 'autonomo' ? 'on aviso' : ''} onClick={() => cambiarAutonomia('autonomo')} title="Edita, ejecuta typecheck/lint/test y aprueba el plan solo, con límite de tokens. Lo destructivo siempre pregunta.">
              Autónomo
            </button>
          </div>
          {modo === 'flujo' && (
            <label className="ag-check" title="Trabaja en un git worktree propio; tu árbol de trabajo no se toca">
              <input type="checkbox" checked={aislado} onChange={(e) => setAislado(e.target.checked)} /> Aislar en rama git
            </label>
          )}
          <span className="ag-espacio" />
          <button onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial} title="Conversaciones guardadas">
            Historial
          </button>
          <button onClick={agente.nuevaConversacion} disabled={agente.enCurso || agente.turnos.length === 0} title="La actual queda guardada en el historial">
            Nueva conversación
          </button>
        </div>
        <div className="ag-entrada">
          {sugerencias.length > 0 && (
            <div className="ag-sugerencias" role="listbox" aria-label="Comandos">
              {sugerencias.map((c, i) => (
                <button key={`${c.propio}-${c.nombre}`} role="option" aria-selected={i === seleccion} className={i === seleccion ? 'sel' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => completar(c.nombre)}>
                  <strong className={c.propio ? 'propio' : ''}>{c.uso}</strong>
                  <small>{c.descripcion}</small>
                </button>
              ))}
            </div>
          )}
          <textarea
            rows={3}
            value={texto}
            placeholder={modo === 'flujo' ? 'Describe el cambio que quieres…' : 'Pregunta o pide algo sobre el proyecto…  (Ctrl+Enter para enviar · «/» para comandos)'}
            onChange={(e) => {
              setTexto(e.target.value)
              setSugOculta(false)
              setSeleccion(0)
            }}
            onKeyDown={(e) => {
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
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                enviar()
              }
            }}
          />
          <button className="primario" onClick={enviar} disabled={!texto.trim() || agente.enCurso}>
            {actual?.estado === 'en_curso' ? 'Trabajando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
