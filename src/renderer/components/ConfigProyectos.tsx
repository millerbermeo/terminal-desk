import { useState } from 'react'
import { confirmar } from '../confirmar'
import { mensajeDe } from '../tareas/useTareas'
import type { DatosProyectos } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoBasura, IconoCarpeta, IconoMas } from './Iconos'
import { ModalAgregar } from './ModalAgregar'
import { ModalEliminarGrupo } from './ModalEliminarGrupo'

const REQUIERE_CONFIRMACION = 'REQUIERE_CONFIRMACION:'

interface Props {
  datos: DatosProyectos
  onDatos: (d: DatosProyectos) => void
}

export function ConfigProyectos({ datos, onDatos }: Props) {
  const [modal, setModal] = useState(false)
  const [grupoAEliminar, setGrupoAEliminar] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Record<string, { tipo: 'ok' | 'error'; texto: string }>>({})
  const [cambiando, setCambiando] = useState<string | null>(null)

  /** Te equivocaste de carpeta al enlazar el proyecto: se elige la correcta y se suelta el enlace de la anterior. */
  const cambiarCarpeta = async (id: string, nombre: string): Promise<void> => {
    const elegida = (await window.api.proyectos.elegirCarpetas())[0]
    if (!elegida) return
    setCambiando(id)
    setMensajes((m) => ({ ...m, [id]: { tipo: 'ok', texto: '' } }))
    try {
      let r: { datos: DatosProyectos; aviso?: string }
      try {
        r = await window.api.proyectos.cambiarCarpeta(id, elegida)
      } catch (err) {
        const m = mensajeDe(err)
        if (!m.includes(REQUIERE_CONFIRMACION)) throw err
        const sigue = await confirmar({
          titulo: 'Revisa esta carpeta antes de cambiarla',
          tono: 'aviso',
          etiqueta: 'Cambiar de todos modos',
          texto: `${m.slice(m.indexOf(REQUIERE_CONFIRMACION) + REQUIERE_CONFIRMACION.length).trim()}\n\n¿Usar esta carpeta para «${nombre}» igualmente?`
        })
        if (!sigue) return
        r = await window.api.proyectos.cambiarCarpeta(id, elegida, true)
      }
      onDatos(r.datos)
      setMensajes((m) => ({ ...m, [id]: { tipo: 'ok', texto: r.aviso ?? 'Carpeta cambiada.' } }))
    } catch (err) {
      setMensajes((m) => ({ ...m, [id]: { tipo: 'error', texto: mensajeDe(err) } }))
    } finally {
      setCambiando(null)
    }
  }
  const sinGrupo = datos.proyectos.filter((p) => !p.grupo || !datos.grupos.some((g) => g.id === p.grupo))

  const lista = (grupoId: string | undefined, nombre: string, proyectos: typeof datos.proyectos) => (
    <section className="cfg-grupo" key={grupoId ?? 'sin-grupo'}>
      <div className="cfg-grupo-cab">
        <h3>
          {nombre} <small>{proyectos.length}</small>
        </h3>
        {grupoId && (
          <button className="peligro" title="Elimina el grupo; sus proyectos pasan a «Sin grupo»" onClick={() => setGrupoAEliminar(grupoId)}>
            Eliminar grupo
          </button>
        )}
      </div>
      {proyectos.length === 0 && <EstadoVacio variante="compacto" icono={<IconoCarpeta />} titulo="Aún no hay proyectos" texto="Agrégalos con «Abrir carpeta» o «Agregar ruta» en la barra lateral." />}
      {proyectos.map((p) => (
        <div className="cfg-proyecto" key={p.id}>
          <IconoCarpeta />
          <strong>{p.nombre}</strong>
          <code>{p.ruta}</code>
          <button disabled={cambiando === p.id} title="¿Enlazaste la carpeta equivocada? Elige la correcta: se suelta el enlace de la anterior (no borra nada de tu código)" onClick={() => void cambiarCarpeta(p.id, p.nombre)}>
            <IconoCarpeta /> Cambiar carpeta
          </button>
          <button className="peligro" title="Quitar de la lista (no borra la carpeta)" onClick={() => void window.api.proyectos.eliminar(p.id).then(onDatos)}>
            <IconoBasura /> Quitar
          </button>
          {mensajes[p.id]?.texto && (
            <p className={mensajes[p.id]!.tipo === 'error' ? 'cfg-error' : 'modal-texto'} style={{ flexBasis: '100%', margin: 0 }} role={mensajes[p.id]!.tipo === 'error' ? 'alert' : 'status'}>
              {mensajes[p.id]!.texto}
            </p>
          )}
        </div>
      ))}
    </section>
  )

  return (
    <div className="config">
      <div className="cfg-cab">
        <h2>Configurar proyectos</h2>
        <button className="primario" onClick={() => setModal(true)}>
          <IconoMas /> Agregar proyectos
        </button>
      </div>

      {datos.grupos.map((g) =>
        lista(g.id, g.nombre, datos.proyectos.filter((p) => p.grupo === g.id))
      )}
      {(sinGrupo.length > 0 || datos.grupos.length === 0) && lista(undefined, 'Sin grupo', sinGrupo)}
      {grupoAEliminar && datos.grupos.some((g) => g.id === grupoAEliminar) && (
        <ModalEliminarGrupo
          grupo={datos.grupos.find((g) => g.id === grupoAEliminar)!}
          proyectos={datos.proyectos.filter((p) => p.grupo === grupoAEliminar).length}
          onEliminado={onDatos}
          onCerrar={() => setGrupoAEliminar(null)}
        />
      )}
      {modal && (
        <ModalAgregar
          datos={datos}
          onCerrar={() => setModal(false)}
          onGuardado={onDatos}
        />
      )}
    </div>
  )
}
