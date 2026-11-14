import type { DefHerramientaTareas } from './tareas-herramientas'

/**
 * Herramientas de la IA para las credenciales de prueba locales. Listar solo devuelve nombres y claves (nunca valores); obtener
 * entrega los valores, y por eso (riesgo `ejecucion`) pide confirmación en todos los modos salvo «Autónomo». Guardar crea o actualiza
 * (riesgo `escritura`: sin preguntar desde «Ediciones») y eliminar siempre pide confirmación (`guardrails/destructivo.ts`).
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
  },
  {
    nombre: 'credenciales_guardar',
    descripcion:
      'Crea una credencial de PRUEBA o actualiza una existente (por su nombre) en este equipo: úsala cuando el usuario te dé o te pida guardar, cambiar o renombrar un usuario, clave, token o URL de pruebas. Al actualizar solo cambian los campos que mandes (los demás se conservan); quitar_campos borra campos. No devuelve valores.',
    esquema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la credencial (p. ej. «Admin staging»). Si ya existe, se actualiza' },
        campos: {
          type: 'array',
          description: 'Campos a crear o cambiar',
          items: {
            type: 'object',
            properties: {
              clave: { type: 'string', description: 'Nombre del campo: usuario, clave, url, token…' },
              valor: { type: 'string' },
              secreto: { type: 'boolean', description: 'Se oculta en la interfaz. Si se omite, se deduce del nombre del campo (clave, token, secret…)' }
            },
            required: ['clave', 'valor']
          }
        },
        quitar_campos: { type: 'array', items: { type: 'string' }, description: 'Nombres de campos a borrar de una credencial existente' },
        notas: { type: 'string', description: 'Para qué sirve o dónde se usa. Cadena vacía borra las notas' },
        nombre_nuevo: { type: 'string', description: 'Renombra una credencial existente' },
        ambito: { type: 'string', enum: ['proyecto', 'grupo'], description: 'Dónde guardarla: solo este proyecto (por defecto) o todo su grupo de proyectos' },
        proyecto_id: { type: 'string', description: 'Id del proyecto. Si se omite, el de esta conversación' }
      },
      required: ['nombre']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'credenciales_eliminar',
    descripcion: 'Elimina una credencial de prueba de este equipo (por su nombre). Solo cuando el usuario lo pida; siempre se le pide confirmación.',
    esquema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la credencial' },
        ambito: { type: 'string', enum: ['proyecto', 'grupo'], description: 'Si hay una con ese nombre en el proyecto y otra en el grupo, cuál borrar (por defecto, la del proyecto)' },
        proyecto_id: { type: 'string', description: 'Id del proyecto. Si se omite, el de esta conversación' }
      },
      required: ['nombre']
    },
    riesgo: 'ejecucion'
  }
]

/** Herramientas que siempre preguntan a la persona, también en «Autónomo» (no entran en la lista de permitidas del CLI). */
export const CREDENCIALES_SIEMPRE_CONFIRMAN: readonly string[] = ['credenciales_eliminar']

/** `true` si es la herramienta que recibe valores de credenciales (con o sin el prefijo `mcp__odesk__` del CLI). */
export const recibeValoresCredencial = (herramienta: string): boolean => herramienta === 'credenciales_guardar' || herramienta.endsWith('__credenciales_guardar')

/**
 * La entrada de `credenciales_guardar` sin los valores: lo que se pinta, se guarda en la conversación y en las trazas (que se
 * sincronizan con la cuenta) no debe llevarlos. Las demás herramientas pasan tal cual.
 */
export function sinValoresCredencial(herramienta: string, entrada: Record<string, unknown>): Record<string, unknown> {
  if (!recibeValoresCredencial(herramienta) || !Array.isArray(entrada.campos)) return entrada
  return { ...entrada, campos: entrada.campos.map((c: unknown) => (c && typeof c === 'object' ? { ...(c as Record<string, unknown>), valor: '••••' } : c)) }
}
