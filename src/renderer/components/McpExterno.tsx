import { useEffect, useState } from 'react'
import type { ClienteMcpExterno, EstadoMcpExterno } from '@shared/control-app'
import { Esqueletos } from './Cargando'

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

  return (
    <>
      <h3 className="cfg-subtitulo">Controlar Odesk desde otros asistentes (MCP)</h3>
      <p className="cfg-intro cfg-intro-sub">
        Con Odesk abierto, estos asistentes pueden usar las herramientas de la app: proyectos, terminales, servicios de arranque, el Asistente, tareas, git, GitHub, el navegador
        integrado e historial. Lo que cierra, para, quita o restaura se pregunta aquí antes de hacerse. Reinicia el cliente tras instalarlo.
      </p>
      <section className="cfg-grupo">
        {!estado && !error && <Esqueletos cuantos={4} />}
        {estado?.clientes.map((c) => (
          <div className="cfg-proyecto" key={c.id}>
            <strong>{c.nombre}</strong>
            {c.ruta && <code title={c.ruta}>{c.ruta}</code>}
            <span className={`chip ${c.instalado ? 'chip-ok' : c.disponible ? '' : 'chip-aviso'}`}>{c.instalado ? 'Instalado' : c.disponible ? 'Disponible' : 'No detectado'}</span>
            <button disabled={ocupado !== null} onClick={() => cambiar(c.id, !c.instalado)} title={c.instalado ? 'Quitar la entrada «odesk» de su configuración' : 'Añadir la entrada «odesk» a su configuración'}>
              {ocupado === c.id ? '…' : c.instalado ? 'Quitar' : 'Instalar'}
            </button>
          </div>
        ))}
        {estado && (
          <div className="cfg-proyecto">
            <strong>Otro cliente MCP</strong>
            <span className="cfg-intro-sub">Pega esta configuración en su archivo de servidores MCP.</span>
            <button onClick={copiar}>{copiado ? 'Copiado' : 'Copiar JSON'}</button>
          </div>
        )}
        {error && <div className="cfg-proyecto chip-aviso">{error}</div>}
      </section>
    </>
  )
}
