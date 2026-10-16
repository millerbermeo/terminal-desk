import type { TipoMemoria } from '@shared/core/memoria'
import type { Herramienta } from '../tools/registro'
import type { MemoriaLargoPlazo } from './largo-plazo'

/** Herramientas del agente para consultar y (con aprobación) ampliar la memoria de largo plazo. */
export function herramientasMemoria(memoria: MemoriaLargoPlazo): Herramienta[] {
  return [
    {
      nombre: 'buscar_memoria',
      descripcion: 'Busca en la memoria del proyecto (reglas, decisiones técnicas, hechos) por palabras clave.',
      esquema: {
        type: 'object',
        properties: {
          consulta: { type: 'string' },
          tipo: { type: 'string', enum: ['regla', 'decision', 'hecho'] }
        },
        required: ['consulta']
      },
      riesgo: 'lectura',
      async ejecutar(entrada, ctx) {
        const r = await memoria.buscar(String(entrada.consulta), ctx.proyectoId, 5, entrada.tipo as TipoMemoria | undefined)
        return {
          texto: r.length
            ? r.map(({ entrada: e }) => `[${e.tipo}] ${e.titulo} (${e.id})\n${e.contenido}`).join('\n\n')
            : 'Sin resultados.'
        }
      }
    },
    {
      nombre: 'guardar_memoria',
      descripcion: 'Guarda en la memoria del proyecto una regla, decisión técnica o hecho duradero para futuras sesiones.',
      esquema: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['regla', 'decision', 'hecho'] },
          titulo: { type: 'string' },
          contenido: { type: 'string' },
          etiquetas: { type: 'array', items: { type: 'string' } }
        },
        required: ['tipo', 'titulo', 'contenido']
      },
      // Escribe en algo que se inyecta en futuros prompts: se trata como escritura (requiere aprobación).
      riesgo: 'escritura',
      async ejecutar(entrada, ctx) {
        await memoria.guardar(
          {
            tipo: entrada.tipo as TipoMemoria,
            titulo: String(entrada.titulo),
            contenido: String(entrada.contenido),
            etiquetas: Array.isArray(entrada.etiquetas) ? entrada.etiquetas.map(String) : []
          },
          ctx.proyectoId
        )
        return { texto: 'Guardado en la memoria.' }
      }
    }
  ]
}
