import { useCallback, useEffect, useState } from 'react'
import type { AccionRegla, ReglaPermiso } from '@shared/core/permisos'
import { EstadoVacio } from './EstadoVacio'
import { IconoEscudo } from './Iconos'

const limpiar = (m: string): string => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  /** Proyecto cuyas reglas se editan; sin él, las globales. */
  proyectoId?: string
  visible?: boolean
}

function Lista({ reglas, onEliminar }: { reglas: ReglaPermiso[]; onEliminar: (r: ReglaPermiso) => void }) {
  return (
    <>
      {reglas.map((r) => (
        <div className="cfg-proyecto" key={r.id}>
          <span className={`chip ${r.accion === 'permitir' ? 'chip-ok' : 'chip-aviso'}`}>{r.accion}</span>
          <span className="chip">{r.tipo}</span>
          <code title={r.patron}>{r.patron}</code>
          <button className="peligro" style={{ opacity: 1 }} title="Eliminar regla" onClick={() => onEliminar(r)}>✕</button>
        </div>
      ))}
    </>
  )
}

/** Reglas que el agente aplica sin preguntar (permitir) o que le prohíben (denegar), por proyecto o globales. */
export function PermisosAgente({ proyectoId, visible = true }: Props) {
  const [propias, setPropias] = useState<ReglaPermiso[]>([])
  const [globales, setGlobales] = useState<ReglaPermiso[]>([])
  const [tipo, setTipo] = useState<'comando' | 'herramienta'>('comando')
  const [accion, setAccion] = useState<AccionRegla>('permitir')
  const [patron, setPatron] = useState('')
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    void window.api.core.permisosListar(proyectoId).then(setPropias)
    if (proyectoId) void window.api.core.permisosListar(undefined).then(setGlobales)
    else setGlobales([])
  }, [proyectoId])
  useEffect(() => {
    if (visible) cargar()
  }, [visible, cargar])

  const agregar = (): void => {
    setError('')
    window.api.core
      .permisosAgregar({ tipo, patron, accion }, proyectoId)
      .then((l) => {
        setPropias(l)
        setPatron('')
      })
      .catch((e: Error) => setError(limpiar(e.message)))
  }
  const eliminar = (ambito: string | undefined) => (r: ReglaPermiso) => void window.api.core.permisosEliminar(r.id, ambito).then(() => cargar())

  return (
    <div className="permisos">
      <p className="cfg-intro">
        Lo que permites aquí el agente lo hace sin preguntar; lo que deniegas, nunca. <strong>Las acciones destructivas</strong> (<code>rm</code>, <code>git push</code>,{' '}
        <code>reset --hard</code>, <code>sudo</code>…) <strong>siempre piden confirmación</strong>, aunque una regla las permita, y los guardrails (credenciales, <code>.env</code>, <code>.git</code>)
        siguen activos. Ejemplos de comandos: <code>pnpm test</code> (exacto) o <code>git commit *</code> (cualquier argumento detrás). Los intérpretes (<code>node</code>,{' '}
        <code>bash</code>, <code>python</code>…) solo se admiten con el comando exacto.
      </p>
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab"><h3>{proyectoId ? 'Reglas de este proyecto' : 'Reglas globales'}</h3></div>
        {propias.length === 0 && <EstadoVacio variante="compacto" icono={<IconoEscudo />} titulo="Sin reglas propias" texto="Todo lo que no sea de solo lectura se pregunta antes de ejecutarse." />}
        <Lista reglas={propias} onEliminar={eliminar(proyectoId)} />
      </section>
      {proyectoId && globales.length > 0 && (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab"><h3>Reglas globales (valen también aquí)</h3></div>
          <Lista reglas={globales} onEliminar={eliminar(undefined)} />
        </section>
      )}
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab"><h3>Añadir regla</h3></div>
        <div className="mem-form">
          <div className="ag-opciones">
            <select value={accion} onChange={(e) => setAccion(e.target.value as AccionRegla)} aria-label="Acción">
              <option value="permitir">Permitir</option>
              <option value="denegar">Denegar</option>
            </select>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as 'comando' | 'herramienta')} aria-label="Tipo">
              <option value="comando">Comando</option>
              <option value="herramienta">Herramienta</option>
            </select>
            <input
              placeholder={tipo === 'comando' ? 'pnpm test   ·   git commit *' : 'escribir_archivo   ·   mcp__db__*'}
              value={patron}
              onChange={(e) => setPatron(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && patron.trim() && agregar()}
            />
          </div>
          {error && <div className="cfg-error">{error}</div>}
          <div className="cfg-acciones">
            <button className="primario" disabled={!patron.trim()} onClick={agregar}>Añadir</button>
          </div>
        </div>
      </section>
    </div>
  )
}
