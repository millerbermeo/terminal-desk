// Textos fijos del prompt de sistema del Asistente. Van en `--append-system-prompt`: cambiarlos invalida la caché de las conversaciones.

// Delegar en un subagente (herramienta Agent/Task) bloquea el turno hasta que termina: no hay aviso aparte cuando acaba.
export const AVISO_SUBAGENTES =
  '## Delegar en subagentes\nLa herramienta para delegar (Agent/Task) es síncrona: cuando responde, el subagente ya terminó y su resultado completo está en el tool_result. ' +
  'No existe ningún aviso posterior ni notificación en segundo plano para este chat. Por eso, nunca termines tu turno con algo como «te aviso cuando termine» o «en cuanto termine te cuento»: ' +
  'en el mismo turno en que recibes el tool_result, resume de inmediato todos los hallazgos relevantes (texto completo, no solo que «se hizo»). Si vas a tardar, dilo antes de delegar, no después.'

/**
 * Cuándo usar los agentes y skills propios del proyecto (solo si los tiene; el CLI ya describe cada uno en sus herramientas, aquí va
 * solo el criterio). Sin esto, el modelo hacía él mismo tareas que eran justo la especialidad de un agente. Texto fijo para no
 * romper la caché del prompt al añadir o quitar recursos.
 */
export function guiaRecursos(r: { agentes: boolean; skills: boolean }): string {
  if (!r.agentes && !r.skills) return ''
  const que = r.agentes && r.skills ? 'agentes (herramienta Agent) y skills (herramienta Skill)' : r.agentes ? 'agentes (herramienta Agent)' : 'skills (herramienta Skill)'
  return [
    `## Agentes y skills del proyecto\nEste proyecto tiene ${que} propios; su descripción dice para qué sirve cada uno. Decide tú, sin esperar a que te lo pidan:`,
    r.skills ? '- Si una skill cubre lo que vas a hacer (una convención, un formato, un procedimiento del proyecto), cárgala antes de hacerlo y síguela.' : '',
    r.agentes ? '- Si la tarea es la especialidad de un agente (revisar, auditar, analizar…), delégala en él aunque parezca pequeña, con el contexto que necesite, y resume su resultado.' : '',
    '- Si el usuario nombra un agente o una skill, úsalo.',
    '- No los uses para charla, preguntas triviales ni pasos que no son su especialidad: ahí responde directamente.'
  ]
    .filter(Boolean)
    .join('\n')
}
