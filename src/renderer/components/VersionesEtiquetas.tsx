import { useEffect, useMemo, useState } from 'react'
import { fechaRelativa, siguienteVersion, type Etiqueta, type TipoVersion } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git, type ContextoGit } from '../versiones/useGit'
import { EstadoVacio } from './EstadoVacio'
import { IconoRama } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'

const TIPOS: { id: TipoVersion; nombre: string; ayuda: string }[] = [
  { id: 'parche', nombre: 'Parche', ayuda: 'Corrección de errores' },
  { id: 'menor', nombre: 'Menor', ayuda: 'Función nueva compatible' },
  { id: 'mayor', nombre: 'Mayor', ayuda: 'Cambios incompatibles' }
]

/** Versiones del proyecto: etiquetas anotadas de git, con la siguiente versión semántica sugerida. */
export function VersionesEtiquetas({ c }: { c: ContextoGit }) {
  const { proyectoId, estado, run, ocupado, avisar, tick } = c
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([])
  const [desdeUltima, setDesdeUltima] = useState<number | null>(null)
  const [tipo, setTipo] = useState<TipoVersion>('parche')
  const [nombre, setNombre] = useState('')
  const [editado, setEditado] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [enviar, setEnviar] = useState(false)
  const [borrar, setBorrar] = useState<Etiqueta | null>(null)
  const [fallo, setFallo] = useState('')
  const hayRemoto = estado.remotos.length > 0
  const bloqueado = ocupado !== ''

  useEffect(() => {
    let vigente = true
    git('etiquetas', { proyectoId })
      .then((r) => vigente && (setEtiquetas(r.etiquetas), setDesdeUltima(r.desdeUltima), setFallo('')))
      .catch((e) => vigente && setFallo(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [proyectoId, tick])

  const sugerida = useMemo(() => siguienteVersion(etiquetas.map((e) => e.nombre), tipo), [etiquetas, tipo])
  // Mientras no se haya escrito a mano, el campo sigue la sugerencia.
  useEffect(() => {
    if (!editado) setNombre(sugerida)
  }, [sugerida, editado])

  const crear = (): void => {
    const n = nombre.trim()
    void run('Creando versión…', async () => {
      const lista = await git('crearEtiqueta', { proyectoId, nombre: n, ...(mensaje.trim() ? { mensaje } : {}) })
      if (enviar && hayRemoto) await git('enviarEtiqueta', { proyectoId, nombre: n })
      return lista
    }).then((lista) => {
      if (!lista) return
      setEtiquetas(lista)
      setMensaje('')
      setEditado(false)
      c.recargar().catch(() => undefined)
      avisar(`Versión ${n} creada${enviar && hayRemoto ? ' y enviada' : ''}.`)
    })
  }
  const ultima = etiquetas.find((e) => /^v?\d+\.\d+\.\d+$/.test(e.nombre)) ?? etiquetas[0]

  return (
    <div className="vc-pagina">
      {fallo && <p className="vc-nota error">{fallo}</p>}
      <section className="cfg-grupo vc-nueva-version">
        <div className="cfg-grupo-cab">
          <h3>Nueva versión</h3>
          {ultima && (
            <span className="tareas-suave">
              Última: <strong>{ultima.nombre}</strong>
              {desdeUltima !== null && ` · ${desdeUltima === 0 ? 'sin commits nuevos' : `${desdeUltima} commit${desdeUltima === 1 ? '' : 's'} desde entonces`}`}
            </span>
          )}
        </div>
        <div className="vc-form">
          {estado.sinCommits ? (
            <p className="vc-nota">Haz primero un commit: una versión marca un punto concreto del historial.</p>
          ) : (
            <>
              <div className="segmentado" role="group" aria-label="Tipo de versión">
                {TIPOS.map((t) => (
                  <button key={t.id} className={tipo === t.id ? 'on' : ''} title={t.ayuda} onClick={() => (setTipo(t.id), setEditado(false))}>
                    {t.nombre}
                  </button>
                ))}
              </div>
              <label>
                Versión
                <input value={nombre} onChange={(e) => (setNombre(e.target.value), setEditado(true))} aria-label="Nombre de la versión" />
              </label>
              <label>
                Notas de la versión (opcional)
                <textarea rows={3} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Qué trae esta versión…" />
              </label>
              <div className="vc-commit-pie">
                <label className="vc-casilla" title={hayRemoto ? undefined : 'Agrega un remoto para poder enviarla'}>
                  <input type="checkbox" checked={enviar && hayRemoto} disabled={!hayRemoto} onChange={(e) => setEnviar(e.target.checked)} /> Enviar al remoto
                </label>
                <button className="primario" disabled={bloqueado || !nombre.trim()} onClick={crear}>
                  Crear versión
                </button>
              </div>
              <p className="vc-nota">Se crea sobre el commit actual{estado.rama ? ` (${estado.rama})` : ''}. Para otro commit, ábrelo en «Historial» → «Crear versión aquí».</p>
            </>
          )}
        </div>
      </section>

      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>
            Versiones <small>{etiquetas.length}</small>
          </h3>
        </div>
        {etiquetas.length === 0 && <EstadoVacio variante="compacto" icono={<IconoRama />} titulo="Aún no hay versiones" texto="Marca un punto del historial (v1.0.0…) para poder volver a él y publicarlo." />}
        {etiquetas.map((e) => (
          <div className="cfg-proyecto vc-rama-fila" key={e.nombre}>
            <strong className="vc-rama-nombre">{e.nombre}</strong>
            {!e.anotada && <span className="chip" title="Etiqueta ligera, sin mensaje">ligera</span>}
            <span className="rec-desc">
              {e.mensaje && `${e.mensaje} · `}
              {fechaRelativa(e.fecha)} · <code>{e.commit}</code>
            </span>
            <span className="vc-acciones visibles">
              <button
                disabled={bloqueado || !hayRemoto}
                title={hayRemoto ? 'Enviar esta versión al remoto' : 'Agrega un remoto primero'}
                onClick={() => void run('Enviando versión…', () => git('enviarEtiqueta', { proyectoId, nombre: e.nombre })).then((m) => m && avisar(`Versión ${e.nombre} enviada.`))}
              >
                Enviar
              </button>
              <button className="peligro" disabled={bloqueado} onClick={() => setBorrar(e)}>
                Eliminar
              </button>
            </span>
          </div>
        ))}
      </section>
      {borrar && (
        <ModalConfirmar
          titulo="Eliminar versión"
          texto={`¿Eliminar la versión «${borrar.nombre}»? Solo se borra la etiqueta local; los commits no cambian. Si ya la enviaste, seguirá en el remoto.`}
          etiqueta="Eliminar"
          onCerrar={() => setBorrar(null)}
          onConfirmar={() => void run('Eliminando…', () => git('eliminarEtiqueta', { proyectoId, nombre: borrar.nombre })).then((l) => l && (setEtiquetas(l), c.recargar()))}
        />
      )}
    </div>
  )
}
