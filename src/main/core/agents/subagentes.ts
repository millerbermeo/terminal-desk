import type { Herramienta } from '../tools/registro'
import type { Agente } from './agente'

export const HERRAMIENTA_DELEGAR = 'delegar'

/**
 * Herramienta `delegar` de un agente con subagentes: el hijo arranca con contexto limpio (solo la tarea)
 * y al padre solo vuelve su respuesta final, así el contexto del padre no se llena con el trabajo del hijo.
 */
export function herramientaDelegar(
  padre: Agente,
  ejecutarHijo: (hijo: Agente, tarea: string) => Promise<{ texto: string; error?: boolean }>
): Herramienta {
  const nombres = [...padre.subagentes.keys()]
  return {
    nombre: HERRAMIENTA_DELEGAR,
    descripcion:
      'Delega una tarea autocontenida en un subagente. No ve esta conversación: incluye en «tarea» todo el contexto necesario.\n' +
      [...padre.subagentes.values()].map((s) => `- ${s.nombre}: ${s.def.descripcion}`).join('\n'),
    esquema: {
      type: 'object',
      properties: { agente: { type: 'string', enum: nombres }, tarea: { type: 'string' } },
      required: ['agente', 'tarea']
    },
    riesgo: 'lectura', // delegar no actúa por sí mismo: las herramientas del hijo pasan por su propia política
    async ejecutar(entrada) {
      const hijo = padre.subagentes.get(String(entrada.agente))
      if (!hijo) return { texto: `Subagente desconocido: ${String(entrada.agente)}`, error: true }
      return ejecutarHijo(hijo, String(entrada.tarea))
    }
  }
}
