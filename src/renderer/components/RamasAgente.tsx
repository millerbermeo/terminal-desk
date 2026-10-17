import { useCallback, useEffect, useState } from 'react'
import type { InfoWorktree } from '@shared/core/agente'
import type { DatosProyectos } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoRama } from './Iconos'
import { confirmar } from '../confirmar'

const limpiar = (m: string): string => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function RamasAgente({ datos, visible }: { datos: DatosProyectos; visible: boolean }) {
  const [proyectoId, setProyectoId] = useState('')
  const [ramas, setRamas] = useState<InfoWorktree[]>([])
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(() => {
    if (!proyectoId) return setRamas([])
    window.api.core.worktreesListar(proyectoId).then(setRamas).catch((e: Error) => {
      setRamas([])
      setMensaje({ ok: false, texto: limpiar(e.message) })
    })
  }, [proyectoId])
  useEffect(() => {
    if (visible) cargar()
  }, [visible, cargar])

  return (
    <div className="ramas">
      <p className="cfg-intro">
        Cada flujo aislado trabaja en una rama de git propia, en una carpeta fuera de tu repositorio. Si termina bien, los cambios quedan confirmados en esa rama:
        revísala e intégrala cuando quieras. Publicar (<code>git push</code>) siempre te pide confirmación.
      </p>
      <div className="ag-opciones">
        <select value={proyectoId} onChange={(e) => { setProyectoId(e.target.value); setMensaje(null) }}>
          <option value="">Elige un proyecto…</option>
          {datos.proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <button onClick={cargar} disabled={!proyectoId}>Actualizar</button>
      </div>
      {mensaje && <div className={mensaje.ok ? 'cfg-ok' : 'cfg-error'}>{mensaje.texto}</div>}
      <section className="cfg-grupo">
        {proyectoId && ramas.length === 0 && <EstadoVacio variante="compacto" icono={<IconoRama />} titulo="Sin ramas de agente" texto="Los flujos aislados crean aquí su rama de trabajo para que la revises antes de publicar." />}
        {ramas.map((r) => (
          <div className="cfg-proyecto" key={r.id}>
            <strong title={r.rama}>{r.rama}</strong>
            <code title={r.ruta}>{r.ruta}</code>
            <button
              style={{ opacity: 1 }}
              onClick={() => {
                setMensaje(null)
                void window.api.core.worktreePublicar(r.proyectoId, r.id).then((res) => setMensaje({ ok: res.ok, texto: res.mensaje }))
              }}
            >
              Publicar…
            </button>
            <button
              className="peligro"
              style={{ opacity: 1 }}
              onClick={() =>
                void confirmar({ titulo: 'Descartar rama', etiqueta: 'Descartar', texto: `Se eliminará la rama «${r.rama}» y su carpeta.\n\nLo que no hayas integrado se perderá.` }).then((si) => {
                  if (si) void window.api.core.worktreeDescartar(r.proyectoId, r.id).then(setRamas).catch((e: Error) => setMensaje({ ok: false, texto: limpiar(e.message) }))
                })
              }
            >
              Descartar
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
