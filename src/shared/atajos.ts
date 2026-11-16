/**
 * Registro único de atajos de teclado de Odesk Code. Lo usan los manejadores (para reconocer la pulsación) y la vista «Atajos de teclado»
 * (para mostrarlos todos), así que lo que se lista es siempre lo que de verdad existe.
 *
 * Formato de un combo: `Ctrl+Shift+P`, `Alt+1`, `F1`, `Ctrl+.`. «Ctrl» vale también como ⌘ en macOS (se acepta ctrlKey o metaKey).
 * Las teclas con Ctrl+Alt se evitan a propósito: en teclados con AltGr (Windows) esa combinación escribe caracteres (@, |, €…).
 */

export type CategoriaAtajo = 'General' | 'Ir a' | 'Terminales' | 'Asistente' | 'Dentro de la terminal' | 'Navegador' | 'Editor de archivos' | 'Tareas' | 'Pantalla'

export interface DefAtajo {
  id: string
  /** Combos que lo activan (el primero es el principal). */
  combos: string[]
  accion: string
  categoria: CategoriaAtajo
  /** Dónde funciona; por defecto, en toda la app. */
  donde?: string
  /** Texto para la vista cuando varias entradas se muestran juntas (p. ej. «Alt + 1 – 9»). */
  mostrar?: string
  /** Solo informativo: lo gestiona otro componente (CodeMirror, el CLI…); el registro no lo intercepta. */
  informativo?: boolean
}

/** Vistas a las que se salta con Ctrl+1…9 (el orden es el de las teclas). */
export const VISTAS_RAPIDAS = ['inicio', 'terminales', 'asistente', 'chat', 'tareas', 'versiones', 'servicios', 'api', 'navegador'] as const
export type VistaRapida = (typeof VISTAS_RAPIDAS)[number]

const NOMBRE_VISTA: Record<VistaRapida, string> = {
  inicio: 'Inicio',
  terminales: 'Terminales',
  asistente: 'Asistente',
  chat: 'Chat',
  tareas: 'Tareas',
  versiones: 'Versiones',
  servicios: 'Servicios',
  api: 'Cliente API',
  navegador: 'Navegador'
}

const irA: DefAtajo[] = VISTAS_RAPIDAS.map((v, i) => ({ id: `ir-${v}`, combos: [`Ctrl+${i + 1}`], accion: NOMBRE_VISTA[v], categoria: 'Ir a' as const }))

const terminalN: DefAtajo[] = Array.from({ length: 9 }, (_, i) => ({
  id: `terminal-${i + 1}`,
  combos: [`Alt+${i + 1}`],
  accion: `Ir a la terminal ${i + 1} de la pestaña activa`,
  categoria: 'Terminales' as const,
  ...(i === 0 ? { mostrar: 'Alt+1 – 9' } : {})
}))

export const ATAJOS_DEF: readonly DefAtajo[] = [
  // ---- General
  { id: 'ayuda', combos: ['F1', 'Ctrl+Shift+K'], accion: 'Ver todos los atajos de teclado', categoria: 'General' },
  { id: 'zoom-mas', combos: ['Ctrl++'], accion: 'Acercar la interfaz', categoria: 'Pantalla', informativo: true, mostrar: 'Ctrl + +' },
  { id: 'zoom-menos', combos: ['Ctrl+-'], accion: 'Alejar la interfaz', categoria: 'Pantalla', informativo: true, mostrar: 'Ctrl + −' },
  { id: 'zoom-cero', combos: ['Ctrl+0'], accion: 'Restablecer el zoom', categoria: 'Pantalla', informativo: true },
  // ---- Ir a (vistas)
  ...irA,
  // ---- Terminales
  { id: 'navegador-rapido', combos: ['Ctrl+Shift+P'], accion: 'Navegador rápido: buscar y saltar a cualquier terminal, asistente o proyecto', categoria: 'Terminales' },
  { id: 'pestana-siguiente', combos: ['Ctrl+Tab'], accion: 'Pestaña siguiente (grupo)', categoria: 'Terminales' },
  { id: 'pestana-anterior', combos: ['Ctrl+Shift+Tab'], accion: 'Pestaña anterior (grupo)', categoria: 'Terminales' },
  { id: 'terminal-siguiente', combos: ['Ctrl+PageDown'], accion: 'Terminal siguiente dentro de la pestaña', categoria: 'Terminales' },
  { id: 'terminal-anterior', combos: ['Ctrl+PageUp'], accion: 'Terminal anterior dentro de la pestaña', categoria: 'Terminales' },
  ...terminalN,
  { id: 'terminal-nueva', combos: ['Ctrl+Shift+T'], accion: 'Nueva terminal en la pestaña activa', categoria: 'Terminales' },
  { id: 'asistente-proyecto', combos: ['Ctrl+Shift+A'], accion: 'Abrir el Asistente del proyecto de la terminal activa', categoria: 'Terminales' },
  // ---- Dentro de la terminal (los gestiona el panel de la terminal)
  { id: 'term-copiar', combos: ['Ctrl+Shift+C'], accion: 'Copiar la selección', categoria: 'Dentro de la terminal', informativo: true },
  { id: 'term-pegar', combos: ['Ctrl+Shift+V'], accion: 'Pegar', categoria: 'Dentro de la terminal', informativo: true },
  { id: 'term-sugerencia', combos: ['Tab', '→', 'End'], accion: 'Aceptar la sugerencia del historial', categoria: 'Dentro de la terminal', informativo: true },
  { id: 'term-sugerencia-palabra', combos: ['Ctrl+→'], accion: 'Aceptar una palabra de la sugerencia', categoria: 'Dentro de la terminal', informativo: true },
  { id: 'term-sugerencia-mayus', combos: ['Mayús'], accion: 'Aceptar la sugerencia entera (pulsar y soltar solo)', categoria: 'Dentro de la terminal', informativo: true },
  // ---- Asistente (chat de proyecto, de grupo y general: es el mismo componente)
  { id: 'chat-buscar', combos: ['Ctrl+F'], accion: 'Buscar en la conversación', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-componer', combos: ['Ctrl+L'], accion: 'Ir al campo de mensaje', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-nueva', combos: ['Ctrl+Shift+N'], accion: 'Nueva conversación', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-historial', combos: ['Ctrl+Shift+H'], accion: 'Abrir o cerrar el historial de conversaciones', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-exportar', combos: ['Ctrl+Shift+E'], accion: 'Exportar la conversación a Markdown', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-cancelar', combos: ['Ctrl+.'], accion: 'Detener la tarea en curso', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-modo', combos: ['Ctrl+Shift+M'], accion: 'Cambiar entre modo Chat y Flujo', categoria: 'Asistente', donde: 'Chat de un proyecto' },
  { id: 'chat-tareas', combos: ['Ctrl+Shift+J'], accion: 'Mostrar las tareas del proyecto', categoria: 'Asistente', donde: 'Chat de un proyecto' },
  { id: 'chat-adjuntar', combos: ['Ctrl+Shift+U'], accion: 'Adjuntar archivos', categoria: 'Asistente', donde: 'Chat del Asistente' },
  { id: 'chat-inicio', combos: ['Alt+ArrowUp'], accion: 'Ir al principio de la conversación', categoria: 'Asistente', donde: 'Chat del Asistente', mostrar: 'Alt + ↑' },
  { id: 'chat-final', combos: ['Alt+ArrowDown'], accion: 'Ir al final de la conversación', categoria: 'Asistente', donde: 'Chat del Asistente', mostrar: 'Alt + ↓' },
  { id: 'chat-enviar', combos: ['Enter'], accion: 'Enviar el mensaje', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true },
  { id: 'chat-salto', combos: ['Shift+Enter'], accion: 'Salto de línea', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true, mostrar: 'Mayús + Enter' },
  { id: 'chat-previos', combos: ['ArrowUp', 'ArrowDown'], accion: 'Recuperar mensajes enviados antes (con el campo vacío)', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true, mostrar: '↑ / ↓' },
  { id: 'chat-voz', combos: ['Espacio'], accion: 'Mantener pulsada con el campo vacío para dictar', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true },
  { id: 'chat-comandos', combos: ['/'], accion: 'Comandos del Asistente', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true },
  { id: 'chat-mencion', combos: ['@'], accion: 'Mencionar un archivo o proyecto', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true },
  { id: 'chat-mencion-tarea', combos: ['#'], accion: 'Mencionar una tarea', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true },
  { id: 'chat-esc', combos: ['Esc'], accion: 'Cerrar menús o cancelar el dictado', categoria: 'Asistente', donde: 'Campo de mensaje', informativo: true },
  // ---- Navegador (ventana propia)
  { id: 'nav-direccion', combos: ['Ctrl+L'], accion: 'Ir a la barra de direcciones', categoria: 'Navegador', donde: 'Ventana del navegador', informativo: true },
  { id: 'nav-recargar', combos: ['Ctrl+R', 'F5'], accion: 'Recargar la página', categoria: 'Navegador', donde: 'Ventana del navegador', informativo: true },
  { id: 'nav-atras', combos: ['Alt+ArrowLeft'], accion: 'Atrás', categoria: 'Navegador', donde: 'Ventana del navegador', informativo: true, mostrar: 'Alt + ←' },
  { id: 'nav-adelante', combos: ['Alt+ArrowRight'], accion: 'Adelante', categoria: 'Navegador', donde: 'Ventana del navegador', informativo: true, mostrar: 'Alt + →' },
  { id: 'nav-devtools', combos: ['F12'], accion: 'Herramientas de desarrollo', categoria: 'Navegador', donde: 'Ventana del navegador', informativo: true },
  // ---- Editor de archivos
  { id: 'ed-guardar', combos: ['Ctrl+S'], accion: 'Guardar el archivo', categoria: 'Editor de archivos', informativo: true },
  { id: 'ed-buscar', combos: ['Ctrl+F'], accion: 'Buscar en el archivo', categoria: 'Editor de archivos', informativo: true },
  { id: 'ed-reemplazar', combos: ['Ctrl+H'], accion: 'Buscar y reemplazar', categoria: 'Editor de archivos', informativo: true },
  { id: 'ed-renombrar', combos: ['F2'], accion: 'Renombrar el archivo marcado', categoria: 'Editor de archivos', donde: 'Árbol de archivos', informativo: true },
  { id: 'ed-borrar', combos: ['Supr'], accion: 'Eliminar el archivo marcado', categoria: 'Editor de archivos', donde: 'Árbol de archivos', informativo: true }
]

const POR_ID = new Map(ATAJOS_DEF.map((a) => [a.id, a]))
export const atajoDe = (id: string): DefAtajo | undefined => POR_ID.get(id)

/** Lo mínimo que se lee de un KeyboardEvent (también vale para los de React y para pruebas). */
export interface TeclaEvento {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

interface Combo {
  mod: boolean
  shift: boolean
  alt: boolean
  tecla: string
}

const cache = new Map<string, Combo>()
function analizar(combo: string): Combo {
  let c = cache.get(combo)
  if (c) return c
  // «Ctrl++» y «Ctrl+-»: el último «+» es la tecla, no un separador
  const tecla = combo.endsWith('+') ? '+' : (combo.split('+').pop() ?? '')
  const mods = combo.slice(0, combo.length - tecla.length).split('+').filter(Boolean)
  c = { mod: mods.includes('Ctrl'), shift: mods.includes('Shift'), alt: mods.includes('Alt'), tecla }
  cache.set(combo, c)
  return c
}

/** ¿La pulsación es exactamente este combo? Los modificadores tienen que coincidir todos (Ctrl+P no vale como Ctrl+Shift+P). */
export function coincideCombo(e: TeclaEvento, combo: string): boolean {
  const c = analizar(combo)
  if (c.mod !== (e.ctrlKey || e.metaKey) || c.shift !== e.shiftKey || c.alt !== e.altKey) return false
  const t = c.tecla
  if (/^[0-9]$/.test(t)) return e.code === `Digit${t}` || e.code === `Numpad${t}` || (!e.code && e.key === t)
  if (t.length === 1) return e.key.toLowerCase() === t.toLowerCase()
  return e.key.toLowerCase() === t.toLowerCase()
}

/** ¿La pulsación activa este atajo del registro? */
export function coincide(e: TeclaEvento, id: string): boolean {
  const a = POR_ID.get(id)
  return !!a && !a.informativo && a.combos.some((c) => coincideCombo(e, c))
}

/** Id del atajo global (no informativo y sin «donde») que activa la pulsación, o undefined. */
export function atajoGlobal(e: TeclaEvento): string | undefined {
  for (const a of ATAJOS_DEF) if (!a.informativo && !a.donde && a.combos.some((c) => coincideCombo(e, c))) return a.id
  return undefined
}

const SIMBOLO: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Re Pág', PageDown: 'Av Pág', Shift: 'Mayús' }

/** Texto de un combo para mostrar: `Ctrl + Mayús + P` (o con ⌘/⇧/⌥ en macOS). */
export function formatearCombo(combo: string, mac = false): string {
  if (!combo.includes('+') || combo === '+') return SIMBOLO[combo] ?? combo
  const c = analizar(combo)
  const partes: string[] = []
  if (c.mod) partes.push(mac ? '⌘' : 'Ctrl')
  if (c.alt) partes.push(mac ? '⌥' : 'Alt')
  if (c.shift) partes.push(mac ? '⇧' : 'Mayús')
  partes.push(SIMBOLO[c.tecla] ?? (c.tecla.length === 1 ? c.tecla.toUpperCase() : c.tecla))
  return partes.join(' + ')
}

/** Lo que se ve en la vista de atajos para una entrada: su texto fijo o sus combos formateados. */
export function teclasParaMostrar(a: DefAtajo, mac = false): string[] {
  return a.mostrar ? [a.mostrar] : a.combos.map((c) => formatearCombo(c, mac))
}
