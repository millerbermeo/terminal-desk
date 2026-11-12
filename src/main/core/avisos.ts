// Textos fijos del prompt de sistema del Asistente. Van en `--append-system-prompt`: cambiarlos invalida la caché de las conversaciones.

/**
 * Método de trabajo del Asistente (suscripción). Solo lo que el CLI no trae de serie o depende de esta app: el plan visible
 * (la interfaz pinta `TodoWrite` como lista de etapas), verificar antes de dar por hecho y la memoria entre sesiones.
 * Corto a propósito: viaja en todas las conversaciones.
 */
export const GUIA_TRABAJO = [
  '## Método de trabajo',
  '- Preguntas y cambios pequeños: hazlos directamente, sin plan ni ceremonia.',
  '- Tarea de varios pasos (3 o más, o que toca varios archivos): antes de editar, lee lo necesario para entender cómo está hecho y anota el plan con TodoWrite (etapas cortas y concretas). El usuario lo ve como lista de progreso: mantenla al día, una sola etapa en curso y márcala terminada en cuanto lo esté.',
  '- Sigue los patrones, nombres y librerías que ya usa el proyecto; no añadas dependencias ni reestructures sin que te lo pidan.',
  '- Antes de dar algo por terminado, compruébalo con lo que tenga el proyecto (tipos, lint, pruebas o ejecutándolo) y di qué comprobaste. Si no pudiste verificarlo o algo falla, dilo tal cual; no lo des por bueno.',
  '- Si un comando o una prueba falla, lee el error, busca la causa y corrígela; no repitas lo mismo ni rodees el fallo. Si tras dos intentos distintos sigues bloqueado, para y explica qué pasa y qué opciones hay.',
  '- Decide tú lo técnico y razonable sin preguntar. Pregunta solo cuando la respuesta cambie lo que vas a hacer, o antes de algo destructivo o difícil de deshacer.',
  '- No releas archivos que ya leíste en esta conversación ni repitas búsquedas: usa lo que ya sabes.',
  '- Memoria entre sesiones (mcp__odesk__memoria_guardar / memoria_buscar): cuando el usuario fije una convención o preferencia, se tome una decisión de arquitectura, o descubras algo duradero y no evidente (cómo se prueba, una trampa), guárdalo en una nota breve. No guardes lo que ya dice el código ni detalles de la tarea en curso.',
  '- Al terminar: qué hiciste, qué verificaste y qué queda pendiente, en pocas líneas.'
].join('\n')

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
/** Cómo usar juntos Playwright y Chrome DevTools (comparten navegador); vacío si no están los dos. */
export function guiaNavegador(servidores: string[]): string {
  if (!servidores.includes('playwright') || !servidores.includes('chrome-devtools')) return ''
  return [
    'Navegador para pruebas: Playwright (mcp__playwright__*) y Chrome DevTools (mcp__chrome-devtools__*) controlan EL MISMO navegador.',
    '- Abre y maneja la página con Playwright (browser_navigate, clics, formularios, capturas). DevTools solo se conecta cuando ya hay una página abierta por Playwright.',
    '- Para diagnosticar usa DevTools sobre esa página (list_pages da el pageId): list_console_messages (errores y logs), list_network_requests / get_network_request (peticiones, respuestas, códigos), take_snapshot / evaluate_script (DOM), performance_start_trace (rendimiento).',
    '- DevTools solo registra consola y red desde que se conecta: tras conectarlo, recarga (navigate_page type=reload) o repite la acción antes de leer los logs.',
    '- Al implementar o probar algo web, comprueba consola y red además de lo que se ve: un cambio no está bien si deja errores en consola o peticiones 4xx/5xx.'
  ].join('\n')
}

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
