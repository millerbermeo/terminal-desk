import type { EsquemaEntrada, Riesgo } from './core/herramientas'

/** Herramientas de tareas que ve la IA (por el registro del núcleo, o por MCP en suscripción y terminales). Solo datos: sin dependencias de main. */
export interface DefHerramientaTareas {
  nombre: string
  descripcion: string
  esquema: EsquemaEntrada
  riesgo: Riesgo
}

const t = (description: string): { type: string; description: string } => ({ type: 'string', description })
const lista = (description: string): { type: string; description: string; items: unknown } => ({ type: 'array', description, items: { type: 'string' } })
const TAREA = t('Número de la tarea (p. ej. 12 o #12) o su id')
const PROYECTO = t('Id del proyecto (usa listar_proyectos). Si se omite, el proyecto de esta conversación')
const REFERENCIAS = { type: 'array', description: 'Referencias: [{tipo: enlace|archivo|nota, titulo, destino}]', items: { type: 'object' } }

const DATOS_TAREA = {
  descripcion: t('Qué hay que hacer y por qué, con el detalle suficiente para implementarlo'),
  prioridad: { type: 'string', description: 'Prioridad', enum: ['baja', 'media', 'alta', 'urgente'] },
  grupo_id: t('Id del grupo (opcional; se hereda del proyecto)'),
  estado: t('Id del estado inicial (por defecto, el primero «sin empezar»)'),
  etiquetas: lista('Etiquetas'),
  vence: t('Fecha de vencimiento AAAA-MM-DD'),
  criterios: lista('Criterios de aceptación: condiciones verificables para darla por terminada'),
  checklist: lista('Subtareas'),
  notas_tecnicas: t('Información técnica para orientar la implementación (archivos, enfoque, restricciones)'),
  depende_de: lista('Números de las tareas que deben terminar antes'),
  referencias: REFERENCIAS
}

export const HERRAMIENTAS_TAREAS: readonly DefHerramientaTareas[] = [
  {
    nombre: 'listar_proyectos',
    descripcion: 'Lista los proyectos y grupos disponibles (ids para vincular tareas).',
    esquema: { type: 'object', properties: {} },
    riesgo: 'lectura'
  },
  {
    nombre: 'listar_tareas',
    descripcion:
      'Lista tareas (resumen: número, título, estado, prioridad, vencimiento, dependencias y criterios) ordenadas por lo que conviene hacer antes. Por defecto, las del proyecto de esta conversación. Úsala antes de empezar a trabajar y para detectar duplicadas o mal definidas.',
    esquema: {
      type: 'object',
      properties: {
        proyecto_id: PROYECTO,
        todos_los_proyectos: { type: 'boolean', description: 'Ignora el proyecto de la conversación y lista las de todos (incluidas las sueltas)' },
        grupo_id: t('Solo las de este grupo'),
        estado: t('Id de estado'),
        prioridad: { type: 'string', description: 'Prioridad', enum: ['baja', 'media', 'alta', 'urgente'] },
        etiqueta: t('Etiqueta'),
        texto: t('Busca en título, descripción, notas y etiquetas'),
        solo_abiertas: { type: 'boolean', description: 'Solo las que no están terminadas ni descartadas' },
        solo_disponibles: { type: 'boolean', description: 'Solo las que se pueden empezar ya (sin bloqueos ni dependencias abiertas)' },
        limite: { type: 'integer', description: 'Máximo de tareas (por defecto 50)' }
      }
    },
    riesgo: 'lectura'
  },
  {
    nombre: 'obtener_tarea',
    descripcion: 'Devuelve una tarea completa: descripción, criterios, subtareas, dependencias, referencias, comentarios, notas técnicas e historial reciente.',
    esquema: { type: 'object', properties: { tarea: TAREA }, required: ['tarea'] },
    riesgo: 'lectura'
  },
  {
    nombre: 'crear_tarea',
    descripcion: 'Crea una tarea. Define siempre criterios de aceptación verificables. Sin proyecto_id se vincula al proyecto de la conversación (si lo hay).',
    esquema: { type: 'object', properties: { titulo: t('Título corto y claro'), proyecto_id: PROYECTO, ...DATOS_TAREA }, required: ['titulo'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'crear_tareas',
    descripcion:
      'Crea varias tareas de una vez (plan de trabajo). Cada elemento admite los campos de crear_tarea y «depende_de_indices» (posiciones, desde 0, de tareas anteriores del mismo lote).',
    esquema: {
      type: 'object',
      properties: { tareas: { type: 'array', description: 'Lista de tareas, en orden de ejecución', items: { type: 'object' } }, proyecto_id: PROYECTO },
      required: ['tareas']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'editar_tarea',
    descripcion:
      'Edita campos de una tarea (título, descripción, prioridad, color, etiquetas, vencimiento, notas técnicas, proyecto/grupo). No cambia el estado (usa cambiar_estado_tarea). Para quitar el vencimiento o el proyecto, pasa una cadena vacía.',
    esquema: {
      type: 'object',
      properties: {
        tarea: TAREA,
        titulo: t('Nuevo título'),
        descripcion: t('Nueva descripción'),
        prioridad: { type: 'string', description: 'Prioridad', enum: ['baja', 'media', 'alta', 'urgente'] },
        etiquetas: lista('Lista completa de etiquetas'),
        color: { type: 'string', description: 'Color de la tarjeta, o vacío para quitarlo', enum: ['', 'rojo', 'naranja', 'amarillo', 'verde', 'azul', 'morado', 'rosa', 'gris'] },
        vence: t('AAAA-MM-DD, o vacío para quitarlo'),
        notas_tecnicas: t('Nuevas notas técnicas'),
        proyecto_id: t('Id del proyecto al que vincularla, o vacío para dejarla suelta'),
        grupo_id: t('Id del grupo, o vacío para quitarlo'),
        motivo: t('Por qué se edita (queda en el historial)')
      },
      required: ['tarea']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'cambiar_estado_tarea',
    descripcion:
      'Cambia el estado según el avance real. Completarla exige criterios y subtareas cumplidos y dependencias terminadas; bloquear, descartar o reabrir exigen un motivo. Si la regla lo impide, devuelve el porqué: corrígelo, no lo fuerces.',
    esquema: { type: 'object', properties: { tarea: TAREA, estado: t('Id del estado (usa estados_tareas)'), motivo: t('Por qué cambia (obligatorio al bloquear, descartar o reabrir)') }, required: ['tarea', 'estado'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'comentar_tarea',
    descripcion: 'Añade un comentario: decisiones técnicas, problemas encontrados y soluciones aplicadas.',
    esquema: { type: 'object', properties: { tarea: TAREA, texto: t('Comentario') }, required: ['tarea', 'texto'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'gestionar_lista_tarea',
    descripcion: 'Añade, marca, edita o quita un criterio de aceptación o una subtarea. Marca un criterio solo cuando esté realmente cumplido.',
    esquema: {
      type: 'object',
      properties: {
        tarea: TAREA,
        lista: { type: 'string', description: 'Qué lista', enum: ['criterios', 'checklist'] },
        accion: { type: 'string', description: 'Qué hacer', enum: ['anadir', 'marcar', 'editar', 'quitar'] },
        texto: t('Texto (anadir y editar)'),
        item: t('Posición (1, 2…) o id del elemento (marcar, editar y quitar)'),
        hecho: { type: 'boolean', description: 'Con «marcar»: true cumple, false reabre (por defecto true)' }
      },
      required: ['tarea', 'lista', 'accion']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'fijar_dependencias_tarea',
    descripcion: 'Fija de qué tareas depende (sustituye la lista). Se rechazan ciclos.',
    esquema: { type: 'object', properties: { tarea: TAREA, depende_de: lista('Números de las tareas que deben terminar antes (vacío = ninguna)') }, required: ['tarea', 'depende_de'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'referencia_tarea',
    descripcion: 'Añade o quita una referencia (enlace, archivo del proyecto o nota).',
    esquema: {
      type: 'object',
      properties: {
        tarea: TAREA,
        accion: { type: 'string', description: 'Qué hacer', enum: ['anadir', 'quitar'] },
        tipo: { type: 'string', description: 'Tipo', enum: ['enlace', 'archivo', 'nota'] },
        titulo: t('Título'),
        destino: t('URL, ruta del archivo o texto de la nota'),
        referencia: t('Posición o id de la referencia (quitar)')
      },
      required: ['tarea', 'accion']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'resumen_tareas',
    descripcion: 'Resumen del proyecto (o grupo): progreso, tareas por estado, bloqueadas, vencidas, abiertas sin criterios de aceptación y la siguiente recomendada.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, grupo_id: t('Resumen de un grupo en vez de un proyecto') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'siguiente_tarea',
    descripcion: 'La tarea que conviene hacer ahora: abierta, sin bloqueos, por prioridad y vencimiento.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'actividad_tareas',
    descripcion: 'Historial de cambios (usuario e IA): de una tarea, del proyecto o general.',
    esquema: { type: 'object', properties: { tarea: TAREA, proyecto_id: PROYECTO, limite: { type: 'integer', description: 'Máximo de entradas (por defecto 30)' } } },
    riesgo: 'lectura'
  },
  {
    nombre: 'estados_tareas',
    descripcion: 'Estados disponibles (id, nombre y categoría) para usar en cambiar_estado_tarea.',
    esquema: { type: 'object', properties: {} },
    riesgo: 'lectura'
  }
]

