import type { DefHerramientaTareas } from './tareas-herramientas'

/**
 * Herramientas de la IA para las credenciales de prueba locales. Listar solo devuelve nombres y claves (nunca valores); obtener
 * entrega los valores, y por eso (riesgo `ejecucion`) pide confirmación en todos los modos salvo «Autónomo».
 */
export const HERRAMIENTAS_CREDENCIALES: readonly DefHerramientaTareas[] = [
  {
    nombre: 'credenciales_listar',
    descripcion:
      'Lista las credenciales de PRUEBA guardadas en este equipo para el proyecto (y su grupo): nombre, notas y nombres de los campos, sin valores. Úsala cuando necesites un usuario, clave de API de sandbox, URL o token para probar.',
    esquema: { type: 'object', properties: { proyecto_id: { type: 'string', description: 'Id del proyecto. Si se omite, el de esta conversación' } } },
    riesgo: 'lectura'
  },
  {
    nombre: 'credenciales_obtener',
    descripcion:
      'Devuelve los valores de una credencial de prueba (por su nombre, como sale en credenciales_listar). Solo para probar en local: nunca las escribas en archivos versionados, commits, issues ni respuestas largas.',
    esquema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la credencial' },
        proyecto_id: { type: 'string', description: 'Id del proyecto. Si se omite, el de esta conversación' }
      },
      required: ['nombre']
    },
    riesgo: 'ejecucion'
  }
]
