import { useEffect, useState } from 'react'
import { carpetaDeArchivo, enConflicto, nombreDeArchivo, NOMBRE_ESTADO, preparados, sinPreparar, type ArchivoCambio, type DiffArchivo } from '@shared/versiones'
import { git, type ContextoGit } from '../versiones/useGit'
import { DiffVista } from './DiffVista'
import { EstadoVacio } from './EstadoVacio'
import { IconoCheck } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'

type Lado = 'preparado' | 'cambio' | 'conflicto'
interface Seleccion {
  ruta: string
  lado: Lado
}

const letra = (a: ArchivoCambio, lado: Lado): string => (a.conflicto ? '!' : a.sinSeguimiento ? 'U' : lado === 'preparado' ? a.indice : a.trabajo)

function Fila({ a, lado, seleccionado, ocupado, onSel, onPreparar, onDespreparar, onDescartar }: { a: ArchivoCambio; lado: Lado; seleccionado: boolean; ocupado: boolean; onSel: () => void; onPreparar?: () => void; onDespreparar?: () => void; onDescartar?: () => void }) {
  const l = letra(a, lado)
  return (
    <li className={`vc-fila${seleccionado ? ' sel' : ''}`}>
      <button className="vc-fila-btn" onClick={onSel} title={a.anterior ? `${a.anterior} → ${a.ruta}` : a.ruta}>
        <span className={`vc-estado vc-e-${l === '!' ? 'conf' : l}`} title={NOMBRE_ESTADO[l] ?? l}>
          {l}
        </span>
        <span className="vc-nombre">
          <span className="vc-dir">{carpetaDeArchivo(a.ruta)}</span>
          {nombreDeArchivo(a.ruta)}
        </span>
        {a.anterior && <span className="vc-dir">← {nombreDeArchivo(a.anterior)}</span>}
      </button>
      <span className="vc-acciones">
        {onDescartar && (
          <button className="icono" disabled={ocupado} onClick={onDescartar} title="Descartar cambios" aria-label={`Descartar ${a.ruta}`}>
            ↺
          </button>
        )}
        {onPreparar && (
          <button className="icono" disabled={ocupado} onClick={onPreparar} title={lado === 'conflicto' ? 'Marcar como resuelto' : 'Preparar para el commit'} aria-label={`Preparar ${a.ruta}`}>
            ＋
          </button>
        )}
        {onDespreparar && (
          <button className="icono" disabled={ocupado} onClick={onDespreparar} title="Quitar de lo que se confirma" aria-label={`Quitar ${a.ruta}`}>
            −
          </button>
        )}
      </span>
    </li>
  )
}

export function VersionesCambios({ c }: { c: ContextoGit }) {
  const { proyectoId, estado, run, ocupado, aplicar, avisar } = c
  const [sel, setSel] = useState<Seleccion | null>(null)
  const [diff, setDiff] = useState<DiffArchivo | null>(null)
  const [cargandoDiff, setCargandoDiff] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [enmendar, setEnmendar] = useState(false)
  const [descartar, setDescartar] = useState<string[] | null>(null)
  const [soloMensaje, setSoloMensaje] = useState(false) // sin cambios pendientes: se abre el panel solo para enmendar el último commit

  const conflictos = enConflicto(estado)
  const listos = preparados(estado)
  const pendientes = sinPreparar(estado)
  const bloqueado = ocupado !== ''

  // La selección se mantiene mientras el archivo siga en esa lista; si desaparece (se preparó, se descartó…) se pasa al otro lado o se quita.
  useEffect(() => {
    if (!sel) return
    const a = estado.archivos.find((x) => x.ruta === sel.ruta)
    if (!a) return setSel(null)
    const enLado = sel.lado === 'conflicto' ? a.conflicto : sel.lado === 'preparado' ? !a.conflicto && a.indice !== '.' : !a.conflicto && (a.sinSeguimiento || a.trabajo !== '.')
    if (!enLado) setSel({ ruta: a.ruta, lado: a.conflicto ? 'conflicto' : a.indice !== '.' ? 'preparado' : 'cambio' })
  }, [estado, sel])

  useEffect(() => {
    if (!sel) return void setDiff(null)
    let vigente = true
    setCargandoDiff(true)
    git('diff', { proyectoId, ruta: sel.ruta, preparado: sel.lado === 'preparado' })
      .then((d) => vigente && setDiff(d))
      .catch(() => vigente && setDiff({ texto: '', binario: false, truncado: false }))
      .finally(() => vigente && setCargandoDiff(false))
    return () => {
      vigente = false
    }
  }, [sel, proyectoId, c.tick])

  const preparar = (rutas?: string[]): void => void run('Preparando…', () => git('preparar', { proyectoId, ...(rutas ? { rutas } : {}) })).then((e) => e && aplicar(e))
  const despreparar = (rutas?: string[]): void => void run('Quitando…', () => git('despreparar', { proyectoId, ...(rutas ? { rutas } : {}) })).then((e) => e && aplicar(e))
  const confirmarDescarte = (): void => {
    const rutas = descartar ?? []
    setDescartar(null)
    void run('Descartando…', () => git('descartar', { proyectoId, rutas })).then((e) => {
      if (e) {
        aplicar(e)
        avisar(`${rutas.length === 1 ? 'Cambios descartados' : `Cambios de ${rutas.length} archivos descartados`}.`)
      }
    })
  }
  const hacerCommit = (): void => {
    void run('Confirmando…', () => git('commit', { proyectoId, mensaje, enmendar })).then((r) => {
      if (!r) return
      aplicar(r.estado)
      setMensaje('')
      setEnmendar(false)
      setSoloMensaje(false)
      avisar(`${enmendar ? 'Commit enmendado' : 'Commit creado'}: ${r.hash}`)
    })
  }

  // Durante una fusión, un revert… git propone su propio mensaje: se puede confirmar sin escribir nada.
  const puedeCommit = !bloqueado && conflictos.length === 0 && (enmendar ? true : (listos.length > 0 && mensaje.trim() !== '') || Boolean(estado.operacion))

  if (estado.archivos.length === 0 && !estado.operacion && !soloMensaje) {
    return (
      <EstadoVacio
        icono={<IconoCheck />}
        titulo="Todo está confirmado"
        texto={estado.sinCommits ? 'Aún no hay archivos en este proyecto. Cuando crees o cambies alguno, aparecerá aquí.' : 'No hay cambios pendientes. Cuando modifiques archivos aparecerán aquí para que los prepares y los confirmes.'}
        accion={
          estado.sinCommits ? undefined : (
            <button onClick={() => (setSoloMensaje(true), setEnmendar(true))} title="Cambiar el mensaje del último commit (no lo hagas si ya lo enviaste)">
              Editar el mensaje del último commit
            </button>
          )
        }
      />
    )
  }

  const seccion = (titulo: string, n: number, acciones: React.ReactNode, filas: React.ReactNode) =>
    n > 0 && (
      <section className="vc-seccion">
        <header>
          <h4>
            {titulo} <span className="chip">{n}</span>
          </h4>
          <span className="vc-acciones visibles">{acciones}</span>
        </header>
        <ul>{filas}</ul>
      </section>
    )

  return (
    <div className="vc-cambios">
      <div className="vc-lista">
        <div className="vc-lista-scroll">
          {seccion('Conflictos', conflictos.length, null, conflictos.map((a) => (
            <Fila key={a.ruta} a={a} lado="conflicto" seleccionado={sel?.ruta === a.ruta} ocupado={bloqueado} onSel={() => setSel({ ruta: a.ruta, lado: 'conflicto' })} onPreparar={() => preparar([a.ruta])} />
          )))}
          {seccion(
            'Preparados',
            listos.length,
            <button className="icono" disabled={bloqueado} onClick={() => despreparar()} title="Quitar todos de lo que se confirma">
              − Todos
            </button>,
            listos.map((a) => (
              <Fila key={a.ruta} a={a} lado="preparado" seleccionado={sel?.ruta === a.ruta && sel.lado === 'preparado'} ocupado={bloqueado} onSel={() => setSel({ ruta: a.ruta, lado: 'preparado' })} onDespreparar={() => despreparar([a.ruta])} />
            ))
          )}
          {seccion(
            'Cambios',
            pendientes.length,
            <>
              <button className="icono" disabled={bloqueado} onClick={() => setDescartar(pendientes.map((a) => a.ruta))} title="Descartar todos los cambios sin preparar">
                ↺ Todos
              </button>
              <button className="icono" disabled={bloqueado} onClick={() => preparar()} title="Preparar todo">
                ＋ Todos
              </button>
            </>,
            pendientes.map((a) => (
              <Fila key={a.ruta} a={a} lado="cambio" seleccionado={sel?.ruta === a.ruta && sel.lado === 'cambio'} ocupado={bloqueado} onSel={() => setSel({ ruta: a.ruta, lado: 'cambio' })} onPreparar={() => preparar([a.ruta])} onDescartar={() => setDescartar([a.ruta])} />
            ))
          )}
          {estado.truncado && <p className="tareas-suave" style={{ padding: 12 }}>Hay muchos archivos: solo se muestran los primeros. Revisa tu .gitignore.</p>}
        </div>
        <div className="vc-commit">
          <textarea
            value={mensaje}
            rows={3}
            placeholder={enmendar ? 'Sin mensaje se conserva el del commit anterior' : estado.operacion ? 'Sin mensaje se usa el que propone git (Ctrl+Enter para confirmar)' : 'Mensaje del commit (Ctrl+Enter para confirmar)'}
            onChange={(e) => setMensaje(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && puedeCommit) hacerCommit()
            }}
            aria-label="Mensaje del commit"
          />
          <div className="vc-commit-pie">
            <label className="vc-casilla" title="Cambia el último commit en vez de crear uno nuevo (no lo hagas si ya lo enviaste)">
              <input type="checkbox" checked={enmendar} disabled={estado.sinCommits} onChange={(e) => setEnmendar(e.target.checked)} /> Enmendar último
            </label>
            <button className="primario" disabled={!puedeCommit} onClick={hacerCommit}>
              {ocupado === 'Confirmando…' ? 'Confirmando…' : enmendar ? 'Enmendar commit' : `Confirmar${listos.length ? ` (${listos.length})` : ''}`}
            </button>
          </div>
          {conflictos.length > 0 && <p className="vc-nota">Resuelve los conflictos y márcalos como resueltos (＋) para poder confirmar.</p>}
          {conflictos.length === 0 && listos.length === 0 && !enmendar && !estado.operacion && <p className="vc-nota">Prepara (＋) los archivos que quieras incluir.</p>}
          {soloMensaje && (
            <p className="vc-nota">
              Solo se cambia el mensaje del último commit.{' '}
              <button className="enlace" onClick={() => (setSoloMensaje(false), setEnmendar(false))}>
                Cancelar
              </button>
            </p>
          )}
        </div>
      </div>
      {sel ? (
        <DiffVista titulo={sel.ruta} texto={diff?.texto ?? ''} binario={diff?.binario ?? false} truncado={diff?.truncado ?? false} cargando={cargandoDiff} vacio={sel.lado === 'conflicto' ? 'Abre el archivo en el editor para resolver el conflicto.' : 'Sin diferencias que mostrar.'} />
      ) : (
        <EstadoVacio variante="compacto" icono={<IconoCheck />} titulo="Elige un archivo" texto="Selecciona un archivo de la lista para ver qué cambió." />
      )}
      {descartar && (
        <ModalConfirmar
          titulo="Descartar cambios"
          texto={
            descartar.length === 1
              ? `¿Descartar los cambios de «${descartar[0]}»? Vuelve a como estaba en el último commit (un archivo nuevo se borra). No se puede deshacer.`
              : `¿Descartar los cambios de ${descartar.length} archivos? Los modificados vuelven al último commit y los archivos nuevos se borran. No se puede deshacer.`
          }
          etiqueta="Descartar"
          onConfirmar={confirmarDescarte}
          onCerrar={() => setDescartar(null)}
        />
      )}
    </div>
  )
}
