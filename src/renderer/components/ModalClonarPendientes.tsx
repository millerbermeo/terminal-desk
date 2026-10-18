import { useEffect, useState } from 'react'
import type { PendienteClonar } from '@shared/equipos'
import { mensajeDe } from '../tareas/useTareas'
import { IconoCarpeta } from './Iconos'

interface Props {
  pendientes: PendienteClonar[]
  /** Proyecto con el que se abrió (los demás quedan sin marcar); sin él se marcan todos. */
  inicial?: string
  onCerrar: () => void
  /** Se clonó al menos uno: hay que recargar los proyectos. */
  onTerminado: () => void
}

type Estado = { fase: 'espera' } | { fase: 'clonando' } | { fase: 'ok'; ruta: string } | { fase: 'error'; mensaje: string }

const CLAVE_PADRE = 'odesk.clonar.padre'
const eq = window.api.equipos.operar

const leerPadre = (): string => {
  try {
    return localStorage.getItem(CLAVE_PADRE) ?? ''
  } catch {
    return ''
  }
}

/**
 * Proyectos de tu cuenta que están en otras computadoras y aún no aquí: se clonan desde su repositorio y quedan enlazados al mismo
 * proyecto (conservan su tablero, conversaciones y trazas).
 */
export function ModalClonarPendientes({ pendientes, inicial, onCerrar, onTerminado }: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(inicial ? [inicial] : pendientes.map((p) => p.id)))
  const [carpeta, setCarpeta] = useState(leerPadre)
  const [protocolo, setProtocolo] = useState<'https' | 'ssh'>('https')
  const [estados, setEstados] = useState<Record<string, Estado>>({})
  const [trabajando, setTrabajando] = useState(false)
  const [terminado, setTerminado] = useState(false)

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !trabajando) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, trabajando])

  const alternar = (id: string): void =>
    setMarcados((m) => {
      const n = new Set(m)
      if (!n.delete(id)) n.add(id)
      return n
    })
  const examinar = (): void => void window.api.proyectos.elegirCarpetas().then((r) => r[0] && setCarpeta(r[0]))

  const clonar = async (): Promise<void> => {
    if (trabajando || marcados.size === 0 || !carpeta.trim()) return
    try {
      localStorage.setItem(CLAVE_PADRE, carpeta.trim())
    } catch {
      // se pedirá de nuevo la próxima vez
    }
    setTrabajando(true)
    let alguno = false
    for (const p of pendientes.filter((x) => marcados.has(x.id) && estados[x.id]?.fase !== 'ok')) {
      setEstados((e) => ({ ...e, [p.id]: { fase: 'clonando' } }))
      try {
        const r = await eq('clonarPendiente', { proyectoId: p.id, carpetaPadre: carpeta.trim(), protocolo })
        alguno = true
        setEstados((e) => ({ ...e, [p.id]: { fase: 'ok', ruta: r.ruta } }))
      } catch (err) {
        setEstados((e) => ({ ...e, [p.id]: { fase: 'error', mensaje: mensajeDe(err) } }))
      }
    }
    setTrabajando(false)
    setTerminado(true)
    if (alguno) onTerminado()
  }

  const hayErrores = Object.values(estados).some((e) => e.fase === 'error')

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !trabajando && onCerrar()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Clonar proyectos de tu cuenta"
        onSubmit={(e) => {
          e.preventDefault()
          void clonar()
        }}
      >
        <div className="modal-cab">
          <h3>Proyectos de tu cuenta</h3>
          <button type="button" className="icono" onClick={onCerrar} aria-label="Cerrar" disabled={trabajando}>
            ✕
          </button>
        </div>
        <p className="modal-texto">Estos proyectos están en otros equipos de tu cuenta y aún no tienen carpeta aquí. Al clonarlos conservan su tablero, conversaciones y trazas.</p>

        <ul className="cp-lista" aria-label="Proyectos por clonar">
          {pendientes.map((p) => {
            const e = estados[p.id]
            return (
              <li key={p.id} className={`cp-fila${e?.fase === 'ok' ? ' ok' : ''}`}>
                <label className="cp-marca">
                  <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} disabled={trabajando || e?.fase === 'ok'} />
                  <span className="cp-nombre">{p.nombre}</span>
                </label>
                <span className="mono cp-repo" title={p.repo}>{p.repo.replace(/^(https?:\/\/|git@)/, '').replace(/\.git$/, '')}</span>
                {e?.fase === 'clonando' && <span className="spinner" aria-label="Clonando" />}
                {e?.fase === 'ok' && <span className="chip chip-ok" title={e.ruta}>✓ clonado</span>}
                {e?.fase === 'error' && <span className="chip api-estado-servidor" title={e.mensaje}>falló</span>}
                {e?.fase === 'error' && <span className="cp-error">{e.mensaje}</span>}
              </li>
            )
          })}
        </ul>

        <label style={{ maxWidth: 'none' }}>
          Carpeta donde clonar
          <span className="td-fila">
            <input value={carpeta} onChange={(e) => setCarpeta(e.target.value)} placeholder="~/dev" spellCheck={false} disabled={trabajando} />
            <button type="button" onClick={examinar} disabled={trabajando}>
              <IconoCarpeta /> Examinar
            </button>
          </span>
          <span className="ayuda">Cada proyecto se clona en una subcarpeta con el nombre de su repositorio.</span>
        </label>
        <label>
          Protocolo
          <select value={protocolo} onChange={(e) => setProtocolo(e.target.value as 'https' | 'ssh')} disabled={trabajando}>
            <option value="https">HTTPS (usa tu cuenta de GitHub conectada)</option>
            <option value="ssh">SSH (usa tu clave)</option>
          </select>
        </label>

        <div className="cfg-acciones">
          {!terminado || hayErrores ? (
            <button className="primario" type="submit" disabled={trabajando || marcados.size === 0 || !carpeta.trim()}>
              {trabajando ? 'Clonando…' : hayErrores ? 'Reintentar' : `Clonar ${marcados.size} proyecto${marcados.size === 1 ? '' : 's'}`}
            </button>
          ) : null}
          <button type="button" onClick={onCerrar} disabled={trabajando}>
            {terminado ? 'Cerrar' : 'Cancelar'}
          </button>
        </div>
      </form>
    </div>
  )
}
