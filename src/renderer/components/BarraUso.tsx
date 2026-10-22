import { useEffect, useState } from 'react'
import type { InfoModelo, LimiteApi, ResumenUso, UsoModelo } from '@shared/core/uso'
import type { ContextoActual } from '../agente/useAgente'
import { fmt, useUso, ventanaDe } from '../agente/uso'

interface Props {
  contexto?: ContextoActual
  /** Modelo fijado a mano (si lo hay) o, en automático, el último que usó el router. */
  modelo?: string
  modelos: readonly InfoModelo[]
  tokensSesion: number
}

const total = (u: UsoModelo): number => u.entrada + u.salida
const usd = (n?: number): string => (n ? ` · $${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}` : '')

function Limite({ nombre, l }: { nombre: string; l: LimiteApi }) {
  const libre = l.limite > 0 ? l.restante / l.limite : 1
  const reinicio = l.reinicio ? Math.max(0, Math.round((Date.parse(l.reinicio) - Date.now()) / 1000)) : undefined
  return (
    <div className="ag-limite">
      <span>{nombre}</span>
      <div className={`ag-ctx-barra ${libre < 0.1 ? 'rojo' : libre < 0.3 ? 'ambar' : ''}`}><i style={{ width: `${Math.round((1 - libre) * 100)}%` }} /></div>
      <small>
        {fmt(l.restante)} de {fmt(l.limite)} libres{reinicio !== undefined ? ` · se renueva en ${reinicio} s` : ''}
      </small>
    </div>
  )
}

function Detalle({ uso, tokensSesion }: { uso: ResumenUso; tokensSesion: number }) {
  const [, forzar] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => forzar((n) => n + 1), 1000) // la cuenta atrás de los límites avanza sola
    return () => window.clearInterval(t)
  }, [])
  const l = uso.limites
  return (
    <div className="ag-popover" role="dialog" aria-label="Uso">
      <strong>Uso de esta aplicación</strong>
      <table>
        <tbody>
          <tr><td>Esta conversación</td><td>{fmt(tokensSesion)} tokens</td></tr>
          <tr><td>Hoy</td><td>{fmt(total(uso.total))} tokens · {uso.total.llamadas} llamadas{usd(uso.total.costo)}</td></tr>
          <tr><td>Últimos 7 días</td><td>{fmt(total(uso.ultimos7Dias))} tokens · {uso.ultimos7Dias.llamadas} llamadas{usd(uso.ultimos7Dias.costo)}</td></tr>
        </tbody>
      </table>
      {Object.keys(uso.hoy).length > 0 && (
        <>
          <small>Hoy por modelo (entrada ↓ / salida ↑)</small>
          <table>
            <tbody>
              {Object.entries(uso.hoy).map(([m, u]) => (
                <tr key={m}><td>{m}</td><td>{fmt(u.entrada)}↓ {u.cache ? `(${fmt(u.cache)} caché) ` : ''}{fmt(u.salida)}↑ · {u.llamadas}{usd(u.costo)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <strong>Límites de la API</strong>
      {l ? (
        <>
          {l.tokens && <Limite nombre="Tokens/min" l={l.tokens} />}
          {l.entrada && <Limite nombre="Entrada/min" l={l.entrada} />}
          {l.salida && <Limite nombre="Salida/min" l={l.salida} />}
          {l.solicitudes && <Limite nombre="Solicitudes/min" l={l.solicitudes} />}
          <small>Actualizado hace {Math.max(0, Math.round((Date.now() - l.actualizado) / 1000))} s (con la última respuesta de la API).</small>
        </>
      ) : (
        <small>Aún no hay datos: la API los informa en cada respuesta, así que aparecen tras el primer mensaje.</small>
      )}
      <small className="ag-aviso-uso">
        El saldo y la facturación de la cuenta no se pueden consultar con una clave de API normal: míralos en console.anthropic.com. Estos son los tokens que ha usado esta aplicación
        (incluidos resúmenes y evals) y el margen de tasa que informa la API.
      </small>
    </div>
  )
}

/** Barra de estado del chat: cuánto contexto lleva la conversación, consumo en tiempo real y límites de la API. */
export function BarraUso({ contexto, modelo, modelos, tokensSesion }: Props) {
  const uso = useUso()
  const [abierto, setAbierto] = useState(false)
  const real = contexto?.ventana && (!modelo || modelo === contexto.modelo) ? contexto.ventana : undefined
  const ventana = real ?? ventanaDe(modelos, modelo ?? contexto?.modelo)
  const pct = contexto && ventana ? Math.min(100, Math.round((contexto.tokens / ventana) * 100)) : 0
  const nivel = pct >= 90 ? 'rojo' : pct >= 70 ? 'ambar' : ''
  const limiteTokens = uso?.limites?.tokens ?? uso?.limites?.entrada
  const libre = limiteTokens && limiteTokens.limite > 0 ? Math.round((limiteTokens.restante / limiteTokens.limite) * 100) : undefined

  return (
    <div className="ag-estado-barra">
      <div
        className="ag-ctx"
        title={
          contexto
            ? ventana
              ? `La conversación ocupa ${contexto.tokens.toLocaleString()} de ${ventana.toLocaleString()} tokens del modelo${contexto.aprox ? ' (estimación)' : ' (dato real de la última llamada)'}. Al llegar al 70 % se comprime sola: se podan los resultados y adjuntos antiguos y se resume lo anterior.`
              : `La conversación ocupa ${contexto.tokens.toLocaleString()} tokens. El tamaño de la ventana de este modelo aún no se conoce: se sabrá cuando el CLI lo informe.`
            : ventana
              ? `Aún no hay contexto: ventana de ${ventana.toLocaleString()} tokens.`
              : 'Aún no hay contexto. El tamaño de la ventana de este modelo se conocerá al usarlo.'
        }
      >
        <span className="largo">Contexto</span>
        {ventana && (
          <div className={`ag-ctx-barra ${nivel}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Contexto usado">
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        <span>
          {ventana
            ? contexto
              ? `${contexto.aprox ? '≈' : ''}${pct} % · ${fmt(contexto.tokens)} / ${fmt(ventana)}`
              : `0 / ${fmt(ventana)}`
            : `${contexto ? fmt(contexto.tokens) : 0} tokens`}
        </span>
      </div>
      <span className="ag-espacio" />
      {libre !== undefined && (
        <span className={`chip ${libre < 10 ? 'chip-aviso' : ''}`} title="Margen de tokens por minuto que informa la API (no se renueva mensualmente)">
          límite {libre} % libre
        </span>
      )}
      <button className="ag-uso-chip" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)} title="Consumo de tokens en tiempo real y límites de la API">
        <span className="largo">Sesión </span>{fmt(tokensSesion)}<span className="largo"> · Hoy </span><span className="corto"> / </span>{fmt(uso ? total(uso.total) : 0)} tokens
      </button>
      {abierto && uso && <Detalle uso={uso} tokensSesion={tokensSesion} />}
    </div>
  )
}
