import { useCallback, useEffect, useState } from 'react'
import type { InfoSuite, InformeEval, ResultadoEvals } from '@shared/core/evals'
import { EstadoVacio } from './EstadoVacio'
import { IconoEvals } from './Iconos'

const pct = (x: number): string => `${Math.round(x * 100)} %`

function Informe({ i }: { i: InformeEval }) {
  return (
    <div className="ev-informe">
      <div className="ag-chips">
        <span className={`chip ${i.superaUmbral ? 'chip-ok' : 'chip-aviso'}`}>{i.pasan}/{i.total} · {pct(i.tasa)} (umbral {pct(i.umbral)})</span>
        <span className="chip">{i.uso.tokensEntrada + i.uso.tokensSalida} tokens</span>
        <span className="chip">{(i.duracionMs / 1000).toFixed(1)} s</span>
        {i.modelo && <span className="chip">{i.modelo}</span>}
        <span className="chip">{new Date(i.fecha).toLocaleString()}</span>
      </div>
      {i.casos.map((c) => (
        <details key={c.id} className={`ev-caso ${c.pasa ? 'ok' : 'mal'}`}>
          <summary>
            <span className="ag-estado">{c.pasa ? '✓' : '✗'}</span> <strong>{c.id}</strong> <small>{c.descripcion}</small>
            <span className="chip">{c.pasos} pasos</span>
          </summary>
          {c.error && <div className="cfg-error">{c.error}</div>}
          {c.aserciones.map((a, k) => (
            <div key={k} className={`ev-asercion ${a.ok ? 'ok' : 'mal'}`}>
              <span>{a.ok ? '✓' : '✗'}</span> <code>{a.tipo}</code> <pre>{a.detalle}</pre>
            </div>
          ))}
          {c.trazaId && <small>traza {c.trazaId}</small>}
        </details>
      ))}
    </div>
  )
}

export function EvalsAgente({ visible }: { visible: boolean }) {
  const [suites, setSuites] = useState<InfoSuite[]>([])
  const [suite, setSuite] = useState('')
  const [historial, setHistorial] = useState<InformeEval[]>([])
  const [resultado, setResultado] = useState<ResultadoEvals | null>(null)
  const [ejecutando, setEjecutando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    void window.api.core.evalsSuites().then((s) => {
      setSuites(s)
      setSuite((x) => x || s[0]?.id || '')
    })
  }, [visible])

  const cargar = useCallback(() => {
    if (suite) void window.api.core.evalsInformes(suite).then(setHistorial)
  }, [suite])
  useEffect(cargar, [cargar])

  const ejecutar = (): void => {
    if (!window.confirm('Se ejecutarán los casos contra el modelo real (en proyectos temporales). Consume tokens de tu cuenta y puede tardar varios minutos. ¿Continuar?')) return
    setError('')
    setEjecutando(true)
    window.api.core
      .evalsEjecutar(suite)
      .then((r) => {
        setResultado(r)
        cargar()
      })
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => setEjecutando(false))
  }

  const info = suites.find((s) => s.id === suite)
  const c = resultado?.comparacion
  return (
    <div className="ev">
      <p className="cfg-intro">
        Los evals comprueban con ejecuciones reales si el agente cumple una especificación (normalmente pruebas) y respeta los guardrails. Cada ejecución se compara con
        la anterior para detectar regresiones. Por terminal también puedes usar <code>pnpm evals</code>.
      </p>
      <div className="ag-opciones">
        <select value={suite} onChange={(e) => { setSuite(e.target.value); setResultado(null) }}>
          {suites.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.casos} casos)</option>)}
        </select>
        <button className="primario" onClick={ejecutar} disabled={!suite || ejecutando}>{ejecutando ? 'Ejecutando…' : 'Ejecutar suite'}</button>
      </div>
      {info && <p className="cfg-nota">{info.descripcion}</p>}
      {error && <div className="cfg-error">{error}</div>}
      {c && (
        <div className="ag-chips">
          <span className={`chip ${c.regresiones.length ? 'chip-aviso' : 'chip-ok'}`}>{c.regresiones.length} regresiones{c.regresiones.length ? `: ${c.regresiones.join(', ')}` : ''}</span>
          <span className="chip">{c.mejoras.length} mejoras</span>
          <span className="chip">Δ tasa {c.deltaTasa >= 0 ? '+' : ''}{Math.round(c.deltaTasa * 100)} %</span>
        </div>
      )}
      {resultado && (<><h4>Resultado</h4><Informe i={resultado.informe} /></>)}
      <h4>Historial</h4>
      {historial.length === 0 && <EstadoVacio variante="compacto" icono={<IconoEvals />} titulo="Sin informes guardados" texto="Ejecuta una suite de evals para medir al agente y comparar resultados." />}
      {historial.filter((i) => i.fecha !== resultado?.informe.fecha).map((i) => (
        <details key={i.fecha} className="ev-hist">
          <summary>{new Date(i.fecha).toLocaleString()} — {i.pasan}/{i.total} ({pct(i.tasa)})</summary>
          <Informe i={i} />
        </details>
      ))}
    </div>
  )
}
