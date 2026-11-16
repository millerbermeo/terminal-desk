import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ResumenSesion } from '@shared/core/sesion'
import { EstadoVacio } from './EstadoVacio'
import { IconoReloj, IconoCerrar } from './Iconos'
import { confirmar } from '../confirmar'
import { Esqueletos } from './Cargando'
import { MAX_ETIQUETAS, alternarFijada, formatoTokens, formatoUsd, ordenarPorConsumo, etiquetasEnUso, filtrarSesiones, guardarOrganizacion, leerOrganizacion, olvidarSesion, ordenarSesiones, ponerEtiquetas, textoBuscable, type Organizacion } from '../agente/utilidades-chat'

interface Props {
  proyectoId?: string // sin proyecto: conversaciones de todos
  activaId?: string
  deshabilitado: boolean // hay una ejecución en marcha
  onAbrir: (id: string) => void
  onBorrar: (id: string) => void
  onCerrar: () => void
}

const cuando = (iso: string): string => {
  const d = new Date(iso)
  return d.toLocaleDateString() === new Date().toLocaleDateString() ? `hoy ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

/** Cuántas conversaciones se abren para buscar dentro de su contenido (las más recientes). */
const MAX_BUSQUEDA_CONTENIDO = 100

const IconoChincheta = ({ llena }: { llena: boolean }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill={llena ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Zm3 11v5" />
  </svg>
)

/** Conversaciones guardadas: se pueden buscar (por título, etiqueta o contenido), fijar, etiquetar, retomar o eliminar. */
export function HistorialAgente({ proyectoId, activaId, deshabilitado, onAbrir, onBorrar, onCerrar }: Props) {
  const [lista, setLista] = useState<ResumenSesion[] | null>(null)
  const [org, setOrg] = useState<Organizacion>(leerOrganizacion)
  const [consulta, setConsulta] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [textoEtiquetas, setTextoEtiquetas] = useState('')
  // Contenido (lo pedido y lo respondido) de las conversaciones ya abiertas para buscar; crece mientras se busca.
  const contenido = useRef(new Map<string, string>())
  const [version, setVersion] = useState(0)
  const [buscando, setBuscando] = useState(false)
  const [porConsumo, setPorConsumo] = useState(false)

  const cargar = useCallback(() => void window.api.core.sesionesListar(proyectoId).then(setLista).catch(() => setLista([])), [proyectoId])
  useEffect(cargar, [cargar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  const cambiarOrg = (nueva: Organizacion): void => {
    setOrg(nueva)
    guardarOrganizacion(nueva)
  }

  // Al buscar, se leen (una a una) las conversaciones recientes que aún no se conocen y se guarda su texto.
  const termino = consulta.trim()
  useEffect(() => {
    if (!lista || termino.length < 2) return
    const pendientes = lista.slice(0, MAX_BUSQUEDA_CONTENIDO).filter((s) => !contenido.current.has(s.id))
    if (pendientes.length === 0) return
    let vigente = true
    setBuscando(true)
    void (async () => {
      for (const s of pendientes) {
        if (!vigente) return
        try {
          const g = await window.api.core.sesionObtener(s.id)
          contenido.current.set(s.id, g ? g.transcripcion.map(textoBuscable).join('\n') : '')
        } catch {
          contenido.current.set(s.id, '')
        }
        if (vigente) setVersion((v) => v + 1)
      }
      if (vigente) setBuscando(false)
    })()
    return () => {
      vigente = false
      setBuscando(false)
    }
  }, [lista, termino])

  const visibles = useMemo(() => {
    void version // se recalcula cuando llega el contenido de otra conversación
    const filtradas = filtrarSesiones(lista ?? [], org, { texto: termino, etiqueta, contenido: contenido.current })
    return porConsumo ? ordenarPorConsumo(filtradas) : ordenarSesiones(filtradas, org)
  }, [lista, org, termino, etiqueta, version, porConsumo])
  const totalTokens = visibles.reduce((t, s) => t + s.tokens, 0)
  const totalCosto = visibles.reduce((t, s) => t + (s.costo ?? 0), 0)
  const etiquetas = useMemo(() => etiquetasEnUso(org), [org])
  const filtrando = termino !== '' || etiqueta !== ''

  return (
    <div className="ag-historial" role="dialog" aria-label="Historial de conversaciones">
      <div className="ag-historial-cab">
        <strong>Historial{proyectoId ? ' de este proyecto' : ''}</strong>
        <button className="icono" onClick={onCerrar} title="Cerrar (Esc)"><IconoCerrar /></button>
      </div>
      {lista !== null && lista.length > 0 && (
        <div className="ag-historial-filtros">
          <input type="search" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Buscar por título, etiqueta o contenido…" aria-label="Buscar conversaciones" autoFocus />
          {etiquetas.length > 0 && (
            <div className="ag-historial-etiquetas" role="group" aria-label="Filtrar por etiqueta">
              {etiquetas.map((e) => (
                <button key={e} className={`chip${etiqueta === e ? ' on' : ''}`} aria-pressed={etiqueta === e} onClick={() => setEtiqueta(etiqueta === e ? '' : e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {termino.length >= 2 && buscando && <small className="ag-historial-nota">Buscando también dentro de las conversaciones…</small>}
          <div className="ag-historial-consumo">
            <span title="Suma de las conversaciones de la lista. El coste es a precio de lista y solo se conoce con la suscripción (lo informa el CLI).">
              {visibles.length} {visibles.length === 1 ? 'conversación' : 'conversaciones'} · {formatoTokens(totalTokens)} tokens{totalCosto > 0 ? ` · ${formatoUsd(totalCosto)}` : ''}
            </span>
            <button className={`chip${porConsumo ? ' on' : ''}`} aria-pressed={porConsumo} onClick={() => setPorConsumo((v) => !v)} title="Ordenar por coste (o tokens) en vez de por fecha">
              Más caras primero
            </button>
          </div>
        </div>
      )}
      {lista === null && <Esqueletos cuantos={5} />}
      {lista?.length === 0 && <EstadoVacio variante="compacto" icono={<IconoReloj />} titulo="Aún no hay conversaciones" texto="Se guardan solas al terminar cada respuesta." />}
      {lista !== null && lista.length > 0 && visibles.length === 0 && !buscando && <div className="ag-historial-nota">Ninguna conversación coincide{termino ? ` con «${termino}»` : ''}.</div>}
      <ul>
        {visibles.map((s) => {
          const fijada = org.fijadas.includes(s.id)
          const suyas = org.etiquetas[s.id] ?? []
          return (
            <li key={s.id} className={`${s.id === activaId ? 'activa' : ''}${fijada ? ' fijada' : ''}`}>
              <button className="ag-historial-abrir" disabled={deshabilitado || s.id === activaId} onClick={() => { onAbrir(s.id); onCerrar() }} title={deshabilitado ? 'Espera a que termine la ejecución en curso' : 'Retomar esta conversación'}>
                <span className="ag-historial-titulo">{s.titulo}</span>
                <span className="ag-historial-meta">
                  {cuando(s.actualizada)} · {s.turnos} {s.turnos === 1 ? 'turno' : 'turnos'} · {formatoTokens(s.tokens)} tokens{s.costo ? ` · ${formatoUsd(s.costo)}` : ''}{s.id === activaId ? ' · actual' : ''}
                </span>
                {suyas.length > 0 && (
                  <span className="ag-historial-chips">
                    {suyas.map((e) => (
                      <span key={e} className="chip">{e}</span>
                    ))}
                  </span>
                )}
              </button>
              <button className={`ag-historial-accion${fijada ? ' on' : ''}`} aria-pressed={fijada} title={fijada ? 'Quitar de las fijadas' : 'Fijar arriba'} aria-label={fijada ? 'Quitar de las fijadas' : 'Fijar arriba'} onClick={() => cambiarOrg(alternarFijada(org, s.id))}>
                <IconoChincheta llena={fijada} />
              </button>
              <button
                className="ag-historial-accion"
                title="Etiquetas"
                aria-label="Editar etiquetas"
                onClick={() => {
                  setEditando(editando === s.id ? null : s.id)
                  setTextoEtiquetas(suyas.join(', '))
                }}
              >
                #
              </button>
              <button
                className="peligro"
                style={{ opacity: 1 }}
                title="Eliminar del historial"
                disabled={deshabilitado && s.id === activaId}
                onClick={() =>
                  void confirmar({ titulo: 'Eliminar conversación', etiqueta: 'Eliminar', texto: `¿Eliminar la conversación «${s.titulo}»?\n\nNo se puede deshacer.` }).then((si) => {
                    if (!si) return
                    onBorrar(s.id)
                    cambiarOrg(olvidarSesion(org, s.id))
                    contenido.current.delete(s.id)
                    setLista((l) => l?.filter((x) => x.id !== s.id) ?? null)
                  })
                }
              >
                <IconoCerrar />
              </button>
              {editando === s.id && (
                <form
                  className="ag-historial-editar"
                  onSubmit={(e) => {
                    e.preventDefault()
                    cambiarOrg(ponerEtiquetas(org, s.id, textoEtiquetas))
                    setEditando(null)
                  }}
                >
                  <input value={textoEtiquetas} onChange={(e) => setTextoEtiquetas(e.target.value)} placeholder={`Etiquetas separadas por comas (máx. ${MAX_ETIQUETAS})`} aria-label="Etiquetas" autoFocus />
                  <button type="submit" className="primario">Guardar</button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      {filtrando && visibles.length > 0 && <div className="ag-historial-nota">{visibles.length} de {lista?.length ?? 0}. Las etiquetas y las fijadas se guardan solo en este equipo.</div>}
    </div>
  )
}
