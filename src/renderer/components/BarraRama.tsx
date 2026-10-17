import { useCallback, useEffect, useRef, useState } from 'react'
import { validarNombreRef, type EstadoGit, type Rama } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git } from '../versiones/useGit'
import { IconoRama } from './Iconos'

/** Qué se quiere hacer cuando hay cambios pendientes y hay que decidir antes qué hacer con ellos. */
type Pendiente = { tipo: 'cambiar'; rama: string } | { tipo: 'crear'; nombre: string }

interface Props {
  proyectoId: string
  /** El agente está trabajando: no se cambia de rama bajo sus pies. */
  ocupadoAgente: boolean
}

/** Rama actual del proyecto en el asistente, con cambio rápido, creación y protección de los cambios sin confirmar. */
export function BarraRama({ proyectoId, ocupadoAgente }: Props) {
  const [estado, setEstado] = useState<EstadoGit | null>(null)
  const [ramas, setRamas] = useState<Rama[]>([])
  const [abierto, setAbierto] = useState(false)
  const [nueva, setNueva] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [trabajando, setTrabajando] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const raiz = useRef<HTMLDivElement>(null)

  const leer = useCallback(async (): Promise<EstadoGit | null> => {
    try {
      const e = await git('estado', { proyectoId })
      setEstado(e)
      return e
    } catch {
      setEstado(null)
      return null
    }
  }, [proyectoId])

  useEffect(() => {
    setEstado(null)
    setAbierto(false)
    setNueva(null)
    setPendiente(null)
    setError('')
    setAviso('')
    void leer()
  }, [leer])

  // Al volver a la ventana y al terminar el agente (que pudo tocar archivos) se vuelve a leer.
  useEffect(() => {
    const alEnfocar = (): void => void leer()
    window.addEventListener('focus', alEnfocar)
    return () => window.removeEventListener('focus', alEnfocar)
  }, [leer])
  useEffect(() => {
    if (!ocupadoAgente) void leer()
  }, [ocupadoAgente, leer])

  useEffect(() => {
    if (!abierto) return
    void git('ramas', { proyectoId }).then((r) => setRamas(r.filter((x) => !x.remota))).catch(() => setRamas([]))
    const fuera = (e: MouseEvent): void => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('mousedown', fuera)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('mousedown', fuera)
      window.removeEventListener('keydown', tecla)
    }
  }, [abierto, proyectoId])

  if (!estado?.repo) return null

  const cambios = estado.archivos.length
  const enCurso = estado.operacion !== undefined || estado.archivos.some((a) => a.conflicto)
  const bloqueado = trabajando !== '' || ocupadoAgente
  const motivoBloqueo = ocupadoAgente ? 'El agente está trabajando: espera a que termine.' : enCurso ? 'Hay una fusión o conflictos sin resolver: termínalos o abórtalos en Versiones.' : estado.sinCommits ? 'Haz primero un commit.' : ''

  const ejecutar = async (etiqueta: string, f: () => Promise<EstadoGit>, ok: string): Promise<boolean> => {
    setTrabajando(etiqueta)
    setError('')
    try {
      setEstado(await f())
      setAviso(ok)
      return true
    } catch (e) {
      setError(mensajeDe(e))
      void leer()
      return false
    } finally {
      setTrabajando('')
    }
  }

  const hacer = (p: Pendiente): Promise<boolean> =>
    p.tipo === 'cambiar'
      ? ejecutar('Cambiando de rama…', () => git('cambiarRama', { proyectoId, nombre: p.rama }), `Ahora estás en «${p.rama}».`)
      : ejecutar('Creando rama…', () => git('crearRama', { proyectoId, nombre: p.nombre, cambiar: true }), `Rama «${p.nombre}» creada y activa.`)

  /** Con cambios sin confirmar no se cambia a ciegas: antes se pregunta qué hacer con ellos. */
  const solicitar = (p: Pendiente): void => {
    setAbierto(false)
    setAviso('')
    setError('')
    if (cambios > 0) {
      setMensaje('')
      setPendiente(p)
    } else void hacer(p)
  }

  const crear = (): void => {
    const n = (nueva ?? '').trim()
    const falla = validarNombreRef(n)
    if (falla) return setError(falla)
    setNueva(null)
    solicitar({ tipo: 'crear', nombre: n })
  }

  const confirmarCommit = async (): Promise<void> => {
    if (!pendiente || !mensaje.trim()) return
    const p = pendiente
    setTrabajando('Haciendo commit…')
    setError('')
    try {
      await git('preparar', { proyectoId })
      await git('commit', { proyectoId, mensaje: mensaje.trim() })
    } catch (e) {
      setTrabajando('')
      return setError(mensajeDe(e))
    }
    setTrabajando('')
    setPendiente(null)
    await hacer(p)
  }

  const confirmarStash = async (): Promise<void> => {
    if (!pendiente) return
    const p = pendiente
    setTrabajando('Guardando cambios…')
    setError('')
    try {
      await git('guardarStash', { proyectoId, mensaje: `Antes de ${p.tipo === 'cambiar' ? `cambiar a ${p.rama}` : `crear ${p.nombre}`}`, incluirNoSeguidos: true })
    } catch (e) {
      setTrabajando('')
      return setError(mensajeDe(e))
    }
    setTrabajando('')
    setPendiente(null)
    if (await hacer(p)) setAviso((a) => `${a} Tus cambios quedaron guardados en Versiones → Stash.`)
  }

  const cerrarDialogo = (): void => {
    if (trabajando === '') (setPendiente(null), setError(''))
  }

  return (
    <div className="ag-rama" ref={raiz}>
      <button className="ag-rama-btn" disabled={bloqueado || Boolean(motivoBloqueo && enCurso)} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} title={motivoBloqueo || 'Cambiar de rama'}>
        <IconoRama /> <strong>{estado.rama ?? `desacoplado (${estado.desacoplado ?? '?'})`}</strong> <span aria-hidden="true">▾</span>
      </button>
      {cambios > 0 && (
        <span className="chip chip-aviso" title="Archivos con cambios sin confirmar">
          {cambios} {cambios === 1 ? 'cambio' : 'cambios'}
        </span>
      )}
      {(estado.adelante > 0 || estado.atras > 0) && (
        <span className="chip" title={`Respecto a ${estado.upstream ?? 'la remota'}`}>
          {estado.adelante > 0 && `↑${estado.adelante}`} {estado.atras > 0 && `↓${estado.atras}`}
        </span>
      )}
      {nueva === null ? (
        <button disabled={bloqueado || Boolean(motivoBloqueo)} onClick={() => (setNueva(''), setError(''), setAviso(''))} title={motivoBloqueo || 'Crear una rama nueva a partir de la actual y cambiar a ella'}>
          + Rama
        </button>
      ) : (
        <form
          className="ag-rama-nueva"
          onSubmit={(e) => {
            e.preventDefault()
            crear()
          }}
        >
          <input autoFocus value={nueva} placeholder="feat/mi-cambio" aria-label="Nombre de la rama nueva" onChange={(e) => (setNueva(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setNueva(null))} />
          <button className="primario" type="submit" disabled={!nueva.trim() || bloqueado}>
            Crear
          </button>
          <button type="button" onClick={() => (setNueva(null), setError(''))}>
            ✕
          </button>
        </form>
      )}
      {trabajando && <span className="ag-rama-msg">{trabajando}</span>}
      {!trabajando && error && !pendiente && (
        <span className="ag-rama-msg error" role="alert">
          {error}
        </span>
      )}
      {!trabajando && !error && aviso && <span className="ag-rama-msg ok">{aviso}</span>}

      {abierto && (
        <div className="ag-rama-lista" role="listbox" aria-label="Ramas">
          {ramas.length === 0 && <div className="ag-rama-vacio">Sin ramas</div>}
          {ramas.map((r) => (
            <button key={r.nombre} role="option" aria-selected={r.actual} className={r.actual ? 'sel' : ''} disabled={r.actual} onClick={() => solicitar({ tipo: 'cambiar', rama: r.nombre })}>
              <IconoRama /> <span>{r.nombre}</span>
              {r.actual && <small>actual</small>}
            </button>
          ))}
        </div>
      )}

      {pendiente && (
        <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && cerrarDialogo()}>
          <div className="modal modal-chico" role="dialog" aria-modal="true" aria-label="Cambios pendientes">
            <div className="modal-cab">
              <h3>Tienes cambios sin confirmar</h3>
              <button className="icono" onClick={cerrarDialogo} aria-label="Cerrar" disabled={trabajando !== ''}>
                ✕
              </button>
            </div>
            <p className="modal-texto">
              Hay {cambios} {cambios === 1 ? 'archivo modificado' : 'archivos modificados'} en «{estado.rama ?? 'esta posición'}». Antes de {pendiente.tipo === 'cambiar' ? `pasar a «${pendiente.rama}»` : `crear «${pendiente.nombre}»`}, decide qué hacer con ellos para no perderlos ni mezclarlos.
            </p>
            <label style={{ maxWidth: 'none' }}>
              Mensaje del commit
              <input autoFocus value={mensaje} placeholder="Describe lo que cambiaste" onChange={(e) => setMensaje(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void confirmarCommit()} />
            </label>
            {error && (
              <p className="tareas-error-texto" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </p>
            )}
            <div className="cfg-acciones" style={{ flexWrap: 'wrap' }}>
              <button className="primario" disabled={!mensaje.trim() || trabajando !== ''} onClick={() => void confirmarCommit()}>
                {trabajando === 'Haciendo commit…' ? 'Trabajando…' : 'Hacer commit y continuar'}
              </button>
              <button disabled={trabajando !== ''} onClick={() => void confirmarStash()} title="Guarda los cambios aparte (incluye archivos nuevos); los recuperas en Versiones → Stash">
                Guardar aparte (stash) y continuar
              </button>
              {pendiente.tipo === 'crear' && (
                <button
                  disabled={trabajando !== ''}
                  onClick={() => {
                    const p = pendiente
                    setPendiente(null)
                    void hacer(p)
                  }}
                  title="Los cambios se quedan en el árbol de trabajo y pasan a la rama nueva"
                >
                  Llevar los cambios a la rama nueva
                </button>
              )}
              <button disabled={trabajando !== ''} onClick={cerrarDialogo}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
