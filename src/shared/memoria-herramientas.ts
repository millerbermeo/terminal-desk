import type { DefHerramientaTareas } from './tareas-herramientas'

const AMBITO = { type: 'string', enum: ['proyecto', 'global'], description: 'proyecto (por defecto): solo este proyecto · global: vale para todos los proyectos' }

/**
 * Memoria de largo plazo para la IA en suscripción y en las terminales ✦ (en modo API el núcleo registra las suyas:
 * `core/memory/herramientas.ts`). Las reglas y lo relevante ya llegan solos al empezar cada conversación; estas herramientas
 * sirven para consultar el resto y para dejar anotado lo que deba recordarse en sesiones futuras.
 */
export const HERRAMIENTAS_MEMORIA: readonly DefHerramientaTareas[] = [
  {
    nombre: 'memoria_buscar',
    descripcion:
      'Busca en la memoria de largo plazo del proyecto (y la global): reglas, decisiones técnicas y hechos anotados en sesiones anteriores. Úsala antes de decidir arquitectura, convenciones o configuración, o cuando el usuario se refiera a algo ya acordado.',
    esquema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Palabras clave' },
        tipo: { type: 'string', enum: ['regla', 'decision', 'hecho'] },
        proyecto_id: { type: 'string', description: 'Id del proyecto. Si se omite, el de esta conversación' }
      },
      required: ['consulta']
    },
    riesgo: 'lectura'
  },
  {
    nombre: 'memoria_guardar',
    descripcion:
      'Anota en la memoria de largo plazo algo que deba recordarse en sesiones futuras: regla (convención o preferencia del usuario que hay que respetar siempre), decision (decisión técnica y su porqué) o hecho (dato duradero: cómo se prueba, dónde vive algo, una trampa conocida). Breve y autocontenido. No guardes lo que ya dice el código, el README o git, ni detalles de la tarea en curso, ni credenciales. Con el mismo tipo y título se actualiza la entrada en vez de duplicarla.',
    esquema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['regla', 'decision', 'hecho'] },
        titulo: { type: 'string', description: 'Corto y específico' },
        contenido: { type: 'string', description: 'Qué y por qué, en 1–4 frases' },
        etiquetas: { type: 'array', items: { type: 'string' } },
        ambito: AMBITO,
        proyecto_id: { type: 'string', description: 'Id del proyecto. Si se omite, el de esta conversación' }
      },
      required: ['tipo', 'titulo', 'contenido']
    },
    riesgo: 'escritura'
  }
]
