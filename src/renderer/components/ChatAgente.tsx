import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventoAgente } from '@shared/core/agente'
import type { DatosProyectos } from '@shared/modelos'
import type { Agente, Turno } from '../agente/useAgente'

interface Props {
  datos: DatosProyectos
  agente: Agente
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
          Tú · {t.destino} {t.modo !== 'chat' && <span className="chip">{t.modo === 'flujo' ? 'flujo de desarrollo' : 'grupo (A2A)'}</span>}
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

export function ChatAgente({ datos, agente }: Props) {
  const [destino, setDestino] = useState('')
  const [modo, setModo] = useState<'chat' | 'flujo'>('chat')
  const [aislado, setAislado] = useState(true)
  const [texto, setTexto] = useState('')
  const fin = useRef<HTMLDivElement>(null)

  const grupoSeleccionado = destino.startsWith('g:')
  const proyecto = destino.startsWith('p:') ? datos.proyectos.find((p) => p.id === destino.slice(2)) : undefined
  const etiqueta = useMemo(() => {
    if (grupoSeleccionado) return datos.grupos.find((g) => g.id === destino.slice(2))?.nombre ?? 'grupo'
    return proyecto?.nombre ?? 'sin proyecto'
  }, [datos.grupos, destino, grupoSeleccionado, proyecto])

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' })
  }, [agente.turnos, agente.solicitudes.length])

  useEffect(() => {
    if (modo === 'flujo' && !proyecto) setModo('chat')
  }, [modo, proyecto])

  const enviar = (): void => {
    const prompt = texto.trim()
    if (!prompt || agente.enCurso) return
    setTexto('')
    void agente.enviar({
      destino: etiqueta,
      solicitud: {
        prompt,
        ...(proyecto ? { proyectoId: proyecto.id } : {}),
        ...(grupoSeleccionado ? { grupoId: destino.slice(2) } : {}),
        ...(modo === 'flujo' ? { modo: 'flujo' as const, aislado } : {})
      }
    })
  }

  const actual = agente.turnos.at(-1)
  return (
    <div className="ag-chat">
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
          <div className="segmentado" role="group" aria-label="Modo">
            <button className={modo === 'chat' ? 'on' : ''} onClick={() => setModo('chat')}>
              Chat
            </button>
            <button className={modo === 'flujo' ? 'on' : ''} disabled={!proyecto} onClick={() => setModo('flujo')} title={proyecto ? 'Plan → aprobación → generación → verificación → confirmación' : 'Elige un proyecto'}>
              Flujo
            </button>
          </div>
          {modo === 'flujo' && (
            <label className="ag-check" title="Trabaja en un git worktree propio; tu árbol de trabajo no se toca">
              <input type="checkbox" checked={aislado} onChange={(e) => setAislado(e.target.checked)} /> Aislar en rama git
            </label>
          )}
          <span className="ag-espacio" />
          {agente.sesionId && <span className="chip" title={agente.sesionId}>conversación en curso</span>}
          <button onClick={agente.nuevaConversacion} disabled={agente.enCurso || agente.turnos.length === 0}>
            Nueva conversación
          </button>
        </div>
        <div className="ag-entrada">
          <textarea
            rows={3}
            value={texto}
            placeholder={modo === 'flujo' ? 'Describe el cambio que quieres…' : 'Pregunta o pide algo sobre el proyecto…  (Ctrl+Enter para enviar)'}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
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
