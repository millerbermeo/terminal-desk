import { useEffect, useState } from 'react'
import { fechaRelativa, type Stash } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git, type ContextoGit } from '../versiones/useGit'
import { EstadoVacio } from './EstadoVacio'
import { IconoArchivo } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'

/** Stash: aparta los cambios sin confirmar para cambiar de rama o traer cambios, y los recupera después. */
export function VersionesStash({ c }: { c: ContextoGit }) {
  const { proyectoId, estado, run, aplicar, avisar, avisarConflictos, ocupado, tick } = c
  const [lista, setLista] = useState<Stash[]>([])
  const [mensaje, setMensaje] = useState('')
  const [nuevos, setNuevos] = useState(true)
  const [borrar, setBorrar] = useState<Stash | null>(null)
  const [fallo, setFallo] = useState('')
  const bloqueado = ocupado !== ''
  const hayCambios = estado.archivos.length > 0

  useEffect(() => {
    let vigente = true
    git('stashes', { proyectoId })
      .then((s) => vigente && (setLista(s), setFallo('')))
      .catch((e) => vigente && setFallo(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [proyectoId, tick])

  const aplicarStash = (s: Stash, quitar: boolean): void =>
    void run(quitar ? 'Recuperando…' : 'Aplicando…', () => git('aplicarStash', { proyectoId, indice: s.indice, quitar })).then((r) => {
      if (!r) return
      aplicar(r.estado)
      if (r.conflictos) avisarConflictos('Al recuperar el stash hubo conflictos: resuélvelos en «Cambios».')
      else avisar(quitar ? 'Cambios recuperados y stash eliminado.' : 'Cambios aplicados (el stash se conserva).')
    })

  return (
    <div className="vc-pagina">
      {fallo && <p className="vc-nota error">{fallo}</p>}
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>Guardar cambios sin confirmar</h3>
        </div>
        <div className="vc-form">
          <p className="vc-nota">Aparta lo que tienes a medias para dejar el árbol limpio (por ejemplo, antes de cambiar de rama). Lo recuperas cuando quieras.</p>
          <label>
            Mensaje (opcional)
            <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Trabajo a medias en el carrito" />
          </label>
          <div className="vc-commit-pie">
            <label className="vc-casilla">
              <input type="checkbox" checked={nuevos} onChange={(e) => setNuevos(e.target.checked)} /> Incluir archivos nuevos
            </label>
            <button
              className="primario"
              disabled={bloqueado || !hayCambios || estado.sinCommits}
              title={!hayCambios ? 'No hay cambios que guardar' : estado.sinCommits ? 'Haz primero un commit' : undefined}
              onClick={() =>
                void run('Guardando…', () => git('guardarStash', { proyectoId, ...(mensaje.trim() ? { mensaje } : {}), incluirNoSeguidos: nuevos })).then((r) => {
                  if (!r) return
                  setLista(r.stashes)
                  aplicar(r.estado)
                  setMensaje('')
                  avisar('Cambios guardados en el stash.')
                })
              }
            >
              Guardar en stash
            </button>
          </div>
        </div>
      </section>

      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>
            Stash <small>{lista.length}</small>
          </h3>
        </div>
        {lista.length === 0 && <EstadoVacio variante="compacto" icono={<IconoArchivo />} titulo="Nada guardado" texto="Los cambios que apartes aparecerán aquí." />}
        {lista.map((s) => (
          <div className="cfg-proyecto vc-rama-fila" key={`${s.indice}-${s.fecha}`}>
            <span className="chip">#{s.indice}</span>
            <strong className="vc-rama-nombre">{s.mensaje.replace(/^(WIP on|On) [^:]+: /, '') || s.mensaje}</strong>
            <span className="rec-desc">{fechaRelativa(s.fecha)}</span>
            <span className="vc-acciones visibles">
              <button disabled={bloqueado} onClick={() => aplicarStash(s, true)} title="Recuperar los cambios y quitar el stash">
                Recuperar
              </button>
              <button disabled={bloqueado} onClick={() => aplicarStash(s, false)} title="Aplicar los cambios y conservar el stash">
                Aplicar
              </button>
              <button className="peligro" disabled={bloqueado} onClick={() => setBorrar(s)}>
                Eliminar
              </button>
            </span>
          </div>
        ))}
      </section>
      {borrar && (
        <ModalConfirmar
          titulo="Eliminar stash"
          texto="¿Eliminar este stash? Los cambios que contiene se pierden y no se pueden recuperar."
          etiqueta="Eliminar"
          onCerrar={() => setBorrar(null)}
          onConfirmar={() => void run('Eliminando…', () => git('eliminarStash', { proyectoId, indice: borrar.indice })).then((l) => l && (setLista(l), c.recargar()))}
        />
      )}
    </div>
  )
}
