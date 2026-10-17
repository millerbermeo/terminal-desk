import { useEffect, useState } from 'react'
import type { DatosApi, VariableEntorno } from '@shared/api'
import { nuevoId } from '@shared/api'
import { mensajeDe } from '../tareas/useTareas'
import { EstadoVacio } from './EstadoVacio'
import { IconoServidor } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'

interface Props {
  datos: DatosApi
  onDatos: (d: DatosApi) => void
  onCerrar: () => void
}

/** Entornos: conjuntos de variables (`{{baseUrl}}`, `{{token}}`…) para cambiar de servidor sin tocar las peticiones. */
export function ApiEntornos({ datos, onDatos, onCerrar }: Props) {
  const [id, setId] = useState<string | undefined>(datos.entornoActivo ?? datos.entornos[0]?.id)
  const actual = datos.entornos.find((e) => e.id === id)
  const [nombre, setNombre] = useState(actual?.nombre ?? '')
  const [variables, setVariables] = useState<VariableEntorno[]>(actual?.variables ?? [])
  const [error, setError] = useState('')
  const [borrar, setBorrar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    setNombre(actual?.nombre ?? '')
    setVariables(actual?.variables ?? [])
    setError('')
  }, [id, actual])
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !borrar) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, borrar])

  const api = window.api.api.operar
  const ejecutar = async (f: () => Promise<void>): Promise<void> => {
    setTrabajando(true)
    try {
      await f()
      setError('')
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setTrabajando(false)
    }
  }
  const nuevo = (): void =>
    void ejecutar(async () => {
      const r = await api('guardarEntorno', { nombre: `Entorno ${datos.entornos.length + 1}`, variables: [] })
      onDatos(r.datos)
      setId(r.id)
    })
  const guardar = (): void =>
    void ejecutar(async () => {
      const r = await api('guardarEntorno', { ...(id ? { id } : {}), nombre, variables })
      onDatos(r.datos)
    })
  const cambiar = (v: string, parche: Partial<VariableEntorno>): void => setVariables(variables.map((x) => (x.id === v ? { ...x, ...parche } : x)))
  const sucio = actual && (nombre !== actual.nombre || JSON.stringify(variables) !== JSON.stringify(actual.variables))

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal api-entornos" role="dialog" aria-modal="true" aria-label="Entornos">
        <div className="modal-cab">
          <h3>Entornos</h3>
          <button className="icono" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="modal-texto">
          Define variables por entorno y úsalas como <code>{'{{baseUrl}}'}</code> en la URL, cabeceras, cuerpo o autenticación. Cambia de entorno (local, pruebas, producción) sin editar las peticiones.
        </p>
        <div className="api-entornos-cuerpo">
          <ul className="api-entornos-lista">
            {datos.entornos.map((e) => (
              <li key={e.id}>
                <button className={e.id === id ? 'sel' : ''} onClick={() => setId(e.id)}>
                  {e.nombre}
                  {e.id === datos.entornoActivo && <span className="chip chip-ok">activo</span>}
                </button>
              </li>
            ))}
            <li>
              <button onClick={nuevo} disabled={trabajando}>
                ＋ Nuevo entorno
              </button>
            </li>
          </ul>
          <div className="api-entornos-editor">
            {!actual ? (
              <EstadoVacio variante="compacto" icono={<IconoServidor />} titulo="Sin entornos" texto="Crea uno (por ejemplo «Local») con la variable baseUrl = http://localhost:3000." accion={<button className="primario" onClick={nuevo}>Crear entorno</button>} />
            ) : (
              <>
                <label>
                  Nombre
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </label>
                <div className="kv" role="table" aria-label="Variables">
                  {variables.map((v) => (
                    <div className={`kv-fila${v.activa ? '' : ' apagada'}`} key={v.id} role="row">
                      <input type="checkbox" checked={v.activa} onChange={(e) => cambiar(v.id, { activa: e.target.checked })} aria-label="Activar variable" />
                      <input value={v.clave} placeholder="Variable" spellCheck={false} onChange={(e) => cambiar(v.id, { clave: e.target.value })} aria-label="Nombre de la variable" />
                      <input value={v.valor} placeholder="Valor" spellCheck={false} onChange={(e) => cambiar(v.id, { valor: e.target.value })} aria-label="Valor" />
                      <button className="icono" onClick={() => setVariables(variables.filter((x) => x.id !== v.id))} aria-label="Quitar variable">
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="kv-fila fantasma" role="row">
                    <input type="checkbox" disabled aria-hidden="true" tabIndex={-1} />
                    <input value="" placeholder="Variable" onChange={(e) => setVariables([...variables, { id: nuevoId(), clave: e.target.value, valor: '', activa: true }])} aria-label="Nueva variable" />
                    <input value="" placeholder="Valor" onChange={(e) => setVariables([...variables, { id: nuevoId(), clave: '', valor: e.target.value, activa: true }])} aria-label="Nuevo valor" />
                    <span />
                  </div>
                </div>
                {error && <p className="tareas-error-texto" role="alert">{error}</p>}
                <div className="cfg-acciones">
                  <button className="peligro" onClick={() => setBorrar(true)} disabled={trabajando}>
                    Eliminar
                  </button>
                  <span className="ag-espacio" />
                  {actual.id !== datos.entornoActivo && (
                    <button disabled={trabajando} onClick={() => void ejecutar(async () => onDatos(await api('fijarEntorno', { id: actual.id })))}>
                      Usar este entorno
                    </button>
                  )}
                  <button className="primario" disabled={trabajando || !sucio} onClick={guardar}>
                    Guardar cambios
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {borrar && actual && (
        <ModalConfirmar
          titulo="Eliminar entorno"
          texto={`¿Eliminar el entorno «${actual.nombre}» y sus ${actual.variables.length} variable(s)?`}
          etiqueta="Eliminar"
          onCerrar={() => setBorrar(false)}
          onConfirmar={() =>
            void ejecutar(async () => {
              const d = await api('eliminarEntorno', { id: actual.id })
              onDatos(d)
              setId(d.entornoActivo ?? d.entornos[0]?.id)
            })
          }
        />
      )}
    </div>
  )
}
