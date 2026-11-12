import type { DefHerramientaTareas } from './tareas-herramientas'

/**
 * Herramientas para manejar la propia aplicación desde cualquier asistente (el Asistente de Odesk, Claude Code en una terminal ✦ o un
 * cliente MCP externo como Claude Desktop, VS Code o Cursor): proyectos y grupos, terminales, servicios de arranque, conversaciones del
 * Asistente, ajustes, consumo e historial local de archivos. Lo que cierra, para, quita o restaura pide confirmación en Odesk
 * (`confirmacionApp`), venga de donde venga.
 */
const t = (description: string): { type: string; description: string } => ({ type: 'string', description })
const n = (description: string): { type: string; description: string } => ({ type: 'number', description })
const b = (description: string): { type: string; description: string } => ({ type: 'boolean', description })
const lista = (description: string): { type: string; description: string; items: unknown } => ({ type: 'array', description, items: { type: 'string' } })
const PROYECTO = t('Id del proyecto (odesk_proyectos o listar_proyectos). Si se omite, el proyecto de esta conversación')
const TERMINAL = t('Id de la terminal (terminal_listar)')

export const HERRAMIENTAS_APP: readonly DefHerramientaTareas[] = [
  // ── Proyectos y grupos ──
  {
    nombre: 'odesk_proyectos',
    descripcion:
      'Estado general de Odesk: proyectos de este equipo (id, nombre, carpeta, grupo, si tienen terminales o servicios en marcha), grupos y proyectos de la cuenta que aún no están en este equipo (pendientes de clonar). Úsalo primero para conocer los ids.',
    esquema: { type: 'object', properties: {} },
    riesgo: 'lectura'
  },
  {
    nombre: 'proyecto_abrir',
    descripcion: 'Abre (o enfoca si ya está abierto) un proyecto en la interfaz de Odesk, en su terminal, su Asistente o su explorador de archivos.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, vista: { type: 'string', description: 'Qué mostrar (por defecto terminal)', enum: ['terminal', 'asistente', 'archivos'] } } },
    riesgo: 'escritura'
  },
  {
    nombre: 'proyecto_clonar',
    descripcion: 'Clona en este equipo un proyecto de la cuenta que aún no tiene carpeta aquí (ver «pendientes» en odesk_proyectos) y lo deja enlazado al mismo proyecto.',
    esquema: { type: 'object', properties: { proyecto_id: t('Id del proyecto pendiente'), carpeta_padre: t('Carpeta donde crear el clon (por defecto la de las preferencias de clonado o ~/dev)') }, required: ['proyecto_id'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'proyecto_quitar',
    descripcion: 'Quita un proyecto de ESTE equipo (no borra la carpeta ni el proyecto de la cuenta). Pide confirmación en Odesk.',
    esquema: { type: 'object', properties: { proyecto_id: t('Id del proyecto') }, required: ['proyecto_id'] },
    riesgo: 'escritura'
  },
  // ── Terminales ──
  {
    nombre: 'terminal_listar',
    descripcion: 'Lista las terminales abiertas en Odesk (id, proyecto, título, si corre Claude Code, si está esperando en el shell o ejecutando algo, última línea).',
    esquema: { type: 'object', properties: { proyecto_id: t('Solo las de este proyecto (opcional)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'terminal_abrir',
    descripcion:
      'Abre una terminal NUEVA en la celda del proyecto (visible para el usuario). Con claude: true arranca Claude Code con los agentes y skills del proyecto. Devuelve su id; para ejecutar algo usa terminal_escribir y para ver el resultado terminal_esperar (espera a que termine) o terminal_leer.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, claude: b('Arrancar Claude Code en ella'), titulo: t('Título de la pestaña (opcional)') } },
    riesgo: 'escritura'
  },
  {
    nombre: 'terminal_escribir',
    descripcion:
      'Escribe en una terminal de Odesk como si lo tecleara el usuario (por defecto pulsa Enter al final): ejecutar un comando, responder a un programa interactivo o hablarle a Claude Code. Para teclas especiales usa tecla.',
    esquema: {
      type: 'object',
      properties: {
        terminal: TERMINAL,
        texto: t('Texto a escribir'),
        enter: b('Pulsar Enter al final (por defecto true)'),
        tecla: { type: 'string', description: 'En vez de texto: una tecla especial', enum: ['ctrl+c', 'ctrl+d', 'escape', 'enter', 'tab', 'arriba', 'abajo'] }
      },
      required: ['terminal']
    },
    riesgo: 'ejecucion'
  },
  {
    nombre: 'terminal_leer',
    descripcion: 'Lee lo último que muestra una terminal de Odesk (texto plano, sin colores). Úsalo tras terminal_escribir para ver el resultado; espera unos segundos si el comando tarda.',
    esquema: { type: 'object', properties: { terminal: TERMINAL, lineas: n('Cuántas líneas del final (por defecto 80, máx. 1000)'), esperar_ms: n('Esperar antes de leer, en ms (máx. 30000)') }, required: ['terminal'] },
    riesgo: 'lectura'
  },
  {
    nombre: 'terminal_esperar',
    descripcion:
      'Espera a que termine lo que corre en una terminal de Odesk y devuelve su salida, sin tener que sondear con terminal_leer. Por defecto espera a que la terminal vuelva al shell (el comando terminó). Con texto, espera a que aparezca ese texto en la salida nueva (p. ej. «ready», «listening», «error»): útil para servidores y procesos que no terminan. Si se agota el tiempo devuelve lo que haya y lo dice: el proceso sigue corriendo.',
    esquema: {
      type: 'object',
      properties: {
        terminal: TERMINAL,
        texto: t('Esperar a que la salida nueva contenga este texto (sin distinguir mayúsculas) en vez de a que termine'),
        max_s: n('Tiempo máximo de espera en segundos (por defecto 60, máx. 300)'),
        lineas: n('Cuántas líneas del final devolver (por defecto 60, máx. 1000)')
      },
      required: ['terminal']
    },
    riesgo: 'lectura'
  },
  {
    nombre: 'terminal_cerrar',
    descripcion: 'Cierra una terminal de Odesk y termina su proceso. Pide confirmación en Odesk.',
    esquema: { type: 'object', properties: { terminal: TERMINAL }, required: ['terminal'] },
    riesgo: 'escritura'
  },
  // ── Servicios de arranque ──
  {
    nombre: 'servicios_listar',
    descripcion: 'Comandos de arranque de un proyecto (servidor de desarrollo, API, base de datos…) con su estado (listo, arrancando, error, detenido), puerto y terminal.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'servicios_arrancar',
    descripcion:
      'Lanza los comandos de arranque del proyecto (todos o los ids indicados), en orden y esperando a que cada uno esté listo. Si un puerto está ocupado por otro proyecto o programa, no lo toca: devuelve el conflicto.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ids: lista('Ids de los comandos (servicios_listar); si se omite, todos'), esperar: b('Esperar a que terminen de arrancar (por defecto true, máx. 2 min)') } },
    riesgo: 'escritura'
  },
  {
    nombre: 'servicios_detener',
    descripcion: 'Detiene comandos de arranque del proyecto (todos o los ids indicados). Pide confirmación en Odesk.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ids: lista('Ids de los comandos; si se omite, todos') } },
    riesgo: 'escritura'
  },
  {
    nombre: 'servicios_reiniciar',
    descripcion: 'Detiene y vuelve a lanzar comandos de arranque del proyecto (p. ej. tras cambiar la configuración del servidor). Pide confirmación en Odesk.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ids: lista('Ids de los comandos; si se omite, todos') } },
    riesgo: 'escritura'
  },
  {
    nombre: 'servicio_logs',
    descripcion: 'Lee la salida reciente de un comando de arranque (errores del servidor de desarrollo, peticiones, compilación).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, id: t('Id del comando (servicios_listar)'), lineas: n('Cuántas líneas del final (por defecto 120, máx. 1000)') }, required: ['id'] },
    riesgo: 'lectura'
  },
  // ── Asistente ──
  {
    nombre: 'asistente_conversaciones',
    descripcion: 'Lista las conversaciones guardadas del Asistente de Odesk (id, título, proyecto, fecha), de un proyecto o de todos.',
    esquema: { type: 'object', properties: { proyecto_id: t('Solo las de este proyecto (opcional)'), limite: n('Máximo (por defecto 20)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'asistente_leer',
    descripcion: 'Lee una conversación del Asistente de Odesk: los últimos mensajes del usuario y las respuestas (sin el detalle de cada herramienta).',
    esquema: { type: 'object', properties: { conversacion: t('Id de la conversación (asistente_conversaciones)'), ultimos: n('Cuántos turnos del final (por defecto 6)') }, required: ['conversacion'] },
    riesgo: 'lectura'
  },
  {
    nombre: 'asistente_enviar',
    descripcion:
      'Envía un mensaje al Asistente de Odesk de un proyecto (se abre su celda y el usuario lo ve como si lo hubiera escrito; si está ocupado, queda en cola). Sirve para delegarle una tarea en ese proyecto. Después lee el resultado con asistente_conversaciones/asistente_leer.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, mensaje: t('Lo que se le pide') }, required: ['mensaje'] },
    riesgo: 'escritura'
  },
  // ── Ajustes, cuentas y consumo ──
  {
    nombre: 'ajustes_leer',
    descripcion: 'Ajustes del Asistente (modelo, autonomía, esfuerzo) de un proyecto o globales, y las cuentas de suscripción (cuál está activa, cambio automático).',
    esquema: { type: 'object', properties: { proyecto_id: t('Proyecto (si se omite, los globales)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'ajustes_fijar',
    descripcion:
      'Cambia el modelo, la autonomía o el esfuerzo del Asistente de un proyecto (o globales). Pasar a «autonomo» pide confirmación en Odesk. «auto» en modelo o esfuerzo vuelve al valor por defecto.',
    esquema: {
      type: 'object',
      properties: {
        proyecto_id: t('Proyecto (si se omite, los globales)'),
        modelo: t('auto, haiku, sonnet, opus o un id de modelo'),
        autonomia: { type: 'string', description: 'preguntar, ediciones o autonomo', enum: ['preguntar', 'ediciones', 'autonomo'] },
        esfuerzo: t('auto, low, medium, high, xhigh o max')
      }
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'cuenta_activar',
    descripcion: 'Cambia la cuenta de suscripción activa de Claude (ajustes_leer da los ids).',
    esquema: { type: 'object', properties: { id: t('Id de la cuenta') }, required: ['id'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'consumo',
    descripcion: 'Consumo de tokens y coste de hoy, de los últimos días y del plan de suscripción (ventana de 5 h y semanal), por modelo.',
    esquema: { type: 'object', properties: {} },
    riesgo: 'lectura'
  },
  // ── Historial local de archivos ──
  {
    nombre: 'historial_archivos',
    descripcion: 'Archivos del proyecto con versiones en el historial local de Odesk (independiente de git: cada guardado del editor, de la IA o externo).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, texto: t('Filtrar por ruta (opcional)'), limite: n('Máximo (por defecto 50)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'historial_versiones',
    descripcion: 'Versiones guardadas de un archivo (id, fecha, origen: usuario/ia/externo/git, autor, líneas +/−).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ruta: t('Ruta del archivo relativa al proyecto') }, required: ['ruta'] },
    riesgo: 'lectura'
  },
  {
    nombre: 'historial_comparar',
    descripcion: 'Diferencias de un archivo entre una versión y otra («actual» = el archivo en disco; desde «anterior» = la versión previa a hasta). Sin desde/hasta: versión indicada contra el archivo actual.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ruta: t('Ruta del archivo'), desde: t('Id de versión, «anterior» o «actual»'), hasta: t('Id de versión o «actual»') }, required: ['ruta', 'hasta'] },
    riesgo: 'lectura'
  },
  {
    nombre: 'historial_restaurar',
    descripcion: 'Restaura un archivo a una versión del historial local (antes guarda el estado actual, así que se puede deshacer). Pide confirmación en Odesk.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ruta: t('Ruta del archivo'), version: t('Id de la versión (historial_versiones)') }, required: ['ruta', 'version'] },
    riesgo: 'escritura'
  }
]

export const NOMBRES_APP = new Set(HERRAMIENTAS_APP.map((h) => h.nombre))

/**
 * Si la llamada necesita que la persona la apruebe en Odesk, el texto de la pregunta; si no, undefined. Es la lista de lo que cierra,
 * para, quita, restaura o sube permisos. Pura: la usan el ejecutor (para preguntar) y el cliente MCP (para esperar más a la respuesta).
 */
export function confirmacionApp(nombre: string, e: Record<string, unknown>): string | undefined {
  const ids = Array.isArray(e.ids) && e.ids.length ? ` (${e.ids.map(String).join(', ')})` : ' (todos)'
  switch (nombre) {
    case 'proyecto_quitar':
      return `Quitar el proyecto ${String(e.proyecto_id)} de este equipo (la carpeta no se borra).`
    case 'terminal_cerrar':
      return `Cerrar la terminal ${String(e.terminal)} y terminar su proceso.`
    case 'servicios_detener':
      return `Detener servicios de arranque${ids}.`
    case 'servicios_reiniciar':
      return `Reiniciar servicios de arranque${ids}.`
    case 'historial_restaurar':
      return `Restaurar ${String(e.ruta)} a la versión ${String(e.version)} (el estado actual se guarda antes).`
    case 'ajustes_fijar':
      return e.autonomia === 'autonomo' ? 'Poner el Asistente en modo «Autónomo» (ejecuta comandos y edita sin preguntar).' : undefined
    default:
      return undefined
  }
}

/** Herramientas que pueden quedarse esperando a la persona: el cliente MCP les da más tiempo. */
export const PUEDEN_CONFIRMAR = new Set(['proyecto_quitar', 'terminal_cerrar', 'servicios_detener', 'servicios_reiniciar', 'historial_restaurar', 'ajustes_fijar', 'servicios_arrancar', 'proyecto_clonar', 'terminal_esperar'])
