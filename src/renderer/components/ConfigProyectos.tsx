import { useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto } from '@shared/ipc'

interface Props {
  datos: DatosProyectos
  onDatos: (d: DatosProyectos) => void
}

interface Fila {
  nombre: string
  ruta: string
}

const NUEVO = '__nuevo__'
const SIN_GRUPO = ''
const filaVacia = (): Fila => ({ nombre: '', ruta: '' })

function nombreDeRuta(ruta: string): string {
  return ruta.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

export function ConfigProyectos({ datos, onDatos }: Props) {
  const [formAbierto, setFormAbierto] = useState(false)
  const [grupo, setGrupo] = useState(SIN_GRUPO)
  const [grupoNuevo, setGrupoNuevo] = useState('')
  const [filas, setFilas] = useState<Fila[]>([filaVacia()])
  const [errores, setErrores] = useState<ErrorProyecto[]>([])
  const [guardando, setGuardando] = useState(false)

  const cambiarFila = (i: number, campo: keyof Fila, valor: string): void =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)))

  const cerrarForm = (): void => {
    setFormAbierto(false)
    setGrupo(SIN_GRUPO)
    setGrupoNuevo('')
    setFilas([filaVacia()])
    setErrores([])
  }

  const enviar = async (): Promise<void> => {
    // Filas totalmente vacías se ignoran; nombre vacío = nombre de la carpeta.
    const proyectos = filas
      .filter((f) => f.nombre.trim() || f.ruta.trim())
      .map((f) => ({ nombre: f.nombre.trim() || nombreDeRuta(f.ruta), ruta: f.ruta }))
    if (proyectos.length === 0) return setErrores([{ indice: -1, mensaje: 'Agrega al menos un proyecto' }])
    if (grupo === NUEVO && !grupoNuevo.trim()) return setErrores([{ indice: -1, mensaje: 'Escribe el nombre del grupo' }])

    setGuardando(true)
    const res = await window.api.proyectos.agregar({
      ...(grupo === NUEVO ? { grupoNuevo } : grupo ? { grupoId: grupo } : {}),
      proyectos
    })
    setGuardando(false)
    if (res.errores.length > 0) {
      // los índices apuntan a la lista filtrada; los remapeo a las filas del formulario
      const usadas = filas.map((f, i) => (f.nombre.trim() || f.ruta.trim() ? i : -1)).filter((i) => i >= 0)
      setErrores(res.errores.map((e) => ({ ...e, indice: e.indice >= 0 ? usadas[e.indice] : -1 })))
      return
    }
    onDatos(res.datos)
    cerrarForm()
  }

  const errorGeneral = errores.filter((e) => e.indice < 0)
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const lista = (grupoId: string | undefined, nombre: string, proyectos: typeof datos.proyectos) => (
    <section className="cfg-grupo" key={grupoId ?? 'sin-grupo'}>
      <div className="cfg-grupo-cab">
        <h3>
          {nombre} <small>({proyectos.length})</small>
        </h3>
        {grupoId && (
          <button title="Elimina el grupo; sus proyectos pasan a «Sin grupo»" onClick={() => void window.api.proyectos.eliminarGrupo(grupoId).then(onDatos)}>
            Eliminar grupo
          </button>
        )}
      </div>
      {proyectos.length === 0 && <p className="cfg-vacio">Sin proyectos</p>}
      {proyectos.map((p) => (
        <div className="cfg-proyecto" key={p.id}>
          <strong>{p.nombre}</strong>
          <code>{p.ruta}</code>
          <button title="Quitar de la lista (no borra la carpeta)" onClick={() => void window.api.proyectos.eliminar(p.id).then(onDatos)}>
            Quitar
          </button>
        </div>
      ))}
    </section>
  )

  return (
    <div className="config">
      <div className="cfg-cab">
        <h2>Configurar proyectos</h2>
        {!formAbierto && <button className="primario" onClick={() => setFormAbierto(true)}>+ Agregar proyectos</button>}
      </div>

      {formAbierto && (
        <form
          className="cfg-form"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar()
          }}
        >
          <h3>Agregar proyectos</h3>
          <label>
            Grupo
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
              <option value={SIN_GRUPO}>Sin grupo</option>
              {datos.grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre}
                </option>
              ))}
              <option value={NUEVO}>+ Nuevo grupo…</option>
            </select>
          </label>
          {grupo === NUEVO && (
            <input placeholder="Nombre del nuevo grupo" value={grupoNuevo} onChange={(e) => setGrupoNuevo(e.target.value)} autoFocus />
          )}

          <div className="cfg-filas">
            {filas.map((f, i) => (
              <div key={i}>
                <div className="cfg-fila">
                  <input
                    placeholder={nombreDeRuta(f.ruta) || 'Nombre'}
                    value={f.nombre}
                    onChange={(e) => cambiarFila(i, 'nombre', e.target.value)}
                  />
                  <input
                    className="ruta"
                    placeholder="Ruta completa o relativa al home (ej. dev/mi-app, ~/dev/mi-app, /opt/app)"
                    value={f.ruta}
                    onChange={(e) => cambiarFila(i, 'ruta', e.target.value)}
                  />
                  <button type="button" title="Quitar fila" disabled={filas.length === 1} onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
                {errores.filter((e) => e.indice === i).map((e) => (
                  <div className="cfg-error" key={e.mensaje}>
                    {e.mensaje}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setFilas((fs) => [...fs, filaVacia()])}>
            + Otra fila
          </button>

          {errorGeneral.map((e) => (
            <div className="cfg-error" key={e.mensaje}>
              {e.mensaje}
            </div>
          ))}
          <div className="cfg-acciones">
            <button type="submit" className="primario" disabled={guardando}>
              Guardar
            </button>
            <button type="button" onClick={cerrarForm}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {datos.grupos.map((g) =>
        lista(g.id, g.nombre, datos.proyectos.filter((p) => p.grupo === g.id))
      )}
      {(sinGrupo.length > 0 || datos.grupos.length === 0) && lista(undefined, 'Sin grupo', sinGrupo)}
    </div>
  )
}
