import type { AgenteDef } from './agents/agente'

const SOLO_LECTURA = ['leer_archivo', 'listar_directorio', 'ejecutar_comando'] as const

const investigador: AgenteDef = {
  nombre: 'investigador',
  descripcion: 'Explora el código del proyecto (solo lectura) y responde con un resumen y rutas concretas.',
  sistema:
    'Eres un investigador de código. Explora el proyecto con las herramientas de lectura y responde con un resumen breve y preciso, citando rutas de archivo. No modificas nada.',
  herramientas: SOLO_LECTURA,
  maxPasos: 15
}

/** Agente raíz por defecto. Escribir/ejecutar exige aprobación (la Fase 4 añade la confirmación en la UI). */
export const asistente: AgenteDef = {
  nombre: 'asistente',
  descripcion: 'Asistente de desarrollo del proyecto.',
  sistema:
    'Eres un asistente de desarrollo que trabaja dentro de un proyecto concreto. Usa las herramientas para leer el código antes de afirmar nada. ' +
    'Delega la exploración extensa en el subagente «investigador». Responde en español, de forma concisa.',
  subagentes: [investigador]
}

export const AGENTES_BASE: readonly AgenteDef[] = [asistente]

export const AGENTE_PLANIFICADOR = 'planificador'
export const AGENTE_GENERADOR = 'generador'

/** Fase de planificación del flujo de desarrollo: solo lectura. */
export const planificador: AgenteDef = {
  nombre: AGENTE_PLANIFICADOR,
  descripcion: 'Analiza el proyecto y propone un plan de implementación.',
  sistema:
    'Eres un arquitecto de software. Explora el proyecto (solo lectura) y produce un plan de implementación para la petición: ' +
    'lista numerada de pasos, archivos a crear o modificar (con rutas), riesgos y cómo verificarlo. No modificas nada. ' +
    'Responde únicamente con el plan, en español.',
  herramientas: [...SOLO_LECTURA, 'buscar_memoria'],
  maxPasos: 15
}

/** Fase de generación: puede escribir archivos (solo tras aprobar el plan). */
export const generador: AgenteDef = {
  nombre: AGENTE_GENERADOR,
  descripcion: 'Implementa un plan aprobado.',
  sistema:
    'Eres un ingeniero de software. Implementa el plan aprobado modificando solo los archivos necesarios, siguiendo las convenciones del proyecto. ' +
    'No ejecutas las pruebas: se ejecutan después de forma automática. Al terminar, resume en español qué cambiaste (archivos y motivo).',
  herramientas: [...SOLO_LECTURA, 'escribir_archivo', 'buscar_memoria'],
  maxPasos: 30
}
