import { useEffect, useState } from 'react'
import type { ClienteMcpExterno, EstadoMcpExterno } from '@shared/control-app'
import { Esqueletos } from './Cargando'
import { IconoAlerta, IconoCheck, IconoCopiar, IconoServidor } from './Iconos'
import { EstadoFila, Monograma, SeccionAjustes, rutaCorta } from './SeccionAjustes'

/**
 * Instala el servidor MCP «odesk» en asistentes externos (Claude Code fuera de Odesk, Claude Desktop, Cursor, VS Code): desde ellos se
 * pueden manejar proyectos, terminales, servicios, el Asistente, tareas, git, el navegador… mientras Odesk está abierto.
 */
export function McpExterno() {
  const [estado, setEstado] = useState<EstadoMcpExterno | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState<ClienteMcpExterno | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    void window.api.ia.mcpExterno('estado').then(setEstado).catch((e: Error) => setError(e.message))
  }, [])

  const cambiar = (id: ClienteMcpExterno, instalar: boolean): void => {
    setOcupado(id)
    setError('')
    void window.api.ia
      .mcpExterno(instalar ? 'instalar' : 'quitar', id)
      .then(setEstado)
      .catch((e: Error) => setError(e.message))
      .finally(() => setOcupado(null))
  }

  const copiar = (): void => {
    if (!estado) return
    void navigator.clipboard.writeText(estado.json).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    })
  }

  const instalados = estado?.clientes.filter((c) => c.instalado).length ?? 0

  return (
    <SeccionAjustes
      icono={<IconoServidor />}
      titulo="Controlar Odesk desde otros asistentes"
      texto={
        <>
          Con Odesk abierto, estos asistentes usan las herramientas de la app (proyectos, terminales, servicios, el Asistente, tareas, git, GitHub, el navegador integrado e
          historial) por MCP. Lo que cierra, para, quita o restaura se pregunta aquí antes de hacerse. Reinicia el cliente tras instalarlo.
        </>
      }
      resumen={estado && `${instalados} de ${estado.clientes.length} conectados`}
    >
      {!estado && !error && <Esqueletos cuantos={4} />}
      {estado?.clientes.map((c) => (
        <div className="prov-fila" key={c.id}>
          <Monograma nombre={c.nombre} />
          <div className="prov-texto">
            <strong>{c.nombre}</strong>
            {c.ruta && (
              <span className="prov-detalle">
                <code title={c.ruta}>{rutaCorta(c.ruta)}</code>
              </span>
            )}
          </div>
          <EstadoFila
            tipo={c.instalado ? 'ok' : c.disponible ? 'neutro' : 'aviso'}
            texto={c.instalado ? 'Instalado' : c.disponible ? 'Disponible' : 'No detectado'}
            titulo={c.instalado ? 'La entrada «odesk» está en su configuración' : c.disponible ? 'El cliente está en este equipo; falta instalar la entrada «odesk»' : 'No se encontró este cliente en el equipo'}
          />
          <div className="prov-acciones visible">
            <button
              className={`prov-btn${c.instalado ? '' : ' acento'}`}
              disabled={ocupado !== null}
              aria-busy={ocupado === c.id}
              onClick={() => cambiar(c.id, !c.instalado)}
              title={c.instalado ? 'Quitar la entrada «odesk» de su configuración' : 'Añadir la entrada «odesk» a su configuración'}
            >
              {ocupado === c.id ? <span className="prov-giro" aria-label="Aplicando" /> : c.instalado ? 'Quitar' : 'Instalar'}
            </button>
          </div>
        </div>
      ))}
      {estado && (
        <div className="prov-fila">
          <Monograma nombre="Otro" />
          <div className="prov-texto">
            <strong>Otro cliente MCP</strong>
            <span className="prov-detalle prov-nota">Pega esta configuración en su archivo de servidores MCP.</span>
          </div>
          <div className="prov-acciones visible">
            <button className={`prov-btn${copiado ? ' hecho' : ''}`} onClick={copiar} aria-live="polite">
              {copiado ? <IconoCheck /> : <IconoCopiar />}
              {copiado ? 'Copiado' : 'Copiar JSON'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="prov-alerta" role="alert">
          <IconoAlerta />
          {error}
        </div>
      )}
    </SeccionAjustes>
  )
}
