import { useCallback, useEffect, useRef, useState } from 'react'
import { IconoCarpeta, IconoCerrar, IconoCheck, IconoMas } from './Iconos'
import type { DatosProyectos } from '@shared/modelos'
import type { ErrorProyecto, ValidacionRuta } from '@shared/ipc'

interface Props {
  datos: DatosProyectos
  onGuardado: (d: DatosProyectos) => void
  onCerrar: () => void
  /** Rutas con las que se abre el formulario (p. ej. las elegidas con «Abrir carpeta»). */
  rutasIniciales?: string[]
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

/** Si el IPC falla (p. ej. main/preload desactualizados) se muestra como error, no se queda cargando. */
function validar(ruta: string, cb: (v: ValidacionRuta) => void): void {
  window.api.proyectos.validarRuta(ruta).then(cb, () =>
    cb({ ok: false, ruta, mensaje: 'No se pudo validar. Reinicia la app (pnpm dev)' })
  )
}

export function ModalAgregar({ datos, onGuardado, onCerrar, rutasIniciales }: Props) {
  const [grupo, setGrupo] = useState(SIN_GRUPO)
  const [grupoNuevo, setGrupoNuevo] = useState('')
  const [filas, setFilas] = useState<Fila[]>(() => (rutasIniciales?.length ? rutasIniciales.map((ruta) => ({ nombre: '', ruta })) : [filaVacia()]))
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [errores, setErrores] = useState<ErrorProyecto[]>([])
  const [guardando, setGuardando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const temporizadores = useRef(new Map<number, number>())

  // animación de salida: se desmonta cuando termina
  const salir = useCallback((): void => {
    setCerrando(true)
    window.setTimeout(onCerrar, 200)
  }, [onCerrar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') salir()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salir])

  // Las rutas con las que se abre el formulario se validan al montar.
  useEffect(() => {
    rutasIniciales?.forEach((ruta, i) =>
      validar(ruta, (validacion) => setFilas((fs) => fs.map((f, j) => (j === i && f.ruta === ruta ? { ...f, validacion } : f))))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autocompletado de la ruta que se está escribiendo.
  const pedirSugerencias = useRef(0)
  const sugerir = (ruta: string): void => {
    window.clearTimeout(pedirSugerencias.current)
    if (!ruta.trim()) return setSugerencias([])
    pedirSugerencias.current = window.setTimeout(() => void window.api.proyectos.sugerirRutas(ruta).then(setSugerencias, () => setSugerencias([])), 150)
  }

  /** Diálogo nativo: la primera carpeta rellena la fila y las demás añaden filas. */
  const examinar = async (i: number): Promise<void> => {
    const rutas = await window.api.proyectos.elegirCarpetas()
    if (rutas.length === 0) return
    setErrores([])
    setFilas((fs) => {
      const nuevas = fs.map((f, j) => (j === i ? { ...f, ruta: rutas[0]!, validacion: undefined } : f))
      return [...nuevas, ...rutas.slice(1).map((ruta) => ({ nombre: '', ruta }))]
    })
    rutas.forEach((ruta, k) => {
      const fila = k === 0 ? i : filas.length + k - 1
      validar(ruta, (validacion) => setFilas((fs) => fs.map((f, j) => (j === fila && f.ruta === ruta ? { ...f, validacion } : f))))
    })
  }

  useEffect(() => {
    const temps = temporizadores.current
    return () => temps.forEach((t) => clearTimeout(t))
  }, [])

  const cambiarRuta = (i: number, ruta: string): void => {
    setErrores([])
    sugerir(ruta)
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ruta, validacion: undefined } : f)))
    clearTimeout(temporizadores.current.get(i))
    if (!ruta.trim()) return
    temporizadores.current.set(
      i,
      window.setTimeout(() => {
        // descarta resultados de una ruta que ya cambió
        validar(ruta, (validacion) =>
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
  const cambiarRutaDiferida = (j: number, ruta: string): void =>
    validar(ruta, (validacion) =>
      setFilas((fs) => fs.map((f, k) => (k === j && f.ruta === ruta ? { ...f, validacion } : f)))
    )

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
    salir()
  }

  const estado = (f: Fila, i: number) => {
    if (!f.ruta.trim()) return null
    if (!f.validacion) return <div className="cfg-nota"><span className="spinner" /> Comprobando…</div>
    if (!f.validacion.ok) return <div className="cfg-error"><IconoCerrar /> {f.validacion.mensaje}</div>
    if (duplicada(i)) return <div className="cfg-error"><IconoCerrar /> Ruta repetida en el formulario</div>
    return <div className="cfg-ok"><IconoCheck /> {f.validacion.ruta}</div>
  }

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && salir()}>
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
        <div className="modal-cab">
          <h3>Agregar proyectos</h3>
          <button type="button" className="icono" onClick={salir} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>
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

        <datalist id="sugerencias-rutas">
          {sugerencias.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
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
                  list="sugerencias-rutas"
                  autoFocus={i === 0 && grupo !== NUEVO && !rutasIniciales?.length}
                  spellCheck={false}
                />
                <button type="button" title="Elegir carpeta…" onClick={() => void examinar(i)}>
                  <IconoCarpeta /> Examinar
                </button>
                <button type="button" className="icono" title="Quitar fila" disabled={filas.length === 1} onClick={() => quitarFila(i)}>
                  <IconoCerrar />
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
          <IconoMas /> Otra fila
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
          <button type="button" onClick={salir}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
