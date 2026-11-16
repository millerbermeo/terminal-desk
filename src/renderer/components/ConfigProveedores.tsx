import { useState } from 'react'
import { McpExterno } from './McpExterno'
import type { ProveedorEstado } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoBasura, IconoChispa, IconoLapiz, IconoMas, IconoTerminal, IconoUsuario } from './Iconos'
import { ModalProveedor } from './ModalProveedor'
import { BarraCuenta } from './BarraCuenta'
import { EstadoFila, Monograma, SeccionAjustes } from './SeccionAjustes'
import { confirmar } from '../confirmar'

interface Props {
  proveedores: ProveedorEstado[]
  onProveedores: (p: ProveedorEstado[]) => void
}

export function ConfigProveedores({ proveedores, onProveedores }: Props) {
  const [modal, setModal] = useState<{ inicial?: ProveedorEstado } | null>(null)
  const instalados = proveedores.filter((p) => p.disponible).length

  const eliminar = async (p: ProveedorEstado): Promise<void> => {
    if (!(await confirmar({ titulo: `Eliminar «${p.nombre}»`, etiqueta: 'Eliminar', texto: 'Deja de aparecer en el menú ✦ de los proyectos. Las terminales abiertas con él siguen funcionando.' }))) return
    onProveedores(await window.api.proveedores.eliminar(p.id))
  }

  return (
    <div className="config ancha prov">
      <header className="prov-cab">
        <div>
          <h2>Proveedores de IA</h2>
          <p>
            Cada proveedor es un CLI que se ejecuta dentro de una terminal. En la barra lateral, pasa el ratón sobre un proyecto y pulsa <kbd>✦</kbd> para abrirlo con el que
            elijas.
          </p>
        </div>
        <button className="primario" onClick={() => setModal({})}>
          <IconoMas /> Agregar proveedor
        </button>
      </header>

      <SeccionAjustes
        icono={<IconoUsuario />}
        titulo="Cuenta del Asistente"
        texto="Con qué se paga el modelo del Asistente: tu suscripción de Claude (una o varias cuentas) o una clave de la API. Se aplica a todos los proyectos."
      >
        <div className="prov-cuenta">
          <BarraCuenta />
        </div>
      </SeccionAjustes>

      <SeccionAjustes
        icono={<IconoTerminal />}
        titulo="Proveedores de terminal"
        texto="Los CLIs que puedes lanzar en la terminal de cada proyecto."
        resumen={proveedores.length > 0 && `${instalados} de ${proveedores.length} instalados`}
      >
        {proveedores.length === 0 && <EstadoVacio variante="compacto" icono={<IconoChispa />} titulo="Sin proveedores" texto="Agrega uno para lanzar Claude Code, Codex, Gemini u otro CLI desde cada proyecto." />}
        {proveedores.map((p) => {
          const vars = Object.keys(p.env).length
          return (
            <div className="prov-fila" key={p.id}>
              <Monograma nombre={p.nombre} />
              <div className="prov-texto">
                <strong>{p.nombre}</strong>
                <span className="prov-detalle">
                  <code>{p.comando}</code>
                  {vars > 0 && (
                    <span className="prov-etiqueta" title="Variables de entorno definidas">
                      {vars} {vars === 1 ? 'variable' : 'variables'}
                    </span>
                  )}
                </span>
              </div>
              <EstadoFila
                tipo={p.disponible ? 'ok' : 'aviso'}
                texto={p.disponible ? 'Instalado' : 'No detectado'}
                titulo={p.disponible ? 'Ejecutable encontrado en el PATH' : 'No se encontró en el PATH de la app; puede funcionar igual si tu shell lo carga (nvm, etc.)'}
              />
              <div className="prov-acciones">
                <button className="prov-btn-ico" title="Editar" aria-label={`Editar ${p.nombre}`} onClick={() => setModal({ inicial: p })}>
                  <IconoLapiz />
                </button>
                <button className="prov-btn-ico peligro" title="Eliminar proveedor" aria-label={`Eliminar ${p.nombre}`} onClick={() => void eliminar(p)}>
                  <IconoBasura />
                </button>
              </div>
            </div>
          )
        })}
      </SeccionAjustes>

      <McpExterno />

      {modal && <ModalProveedor inicial={modal.inicial} onGuardado={onProveedores} onCerrar={() => setModal(null)} />}
    </div>
  )
}
