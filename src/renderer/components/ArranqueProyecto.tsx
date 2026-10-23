import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ESPERAS,
  describirConflicto,
  esperaPorDefecto,
  puertoSugerido,
  validarComando,
  type ComandoArranque,
  type ConflictoPuerto,
  type EsperaListo,
  type EstadoArranque,
  type EstadoComando,
  type Resolucion
} from '@shared/arranque'
import type { Proyecto } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoAbrirTodas, IconoBasura, IconoDetener, IconoLapiz, IconoReiniciar, IconoRayo } from './Iconos'

interface Props {
  proyecto: Proyecto
  onCerrar: () => void
  /** Cierra esta ventana y lleva a la sección «Servicios», donde viven las terminales de los comandos. */
  onVer: () => void
}

interface Formulario {
  id: string
  nombre: string
  comando: string
  cwd: string
  puerto: string
  esperar: EsperaListo
  textoListo: string
  segundos: string
  siempre: boolean
}

const vacio = (): Formulario => ({ id: '', nombre: '', comando: '', cwd: '', puerto: '', esperar: 'nada', textoListo: '', segundos: '', siempre: false })
const limpiar = (m: string): string => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^Arranque: /, '')

const ETIQUETA_ESPERA: Record<EsperaListo, string> = {
  puerto: 'Hasta que el puerto esté abierto',
  texto: 'Hasta que aparezca un texto en la salida',
  tiempo: 'Una pausa fija',
  nada: 'No esperar (pasar al siguiente)'
}
const ETIQUETA_ESTADO: Record<EstadoComando, string> = { pendiente: 'En espera', arrancando: 'Arrancando…', listo: 'Listo', error: 'Error', detenido: 'Detenido', omitido: 'Omitido' }

const aFormulario = (c: ComandoArranque): Formulario => ({
  id: c.id,
  nombre: c.nombre,
  comando: c.comando,
  cwd: c.cwd ?? '',
  puerto: c.puerto === undefined ? '' : String(c.puerto),
  esperar: c.esperar,
  textoListo: c.textoListo ?? '',
  segundos: c.esperar === 'puerto' || c.esperar === 'texto' || c.esperar === 'tiempo' ? String(c.esperaMs / 1000) : '',
  siempre: c.siempre
})

const aEntrada = (f: Formulario) => ({
  ...(f.id ? { id: f.id } : {}),
  nombre: f.nombre,
  comando: f.comando,
  cwd: f.cwd,
  ...(f.puerto.trim() ? { puerto: Number(f.puerto) } : {}),
  esperar: f.esperar,
  textoListo: f.textoListo,
  ...(f.segundos.trim() && f.esperar !== 'nada' ? { esperaMs: Math.round(Number(f.segundos) * 1000) } : {}),
  siempre: f.siempre
})

/** Comandos de arranque de un proyecto: lista ordenada, formulario y control de arranque con revisión de puertos. */
export function ArranqueProyecto({ proyecto, onCerrar, onVer }: Props) {
  const [comandos, setComandos] = useState<ComandoArranque[]>([])
  const [estados, setEstados] = useState<Record<string, EstadoArranque>>({})
  const [f, setF] = useState<Formulario>(vacio())
  const [error, setError] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const [continuar, setContinuar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [revision, setRevision] = useState<{ ids?: string[]; conflictos: ConflictoPuerto[]; resoluciones: Record<string, Resolucion> } | null>(null)

  const cargar = useCallback(async (): Promise<void> => {
    const [lista, est] = await Promise.all([
      window.api.arranque.operar('listar', { proyectoId: proyecto.id }),
      window.api.arranque.operar('estados', { proyectoId: proyecto.id })
    ])
    setComandos(lista)
    setEstados(Object.fromEntries(est.map((e) => [e.comandoId, e])))
  }, [proyecto.id])

  useEffect(() => {
    void cargar().catch((e: Error) => setError(limpiar(e.message)))
    return window.api.arranque.onEstado((e) => {
      if (e.proyectoId === proyecto.id) setEstados((x) => ({ ...x, [e.comandoId]: e }))
    })
  }, [cargar, proyecto.id])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  // Aviso inmediato de repetidos y datos no válidos mientras se escribe (main vuelve a validar al guardar).
  const previa = useMemo(() => {
    if (!f.nombre.trim() && !f.comando.trim()) return null
    return validarComando(aEntrada(f), comandos.filter((c) => c.id !== f.id), f.id || 'nuevo')
  }, [f, comandos])
  const mensajeForm = f.nombre.trim() && f.comando.trim() && previa && !previa.ok ? previa.mensaje : ''

  const guardar = async (): Promise<void> => {
    setError('')
    setAvisos([])
    try {
      const r = await window.api.arranque.operar('guardar', { proyectoId: proyecto.id, comando: aEntrada(f) })
      if (!r.ok) return setError(r.mensaje)
      setComandos(r.comandos)
      setAvisos(r.avisos)
      setF(vacio())
    } catch (e) {
      setError(limpiar((e as Error).message))
    }
  }

  const alSalirDelComando = (): void => {
    const p = puertoSugerido(f.comando)
    if (p !== undefined && !f.puerto.trim()) setF((x) => ({ ...x, puerto: String(p), esperar: x.esperar === 'nada' ? 'puerto' : x.esperar }))
  }

  const mover = async (id: string, indice: number): Promise<void> => setComandos(await window.api.arranque.operar('mover', { proyectoId: proyecto.id, id, indice }))
  const eliminar = async (id: string): Promise<void> => {
    setComandos(await window.api.arranque.operar('eliminar', { proyectoId: proyecto.id, id }))
    setEstados((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== id)))
    if (f.id === id) setF(vacio())
  }

  const lanzar = async (ids: string[] | undefined, resoluciones: Record<string, Resolucion> = {}): Promise<void> => {
    setError('')
    const r = await window.api.arranque.operar('arrancar', { proyectoId: proyecto.id, ...(ids ? { ids } : {}), resoluciones, continuarSiFalla: continuar })
    if (!r.ok) setError(r.mensaje)
    else onVer() // las terminales no se abren aquí: están en «Servicios»
  }

  /** Mira los puertos antes de arrancar: si algo choca, pregunta qué hacer en vez de pisarlo. */
  const arrancar = async (ids?: string[]): Promise<void> => {
    setOcupado(true)
    setError('')
    try {
      const conflictos = await window.api.arranque.operar('revisar', { proyectoId: proyecto.id, ...(ids ? { ids } : {}) })
      if (conflictos.some((c) => c.bloquea || c.tipo === 'configurado-en-otro')) {
        setRevision({ ...(ids ? { ids } : {}), conflictos, resoluciones: Object.fromEntries(conflictos.filter((c) => c.bloquea).map((c) => [c.comandoId, 'omitir' as Resolucion])) })
      } else await lanzar(ids)
    } catch (e) {
      setError(limpiar((e as Error).message))
    } finally {
      setOcupado(false)
    }
  }

  const detener = async (ids?: string[]): Promise<void> => {
    const est = await window.api.arranque.operar('detener', { proyectoId: proyecto.id, ...(ids ? { ids } : {}) })
    setEstados(Object.fromEntries(est.map((e) => [e.comandoId, e])))
  }

  const hayEnMarcha = Object.values(estados).some((e) => e.estado === 'arrancando' || e.estado === 'listo' || e.estado === 'pendiente')
  const bloqueantes = revision?.conflictos.filter((c) => c.bloquea) ?? []
  const nuevo = !f.id

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal arranque" role="dialog" aria-modal="true" aria-label={`Comandos de arranque de ${proyecto.nombre}`}>
        <div className="modal-cab">
          <h3>Comandos de arranque · {proyecto.nombre}</h3>
          <div className="arr-barra">
            <button onClick={onVer} title="Ir a la sección Servicios, donde están las terminales">Ver servicios</button>
            <button className="icono" onClick={onCerrar} title="Cerrar (Esc)">✕</button>
          </div>
        </div>
        <p className="cfg-intro arr-intro">
          Los comandos se lanzan <strong>en orden, uno por uno</strong>, cada uno en su terminal (en la sección «Servicios», no en la rejilla del proyecto): el siguiente espera a que el anterior esté listo. Antes de lanzar uno con puerto se mira quién lo usa:
          lo de este proyecto se da por ya en marcha y lo de otro proyecto o programa no se pisa sin que lo decidas. Se guardan en tu cuenta: los ven todos tus equipos (sin conexión se pueden usar, pero no editar).
        </p>

        {revision && (
          <section className="cfg-grupo arr-revision" role="alertdialog" aria-label="Puertos ocupados">
            <div className="cfg-grupo-cab"><h3>Antes de arrancar</h3></div>
            <div className="arr-revision-cuerpo">
              {revision.conflictos.map((c) => (
                <div key={`${c.comandoId}-${c.tipo}`} className={`arr-conflicto${c.bloquea ? ' bloquea' : ''}`}>
                  <div>
                    <strong>{c.comandoNombre}</strong> · {describirConflicto(c)}
                  </div>
                  {c.bloquea && (
                    <div className="arr-opciones" role="radiogroup" aria-label={`Qué hacer con el puerto ${c.puerto}`}>
                      <label className="ag-check">
                        <input type="radio" name={`res-${c.comandoId}`} checked={revision.resoluciones[c.comandoId] === 'omitir'} onChange={() => setRevision({ ...revision, resoluciones: { ...revision.resoluciones, [c.comandoId]: 'omitir' } })} />
                        Omitir este comando
                      </label>
                      <label className="ag-check" title={c.puedeLiberar ? `Cierra el proceso ${c.pid}` : 'No se sabe qué proceso es: ciérralo a mano'}>
                        <input type="radio" name={`res-${c.comandoId}`} disabled={!c.puedeLiberar} checked={revision.resoluciones[c.comandoId] === 'liberar'} onChange={() => setRevision({ ...revision, resoluciones: { ...revision.resoluciones, [c.comandoId]: 'liberar' } })} />
                        Cerrar el proceso{c.pid ? ` (pid ${c.pid})` : ''} y arrancar
                      </label>
                    </div>
                  )}
                </div>
              ))}
              {bloqueantes.some((c) => revision.resoluciones[c.comandoId] === 'liberar') && (
                <div className="cfg-error">Cerrar un proceso es definitivo: se perderá lo que estuviera haciendo.</div>
              )}
              <div className="cfg-acciones">
                <button onClick={() => setRevision(null)}>Cancelar</button>
                <button
                  className="primario"
                  onClick={() => {
                    const r = revision
                    setRevision(null)
                    void lanzar(r.ids, r.resoluciones)
                  }}
                >
                  Arrancar
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>Orden de arranque <small>{comandos.length}</small></h3>
            <div className="arr-barra">
              <label className="ag-check" title="Si uno falla, seguir con los demás en vez de parar">
                <input type="checkbox" checked={continuar} onChange={(e) => setContinuar(e.target.checked)} /> Seguir aunque uno falle
              </label>
              <button className="primario" disabled={comandos.length === 0 || ocupado} onClick={() => void arrancar()}>
                <IconoAbrirTodas /> Arrancar todo
              </button>
              <button disabled={!hayEnMarcha} onClick={() => void detener()}>
                <IconoDetener /> Detener todo
              </button>
            </div>
          </div>
          {comandos.length === 0 && (
            <EstadoVacio variante="compacto" icono={<IconoRayo />} titulo="Aún no hay comandos de arranque" texto="Añade los que necesitas para tener el proyecto en marcha (base de datos, API, frontend…); se lanzarán en el orden de esta lista." />
          )}
          {comandos.map((c, i) => {
            const e = estados[c.id]
            const activo = e?.estado === 'arrancando' || e?.estado === 'listo' || e?.estado === 'pendiente'
            return (
              <div className="arr-fila" key={c.id}>
                <span className="arr-num" aria-label={`Posición ${i + 1}`}>{i + 1}</span>
                <div className="arr-info">
                  <div className="arr-titulo">
                    <strong>{c.nombre}</strong>
                    {c.puerto !== undefined && <span className="chip" title="Puerto que abre">:{c.puerto}</span>}
                    <span className="chip" title="Cuándo se pasa al siguiente">{c.esperar === 'puerto' ? 'espera el puerto' : c.esperar === 'texto' ? `espera «${c.textoListo}»` : c.esperar === 'tiempo' ? `pausa ${c.esperaMs / 1000} s` : 'no espera'}</span>
                    {c.siempre && <span className="chip chip-ok" title="Se lanza solo al abrir el proyecto">siempre</span>}
                  </div>
                  <code title={c.comando}>{c.comando}</code>
                  {c.cwd && <small className="arr-cwd">en {c.cwd}</small>}
                  {e?.mensaje && <small className={`arr-msg${e.estado === 'error' ? ' error' : ''}`}>{e.mensaje}</small>}
                </div>
                {e && <span className={`arr-estado est-${e.estado}`}>{ETIQUETA_ESTADO[e.estado]}</span>}
                <div className="arr-acciones">
                  <button className="icono" style={{ opacity: 1 }} disabled={i === 0} title="Subir (arranca antes)" onClick={() => void mover(c.id, i - 1)}>↑</button>
                  <button className="icono" style={{ opacity: 1 }} disabled={i === comandos.length - 1} title="Bajar (arranca después)" onClick={() => void mover(c.id, i + 1)}>↓</button>
                  {activo ? (
                    <button className="icono" style={{ opacity: 1 }} title="Detener este comando" onClick={() => void detener([c.id])}><IconoDetener /></button>
                  ) : (
                    <button className="icono" style={{ opacity: 1 }} disabled={ocupado} title={e ? 'Volver a lanzar solo este' : 'Lanzar solo este'} onClick={() => void arrancar([c.id])}>{e ? <IconoReiniciar /> : <IconoAbrirTodas />}</button>
                  )}
                  <button className="icono" style={{ opacity: 1 }} title="Editar" onClick={() => { setF(aFormulario(c)); setError(''); setAvisos([]) }}><IconoLapiz /></button>
                  <button className="peligro" style={{ opacity: 1 }} title="Eliminar (si está en marcha, se detiene)" onClick={() => void eliminar(c.id)}><IconoBasura /></button>
                </div>
              </div>
            )
          })}
        </section>

        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>{nuevo ? 'Nuevo comando' : `Editar «${comandos.find((c) => c.id === f.id)?.nombre ?? ''}»`}</h3>
            {!nuevo && <button onClick={() => { setF(vacio()); setError('') }}>Cancelar edición</button>}
          </div>
          <div className="mem-form arr-form">
            <div className="ag-opciones">
              <input placeholder="Nombre (API, Frontend, Base de datos…)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} style={{ maxWidth: 260 }} aria-label="Nombre" />
              <input placeholder="Carpeta dentro del proyecto (opcional)" value={f.cwd} onChange={(e) => setF({ ...f, cwd: e.target.value })} aria-label="Carpeta" spellCheck={false} />
            </div>
            <input placeholder="pnpm dev   ·   docker compose up -d   ·   node server.js --port 4000" value={f.comando} onChange={(e) => setF({ ...f, comando: e.target.value })} onBlur={alSalirDelComando} aria-label="Comando" spellCheck={false} />
            <div className="ag-opciones">
              <input placeholder="Puerto" inputMode="numeric" value={f.puerto} onChange={(e) => setF({ ...f, puerto: e.target.value.replace(/[^0-9]/g, '') })} style={{ maxWidth: 100 }} aria-label="Puerto" />
              <select value={f.esperar} onChange={(e) => setF({ ...f, esperar: e.target.value as EsperaListo, segundos: '' })} aria-label="Cuándo pasar al siguiente">
                {ESPERAS.map((x) => (
                  <option key={x} value={x}>{ETIQUETA_ESPERA[x]}</option>
                ))}
              </select>
              {f.esperar === 'texto' && <input placeholder="Texto (p. ej. ready in)" value={f.textoListo} onChange={(e) => setF({ ...f, textoListo: e.target.value })} aria-label="Texto que indica que está listo" />}
              {f.esperar !== 'nada' && (
                <input
                  placeholder={f.esperar === 'tiempo' ? `Segundos (${esperaPorDefecto('tiempo') / 1000})` : `Máx. segundos (${esperaPorDefecto(f.esperar) / 1000})`}
                  inputMode="decimal"
                  value={f.segundos}
                  onChange={(e) => setF({ ...f, segundos: e.target.value.replace(/[^0-9.]/g, '') })}
                  style={{ maxWidth: 150 }}
                  aria-label={f.esperar === 'tiempo' ? 'Segundos de pausa' : 'Segundos máximos de espera'}
                />
              )}
            </div>
            <label className="ag-check"><input type="checkbox" checked={f.siempre} onChange={(e) => setF({ ...f, siempre: e.target.checked })} /> Arrancar siempre: lanzarlo solo cada vez que abra este proyecto</label>
            {(mensajeForm || error) && <div className="cfg-error">{mensajeForm || error}</div>}
            {avisos.map((a) => (
              <div key={a} className="cfg-nota arr-aviso">⚠ {a}</div>
            ))}
            <div className="cfg-acciones">
              <button className="primario" disabled={!f.nombre.trim() || !f.comando.trim() || (previa !== null && !previa.ok)} onClick={() => void guardar()}>{nuevo ? 'Añadir' : 'Guardar'}</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
