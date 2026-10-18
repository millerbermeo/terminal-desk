import { useCallback, useEffect, useMemo, useState } from 'react'
import { ETIQUETA_ORIGEN, type AutorVersion, type OrigenVersion, type ResultadoComparar, type Version } from '@shared/historial'
import { fechaRelativa } from '@shared/versiones'
import { confirmar } from '../confirmar'
import { mensajeDe } from '../tareas/useTareas'
import { VisorDiff } from './VisorDiff'

const api = window.api.historial.operar

interface Props {
  proyectoId: string
  ruta: string
  /** Se restauró algo (para que quien lo muestra refresque sus listas). */
  onCambio?: () => void
  avisar?: (texto: string) => void
  /** Cambia cuando algo puede haber cambiado fuera (el historial se vuelve a leer). */
  tick?: number
}

const CLAVE_MODO = 'historial:modo-diff'
const modoGuardado = (): 'unificado' | 'dividido' => {
  try {
    return localStorage.getItem(CLAVE_MODO) === 'dividido' ? 'dividido' : 'unificado'
  } catch {
    return 'unificado'
  }
}

export const nombreAutor = (a: AutorVersion): string => [a.usuario ?? a.cuenta, a.equipo].filter(Boolean).join(' · ') || 'desconocido'
const hora = (iso: string): string => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function FilaVersion({ v, sel, onElegir }: { v: Version; sel: boolean; onElegir: () => void }) {
  return (
    <li>
      <button className={`hv-fila${sel ? ' sel' : ''}${v.eliminada ? ' borrada' : ''}`} onClick={onElegir} aria-pressed={sel}>
        <span className={`chip hv-origen hv-${v.origen}`}>{ETIQUETA_ORIGEN[v.origen]}</span>
        <span className="hv-hora" title={new Date(v.fecha).toLocaleString('es')}>
          {hora(v.fecha)} <small>· {fechaRelativa(v.fecha)}</small>
        </span>
        {v.origen !== 'base' && (
          <span className="hv-autor" title={nombreAutor(v.autor)}>
            {v.herramienta && v.origen === 'ia' ? `${v.herramienta} · ` : ''}
            {nombreAutor(v.autor)}
          </span>
        )}
        {v.eliminada ? (
          <span className="chip api-estado-servidor">borrado</span>
        ) : (
          (v.mas > 0 || v.menos > 0) && (
            <span className="mono eq-lineas">
              <b className="mas">+{v.mas}</b> <b className="menos">−{v.menos}</b>
            </span>
          )
        )}
        {v.nota && <span className="hv-nota">{v.nota}</span>}
      </button>
    </li>
  )
}

/**
 * Historial de un archivo: todas sus versiones (a mano, de la IA, de otros programas, de git), con lo que cambió en cada una y con
 * opciones para compararlas y restaurar una versión entera o solo algunos bloques.
 */
export function HistorialArchivo({ proyectoId, ruta, onCambio, avisar, tick = 0 }: Props) {
  const [versiones, setVersiones] = useState<Version[] | null>(null)
  const [error, setError] = useState('')
  const [origen, setOrigen] = useState<OrigenVersion | ''>('')
  const [autor, setAutor] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [contra, setContra] = useState<string>('anterior')
  const [modo, setModo] = useState(modoGuardado)
  const [resultado, setResultado] = useState<ResultadoComparar | null>(null)
  const [cargando, setCargando] = useState(false)
  const [eligiendo, setEligiendo] = useState(false)
  const [paraRestaurar, setParaRestaurar] = useState<ResultadoComparar | null>(null)
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async (): Promise<void> => {
    try {
      setVersiones(await api('versiones', { proyectoId, ruta, filtro: { ...(origen ? { origen } : {}), ...(autor ? { autor } : {}) } }))
      setError('')
    } catch (e) {
      setError(mensajeDe(e))
    }
  }, [proyectoId, ruta, origen, autor])

  useEffect(() => {
    void cargar()
  }, [cargar, tick])

  // Al cambiar de archivo se empieza de cero; si la versión elegida ya no está, se elige la más reciente.
  useEffect(() => {
    setSel(null)
    setContra('anterior')
    setEligiendo(false)
    setAviso('')
  }, [proyectoId, ruta])
  useEffect(() => {
    if (!versiones) return
    if (!sel || !versiones.some((v) => v.id === sel)) setSel(versiones[0]?.id ?? null)
  }, [versiones, sel])

  // La comparación: la versión elegida contra su anterior, contra el archivo actual o contra otra versión.
  useEffect(() => {
    if (!sel) return void setResultado(null)
    let vigente = true
    setCargando(true)
    const pedir = contra === 'actual' ? api('comparar', { proyectoId, ruta, desde: sel, hasta: 'actual' }) : api('comparar', { proyectoId, ruta, desde: contra, hasta: sel })
    pedir
      .then((r) => vigente && (setResultado(r), setError('')))
      .catch((e) => vigente && (setResultado(null), setError(mensajeDe(e))))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [proyectoId, ruta, sel, contra, tick])

  // Para elegir qué restaurar: los cambios que se aplicarían (archivo actual → versión elegida).
  useEffect(() => {
    if (!eligiendo || !sel) return void setParaRestaurar(null)
    let vigente = true
    api('comparar', { proyectoId, ruta, desde: 'actual', hasta: sel })
      .then((r) => vigente && (setParaRestaurar(r), setMarcados(new Set(r.diff.bloques.map((b) => b.id)))))
      .catch((e) => vigente && setError(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [eligiendo, proyectoId, ruta, sel, tick])

  const actual = versiones?.find((v) => v.id === sel)
  const autores = useMemo(() => [...new Set((versiones ?? []).map((v) => v.autor.usuario ?? v.autor.cuenta ?? '').filter(Boolean))], [versiones])
  const informar = (t: string): void => {
    setAviso(t)
    avisar?.(t)
  }

  const restaurar = async (bloques?: number[]): Promise<void> => {
    if (!actual || ocupado) return
    const fecha = new Date(actual.fecha).toLocaleString('es')
    const total = paraRestaurar?.diff.bloques.length ?? 0
    const ok = await confirmar({
      titulo: bloques ? `¿Restaurar ${bloques.length} de ${total} bloque${total === 1 ? '' : 's'}?` : '¿Restaurar esta versión?',
      etiqueta: 'Restaurar',
      tono: 'aviso',
      texto: `${bloques ? 'Solo esos cambios' : `El archivo volverá a como estaba el ${fecha}`} de «${ruta}».\n\nAntes de restaurar se guarda como versión el estado actual del archivo: siempre puedes volver atrás.`
    })
    if (!ok) return
    setOcupado(true)
    try {
      await api('restaurar', { proyectoId, ruta, version: actual.id, ...(bloques ? { bloques } : {}) })
      informar(bloques ? 'Cambios restaurados.' : 'Versión restaurada.')
      setEligiendo(false)
      setContra('anterior')
      setSel(null)
      await cargar()
      onCambio?.()
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setOcupado(false)
    }
  }

  const cambiarModo = (m: 'unificado' | 'dividido'): void => {
    setModo(m)
    try {
      localStorage.setItem(CLAVE_MODO, m)
    } catch {
      /* sin almacenamiento */
    }
  }

  if (!versiones) return error ? <p className="vc-nota error" style={{ padding: 16 }}>{error}</p> : <p className="tareas-vacio">Cargando historial…</p>

  return (
    <div className="hv">
      <div className="hv-lista-caja">
        <div className="hv-filtros">
          <select value={origen} onChange={(e) => setOrigen(e.target.value as OrigenVersion | '')} aria-label="Filtrar por origen">
            <option value="">Todo origen</option>
            {(Object.keys(ETIQUETA_ORIGEN) as OrigenVersion[]).map((o) => (
              <option key={o} value={o}>
                {ETIQUETA_ORIGEN[o]}
              </option>
            ))}
          </select>
          <select value={autor} onChange={(e) => setAutor(e.target.value)} aria-label="Filtrar por usuario" disabled={autores.length === 0 && !autor}>
            <option value="">Todos los usuarios</option>
            {autores.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        {versiones.length === 0 ? (
          <p className="tareas-vacio">{origen || autor ? 'Ninguna versión coincide con el filtro.' : 'Este archivo aún no tiene versiones guardadas.'}</p>
        ) : (
          <ul className="hv-lista" aria-label={`Versiones de ${ruta}`}>
            {versiones.map((v) => (
              <FilaVersion key={v.id} v={v} sel={v.id === sel} onElegir={() => (setSel(v.id), setEligiendo(false))} />
            ))}
          </ul>
        )}
      </div>

      <div className="hv-detalle">
        {error && <p className="vc-nota error">{error}</p>}
        {aviso && <p className="vc-nota hv-ok" role="status">✓ {aviso}</p>}
        {actual ? (
          <>
            <div className="hv-barra">
              <label className="hv-comparar">
                <span>Comparar con</span>
                <select value={contra} onChange={(e) => (setContra(e.target.value), setEligiendo(false))}>
                  <option value="anterior">Su versión anterior (qué cambió aquí)</option>
                  <option value="actual">El archivo actual</option>
                  {versiones
                    .filter((v) => v.id !== actual.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {hora(v.fecha)} · {ETIQUETA_ORIGEN[v.origen]}
                      </option>
                    ))}
                </select>
              </label>
              <span className="ag-espacio" />
              <div className="segmentado" role="group" aria-label="Forma de ver las diferencias">
                <button className={modo === 'unificado' ? 'on' : ''} onClick={() => cambiarModo('unificado')}>
                  Unificado
                </button>
                <button className={modo === 'dividido' ? 'on' : ''} onClick={() => cambiarModo('dividido')}>
                  Lado a lado
                </button>
              </div>
            </div>

            {resultado && (
              <p className="hv-resumen">
                <span className="hd-mas">+{resultado.diff.agregadas} agregadas</span> <span className="hd-menos">−{resultado.diff.quitadas} quitadas</span> <span className="hd-mod">~{resultado.diff.modificadas} modificadas</span>
              </p>
            )}

            {cargando ? (
              <p className="tareas-vacio">Calculando diferencias…</p>
            ) : resultado?.omitido ? (
              <p className="tareas-vacio">{resultado.omitido === 'binario' ? 'El archivo actual no es de texto.' : 'El archivo es demasiado grande para compararlo.'}</p>
            ) : resultado ? (
              <VisorDiff diff={resultado.diff} modo={modo} />
            ) : null}

            <div className="hv-acciones">
              {!eligiendo ? (
                <>
                  <button className="primario" disabled={ocupado || actual.eliminada} onClick={() => void restaurar()} title={actual.eliminada ? 'Esa versión es el borrado: elige una anterior' : 'Devuelve el archivo a como estaba en esta versión'}>
                    Restaurar esta versión
                  </button>
                  <button disabled={ocupado || actual.eliminada} onClick={() => setEligiendo(true)}>
                    Elegir qué restaurar…
                  </button>
                </>
              ) : (
                <>
                  <strong>Marca los cambios que quieres recuperar</strong>
                  <span className="ag-espacio" />
                  <button onClick={() => setEligiendo(false)}>Cancelar</button>
                </>
              )}
            </div>

            {eligiendo && paraRestaurar && (
              <div className="hv-elegir">
                {paraRestaurar.diff.iguales ? (
                  <p className="tareas-vacio">El archivo actual ya es igual a esta versión.</p>
                ) : (
                  <>
                    <p className="vc-nota">Lo que verás son los cambios que se aplicarían al archivo actual para dejarlo como estaba en esta versión.</p>
                    <div className="hv-marcar">
                      <button onClick={() => setMarcados(new Set(paraRestaurar.diff.bloques.map((b) => b.id)))}>Todos</button>
                      <button onClick={() => setMarcados(new Set())}>Ninguno</button>
                      <button className="primario" disabled={ocupado || marcados.size === 0} onClick={() => void restaurar([...marcados].sort((a, b) => a - b))}>
                        Restaurar {marcados.size} bloque{marcados.size === 1 ? '' : 's'}
                      </button>
                    </div>
                    <VisorDiff
                      diff={paraRestaurar.diff}
                      modo={modo}
                      seleccion={marcados}
                      onSeleccion={(id, v) =>
                        setMarcados((m) => {
                          const n = new Set(m)
                          if (v) n.add(id)
                          else n.delete(id)
                          return n
                        })
                      }
                    />
                  </>
                )}
              </div>
            )}
            <p className="vc-nota hv-pista">Antes de restaurar se guarda el estado actual como una versión más: no se pierde nada.</p>
          </>
        ) : (
          <p className="tareas-vacio">Elige una versión para ver qué cambió.</p>
        )}
      </div>
    </div>
  )
}
