/**
 * Mensajes que un asistente externo (por MCP, `asistente_enviar`) manda al Asistente de un proyecto. Se guardan aquí hasta que el chat
 * de ese proyecto los recoge: así no se pierden si su celda aún no estaba montada, y solo UN chat los envía aunque haya varias celdas.
 */
const pendientes = new Map<string, string[]>()
const EVENTO = 'odesk:asistente-externo'

export function encolarExterno(proyectoId: string, mensaje: string): void {
  pendientes.set(proyectoId, [...(pendientes.get(proyectoId) ?? []), mensaje])
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: proyectoId }))
}

/** Saca (y borra) los mensajes pendientes del proyecto: el primero que llama se los lleva. */
export function tomarExternos(proyectoId: string): string[] {
  const l = pendientes.get(proyectoId) ?? []
  pendientes.delete(proyectoId)
  return l
}

export function alExterno(cb: (proyectoId: string) => void): () => void {
  const h = (e: Event): void => cb(String((e as CustomEvent).detail))
  window.addEventListener(EVENTO, h)
  return () => window.removeEventListener(EVENTO, h)
}
