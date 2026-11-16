import { memo, useContext, useMemo, useState } from 'react'
import type { EventoAgente } from '@shared/core/agente'
import { cambiosDelTurno, revertirArchivo, rutaRelativa, type ArchivoDelTurno } from '../agente/utilidades-chat'
import { confirmar } from '../confirmar'
import { Cambio, ProyectoDelChat } from './DiffEdicion'

const MOTIVO: Record<string, string> = {
  'ya-cambiado': 'El archivo cambió después de este turno (a mano o en otro mensaje): no se puede devolver trozo a trozo. Usa «Deshacer todo».',
  ambiguo: 'Un trozo aparece más de una vez en el archivo: no sé cuál devolver. Usa «Deshacer todo».',
  'sin-referencia': 'Se reescribió el archivo entero o solo se borró texto: no hay un punto seguro. Usa «Deshacer todo».'
}

const corta = (ruta: string): string => ruta.split(/[\\/]/).slice(-3).join('/')

function FilaArchivo({ a, proyectoId, revisado, onRevisado }: { a: ArchivoDelTurno; proyectoId?: string; revisado: boolean; onRevisado: (v: boolean) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, setEstado] = useState<'' | 'trabajando' | 'devuelto'>('')
  const [aviso, setAviso] = useState('')

  const revertir = async (): Promise<void> => {
    if (!proyectoId || estado) return
    setAviso('')
    setEstado('trabajando')
    try {
      const raiz = await window.api.archivos.rutaAbsoluta(proyectoId, '')
      const rel = rutaRelativa(a.ruta, raiz)
      if (rel === undefined) return void setAviso('Está fuera de la carpeta del proyecto: no se toca desde aquí.')
      const leido = await window.api.archivos.leer(proyectoId, rel)
      if (!leido.ok) return void setAviso('No se pudo leer el archivo (¿se movió o se borró?).')
      const r = revertirArchivo(leido.contenido, a.cambios)
      if (!r.ok) return void setAviso(MOTIVO[r.motivo]!)
      if (!(await confirmar({ titulo: 'Revertir archivo', tono: 'aviso', etiqueta: 'Revertir', texto: `${rel} vuelve a como estaba antes de este turno (${a.cambios.length} ${a.cambios.length === 1 ? 'cambio' : 'cambios'}). El resto de archivos no se toca.` }))) return
      const g = await window.api.archivos.guardar(proyectoId, rel, r.contenido, leido.mtimeMs)
      if (!g.ok) return void setAviso(g.motivo === 'conflicto' ? 'El archivo cambió mientras tanto: vuelve a intentarlo.' : (g.mensaje ?? 'No se pudo guardar.'))
      setEstado('devuelto')
      onRevisado(true)
      return
    } catch {
      setAviso('No se pudo revertir.')
    } finally {
      setEstado((e) => (e === 'trabajando' ? '' : e))
    }
  }

  return (
    <li className={`rv-archivo${revisado ? ' revisado' : ''}${estado === 'devuelto' ? ' devuelto' : ''}`}>
      <div className="rv-fila">
        <button className="rv-check" role="checkbox" aria-checked={revisado} onClick={() => onRevisado(!revisado)} title={revisado ? 'Marcar como pendiente' : 'Marcar como revisado'}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 5 5 9-10" />
          </svg>
        </button>
        <button className="rv-nombre" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} title={a.ruta}>
          <span className={`rv-chevron${abierto ? ' abierto' : ''}`} aria-hidden>›</span>
          <code>{corta(a.ruta)}</code>
          {a.reescribe && <span className="rv-etiqueta">nuevo o reescrito</span>}
          {estado === 'devuelto' && <span className="rv-etiqueta ok">revertido</span>}
        </button>
        <span className="rv-lineas">
          <span className="mas">+{a.agregadas}</span>
          <span className="menos">−{a.quitadas}</span>
        </span>
        {proyectoId && !a.reescribe && (
          <button className="rv-accion" disabled={estado !== ''} onClick={() => void revertir()} title="Devuelve este archivo a como estaba antes de este turno (solo este archivo)">
            {estado === 'trabajando' ? 'Revirtiendo…' : estado === 'devuelto' ? 'Revertido' : 'Revertir'}
          </button>
        )}
      </div>
      {aviso && <div className="rv-aviso" role="alert">{aviso}</div>}
      {abierto && (
        <div className="rv-diffs">
          {a.cambios.map((c, i) => (
            <Cambio key={i} c={c} />
          ))}
        </div>
      )}
    </li>
  )
}

/**
 * Revisión de lo que cambió un turno: todos los archivos juntos con sus líneas, el diff de cada uno, revertir un archivo concreto,
 * marcarlo como revisado, o deshacer el turno entero con el punto de control del CLI.
 */
export const RevisionCambios = memo(function RevisionCambios({ eventos, onDeshacerTodo }: { eventos: EventoAgente[]; onDeshacerTodo?: () => void }) {
  const proyectoId = useContext(ProyectoDelChat)
  const archivos = useMemo(() => cambiosDelTurno(eventos), [eventos])
  const [abierto, setAbierto] = useState(false)
  const [revisados, setRevisados] = useState<Set<string>>(() => new Set())
  if (archivos.length === 0) return null
  const mas = archivos.reduce((s, a) => s + a.agregadas, 0)
  const menos = archivos.reduce((s, a) => s + a.quitadas, 0)
  const listos = archivos.filter((a) => revisados.has(a.ruta)).length
  const marcar = (ruta: string, v: boolean): void =>
    setRevisados((s) => {
      const n = new Set(s)
      if (v) n.add(ruta)
      else n.delete(ruta)
      return n
    })

  return (
    <section className={`rv${abierto ? ' abierto' : ''}`} aria-label="Cambios de este turno">
      <header className="rv-cab">
        <button className="rv-titulo" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
          <span className={`rv-chevron${abierto ? ' abierto' : ''}`} aria-hidden>›</span>
          <strong>
            {archivos.length} {archivos.length === 1 ? 'archivo cambiado' : 'archivos cambiados'}
          </strong>
          <span className="rv-lineas">
            <span className="mas">+{mas}</span>
            <span className="menos">−{menos}</span>
          </span>
        </button>
        <span className={`rv-progreso${listos === archivos.length ? ' completo' : ''}`} title="Archivos que marcaste como revisados">
          {listos}/{archivos.length} revisados
        </span>
        {abierto && listos < archivos.length && (
          <button className="rv-accion" onClick={() => setRevisados(new Set(archivos.map((a) => a.ruta)))}>
            Marcar todo
          </button>
        )}
        {!abierto && (
          <button className="rv-accion primaria" onClick={() => setAbierto(true)}>
            Revisar
          </button>
        )}
        {onDeshacerTodo && (
          <button className="rv-accion peligro" onClick={onDeshacerTodo} title="Devuelve todos los archivos a como estaban antes de este mensaje (con el punto de control del CLI)">
            Deshacer todo
          </button>
        )}
      </header>
      {abierto && (
        <ul className="rv-lista">
          {archivos.map((a) => (
            <FilaArchivo key={a.ruta} a={a} {...(proyectoId ? { proyectoId } : {})} revisado={revisados.has(a.ruta)} onRevisado={(v) => marcar(a.ruta, v)} />
          ))}
        </ul>
      )}
    </section>
  )
})
