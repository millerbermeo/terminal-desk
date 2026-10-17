import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ResumenTraza, Span, Traza } from '@shared/core/traza'
import { EstadoVacio } from './EstadoVacio'
import { IconoActividad } from './Iconos'

const fecha = (ms: number): string => new Date(ms).toLocaleString()
const dur = (ms?: number): string => (ms === undefined ? '…' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
const tokens = (u: { tokensEntrada: number; tokensSalida: number }): string => `${u.tokensEntrada}↓ ${u.tokensSalida}↑`

function ordenar(spans: Span[]): { span: Span; nivel: number }[] {
  const hijos = new Map<string | undefined, Span[]>()
  for (const s of spans) hijos.set(s.padre, [...(hijos.get(s.padre) ?? []), s])
  const salida: { span: Span; nivel: number }[] = []
  const visitar = (padre: string | undefined, nivel: number): void => {
    for (const s of (hijos.get(padre) ?? []).sort((a, b) => a.inicio - b.inicio)) {
      salida.push({ span: s, nivel })
      visitar(s.id, nivel + 1)
    }
  }
  visitar(undefined, 0)
  return salida
}

function Cascada({ traza }: { traza: Traza }) {
  const [sel, setSel] = useState<Span | null>(null)
  const filas = useMemo(() => ordenar(traza.spans), [traza])
  const total = Math.max(1, traza.duracionMs ?? Math.max(...traza.spans.map((s) => (s.fin ?? s.inicio) - traza.inicio), 1))
  return (
    <div className="tr-detalle">
      <div className="tr-cab">
        <strong>{traza.agente}</strong> <span className={`chip estado-${traza.estado}`}>{traza.estado}</span>
        <span className="chip">{traza.modo}</span>
        <span className="chip">{dur(traza.duracionMs)}</span>
        <span className="chip">{tokens(traza.uso)} tokens</span>
        {traza.truncada && <span className="chip chip-aviso">truncada</span>}
      </div>
      <p className="tr-prompt">{traza.prompt}</p>
      <div className="tr-spans" role="tree">
        {filas.map(({ span: s, nivel }) => (
          <button key={s.id} className={`tr-fila${sel?.id === s.id ? ' sel' : ''}${s.estado === 'error' ? ' error' : ''}`} onClick={() => setSel(s)}>
            <span className="tr-nombre" style={{ paddingLeft: nivel * 14 }}>
              <span className={`tr-tipo tipo-${s.tipo}`}>{s.tipo}</span> {s.nombre}
            </span>
            <span className="tr-barra">
              <i style={{ left: `${((s.inicio - traza.inicio) / total) * 100}%`, width: `${Math.max(0.6, ((s.duracionMs ?? 0) / total) * 100)}%` }} />
            </span>
            <span className="tr-dur">{dur(s.duracionMs)}</span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="tr-sel">
          <h4>
            {sel.tipo} · {sel.nombre} <small>{dur(sel.duracionMs)}{sel.uso ? ` · ${tokens(sel.uso)} tokens` : ''}</small>
          </h4>
          {sel.atributos && <div className="ag-chips">{Object.entries(sel.atributos).map(([k, v]) => <span key={k} className="chip">{k}: {String(v)}</span>)}</div>}
          {sel.entrada && <><small>Entrada</small><pre>{sel.entrada}</pre></>}
          {sel.salida && <><small>Salida</small><pre>{sel.salida}</pre></>}
        </div>
      )}
    </div>
  )
}

export function TrazasAgente({ visible }: { visible: boolean }) {
  const [lista, setLista] = useState<ResumenTraza[]>([])
  const [traza, setTraza] = useState<Traza | null>(null)

  const cargar = useCallback(() => void window.api.core.trazasListar(100).then(setLista), [])
  useEffect(() => {
    if (visible) cargar()
  }, [visible, cargar])

  return (
    <div className="tr">
      <div className="tr-lista">
        <div className="tr-lista-cab">
          <strong>Ejecuciones</strong>
          <button className="icono" onClick={cargar} title="Actualizar">↻</button>
        </div>
        {lista.length === 0 && <EstadoVacio variante="compacto" icono={<IconoActividad />} titulo="Sin trazas todavía" texto="Cada ejecución del agente deja aquí su rastro." />}
        {lista.map((r) => (
          <button key={r.id} className={`tr-item${traza?.id === r.id ? ' sel' : ''}`} onClick={() => void window.api.core.trazaObtener(r.id).then((t) => setTraza(t ?? null))}>
            <span className="tr-item-prompt">{r.prompt || '(sin prompt)'}</span>
            <span className="tr-item-meta">
              <span className={`chip estado-${r.estado}`}>{r.estado}</span>
              {r.modo} · {r.llamadasLlm} llm · {r.herramientas} herr.{r.errores ? ` · ${r.errores} err.` : ''} · {dur(r.duracionMs)} · {fecha(r.inicio)}
            </span>
          </button>
        ))}
      </div>
      <div className="tr-panel">
        {traza ? (
          <>
            <div className="cfg-acciones">
              <button className="peligro" onClick={() => void window.api.core.trazaEliminar(traza.id).then(() => { setTraza(null); cargar() })}>Eliminar traza</button>
            </div>
            <Cascada traza={traza} />
          </>
        ) : (
          <EstadoVacio icono={<IconoActividad />} titulo="Observabilidad" texto="Elige una ejecución para ver su árbol de agentes, llamadas al modelo y herramientas con tiempos y tokens. Las credenciales se redactan al guardar." />
        )}
      </div>
    </div>
  )
}
