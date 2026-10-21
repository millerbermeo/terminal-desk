import { useCallback, useEffect, useState } from 'react'
import { dividirArgumentos, nombreReservado, type ComandoUsuario } from '@shared/core/comandos'
import { EstadoVacio } from './EstadoVacio'
import { IconoRayo } from './Iconos'

const limpiar = (m: string): string => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const vacio = (): ComandoUsuario => ({ nombre: '', descripcion: '', tipo: 'ejecutable', comando: [], argumentos: false, permitido: false })
const lineaDe = (c: ComandoUsuario): string => (c.comando ?? []).map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' ')

interface Props {
  /** Proyecto cuyos comandos se editan; sin él, los globales. */
  proyectoId?: string
  visible?: boolean
}

/** Comandos propios que se escriben en el chat como `/nombre`. */
export function ComandosAgente({ proyectoId, visible = true }: Props) {
  const [propios, setPropios] = useState<ComandoUsuario[]>([])
  const [globales, setGlobales] = useState<ComandoUsuario[]>([])
  const [c, setC] = useState<ComandoUsuario>(vacio())
  const [linea, setLinea] = useState('')
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    void window.api.core.comandosListar(proyectoId).then(setPropios)
    if (proyectoId) void window.api.core.comandosListar(undefined).then(setGlobales)
    else setGlobales([])
  }, [proyectoId])
  useEffect(() => {
    if (visible) cargar()
  }, [visible, cargar])

  const editar = (x: ComandoUsuario): void => {
    setC(x)
    setLinea(lineaDe(x))
    setError('')
  }
  const nuevo = (): void => editar(vacio())

  const guardar = (): void => {
    setError('')
    const cmd: ComandoUsuario = c.tipo === 'ejecutable' ? { ...c, comando: dividirArgumentos(linea) } : c
    window.api.core
      .comandosGuardar(cmd, proyectoId)
      .then((l) => {
        setPropios(l)
        nuevo()
      })
      .catch((e: Error) => setError(limpiar(e.message)))
  }

  const fila = (x: ComandoUsuario, ambito: string | undefined, editable: boolean) => (
    <div className="cfg-proyecto" key={`${ambito ?? 'g'}-${x.nombre}`}>
      <strong>/{x.nombre}</strong>
      <span className={`chip ${x.tipo === 'prompt' ? 'chip-ok' : ''}`} title={x.tipo === 'prompt' ? 'Lo resuelve la IA' : 'Ejecuta un programa, sin IA'}>{x.tipo === 'prompt' ? 'prompt · IA' : 'manual'}</span>
      {x.permitido && <span className="chip chip-ok" title="Se ejecuta sin pedir confirmación">permitido</span>}
      <code title={x.tipo === 'prompt' ? x.plantilla : lineaDe(x)}>{x.descripcion}</code>
      {editable && (
        <>
          <button className="icono" style={{ opacity: 1 }} title="Editar" onClick={() => editar(x)}>✎</button>
          <button className="peligro" style={{ opacity: 1 }} title="Eliminar" onClick={() => void window.api.core.comandosEliminar(x.nombre, ambito).then(setPropios)}>✕</button>
        </>
      )}
    </div>
  )

  return (
    <div className="permisos">
      <p className="cfg-intro">
        Escríbelos en el chat como <code>/nombre</code>. Hay dos tipos. Un comando <strong>manual</strong> hace una tarea por ti, sin IA: lanza un programa fijo (sin shell), como <code>pnpm test</code>, y su
        salida se muestra en el chat (la IA la ve en tu siguiente mensaje). Uno de <strong>prompt</strong> es una petición reutilizable para la IA (<code>$ARGUMENTOS</code> se sustituye por lo que escribas
        detrás). Los manuales piden confirmación salvo que los marques como «permitidos»; los destructivos (<code>rm</code>, <code>git push</code>…) siempre la piden.
      </p>
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab"><h3>{proyectoId ? 'Comandos de este proyecto' : 'Comandos globales'}</h3></div>
        {propios.length === 0 && <EstadoVacio variante="compacto" icono={<IconoRayo />} titulo="Aún no hay comandos" texto="Crea atajos que se escriben con / en el chat: manuales (ejecutan una tarea, sin IA) o prompts (una petición para la IA)." />}
        {propios.map((x) => fila(x, proyectoId, true))}
      </section>
      {proyectoId && globales.length > 0 && (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab"><h3>Comandos globales (valen también aquí)</h3></div>
          {globales.map((x) => fila(x, undefined, false))}
        </section>
      )}
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>{propios.some((x) => x.nombre === c.nombre) ? `Editar /${c.nombre}` : 'Nuevo comando'}</h3>
          <button onClick={nuevo}>Limpiar</button>
        </div>
        <div className="mem-form">
          <div className="ag-opciones">
            <input placeholder="nombre (sin /)" value={c.nombre} onChange={(e) => setC({ ...c, nombre: e.target.value.toLowerCase() })} style={{ maxWidth: 180 }} />
            <select value={c.tipo} onChange={(e) => setC({ ...c, tipo: e.target.value as ComandoUsuario['tipo'] })} aria-label="Tipo">
              <option value="ejecutable">Manual (ejecuta una tarea, sin IA)</option>
              <option value="prompt">Prompt (petición para la IA)</option>
            </select>
            <input placeholder="Descripción" value={c.descripcion} onChange={(e) => setC({ ...c, descripcion: e.target.value })} />
          </div>
          {c.tipo === 'prompt' ? (
            <textarea rows={4} placeholder="Revisa los cambios sin confirmar y busca bugs. $ARGUMENTOS" value={c.plantilla ?? ''} onChange={(e) => setC({ ...c, plantilla: e.target.value })} />
          ) : (
            <>
              <input placeholder='pnpm test   ·   node scripts/seed.js   ·   git log --oneline -n 5' value={linea} onChange={(e) => setLinea(e.target.value)} />
              <div className="ag-opciones">
                <label className="ag-check"><input type="checkbox" checked={c.argumentos === true} onChange={(e) => setC({ ...c, argumentos: e.target.checked })} /> Admite argumentos tras el nombre</label>
                <label className="ag-check"><input type="checkbox" checked={c.permitido === true} onChange={(e) => setC({ ...c, permitido: e.target.checked })} /> Permitido: ejecutar sin pedir confirmación</label>
              </div>
            </>
          )}
          {c.nombre && nombreReservado(c.nombre) && <div className="cfg-error">{nombreReservado(c.nombre)}</div>}
          {error && <div className="cfg-error">{error}</div>}
          <div className="cfg-acciones">
            <button className="primario" disabled={!c.nombre.trim() || !c.descripcion.trim() || nombreReservado(c.nombre.trim()) !== null} onClick={guardar}>Guardar</button>
          </div>
        </div>
      </section>
    </div>
  )
}
