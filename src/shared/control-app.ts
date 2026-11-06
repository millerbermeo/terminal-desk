/** Lo que main pide a la interfaz cuando un asistente maneja Odesk por MCP (canal `ia:accion`). */
export type AccionIa =
  | { tipo: 'abrir-proyecto'; proyectoId: string; vista: 'terminal' | 'asistente' | 'archivos' }
  /** main ya creó el pty: la interfaz lo muestra en la celda del proyecto. */
  | { tipo: 'terminal'; proyectoId: string; ptyId: string; titulo: string }
  | { tipo: 'cerrar-terminal'; ptyId: string }
  | { tipo: 'asistente-enviar'; proyectoId: string; mensaje: string }
  /** Se quitó o clonó un proyecto: la interfaz vuelve a leer la lista. */
  | { tipo: 'proyectos-cambiados' }

/** Cliente MCP externo al que se le puede instalar el servidor «odesk». */
export type ClienteMcpExterno = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode'

export interface EstadoMcpExterno {
  /** Configuración lista para pegar en cualquier cliente MCP (`mcpServers`). */
  json: string
  clientes: { id: ClienteMcpExterno; nombre: string; instalado: boolean; disponible: boolean; ruta?: string }[]
}
