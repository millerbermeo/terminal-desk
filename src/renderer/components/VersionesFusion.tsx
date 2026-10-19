import { useEffect, useMemo, useState } from 'react'
import type { ArchivoFusion, DatosArchivoFusion, Decision, PrevisualizacionFusion, ResolucionFusion } from '@shared/fusion'
import type { Rama } from '@shared/versiones'
import { carpetaDeArchivo, nombreDeArchivo } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git, type ContextoGit } from '../versiones/useGit'
import { EditorFusion } from './EditorFusion'
import { EstadoVacio } from './EstadoVacio'
import { IconoRama } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'

const ETIQUETA: Record<string, string> = { A: 'añadido', M: 'modificado', D: 'borrado' }

/** Archivo abierto: o el editor de tres paneles, o (si un lado lo borró o no es texto) la elección de una versión entera. */
type Abierto = { ruta: string; datos: DatosArchivoFusion } | { ruta: string; entero: true; borrado: { actual: boolean; origen: boolean } }

/**
 * Fusión asistida: compara la rama actual con otra y deja integrarla archivo a archivo en un editor de tres paneles (origen · resultado ·
 * actual), resolviendo los conflictos a mano. No toca nada hasta pulsar «Fusionar».
 */
export function VersionesFusion({ c }: { c: ContextoGit }) {
  const { proyectoId, estado, run, aplicar, avisar, ocupado, tick } = c
  const [ramas, setRamas] = useState<Rama[]>([])
  const [origen, setOrigen] = useState('')
  const [previa, setPrevia] = useState<PrevisualizacionFusion | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [resoluciones, setResoluciones] = useState<Record<string, ResolucionFusion>>({})
  const [borradores, setBorradores] = useState<Record<string, Map<number, Decision>>>({})
  const [mensaje, setMensaje] = useState('')
  const [confirmar, setConfirmar] = useState(true)
  const [pidiendo, setPidiendo] = useState(false)

  useEffect(() => {
    let vigente = true
    git('ramas', { proyectoId })
      .then((r) => vigente && setRamas(r))
      .catch((e) => vigente && setError(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [proyectoId, tick])

  // Cambiar de proyecto o de rama actual invalida la comparación.
  useEffect(() => {
    setPrevia(null)
    setAbierto(null)
    setResoluciones({})
    setBorradores({})
    setOrigen('')
  }, [proyectoId, estado.rama])

  const candidatas = useMemo(() => ramas.filter((r) => !r.actual).sort((a, b) => Number(a.remota) - Number(b.remota) || a.nombre.localeCompare(b.nombre)), [ramas])
  const bloqueado = ocupado !== ''
  const enCurso = Boolean(estado.operacion)
  const sinCambios = estado.archivos.filter((a) => !a.sinSeguimiento).length === 0

  const comparar = (): void => {
    if (!origen) return
    setCargando(true)
    setError('')
    setAbierto(null)
    setResoluciones({})
    setBorradores({})
    git('fusionPrevia', { proyectoId, origen })
      .then((p) => (setPrevia(p), setMensaje(`Merge branch '${p.origen}' into ${p.actual}`)))
      .catch((e) => (setPrevia(null), setError(mensajeDe(e))))
      .finally(() => setCargando(false))
  }

  const abrir = (a: ArchivoFusion): void => {
    setError('')
    git('fusionArchivo', { proyectoId, origen: previa!.origen, ruta: a.ruta })
      .then((datos) => {
        // Si una rama borró el archivo no hay nada que mezclar línea a línea: se elige una versión entera.
        if (!datos.existe.actual || !datos.existe.origen) setAbierto({ ruta: a.ruta, entero: true, borrado: { actual: !datos.existe.actual, origen: !datos.existe.origen } })
        else setAbierto({ ruta: a.ruta, datos })
      })
      .catch((e) => {
        const m = mensajeDe(e)
        // Binario o enorme: solo se puede elegir una versión entera.
        if (/binario|demasiado grande/i.test(m) || a.noTexto) setAbierto({ ruta: a.ruta, entero: true, borrado: { actual: false, origen: false } })
        else setError(m)
      })
  }

  const pendientes = previa ? previa.archivos.filter((a) => a.estado === 'conflicto' && a.conflictos > 0 && !resoluciones[a.ruta]) : []
  const conflictivos = previa ? previa.archivos.filter((a) => a.estado === 'conflicto' && a.conflictos > 0) : []

  const fusionar = (): void => {
    if (!previa) return
    setPidiendo(false)
    void run('Fusionando…', () => git('fusionAplicar', { proyectoId, origen: previa.origen, resoluciones, mensaje, confirmar })).then((r) => {
      if (!r) return
      aplicar(r.estado)
      avisar(r.hash ? `«${previa.origen}» fusionada en «${previa.actual}» (${r.hash}).` : `«${previa.origen}» integrada: revisa y confirma en «Cambios».`)
      setPrevia(null)
      setAbierto(null)
      setResoluciones({})
      setBorradores({})
      setOrigen('')
    })
  }

  if (abierto && previa) {
    if ('entero' in abierto) {
      return (
        <div className="vc-pagina">
          <section className="cfg-grupo">
            <div className="cfg-grupo-cab">
              <h3 className="mono">{abierto.ruta}</h3>
            </div>
            <p className="vc-nota">
              {abierto.borrado.actual || abierto.borrado.origen
                ? `${abierto.borrado.origen ? `«${previa.origen}»` : `«${previa.actual}»`} borró este archivo y la otra rama lo cambió: elige con cuál quedarte.`
                : 'Este archivo es binario o demasiado grande para mostrarlo línea a línea: elige la versión de una de las dos ramas.'}
            </p>
            <div className="vc-acciones visibles">
              <button className="primario" onClick={() => (setResoluciones((r) => ({ ...r, [abierto.ruta]: { tipo: 'origen' } })), setAbierto(null))}>
                Quedarme con la de «{previa.origen}»{abierto.borrado.origen ? ' (borrar el archivo)' : ''}
              </button>
              <button className="primario" onClick={() => (setResoluciones((r) => ({ ...r, [abierto.ruta]: { tipo: 'actual' } })), setAbierto(null))}>
                Quedarme con la de «{previa.actual}»{abierto.borrado.actual ? ' (borrar el archivo)' : ''}
              </button>
              <button onClick={() => setAbierto(null)}>Volver</button>
            </div>
          </section>
        </div>
      )
    }
    const ruta = abierto.ruta
    return (
      <EditorFusion
        key={ruta}
        datos={abierto.datos}
        origen={previa.origen}
        actual={previa.actual}
        inicial={borradores[ruta]}
        onCambio={(d) => setBorradores((b) => ({ ...b, [ruta]: d }))}
        onCerrar={() => setAbierto(null)}
        onGuardar={(texto, d) => {
          setResoluciones((r) => ({ ...r, [ruta]: { tipo: 'texto', texto } }))
          setBorradores((b) => ({ ...b, [ruta]: d }))
          setAbierto(null)
        }}
      />
    )
  }

  return (
    <div className="vc-pagina">
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>Fusionar ramas</h3>
        </div>
        <p className="vc-nota">
          Elige la rama con los cambios que quieres traer a <b>{estado.rama ?? 'la rama actual'}</b>. Verás qué archivos cambian y podrás resolver cada conflicto en un editor de tres paneles
          (los de la rama de origen a la izquierda, los de la actual a la derecha y el resultado en el centro). No se toca nada hasta que pulses «Fusionar».
        </p>
        {estado.sinCommits || !estado.rama ? (
          <EstadoVacio variante="compacto" icono={<IconoRama />} titulo="Nada que fusionar todavía" texto={estado.desacoplado ? 'Estás en un commit suelto: cambia a una rama.' : 'Haz primero un commit.'} />
        ) : (
          <div className="vf-selector">
            <span className="chip chip-ok" title="Rama actual: donde se integran los cambios">
              {estado.rama} (actual)
            </span>
            <span aria-hidden="true">←</span>
            <select value={origen} onChange={(e) => (setOrigen(e.target.value), setPrevia(null))} aria-label="Rama de origen" disabled={bloqueado}>
              <option value="">Rama con los cambios…</option>
              {candidatas.map((r) => (
                <option key={r.nombre} value={r.nombre}>
                  {r.nombre}
                  {r.remota ? ' (remota)' : ''}
                </option>
              ))}
            </select>
            <button className="primario" disabled={!origen || bloqueado || cargando} onClick={comparar}>
              {cargando ? 'Comparando…' : 'Comparar'}
            </button>
          </div>
        )}
        {error && <p className="vc-nota error">{error}</p>}
        {enCurso && <p className="vc-nota">Hay una operación en curso ({estado.operacion}): termínala o abórtala antes de fusionar.</p>}
      </section>

      {previa && (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>
              {previa.archivos.length} archivo{previa.archivos.length === 1 ? '' : 's'} <small>{previa.commits} commit{previa.commits === 1 ? '' : 's'} de «{previa.origen}»</small>
            </h3>
          </div>
          {previa.archivos.length === 0 ? (
            <EstadoVacio variante="compacto" icono={<IconoRama />} titulo="No hay nada que fusionar" texto={`«${previa.actual}» ya contiene los cambios de «${previa.origen}».`} />
          ) : (
            <>
              <p className="vc-nota">
                {conflictivos.length === 0
                  ? 'Ningún conflicto: git puede integrarlo todo solo. Puedes revisar cualquier archivo antes.'
                  : `${conflictivos.length} archivo${conflictivos.length === 1 ? '' : 's'} con conflictos (${pendientes.length} sin resolver): ábrelos para resolverlos.`}
              </p>
              <ul className="vf-archivos">
                {previa.archivos.map((a) => {
                  const resuelto = Boolean(resoluciones[a.ruta])
                  const conflicto = a.estado === 'conflicto' && a.conflictos > 0
                  return (
                    <li key={a.ruta}>
                      <button className="vf-archivo" onClick={() => abrir(a)} title={a.ruta}>
                        <span className={`vf-estado ${conflicto && !resuelto ? 'conflicto' : resuelto ? 'resuelto' : 'auto'}`} aria-hidden="true">
                          {conflicto && !resuelto ? '!' : resuelto ? '✓' : '•'}
                        </span>
                        <span className="vf-nombre">{nombreDeArchivo(a.ruta)}</span>
                        <span className="vf-carpeta">{carpetaDeArchivo(a.ruta)}</span>
                        <span className="ag-espacio" />
                        <span className="chip" title="Cambio en la rama de origen">{ETIQUETA[a.enOrigen] ?? a.enOrigen}</span>
                        {a.enActual && <span className="chip" title="También cambió en la rama actual">también en la actual</span>}
                        {conflicto && !resuelto && <span className="chip chip-aviso">{a.conflictos} conflicto{a.conflictos === 1 ? '' : 's'}</span>}
                        {resuelto && <span className="chip chip-ok">resuelto</span>}
                        {!conflicto && !resuelto && a.estado === 'ambos' && <span className="chip chip-ok">se fusiona solo</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {previa.truncado && <p className="vc-nota">Hay más archivos de los que se muestran: se integrarán igualmente (los conflictos de los no mostrados se detectan al fusionar y se cancela todo).</p>}

              <div className="vf-pie">
                <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} aria-label="Mensaje del commit de fusión" placeholder="Mensaje del commit de fusión" disabled={!confirmar} />
                <label className="vc-casilla">
                  <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} /> Crear el commit
                </label>
                <button
                  className="primario"
                  disabled={bloqueado || enCurso || pendientes.length > 0 || !sinCambios}
                  onClick={() => setPidiendo(true)}
                  title={enCurso ? 'Hay una operación en curso' : !sinCambios ? 'Confirma o aparta (stash) tus cambios antes de fusionar' : pendientes.length ? 'Resuelve primero todos los conflictos' : undefined}
                >
                  Fusionar en «{previa.actual}»
                </button>
              </div>
              {!sinCambios && <p className="vc-nota error">Tienes cambios sin confirmar: confírmalos o apártalos (stash) antes de fusionar.</p>}
            </>
          )}
        </section>
      )}

      {pidiendo && previa && (
        <ModalConfirmar
          titulo="Fusionar rama"
          texto={`Se integra «${previa.origen}» en «${previa.actual}»${confirmar ? ' y se crea el commit de fusión' : ' sin confirmar (podrás revisar en «Cambios»)'}.\n\nSi algo falla, no se toca nada.`}
          etiqueta="Fusionar"
          tono="aviso"
          onCerrar={() => setPidiendo(false)}
          onConfirmar={fusionar}
        />
      )}
    </div>
  )
}
