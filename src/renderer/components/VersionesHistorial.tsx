import { useCallback, useEffect, useMemo, useState } from 'react'
import { fechaRelativa, NOMBRE_ESTADO, type Commit, type DetalleCommit, type DiffArchivo, type Rama, type RefCommit } from '@shared/versiones'
import { carpetaDeArchivo, nombreDeArchivo } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git, type ContextoGit } from '../versiones/useGit'
import { DiffVista } from './DiffVista'
import { EstadoVacio } from './EstadoVacio'
import { IconoReloj } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'
import { ModalFormulario } from './ModalFormulario'

const PAGINA = 50

const Ref = ({ r }: { r: RefCommit }) => <span className={`chip vc-ref vc-ref-${r.tipo}`}>{r.tipo === 'etiqueta' ? `🏷 ${r.nombre}` : r.nombre}</span>

export function VersionesHistorial({ c }: { c: ContextoGit }) {
  const { proyectoId, run, aplicar, avisar, avisarConflictos, tick } = c
  const [commits, setCommits] = useState<Commit[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [rama, setRama] = useState('') // '' = la actual, '__todas__' = todas
  const [ramas, setRamas] = useState<Rama[]>([])
  const [texto, setTexto] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<DetalleCommit | null>(null)
  const [archivo, setArchivo] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffArchivo | null>(null)
  const [dialogo, setDialogo] = useState<'rama' | 'version' | 'revertir' | null>(null)
  const [error, setError] = useState('')

  const filtro = useCallback((saltar: number) => ({ proyectoId, limite: PAGINA, saltar, ...(rama === '__todas__' ? { todas: true } : rama ? { rama } : {}) }), [proyectoId, rama])

  useEffect(() => {
    let vigente = true
    setCargando(true)
    git('historial', filtro(0))
      .then((r) => vigente && (setCommits(r.commits), setHayMas(r.hayMas), setError('')))
      .catch((e) => vigente && setError(mensajeDe(e)))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [filtro, tick])

  useEffect(() => {
    git('ramas', { proyectoId }).then(setRamas).catch(() => undefined)
  }, [proyectoId, tick])

  useEffect(() => {
    setArchivo(null)
    setDiff(null)
    if (!hash) return void setDetalle(null)
    let vigente = true
    git('detalleCommit', { proyectoId, hash })
      .then((d) => vigente && setDetalle(d))
      .catch((e) => vigente && setError(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [hash, proyectoId])

  useEffect(() => {
    if (!hash || !archivo) return void setDiff(null)
    let vigente = true
    setDiff(null)
    git('diff', { proyectoId, ruta: archivo, hash })
      .then((d) => vigente && setDiff(d))
      .catch(() => vigente && setDiff({ texto: '', binario: false, truncado: false }))
    return () => {
      vigente = false
    }
  }, [hash, archivo, proyectoId])

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return t ? commits.filter((x) => `${x.asunto} ${x.autor} ${x.corto} ${x.refs.map((r) => r.nombre).join(' ')}`.toLowerCase().includes(t)) : commits
  }, [commits, texto])

  const cargarMas = (): void => {
    setCargando(true)
    git('historial', filtro(commits.length))
      .then((r) => (setCommits((x) => [...x, ...r.commits]), setHayMas(r.hayMas)))
      .catch((e) => setError(mensajeDe(e)))
      .finally(() => setCargando(false))
  }

  if (!cargando && commits.length === 0 && !error && rama === '') {
    return <EstadoVacio icono={<IconoReloj />} titulo="Aún no hay commits" texto="Cuando confirmes tus primeros cambios, su historial aparecerá aquí." />
  }

  const actual = commits.find((x) => x.hash === hash)
  return (
    <div className="vc-historial">
      <div className="vc-lista">
        <div className="vc-filtros">
          <select value={rama} onChange={(e) => (setRama(e.target.value), setHash(null))} aria-label="Rama">
            <option value="">Rama actual</option>
            <option value="__todas__">Todas las ramas</option>
            {ramas.map((r) => (
              <option key={r.nombre} value={r.nombre}>
                {r.nombre}
              </option>
            ))}
          </select>
          <input type="search" value={texto} placeholder="Filtrar…" onChange={(e) => setTexto(e.target.value)} aria-label="Filtrar commits" />
        </div>
        {error && <p className="vc-nota error">{error}</p>}
        <ul className="vc-commits">
          {visibles.map((x) => (
            <li key={x.hash}>
              <button className={`vc-commit-fila${x.hash === hash ? ' sel' : ''}`} onClick={() => setHash(x.hash)}>
                <span className="vc-punto-commit" data-merge={x.padres.length > 1} aria-hidden="true" />
                <span className="vc-commit-texto">
                  <span className="vc-asunto">{x.asunto || '(sin mensaje)'}</span>
                  <span className="vc-meta">
                    {x.refs.map((r) => (
                      <Ref key={`${r.tipo}${r.nombre}`} r={r} />
                    ))}
                    <span>{x.autor}</span>
                    <span title={new Date(x.fecha).toLocaleString()}>{fechaRelativa(x.fecha)}</span>
                    <code>{x.corto}</code>
                  </span>
                </span>
              </button>
            </li>
          ))}
          {visibles.length === 0 && !cargando && <li className="vc-nota">Ningún commit coincide.</li>}
        </ul>
        {hayMas && (
          <button className="vc-mas-btn" disabled={cargando} onClick={cargarMas}>
            {cargando ? 'Cargando…' : 'Cargar más'}
          </button>
        )}
      </div>

      {detalle && actual ? (
        <div className="vc-detalle">
          <div className="vc-detalle-cab">
            <h3>{detalle.commit.asunto}</h3>
            {detalle.cuerpo && <p className="vc-cuerpo-commit">{detalle.cuerpo}</p>}
            <p className="vc-meta">
              <strong>{detalle.commit.autor}</strong> &lt;{detalle.commit.correo}&gt; · {new Date(detalle.commit.fecha).toLocaleString()}
            </p>
            <p className="vc-meta">
              <code>{detalle.commit.hash}</code>
              <button className="icono" onClick={() => void navigator.clipboard.writeText(detalle.commit.hash).then(() => avisar('Hash copiado.'))} title="Copiar hash" aria-label="Copiar hash">
                ⧉
              </button>
              {detalle.commit.padres.length > 0 && <span>padre{detalle.commit.padres.length > 1 ? 's' : ''}: {detalle.commit.padres.map((p) => p.slice(0, 7)).join(', ')}</span>}
            </p>
            <div className="vc-acciones visibles">
              <button onClick={() => setDialogo('rama')}>Crear rama aquí</button>
              <button onClick={() => setDialogo('version')}>Crear versión aquí</button>
              <button onClick={() => setDialogo('revertir')}>Revertir</button>
            </div>
          </div>
          <ul className="vc-archivos-commit">
            {detalle.archivos.map((f) => (
              <li key={f.ruta}>
                <button className={`vc-fila-btn${archivo === f.ruta ? ' sel' : ''}`} onClick={() => setArchivo(archivo === f.ruta ? null : f.ruta)}>
                  <span className={`vc-estado vc-e-${f.estado}`} title={NOMBRE_ESTADO[f.estado] ?? f.estado}>
                    {f.estado}
                  </span>
                  <span className="vc-nombre">
                    <span className="vc-dir">{carpetaDeArchivo(f.ruta)}</span>
                    {nombreDeArchivo(f.ruta)}
                  </span>
                  <span className="vc-cifras">
                    {f.adiciones === null ? 'bin' : <><span className="vc-mas">+{f.adiciones}</span> <span className="vc-menos">−{f.eliminaciones}</span></>}
                  </span>
                </button>
              </li>
            ))}
            {detalle.archivos.length === 0 && <li className="vc-nota">Este commit no cambia archivos.</li>}
          </ul>
          {archivo && diff && <DiffVista titulo={archivo} texto={diff.texto} binario={diff.binario} truncado={diff.truncado} />}
        </div>
      ) : (
        <EstadoVacio variante="compacto" icono={<IconoReloj />} titulo="Elige un commit" texto="Verás quién lo hizo, qué archivos cambió y las diferencias." />
      )}

      {dialogo === 'rama' && detalle && (
        <ModalFormulario
          titulo="Crear rama desde este commit"
          descripcion={`Nueva rama a partir de ${detalle.commit.corto}.`}
          campos={[{ id: 'nombre', etiqueta: 'Nombre de la rama', placeholder: 'feat/mi-cambio', obligatorio: true }]}
          casilla={{ etiqueta: 'Cambiar a la rama nueva', valor: true }}
          etiquetaBoton="Crear rama"
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v, cambiar) => {
            const e = await run('Creando rama…', () => git('crearRama', { proyectoId, nombre: v.nombre!, desde: detalle.commit.hash, cambiar }))
            if (e) (aplicar(e), avisar(`Rama «${v.nombre}» creada.`))
            return Boolean(e)
          }}
        />
      )}
      {dialogo === 'version' && detalle && (
        <ModalFormulario
          titulo="Crear versión en este commit"
          descripcion={`Etiqueta anotada sobre ${detalle.commit.corto}. Para la próxima versión sugerida usa la pestaña «Versiones».`}
          campos={[
            { id: 'nombre', etiqueta: 'Versión', placeholder: 'v1.0.0', obligatorio: true },
            { id: 'mensaje', etiqueta: 'Mensaje (opcional)', multilinea: true }
          ]}
          etiquetaBoton="Crear versión"
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v) => {
            const r = await run('Creando versión…', () => git('crearEtiqueta', { proyectoId, nombre: v.nombre!, ...(v.mensaje?.trim() ? { mensaje: v.mensaje } : {}), commit: detalle.commit.hash }))
            if (r) (c.recargar(), avisar(`Versión «${v.nombre}» creada.`))
            return Boolean(r)
          }}
        />
      )}
      {dialogo === 'revertir' && detalle && (
        <ModalConfirmar
          titulo="Revertir commit"
          texto={`Se creará un commit nuevo que deshace los cambios de «${detalle.commit.asunto}». El historial no se reescribe.`}
          etiqueta="Revertir"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() =>
            void run('Revirtiendo…', () => git('revertir', { proyectoId, hash: detalle.commit.hash })).then((r) => {
              if (!r) return
              aplicar(r.estado)
              if (r.conflictos) avisarConflictos('El revert dejó conflictos: resuélvelos y confirma, o aborta la operación.')
              else avisar('Commit revertido.')
            })
          }
        />
      )}
    </div>
  )
}
