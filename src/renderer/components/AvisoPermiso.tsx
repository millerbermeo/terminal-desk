import type { Denegacion } from '../agente/permisos-denegados'

const ICONO: Record<Denegacion['tipo'], string> = { sistema: '🔒', regla: '📏', guardrail: '🛡', usuario: '✋', autonomo: '⛔', credenciales: '🔑', sudo: '⚡', cli: '🔐' }

/**
 * Explica en claro por qué el asistente no pudo hacer algo: qué intentó, por qué se bloqueó y qué permiso necesita (y cómo darlo).
 * El texto técnico original queda plegado por si hace falta.
 */
export function AvisoPermiso({ d, tecnico, sangria }: { d: Denegacion; tecnico?: string; sangria?: React.CSSProperties }) {
  return (
    <section className={`avp tipo-${d.tipo}`} style={sangria} role="alert">
      <header className="avp-cab">
        <span className="avp-icono" aria-hidden="true">{ICONO[d.tipo]}</span>
        <h4>{d.titulo}</h4>
      </header>
      <dl className="avp-cuerpo">
        <div>
          <dt>Intentó</dt>
          <dd>
            {d.accion}
            {d.objetivo && <code> {d.objetivo}</code>}
          </dd>
        </div>
        <div>
          <dt>Por qué no pudo</dt>
          <dd>{d.porque}</dd>
        </div>
        <div className="avp-permiso">
          <dt>Permiso que necesita</dt>
          <dd>{d.permiso}</dd>
        </div>
        <div>
          <dt>Cómo darlo</dt>
          <dd>{d.solucion}</dd>
        </div>
      </dl>
      {tecnico && (
        <details className="avp-tecnico">
          <summary>Detalle técnico</summary>
          <pre>{tecnico.length > 1500 ? `${tecnico.slice(0, 1500)}\n[… recortado]` : tecnico}</pre>
        </details>
      )}
    </section>
  )
}
