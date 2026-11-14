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

/**
 * Credenciales de prueba del proyecto (herramientas `credenciales_*` del MCP `odesk`). Texto fijo a propósito: no nombra las que hay
 * (para eso está `credenciales_listar`), así crear o borrar una no cambia el prompt de sistema.
 */
export const GUIA_CREDENCIALES = [
  '## Credenciales de prueba',
  'Este proyecto puede tener credenciales de PRUEBA guardadas en este equipo (usuarios, claves de sandbox, URLs, tokens).',
  '- Cuando necesites un usuario, clave o URL para probar: credenciales_listar y luego credenciales_obtener, antes de pedírselos al usuario.',
  '- Cuando el usuario te dé una credencial de prueba, o te pida crear, cambiar, renombrar o borrar una: credenciales_guardar (crea o actualiza por nombre; solo cambian los campos que mandes) y credenciales_eliminar. Tras guardarla, no repitas sus valores en la respuesta.',
  '- No las escribas en archivos versionados, commits ni incidencias.'
].join('\n')

// Delegar en un subagente (herramienta Agent/Task) bloquea el turno hasta que termina: no hay aviso aparte cuando acaba.
export const AVISO_SUBAGENTES =
  '## Delegar en subagentes\nLa herramienta para delegar (Agent/Task) es síncrona: cuando responde, el subagente ya terminó y su resultado completo está en el tool_result. ' +
  'No existe ningún aviso posterior ni notificación en segundo plano para este chat. Por eso, nunca termines tu turno con algo como «te aviso cuando termine» o «en cuanto termine te cuento»: ' +
  'en el mismo turno en que recibes el tool_result, resume de inmediato todos los hallazgos relevantes (texto completo, no solo que «se hizo»). Si vas a tardar, dilo antes de delegar, no después.'

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

/** Un agente o skill disponible en la conversación, con la descripción que dice cuándo usarlo. */
export interface RecursoGuia {
  tipo: 'agente' | 'skill'
  nombre: string
  descripcion: string
}

const MAX_RECURSOS_GUIA = 16
const MAX_DESCRIPCION_GUIA = 180
const unaLinea = (t: string, max: number): string => {
  const l = t.replace(/\s+/g, ' ').trim()
  return l.length > max ? `${l.slice(0, max - 1)}…` : l
}

/**
 * Cuándo usar los agentes y skills propios del proyecto (solo si los tiene). El CLI ya describe cada uno dentro de sus herramientas,
 * pero ahí son un dato más y el modelo acababa haciendo él mismo lo que era la especialidad de un agente, o cargando una skill a
 * destiempo. Aquí va la regla de decisión y, si se conocen, los recursos uno por uno con su «cuándo» (`lista`): el modelo compara
 * cada petición contra esa tabla antes de empezar. También acota el gasto: una skill se carga una vez por conversación y lo que ya
 * hizo un agente no se repite. El texto solo cambia cuando cambian los recursos (y entonces el plugin ya relanza el proceso).
 */
export function guiaRecursos(r: { agentes: boolean; skills: boolean; lista?: readonly RecursoGuia[] }): string {
  if (!r.agentes && !r.skills) return ''
  const que = r.agentes && r.skills ? 'agentes (herramienta Agent) y skills (herramienta Skill)' : r.agentes ? 'agentes (herramienta Agent)' : 'skills (herramienta Skill)'
  const fila = (x: RecursoGuia): string => `- ${x.nombre}: ${unaLinea(x.descripcion, MAX_DESCRIPCION_GUIA) || '(sin descripción: mira la que da la herramienta)'}`
  const tabla = (tipo: RecursoGuia['tipo'], titulo: string): string => {
    const filas = (r.lista ?? []).filter((x) => x.tipo === tipo)
    if (!filas.length) return ''
    const resto = filas.length - MAX_RECURSOS_GUIA
    return [titulo, ...filas.slice(0, MAX_RECURSOS_GUIA).map(fila), ...(resto > 0 ? [`- (y ${resto} más: están en la descripción de la herramienta)`] : [])].join('\n')
  }
  return [
    `## Agentes y skills del proyecto\nEste proyecto tiene ${que} propios. Antes de empezar cada petición, compárala con ${r.lista?.length ? 'esta lista' : 'sus descripciones'} y decide tú, sin esperar a que te lo pidan:`,
    r.skills ? tabla('skill', 'Skills (cuándo cargar cada una):') : '',
    r.agentes ? tabla('agente', 'Agentes (cuándo delegar en cada uno):') : '',
    'Reglas:',
    r.skills
      ? '- Skill: si lo que vas a hacer cae en lo que describe una skill (una convención, un formato, un procedimiento del proyecto), cárgala ANTES de hacerlo y síguela. Una sola vez por conversación: si ya la cargaste, sus instrucciones siguen en el contexto; no la vuelvas a cargar.'
      : '',
    r.agentes
      ? '- Agente: si la tarea es la especialidad de un agente (revisar, auditar, analizar, probar…), delégala en él aunque parezca pequeña. No ve esta conversación: dale en el encargo todo lo que necesita (qué hacer, archivos, criterios). Cuando responda, usa su resultado tal cual y resúmelo: no repitas su trabajo ni releas lo que ya revisó.'
      : '',
    r.agentes && r.skills ? '- Si coinciden una skill y un agente, carga la skill y delega: son compatibles.' : '',
    '- Si el usuario nombra un agente o una skill, úsalo.',
    '- Si ninguno encaja, no los uses: charla, preguntas triviales, cambios de una línea y pasos fuera de su especialidad los resuelves tú directamente (delegar o cargar una skill ahí solo gasta contexto).'
  ]
    .filter(Boolean)
    .join('\n')
}
