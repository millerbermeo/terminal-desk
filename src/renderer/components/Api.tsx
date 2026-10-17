import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analizarCurl, nuevoId, variablesDe, type Coleccion, type DatosApi, type PeticionApi, type PeticionGuardada } from '@shared/api'
import { fechaRelativa } from '@shared/versiones'
import { borradorNuevo, tituloDe, type Borrador } from '../api/borrador'
import { mensajeDe } from '../tareas/useTareas'
import { ApiEntornos } from './ApiEntornos'
import { ApiPeticion } from './ApiPeticion'
import { ApiRespuesta } from './ApiRespuesta'
import { EstadoVacio } from './EstadoVacio'
import { IconoApi, IconoMas } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'
import { ModalFormulario } from './ModalFormulario'

const api = window.api.api.operar

type Dialogo =
  | { tipo: 'guardar'; borrador: Borrador }
  | { tipo: 'curl' }
  | { tipo: 'entornos' }
  | { tipo: 'coleccion'; coleccion?: Coleccion }
  | { tipo: 'renombrar'; coleccion: Coleccion; peticion: PeticionGuardada }
  | { tipo: 'eliminarColeccion'; coleccion: Coleccion }
  | { tipo: 'eliminarPeticion'; coleccion: Coleccion; peticion: PeticionGuardada }
  | { tipo: 'cerrar'; borrador: Borrador }
  | null

const nombreSugerido = (b: Borrador): string => tituloDe({ ...b, nombre: '' })

/** Cliente API integrado (estilo Postman): peticiones HTTP con entornos, colecciones, historial y respuesta con JSON en árbol. */
export function Api({ visible }: { visible: boolean }) {
  const [datos, setDatos] = useState<DatosApi | null>(null)
  const [borradores, setBorradores] = useState<Borrador[]>(() => [borradorNuevo()])
  const [activoId, setActivoId] = useState(() => borradores[0]!.id)
  const [lateral, setLateral] = useState<'colecciones' | 'historial'>('colecciones')
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [errorCurl, setErrorCurl] = useState('')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const temporizador = useRef<number | undefined>(undefined)

  const avisar = useCallback((t: string): void => {
    setAviso(t)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setAviso(''), 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(temporizador.current), [])

  const cargar = useCallback(async (): Promise<void> => {
    try {
      setDatos(await api('datos', {}))
    } catch (e) {
      setError(mensajeDe(e))
    }
  }, [])
  useEffect(() => {
    if (visible && !datos) void cargar()
  }, [visible, datos, cargar])

  const entorno = datos?.entornos.find((e) => e.id === datos.entornoActivo)
  const vars = useMemo(() => variablesDe(entorno), [entorno])
  const activo = borradores.find((b) => b.id === activoId) ?? borradores[0]!

  const actualizar = useCallback((id: string, f: Partial<Borrador> | ((b: Borrador) => Partial<Borrador>)): void => {
    setBorradores((bs) => bs.map((b) => (b.id === id ? { ...b, ...(typeof f === 'function' ? f(b) : f) } : b)))
  }, [])

  const abrir = (b: Borrador): void => {
    setBorradores((bs) => [...bs, b])
    setActivoId(b.id)
  }
  const nueva = (): void => abrir(borradorNuevo())
  const cerrar = (b: Borrador): void => {
    const resto = borradores.filter((x) => x.id !== b.id)
    if (b.envioId) void api('cancelar', { envioId: b.envioId })
    const lista = resto.length ? resto : [borradorNuevo()]
    setBorradores(lista)
    if (b.id === activoId) setActivoId(lista[Math.max(0, borradores.findIndex((x) => x.id === b.id) - 1)]?.id ?? lista[0]!.id)
  }

  const enviar = async (b: Borrador): Promise<void> => {
    const envioId = nuevoId()
    actualizar(b.id, { envioId, ...({ error: undefined, respuesta: undefined } as Partial<Borrador>) })
    try {
      const respuesta = await api('enviar', { peticion: b.peticion, envioId })
      actualizar(b.id, { respuesta, ...({ envioId: undefined } as Partial<Borrador>) })
    } catch (e) {
      actualizar(b.id, { error: mensajeDe(e), ...({ envioId: undefined } as Partial<Borrador>) })
    }
    void cargar()
  }

  const copiarCurl = async (b: Borrador): Promise<void> => {
    try {
      await navigator.clipboard.writeText(await api('curl', { peticion: b.peticion }))
      avisar('Comando cURL copiado.')
    } catch (e) {
      setError(mensajeDe(e))
    }
  }

  const guardarEn = async (b: Borrador, coleccionId: string, nombre: string): Promise<void> => {
    const r = await api('guardarPeticion', { coleccionId, ...(b.guardada ? { id: b.guardada.peticionId } : {}), nombre, peticion: b.peticion })
    setDatos(r.datos)
    actualizar(b.id, { nombre, guardada: { coleccionId, peticionId: r.id }, sucio: false })
    avisar(`«${nombre}» guardada.`)
  }
  const guardar = (b: Borrador): void => {
    if (b.guardada && datos?.colecciones.some((c) => c.id === b.guardada!.coleccionId)) void guardarEn(b, b.guardada.coleccionId, b.nombre).catch((e) => setError(mensajeDe(e)))
    else setDialogo({ tipo: 'guardar', borrador: b })
  }

  const abrirGuardada = (c: Coleccion, p: PeticionGuardada): void => {
    const ya = borradores.find((b) => b.guardada?.peticionId === p.id)
    if (ya) return setActivoId(ya.id)
    abrir(borradorNuevo(structuredClone(p.peticion), p.nombre, { coleccionId: c.id, peticionId: p.id }))
  }

  const cambiarPeticion = (p: PeticionApi): void => actualizar(activo.id, { peticion: p, sucio: true })
  const colecciones = datos?.colecciones ?? []

  return (
    <main className="api" style={{ display: visible ? 'flex' : 'none' }}>
      <aside className="api-lateral">
        <div className="api-entorno">
          <select
            value={datos?.entornoActivo ?? ''}
            onChange={(e) => void api('fijarEntorno', { ...(e.target.value ? { id: e.target.value } : {}) }).then(setDatos).catch((x) => setError(mensajeDe(x)))}
            aria-label="Entorno activo"
            disabled={!datos}
          >
            <option value="">Sin entorno</option>
            {datos?.entornos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          <button onClick={() => setDialogo({ tipo: 'entornos' })} title="Variables de entorno">
            Entornos
          </button>
        </div>
        <div className="api-lateral-acciones">
          <button className="primario" onClick={nueva}>
            <IconoMas /> Nueva petición
          </button>
          <button onClick={() => (setErrorCurl(''), setDialogo({ tipo: 'curl' }))} title="Pegar un comando cURL (p. ej. «Copiar como cURL» del navegador)">
            Importar cURL
          </button>
        </div>
        <div className="segmentado api-lateral-tabs" role="tablist">
          <button role="tab" className={lateral === 'colecciones' ? 'on' : ''} onClick={() => setLateral('colecciones')}>
            Colecciones
          </button>
          <button role="tab" className={lateral === 'historial' ? 'on' : ''} onClick={() => setLateral('historial')}>
            Historial
          </button>
        </div>
        <div className="api-lateral-lista">
          {lateral === 'colecciones' ? (
            <>
              {colecciones.map((c) => {
                const abierta = abiertas.has(c.id) || colecciones.length === 1
                return (
                  <section key={c.id} className="api-coleccion">
                    <header>
                      <button className="api-col-btn" onClick={() => setAbiertas((s) => { const n = new Set(s); if (!n.delete(c.id)) n.add(c.id); return n })} aria-expanded={abierta}>
                        <span className="chevron" style={{ transform: abierta ? 'rotate(90deg)' : 'rotate(0)' }}>▸</span>
                        <span className="api-col-nombre">{c.nombre}</span>
                        <span className="chip">{c.peticiones.length}</span>
                      </button>
                      <span className="vc-acciones">
                        <button className="icono" onClick={() => setDialogo({ tipo: 'coleccion', coleccion: c })} title="Renombrar" aria-label={`Renombrar ${c.nombre}`}>✎</button>
                        <button className="icono" onClick={() => setDialogo({ tipo: 'eliminarColeccion', coleccion: c })} title="Eliminar colección" aria-label={`Eliminar ${c.nombre}`}>🗑</button>
                      </span>
                    </header>
                    {abierta && (
                      <ul>
                        {c.peticiones.map((p) => (
                          <li key={p.id} className="vc-fila">
                            <button className={`api-pet-btn${activo.guardada?.peticionId === p.id ? ' sel' : ''}`} onClick={() => abrirGuardada(c, p)} title={p.peticion.url}>
                              <span className={`api-met api-m-${p.peticion.metodo}`}>{p.peticion.metodo}</span>
                              <span className="api-pet-nombre">{p.nombre}</span>
                            </button>
                            <span className="vc-acciones">
                              <button className="icono" onClick={() => setDialogo({ tipo: 'renombrar', coleccion: c, peticion: p })} title="Renombrar" aria-label={`Renombrar ${p.nombre}`}>✎</button>
                              <button className="icono" onClick={() => setDialogo({ tipo: 'eliminarPeticion', coleccion: c, peticion: p })} title="Eliminar" aria-label={`Eliminar ${p.nombre}`}>🗑</button>
                            </span>
                          </li>
                        ))}
                        {c.peticiones.length === 0 && <li className="vc-nota" style={{ padding: '4px 12px' }}>Vacía: guarda aquí una petición.</li>}
                      </ul>
                    )}
                  </section>
                )
              })}
              {colecciones.length === 0 && <EstadoVacio variante="compacto" icono={<IconoApi />} titulo="Sin colecciones" texto="Agrupa tus peticiones por proyecto o servicio para reutilizarlas." />}
              <button className="api-nueva-col" onClick={() => setDialogo({ tipo: 'coleccion' })}>
                <IconoMas /> Nueva colección
              </button>
            </>
          ) : (
            <>
              {(datos?.historial ?? []).map((h) => (
                <button key={h.id} className="api-hist" onClick={() => abrir(borradorNuevo(structuredClone(h.peticion)))} title={h.error ?? h.url}>
                  <span className={`api-met api-m-${h.metodo}`}>{h.metodo}</span>
                  <span className="api-hist-url">{h.url}</span>
                  <span className="api-hist-meta">
                    {h.estado !== undefined ? <span className={`api-estado-mini api-estado-${h.estado < 300 ? 'ok' : h.estado < 400 ? 'redireccion' : h.estado < 500 ? 'cliente' : 'servidor'}`}>{h.estado}</span> : <span className="api-estado-mini api-estado-servidor">error</span>}
                    {h.ms !== undefined && ` ${h.ms} ms`} · {fechaRelativa(new Date(h.fecha).toISOString())}
                  </span>
                </button>
              ))}
              {(datos?.historial.length ?? 0) === 0 && <EstadoVacio variante="compacto" icono={<IconoApi />} titulo="Sin historial" texto="Las peticiones que envíes aparecerán aquí." />}
              {(datos?.historial.length ?? 0) > 0 && (
                <button className="api-nueva-col" onClick={() => void api('limpiarHistorial', {}).then(setDatos)}>
                  Limpiar historial
                </button>
              )}
            </>
          )}
        </div>
      </aside>

      <section className="api-centro">
        <div className="api-tabs" role="tablist">
          {borradores.map((b) => (
            <div key={b.id} role="tab" aria-selected={b.id === activo.id} className={`api-tab${b.id === activo.id ? ' activa' : ''}`} onClick={() => setActivoId(b.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActivoId(b.id)}>
              <span className={`api-met api-m-${b.peticion.metodo}`}>{b.peticion.metodo}</span>
              <span className="api-tab-titulo">{tituloDe(b)}</span>
              {b.sucio && <span className="api-sucio" title="Cambios sin guardar" />}
              <button className="icono" onClick={(e) => { e.stopPropagation(); b.sucio && b.peticion.url.trim() ? setDialogo({ tipo: 'cerrar', borrador: b }) : cerrar(b) }} aria-label="Cerrar pestaña" title="Cerrar">✕</button>
            </div>
          ))}
          <button className="icono" onClick={nueva} title="Petición nueva" aria-label="Petición nueva">
            <IconoMas />
          </button>
        </div>
        {(error || aviso) && (
          <div className={`vc-banner ${error ? 'error' : 'ok'}`} role={error ? 'alert' : 'status'} style={{ margin: '10px 16px 0' }}>
            <span className="vc-error-texto">{error || aviso}</span>
            {error && (
              <button className="icono" onClick={() => setError('')} aria-label="Cerrar aviso">
                ✕
              </button>
            )}
          </div>
        )}
        <ApiPeticion
          key={activo.id}
          peticion={activo.peticion}
          vars={vars}
          enviando={Boolean(activo.envioId)}
          guardada={Boolean(activo.guardada)}
          sucio={activo.sucio}
          onCambio={cambiarPeticion}
          onEnviar={() => void enviar(activo)}
          onCancelar={() => activo.envioId && void api('cancelar', { envioId: activo.envioId })}
          onGuardar={() => guardar(activo)}
          onCurl={() => void copiarCurl(activo)}
          onEntornos={() => setDialogo({ tipo: 'entornos' })}
        />
        <ApiRespuesta
          respuesta={activo.respuesta}
          error={activo.error}
          enviando={Boolean(activo.envioId)}
          onCancelar={() => activo.envioId && void api('cancelar', { envioId: activo.envioId })}
          onGuardar={() => activo.respuesta && void api('guardarRespuesta', { envioId: activo.respuesta.envioId }).then((r) => r.ruta && avisar(`Guardada en ${r.ruta}`)).catch((e) => setError(mensajeDe(e)))}
        />
      </section>

      {dialogo?.tipo === 'entornos' && datos && <ApiEntornos datos={datos} onDatos={setDatos} onCerrar={() => setDialogo(null)} />}
      {dialogo?.tipo === 'curl' && (
        <ModalFormulario
          titulo="Importar cURL"
          descripcion="Pega un comando cURL (por ejemplo, «Copiar como cURL» en las herramientas del navegador o en la documentación de una API)."
          campos={[{ id: 'curl', etiqueta: 'Comando', multilinea: true, obligatorio: true, placeholder: "curl 'https://api.ejemplo.com/v1/usuarios' -H 'Authorization: Bearer …'" }]}
          etiquetaBoton="Importar"
          error={errorCurl}
          onCerrar={() => setDialogo(null)}
          onEnviar={(v) => {
            try {
              abrir(borradorNuevo(analizarCurl(v.curl ?? '')))
              return true
            } catch (e) {
              setErrorCurl((e as Error).message)
              return false
            }
          }}
        />
      )}
      {dialogo?.tipo === 'guardar' && (
        <GuardarPeticion
          colecciones={colecciones}
          nombre={nombreSugerido(dialogo.borrador)}
          onCerrar={() => setDialogo(null)}
          onGuardar={async (coleccionId, nombre, nuevaColeccion) => {
            try {
              let id = coleccionId
              if (nuevaColeccion) {
                const c = await api('guardarColeccion', { nombre: nuevaColeccion })
                setDatos(c.datos)
                id = c.id
                setAbiertas((s) => new Set(s).add(c.id))
              }
              await guardarEn(dialogo.borrador, id, nombre)
              setAbiertas((s) => new Set(s).add(id))
              return true
            } catch (e) {
              setError(mensajeDe(e))
              return false
            }
          }}
        />
      )}
      {dialogo?.tipo === 'coleccion' && (
        <ModalFormulario
          titulo={dialogo.coleccion ? 'Renombrar colección' : 'Nueva colección'}
          campos={[{ id: 'nombre', etiqueta: 'Nombre', valor: dialogo.coleccion?.nombre ?? '', obligatorio: true, placeholder: 'Mi API' }]}
          etiquetaBoton={dialogo.coleccion ? 'Renombrar' : 'Crear'}
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v) => {
            try {
              const r = await api('guardarColeccion', { ...(dialogo.coleccion ? { id: dialogo.coleccion.id } : {}), nombre: v.nombre! })
              setDatos(r.datos)
              setAbiertas((s) => new Set(s).add(r.id))
              return true
            } catch (e) {
              setError(mensajeDe(e))
              return false
            }
          }}
        />
      )}
      {dialogo?.tipo === 'renombrar' && (
        <ModalFormulario
          titulo="Renombrar petición"
          campos={[{ id: 'nombre', etiqueta: 'Nombre', valor: dialogo.peticion.nombre, obligatorio: true }]}
          etiquetaBoton="Renombrar"
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v) => {
            try {
              const r = await api('guardarPeticion', { coleccionId: dialogo.coleccion.id, id: dialogo.peticion.id, nombre: v.nombre!, peticion: dialogo.peticion.peticion })
              setDatos(r.datos)
              setBorradores((bs) => bs.map((b) => (b.guardada?.peticionId === dialogo.peticion.id ? { ...b, nombre: v.nombre! } : b)))
              return true
            } catch (e) {
              setError(mensajeDe(e))
              return false
            }
          }}
        />
      )}
      {dialogo?.tipo === 'eliminarColeccion' && (
        <ModalConfirmar
          titulo="Eliminar colección"
          texto={`¿Eliminar «${dialogo.coleccion.nombre}» con sus ${dialogo.coleccion.peticiones.length} petición(es) guardadas? No se puede deshacer.`}
          etiqueta="Eliminar"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() => void api('eliminarColeccion', { id: dialogo.coleccion.id }).then((d) => (setDatos(d), setBorradores((bs) => bs.map((b) => (b.guardada?.coleccionId === dialogo.coleccion.id ? (({ guardada: _g, ...resto }) => ({ ...resto, sucio: true }))(b) : b))))).catch((e) => setError(mensajeDe(e)))}
        />
      )}
      {dialogo?.tipo === 'eliminarPeticion' && (
        <ModalConfirmar
          titulo="Eliminar petición"
          texto={`¿Eliminar «${dialogo.peticion.nombre}» de la colección «${dialogo.coleccion.nombre}»?`}
          etiqueta="Eliminar"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() => void api('eliminarPeticion', { coleccionId: dialogo.coleccion.id, id: dialogo.peticion.id }).then((d) => (setDatos(d), setBorradores((bs) => bs.map((b) => (b.guardada?.peticionId === dialogo.peticion.id ? (({ guardada: _g, ...resto }) => ({ ...resto, sucio: true }))(b) : b))))).catch((e) => setError(mensajeDe(e)))}
        />
      )}
      {dialogo?.tipo === 'cerrar' && (
        <ModalConfirmar titulo="Cerrar petición" texto={`«${tituloDe(dialogo.borrador)}» tiene cambios sin guardar. ¿Cerrarla igualmente?`} etiqueta="Cerrar sin guardar" onCerrar={() => setDialogo(null)} onConfirmar={() => cerrar(dialogo.borrador)} />
      )}
    </main>
  )
}

function GuardarPeticion({ colecciones, nombre: inicial, onGuardar, onCerrar }: { colecciones: Coleccion[]; nombre: string; onGuardar: (coleccionId: string, nombre: string, nuevaColeccion?: string) => Promise<boolean>; onCerrar: () => void }) {
  const [nombre, setNombre] = useState(inicial)
  const [coleccion, setColeccion] = useState(colecciones[0]?.id ?? '__nueva__')
  const [nueva, setNueva] = useState(colecciones.length === 0 ? 'Mi API' : '')
  const [enviando, setEnviando] = useState(false)
  const nuevaElegida = coleccion === '__nueva__'
  const completo = nombre.trim() !== '' && (!nuevaElegida || nueva.trim() !== '')
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !enviando && onCerrar()}>
      <form
        className="modal modal-chico"
        role="dialog"
        aria-modal="true"
        aria-label="Guardar petición"
        onSubmit={(e) => {
          e.preventDefault()
          if (!completo || enviando) return
          setEnviando(true)
          void onGuardar(coleccion, nombre, nuevaElegida ? nueva : undefined).then((ok) => (ok ? onCerrar() : setEnviando(false)))
        }}
      >
        <div className="modal-cab">
          <h3>Guardar petición</h3>
          <button type="button" className="icono" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <label style={{ maxWidth: 'none' }}>
          Nombre
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label style={{ maxWidth: 'none' }}>
          Colección
          <select value={coleccion} onChange={(e) => setColeccion(e.target.value)}>
            {colecciones.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
            <option value="__nueva__">＋ Nueva colección…</option>
          </select>
        </label>
        {nuevaElegida && (
          <label style={{ maxWidth: 'none' }}>
            Nombre de la colección
            <input value={nueva} onChange={(e) => setNueva(e.target.value)} />
          </label>
        )}
        <div className="cfg-acciones">
          <button className="primario" type="submit" disabled={!completo || enviando}>
            Guardar
          </button>
          <button type="button" onClick={onCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
