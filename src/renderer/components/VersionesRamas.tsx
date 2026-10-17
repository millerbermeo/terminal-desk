import { useEffect, useState } from 'react'
import { fechaRelativa, type Rama, type Remoto } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git, type ContextoGit } from '../versiones/useGit'
import { EstadoVacio } from './EstadoVacio'
import { IconoMas, IconoRama, IconoServidor } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'
import { ModalFormulario } from './ModalFormulario'

type Dialogo = { tipo: 'nueva' } | { tipo: 'remoto' } | { tipo: 'eliminar'; rama: Rama } | { tipo: 'fusionar'; rama: Rama } | null

export function VersionesRamas({ c }: { c: ContextoGit }) {
  const { proyectoId, estado, run, aplicar, avisar, avisarConflictos, ocupado, tick } = c
  const [ramas, setRamas] = useState<Rama[]>([])
  const [remotos, setRemotos] = useState<Remoto[]>([])
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [fallo, setFallo] = useState('')
  const [forzar, setForzar] = useState<Rama | null>(null)

  useEffect(() => {
    let vigente = true
    Promise.all([git('ramas', { proyectoId }), git('remotos', { proyectoId })])
      .then(([r, m]) => vigente && (setRamas(r), setRemotos(m), setFallo('')))
      .catch((e) => vigente && setFallo(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [proyectoId, tick])

  const locales = ramas.filter((r) => !r.remota).sort((a, b) => Number(b.actual) - Number(a.actual) || a.nombre.localeCompare(b.nombre))
  const remotas = ramas.filter((r) => r.remota).sort((a, b) => a.nombre.localeCompare(b.nombre))
  const bloqueado = ocupado !== ''

  const cambiar = (r: Rama): void =>
    void run('Cambiando de rama…', () => git('cambiarRama', { proyectoId, nombre: r.nombre, remota: r.remota })).then((e) => {
      if (e) (aplicar(e), avisar(`Ahora estás en «${e.rama}».`))
    })

  return (
    <div className="vc-pagina">
      {fallo && <p className="vc-nota error">{fallo}</p>}
      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>
            Ramas locales <small>{locales.length}</small>
          </h3>
          <button className="primario" disabled={bloqueado || estado.sinCommits} onClick={() => setDialogo({ tipo: 'nueva' })} title={estado.sinCommits ? 'Haz primero un commit' : undefined}>
            <IconoMas /> Nueva rama
          </button>
        </div>
        {locales.length === 0 && <EstadoVacio variante="compacto" icono={<IconoRama />} titulo="Aún no hay ramas" texto="La primera rama se crea con tu primer commit." />}
        {locales.map((r) => (
          <div className="cfg-proyecto vc-rama-fila" key={r.nombre}>
            <IconoRama />
            <strong className="vc-rama-nombre">{r.nombre}</strong>
            {r.actual && <span className="chip chip-ok">actual</span>}
            {r.upstream && (r.adelante > 0 || r.atras > 0) && (
              <span className="chip" title={`Respecto a ${r.upstream}`}>
                {r.adelante > 0 && `↑${r.adelante}`} {r.atras > 0 && `↓${r.atras}`}
              </span>
            )}
            {r.huerfana && <span className="chip chip-aviso" title="La rama remota ya no existe">sin remota</span>}
            <span className="rec-desc">
              {r.asunto} · {fechaRelativa(r.fecha)}
            </span>
            <span className="vc-acciones visibles">
              <button disabled={bloqueado || r.actual} onClick={() => cambiar(r)}>
                Cambiar
              </button>
              <button disabled={bloqueado || r.actual || estado.sinCommits} onClick={() => setDialogo({ tipo: 'fusionar', rama: r })} title={`Fusionar «${r.nombre}» en «${estado.rama ?? 'la actual'}»`}>
                Fusionar aquí
              </button>
              <button className="peligro" disabled={bloqueado || r.actual} onClick={() => setDialogo({ tipo: 'eliminar', rama: r })}>
                Eliminar
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>
            Remotos <small>{remotos.length}</small>
          </h3>
          <button disabled={bloqueado} onClick={() => setDialogo({ tipo: 'remoto' })}>
            <IconoMas /> Agregar remoto
          </button>
        </div>
        {remotos.length === 0 ? (
          <EstadoVacio variante="compacto" icono={<IconoServidor />} titulo="Sin remotos" texto="Agrega la URL de tu repositorio (GitHub, GitLab…) para poder enviar y traer cambios." />
        ) : (
          remotos.map((m) => (
            <div className="cfg-proyecto" key={m.nombre}>
              <IconoServidor />
              <strong>{m.nombre}</strong>
              <code>{m.url}</code>
            </div>
          ))
        )}
      </section>

      {remotas.length > 0 && (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>
              Ramas remotas <small>{remotas.length}</small>
            </h3>
          </div>
          {remotas.map((r) => {
            const yaLocal = locales.some((l) => l.nombre === r.nombre.slice(r.nombre.indexOf('/') + 1))
            return (
              <div className="cfg-proyecto vc-rama-fila" key={r.nombre}>
                <IconoRama />
                <strong className="vc-rama-nombre">{r.nombre}</strong>
                <span className="rec-desc">
                  {r.asunto} · {fechaRelativa(r.fecha)}
                </span>
                <span className="vc-acciones visibles">
                  <button disabled={bloqueado} onClick={() => cambiar(r)}>
                    {yaLocal ? 'Cambiar a la local' : 'Crear rama local'}
                  </button>
                </span>
              </div>
            )
          })}
        </section>
      )}

      {dialogo?.tipo === 'nueva' && (
        <ModalFormulario
          titulo="Nueva rama"
          descripcion={`Se crea a partir de ${estado.rama ?? 'el commit actual'}.`}
          campos={[{ id: 'nombre', etiqueta: 'Nombre', placeholder: 'feat/mi-cambio', obligatorio: true, ayuda: 'Sin espacios. Puedes usar «/» para agrupar (feat/, fix/).' }]}
          casilla={{ etiqueta: 'Cambiar a la rama nueva', valor: true }}
          etiquetaBoton="Crear rama"
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v, cambiar) => {
            const e = await run('Creando rama…', () => git('crearRama', { proyectoId, nombre: v.nombre!, cambiar }))
            if (e) (aplicar(e), avisar(`Rama «${v.nombre}» creada.`))
            return Boolean(e)
          }}
        />
      )}
      {dialogo?.tipo === 'remoto' && (
        <ModalFormulario
          titulo="Agregar remoto"
          campos={[
            { id: 'nombre', etiqueta: 'Nombre', valor: remotos.length ? '' : 'origin', obligatorio: true },
            { id: 'url', etiqueta: 'URL', placeholder: 'git@github.com:usuario/repo.git', obligatorio: true, ayuda: 'La app no puede pedir contraseñas: usa SSH o un credential helper de git.' }
          ]}
          etiquetaBoton="Agregar"
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v) => {
            const r = await run('Agregando remoto…', () => git('agregarRemoto', { proyectoId, nombre: v.nombre!, url: v.url! }))
            if (r) (setRemotos(r), c.recargar(), avisar(`Remoto «${v.nombre}» agregado.`))
            return Boolean(r)
          }}
        />
      )}
      {dialogo?.tipo === 'fusionar' && (
        <ModalConfirmar
          titulo="Fusionar rama"
          texto={`Se fusiona «${dialogo.rama.nombre}» en «${estado.rama ?? 'la rama actual'}». Si hay conflictos podrás resolverlos o abortar la fusión.`}
          etiqueta="Fusionar" tono="aviso"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() =>
            void run('Fusionando…', () => git('fusionar', { proyectoId, rama: dialogo.rama.nombre })).then((r) => {
              if (!r) return
              aplicar(r.estado)
              if (r.conflictos) avisarConflictos('La fusión dejó conflictos: resuélvelos en «Cambios» y confirma, o aborta la fusión.')
              else avisar(`«${dialogo.rama.nombre}» fusionada.`)
            })
          }
        />
      )}
      {dialogo?.tipo === 'eliminar' && (
        <ModalConfirmar
          titulo="Eliminar rama"
          texto={`¿Eliminar la rama «${dialogo.rama.nombre}»? Solo se borra la rama local.`}
          etiqueta="Eliminar"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() => {
            const rama = dialogo.rama
            void git('eliminarRama', { proyectoId, nombre: rama.nombre })
              .then((r) => (setRamas(r), c.recargar(), avisar(`Rama «${rama.nombre}» eliminada.`)))
              .catch((e) => {
                const m = mensajeDe(e)
                // Con commits sin fusionar git se niega: se pregunta si se quiere forzar.
                if (/commits que no están en otra|forzando/i.test(m)) setForzar(rama)
                else c.mostrarError(m)
              })
          }}
        />
      )}
      {forzar && (
        <ModalConfirmar
          titulo="Eliminar rama con commits sin fusionar"
          texto={`«${forzar.nombre}» tiene commits que no están en ninguna otra rama: se perderían. ¿Eliminarla igualmente?`}
          etiqueta="Eliminar igualmente"
          onCerrar={() => setForzar(null)}
          onConfirmar={() =>
            void run('Eliminando rama…', () => git('eliminarRama', { proyectoId, nombre: forzar.nombre, forzar: true })).then((r) => {
              if (r) (setRamas(r), c.recargar(), avisar(`Rama «${forzar.nombre}» eliminada.`))
            })
          }
        />
      )}
    </div>
  )
}
