import { useState } from 'react'
import type { ProveedorEstado } from '@shared/modelos'
import { IconoBasura, IconoLapiz, IconoMas } from './Iconos'
import { ModalProveedor } from './ModalProveedor'

interface Props {
  proveedores: ProveedorEstado[]
  onProveedores: (p: ProveedorEstado[]) => void
}

export function ConfigProveedores({ proveedores, onProveedores }: Props) {
  const [modal, setModal] = useState<{ inicial?: ProveedorEstado } | null>(null)

  return (
    <div className="config">
      <div className="cfg-cab">
        <h2>Proveedores de IA</h2>
        <button className="primario" onClick={() => setModal({})}>
          <IconoMas /> Agregar proveedor
        </button>
      </div>
      <p className="cfg-intro">
        Cada proveedor es un CLI que se ejecuta dentro de una terminal. En la barra lateral, pasa el ratón sobre un
        proyecto y pulsa ✦ para abrirlo con el proveedor que elijas.
      </p>

      <section className="cfg-grupo">
        {proveedores.length === 0 && <p className="cfg-vacio">Sin proveedores. Agrega uno para empezar.</p>}
        {proveedores.map((p) => (
          <div className="cfg-proyecto" key={p.id}>
            <strong>{p.nombre}</strong>
            <code>{p.comando}</code>
            {Object.keys(p.env).length > 0 && <span className="chip" title="Variables de entorno definidas">{Object.keys(p.env).length} env</span>}
            <span className={`chip ${p.disponible ? 'chip-ok' : 'chip-aviso'}`} title={p.disponible ? 'Ejecutable encontrado en el PATH' : 'No se encontró en el PATH de la app; puede funcionar igual si tu shell lo carga (nvm, etc.)'}>
              {p.disponible ? 'Instalado' : 'No detectado'}
            </span>
            <button className="icono" title="Editar" onClick={() => setModal({ inicial: p })}>
              <IconoLapiz />
            </button>
            <button className="peligro" title="Eliminar proveedor" onClick={() => void window.api.proveedores.eliminar(p.id).then(onProveedores)}>
              <IconoBasura />
            </button>
          </div>
        ))}
      </section>

      {modal && <ModalProveedor inicial={modal.inicial} onGuardado={onProveedores} onCerrar={() => setModal(null)} />}
    </div>
  )
}
