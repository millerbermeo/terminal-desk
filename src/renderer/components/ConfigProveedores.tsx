import { useState } from 'react'
import type { ProveedorEstado } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoBasura, IconoChispa, IconoLapiz, IconoMas } from './Iconos'
import { ModalProveedor } from './ModalProveedor'
import { BarraCuenta } from './BarraCuenta'

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

      <h3 className="cfg-subtitulo">Cuenta del Asistente</h3>
      <p className="cfg-intro cfg-intro-sub">Con qué se paga el modelo del Asistente: tu suscripción de Claude (una o varias cuentas) o una clave de la API. Se aplica a todos los proyectos.</p>
      <section className="cfg-grupo">
        <BarraCuenta />
      </section>

      <h3 className="cfg-subtitulo">Proveedores de terminal</h3>
      <section className="cfg-grupo">
        {proveedores.length === 0 && <EstadoVacio variante="compacto" icono={<IconoChispa />} titulo="Sin proveedores" texto="Agrega uno para lanzar Claude Code, Codex, Gemini u otro CLI desde cada proyecto." />}
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
