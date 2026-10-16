import { useEffect, useRef, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto, ValidacionRuta } from '@shared/ipc'

interface Props {
  datos: DatosProyectos
  onGuardado: (d: DatosProyectos) => void
  onCerrar: () => void
}

interface Fila {
  nombre: string
  ruta: string
  validacion?: ValidacionRuta // undefined = sin validar / validando
}

const NUEVO = '__nuevo__'
const SIN_GRUPO = ''
const filaVacia = (): Fila => ({ nombre: '', ruta: '' })

function nombreDeRuta(ruta: string): string {
  return ruta.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

export function ModalAgregar({ datos, onGuardado, onCerrar }: Props) {
  const [grupo, setGrupo] = useState(SIN_GRUPO)
  const [grupoNuevo, setGrupoNuevo] = useState('')
  const [filas, setFilas] = useState<Fila[]>([filaVacia()])
  const [errores, setErrores] = useState<ErrorProyecto[]>([])
  const [guardando, setGuardando] = useState(false)
  const temporizadores = useRef(new Map<number, number>())

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    const temps = temporizadores.current
    return () => {
      window.removeEventListener('keydown', tecla)
      temps.forEach((t) => clearTimeout(t))
    }
  }, [onCerrar])

  const cambiarRuta = (i: number, ruta: string): void => {
    setErrores([])
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ruta, validacion: undefined } : f)))
    clearTimeout(temporizadores.current.get(i))
    if (!ruta.trim()) return
    temporizadores.current.set(
      i,
      window.setTimeout(() => {
        void window.api.proyectos.validarRuta(ruta).then((validacion) =>
          // descarta resultados de una ruta que ya cambió
          setFilas((fs) => fs.map((f, j) => (j === i && f.ruta === ruta ? { ...f, validacion } : f)))
        )
      }, 300)
    )
  }

  const cambiarNombre = (i: number, nombre: string): void =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, nombre } : f)))

  const quitarFila = (i: number): void => {
    // los temporizadores y validaciones van por índice: se revalidan todas
    temporizadores.current.forEach((t) => clearTimeout(t))
    temporizadores.current.clear()
    const resto = filas.filter((_, j) => j !== i)
    setFilas(resto.map((f) => ({ ...f, validacion: undefined })))
    resto.forEach((f, j) => f.ruta.trim() && cambiarRutaDiferida(j, f.ruta))
  }
  const cambiarRutaDiferida = (j: number, ruta: string): void => {
    void window.api.proyectos.validarRuta(ruta).then((validacion) =>
      setFilas((fs) => fs.map((f, k) => (k === j && f.ruta === ruta ? { ...f, validacion } : f)))
    )
  }

  const usadas = filas.map((f, i) => (f.nombre.trim() || f.ruta.trim() ? i : -1)).filter((i) => i >= 0)
  const duplicada = (i: number): boolean => {
    const r = filas[i].validacion?.ruta
    return !!r && filas.some((f, j) => j < i && f.validacion?.ruta === r)
  }
  const todoValido =
    usadas.length > 0 &&
    usadas.every((i) => filas[i].validacion?.ok && !duplicada(i)) &&
    (grupo !== NUEVO || grupoNuevo.trim() !== '')

  const enviar = async (): Promise<void> => {
    const proyectos = usadas.map((i) => ({ nombre: filas[i].nombre.trim() || nombreDeRuta(filas[i].ruta), ruta: filas[i].ruta }))
    setGuardando(true)
    const res = await window.api.proyectos.agregar({
      ...(grupo === NUEVO ? { grupoNuevo } : grupo ? { grupoId: grupo } : {}),
      proyectos
    })
    setGuardando(false)
    if (res.errores.length > 0) {
      setErrores(res.errores.map((e) => ({ ...e, indice: e.indice >= 0 ? usadas[e.indice] : -1 })))
      return
    }
    onGuardado(res.datos)
  }

  const estado = (f: Fila, i: number) => {
    if (!f.ruta.trim()) return null
    if (!f.validacion) return <div className="cfg-nota">Comprobando…</div>
    if (!f.validacion.ok) return <div className="cfg-error">✗ {f.validacion.mensaje}</div>
    if (duplicada(i)) return <div className="cfg-error">✗ Ruta repetida en el formulario</div>
    return <div className="cfg-ok">✓ {f.validacion.ruta}</div>
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Agregar proyectos"
        onSubmit={(e) => {
          e.preventDefault()
          if (todoValido && !guardando) void enviar()
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

        <div className="modal-filas">
          {filas.map((f, i) => (
            <div key={i}>
              <div className="cfg-fila">
                <input placeholder={nombreDeRuta(f.ruta) || 'Nombre'} value={f.nombre} onChange={(e) => cambiarNombre(i, e.target.value)} />
                <input
                  className="ruta"
                  placeholder="Ruta completa o relativa al home (dev/app, ~/dev/app, /opt/app)"
                  value={f.ruta}
                  onChange={(e) => cambiarRuta(i, e.target.value)}
                  autoFocus={i === 0 && grupo !== NUEVO}
                />
                <button type="button" title="Quitar fila" disabled={filas.length === 1} onClick={() => quitarFila(i)}>
                  ×
                </button>
              </div>
              {estado(f, i)}
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

        {errores.filter((e) => e.indice < 0).map((e) => (
          <div className="cfg-error" key={e.mensaje}>
            {e.mensaje}
          </div>
        ))}
        <div className="cfg-acciones">
          <button type="submit" className="primario" disabled={!todoValido || guardando}>
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
