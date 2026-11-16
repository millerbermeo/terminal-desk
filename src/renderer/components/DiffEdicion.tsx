import { createContext, memo, useContext, useMemo, useState } from 'react'
import { compararTextos } from '@shared/diff'
import { cambiosDeEdicion, revertirCambio, rutaRelativa, type CambioArchivo } from '../agente/utilidades-chat'
import { confirmar } from '../confirmar'

/** Proyecto del chat: con él se puede devolver un cambio a como estaba (sin él solo se muestra el diff). */
export const ProyectoDelChat = createContext<string | undefined>(undefined)

const MAX_LINEAS_VISTAS = 200

const MENSAJE_REVERSION: Record<string, string> = {
  'ya-cambiado': 'Ese trozo ya no está en el archivo (se editó después). No se tocó nada.',
  ambiguo: 'El texto aparece más de una vez en el archivo: no puedo saber cuál devolver. No se tocó nada.',
  'sin-referencia': 'El cambio solo borró texto: no hay un punto seguro donde devolverlo. Usa «Deshacer cambios» del mensaje.'
}

export function Cambio({ c, proyectoId }: { c: CambioArchivo; proyectoId?: string }) {
  const diff = useMemo(() => compararTextos(c.antes, c.despues, 2), [c.antes, c.despues])
  const [estado, setEstado] = useState<'pendiente' | 'devuelto'>('pendiente')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const lineas = diff.bloques.flatMap((b) => b.lineas)
  const recortadas = lineas.length > MAX_LINEAS_VISTAS

  const devolver = async (): Promise<void> => {
    if (!proyectoId || trabajando) return
    setAviso('')
    setTrabajando(true)
    try {
      const raiz = await window.api.archivos.rutaAbsoluta(proyectoId, '')
      const rel = rutaRelativa(c.ruta, raiz)
      if (rel === undefined) return setAviso('El archivo está fuera de la carpeta del proyecto: no se toca desde aquí.')
      const leido = await window.api.archivos.leer(proyectoId, rel)
      if (!leido.ok) return setAviso('No se pudo leer el archivo (¿se movió o se borró?).')
      const r = revertirCambio(leido.contenido, c.antes, c.despues)
      if (!r.ok) return setAviso(MENSAJE_REVERSION[r.motivo]!)
      if (!(await confirmar({ titulo: 'Devolver este cambio', tono: 'aviso', etiqueta: 'Devolver', texto: `Se restaura el texto anterior en ${rel}. El resto del archivo no se toca.\n\nSi lo cambiaste a mano en ese punto, se pierde.` }))) return
      const g = await window.api.archivos.guardar(proyectoId, rel, r.contenido, leido.mtimeMs)
      if (!g.ok) return setAviso(g.motivo === 'conflicto' ? 'El archivo cambió mientras tanto: vuelve a intentarlo.' : (g.mensaje ?? 'No se pudo guardar el archivo.'))
      setEstado('devuelto')
    } catch {
      setAviso('No se pudo devolver el cambio.')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className={`ag-diff${estado === 'devuelto' ? ' devuelto' : ''}`}>
      <div className="ag-diff-cab">
        <code title={c.ruta}>{c.ruta.split(/[\\/]/).slice(-2).join('/')}</code>
        <span className="ag-diff-mas">+{diff.agregadas + diff.modificadas}</span>
        <span className="ag-diff-menos">−{diff.quitadas + diff.modificadas}</span>
        {c.reescribe ? <span className="chip" title="Reescribe el archivo entero">archivo completo</span> : null}
        {!c.reescribe && proyectoId && (
          <button onClick={() => void devolver()} disabled={trabajando || estado === 'devuelto'} title="Rechazar este cambio: deja ese trozo como estaba antes (el resto del archivo no se toca)">
            {estado === 'devuelto' ? 'Devuelto' : trabajando ? 'Devolviendo…' : '↩ Devolver'}
          </button>
        )}
      </div>
      {aviso && <div className="ag-diff-aviso" role="alert">{aviso}</div>}
      <pre className="ag-diff-cuerpo">
        {lineas.slice(0, MAX_LINEAS_VISTAS).map((l, i) => (
          <div key={i} className={`ag-diff-linea ${l.tipo}`}>
            <span aria-hidden>{l.tipo === 'agregada' ? '+' : l.tipo === 'quitada' ? '−' : ' '}</span>
            {l.texto || ' '}
          </div>
        ))}
        {recortadas && <div className="ag-diff-mas-lineas">… {lineas.length - MAX_LINEAS_VISTAS} líneas más</div>}
      </pre>
    </div>
  )
}

/** Lo que cambió una llamada a `Edit`, `MultiEdit` o `Write`, línea a línea, con la opción de devolver cada cambio. */
export const DiffEdicion = memo(function DiffEdicion({ nombre, entrada }: { nombre: string; entrada: Record<string, unknown> }) {
  const proyectoId = useContext(ProyectoDelChat)
  const cambios = useMemo(() => cambiosDeEdicion(nombre, entrada), [nombre, entrada])
  if (cambios.length === 0) return null
  return (
    <>
      {cambios.map((c, i) => (
        <Cambio key={i} c={c} {...(proyectoId ? { proyectoId } : {})} />
      ))}
    </>
  )
})
