import { useEffect, useState } from 'react'
import type { ContextoUso, InfoModelo, LimiteApi, ResumenUso, UsoModelo, UsoPlan, VentanaPlan } from '@shared/core/uso'
import type { ContextoActual } from '../agente/useAgente'
import { fmt, useUso, ventanaDe } from '../agente/uso'

interface Props {
  /** Desglose real que informa el CLI (solo mientras su proceso sigue vivo). */
  detalle?: ContextoUso
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

const nivelPlan = (p: number): string => (p >= 90 ? 'rojo' : p >= 70 ? 'ambar' : '')

/** «en 45 min», «en 2 h 5 min»; a más de un día, el día y la hora. */
function reinicioPlan(ms: number): string {
  const min = Math.max(0, Math.round((ms - Date.now()) / 60_000))
  if (min < 1) return 'en menos de 1 min'
  if (min < 60) return `en ${min} min`
  if (min < 24 * 60) return `en ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function VentanaDelPlan({ nombre, v }: { nombre: string; v: VentanaPlan }) {
  return (
    <div className="ag-limite">
      <span>{nombre}</span>
      <div className={`ag-ctx-barra ${nivelPlan(v.porcentaje)}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.porcentaje} aria-label={nombre}>
        <i style={{ width: `${v.porcentaje}%` }} />
      </div>
      <small>
        {v.porcentaje} % usado{v.reinicio ? ` · se reinicia ${reinicioPlan(v.reinicio)}` : ''}
      </small>
    </div>
  )
}

function Plan({ plan }: { plan?: UsoPlan }) {
  const [pidiendo, setPidiendo] = useState(false)
  const actualizar = (): void => {
    setPidiendo(true)
    void window.api.core.usoPlan().finally(() => setPidiendo(false))
  }
  const hay = plan && (plan.cincoHoras || plan.semana)
  return (
    <>
      <strong className="ag-plan-titulo">
        Plan de Claude{plan?.tipo ? ` (${plan.tipo})` : ''}
        <button className="enlace" onClick={actualizar} disabled={pidiendo}>
          {pidiendo ? 'Consultando…' : 'Actualizar'}
        </button>
      </strong>
      {plan?.cincoHoras && <VentanaDelPlan nombre="Sesión (5 h)" v={plan.cincoHoras} />}
      {plan?.semana && <VentanaDelPlan nombre="Semana" v={plan.semana} />}
      {plan?.semanaOpus && <VentanaDelPlan nombre="Semana · Opus" v={plan.semanaOpus} />}
      {plan?.semanaSonnet && <VentanaDelPlan nombre="Semana · Sonnet" v={plan.semanaSonnet} />}
      {plan?.error && <small className={hay ? 'ag-aviso-uso' : ''}>{hay ? `Últimos datos: ${plan.error}` : plan.error}</small>}
      {!plan && <small>Consultando el uso de tu suscripción…</small>}
      {hay && plan.actualizado && <small>Toda la cuenta (web, terminales y otros equipos). Actualizado hace {Math.max(0, Math.round((Date.now() - plan.actualizado) / 1000))} s; se consulta cada minuto.</small>}
    </>
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
      <Plan {...(uso.plan ? { plan: uso.plan } : {})} />
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
export function BarraUso({ detalle, contexto, modelo, modelos, tokensSesion }: Props) {
  const uso = useUso()
  const [abierto, setAbierto] = useState(false)
  const real = contexto?.ventana && (!modelo || modelo === contexto.modelo) ? contexto.ventana : undefined
  // La ventana efectiva es la que el CLI aplica (con la compactación temprana: 200 k aunque el modelo admita 1 M).
  const ventana = detalle?.maximo || (real ?? ventanaDe(modelos, modelo ?? contexto?.modelo))
  const pct = contexto && ventana ? Math.min(100, Math.round((contexto.tokens / ventana) * 100)) : 0
  const desglose = detalle?.categorias.map((c) => `${c.nombre}: ${c.tokens.toLocaleString()}${c.reservado ? ' (margen para compactar)' : ''}`).join('\n')
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
              ? `La conversación ocupa ${contexto.tokens.toLocaleString()} de ${ventana.toLocaleString()} tokens del modelo${contexto.aprox ? ' (estimación)' : ' (dato real de la última llamada)'}. Se compacta sola antes de llenarse y, si crece demasiado, la conversación sigue en una sesión nueva con un resumen.${desglose ? `\n\nDesglose:\n${desglose}` : ''}`
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
      {(uso?.plan?.cincoHoras || uso?.plan?.semana) && (
        <button
          className={`chip ag-plan-chip ${nivelPlan(Math.max(uso.plan.cincoHoras?.porcentaje ?? 0, uso.plan.semana?.porcentaje ?? 0))}`}
          onClick={() => setAbierto((a) => !a)}
          title={`Uso de tu plan de Claude${uso.plan.cincoHoras?.reinicio ? `\nSesión de 5 h: se reinicia ${reinicioPlan(uso.plan.cincoHoras.reinicio)}` : ''}${uso.plan.semana?.reinicio ? `\nSemana: se reinicia ${reinicioPlan(uso.plan.semana.reinicio)}` : ''}${uso.plan.error ? `\n${uso.plan.error}` : ''}`}
        >
          {uso.plan.cincoHoras && <>5 h {uso.plan.cincoHoras.porcentaje} %</>}
          {uso.plan.cincoHoras && uso.plan.semana && ' · '}
          {uso.plan.semana && <>sem {uso.plan.semana.porcentaje} %</>}
        </button>
      )}
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
