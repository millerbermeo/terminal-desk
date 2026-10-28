import type { Tarea } from '@shared/tareas'

export interface MencionTarea {
  /** Posición del «#» en el texto. */
  inicio: number
  /** Lo escrito después del «#» hasta el cursor. */
  consulta: string
}

const MAX_OPCIONES = 20

const plano = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** ¿El cursor está escribiendo una referencia a tarea («#20», «#login»)? Solo cuenta un «#» al inicio o tras un espacio. */
export function detectarMencionTarea(texto: string, cursor: number): MencionTarea | null {
  const m = /(^|\s)#([^\s#]*)$/.exec(texto.slice(0, cursor))
  return m ? { inicio: cursor - m[2]!.length - 1, consulta: m[2]! } : null
}

/** Tareas que coinciden con lo escrito: por número (empieza por) o por palabras del título. Sin nada escrito, todas en su orden. */
export function opcionesTarea(tareas: readonly Tarea[], consulta: string): Tarea[] {
  const q = plano(consulta.trim())
  if (!q) return tareas.slice(0, MAX_OPCIONES)
  const palabras = q.split(/\s+/)
  return tareas.filter((t) => String(t.numero).startsWith(q) || palabras.every((p) => plano(t.titulo).includes(p))).slice(0, MAX_OPCIONES)
}

/** Sustituye la mención por «#N » (el núcleo adjunta la ficha completa de esa tarea al mensaje). */
export function aplicarMencionTarea(texto: string, cursor: number, mencion: MencionTarea, t: Pick<Tarea, 'numero'>): { texto: string; cursor: number } {
  const insertado = `#${t.numero} `
  const resto = texto.slice(cursor)
  return { texto: texto.slice(0, mencion.inicio) + insertado + (resto.startsWith(' ') ? resto.slice(1) : resto), cursor: mencion.inicio + insertado.length }
}

/** Petición para que el Asistente haga una tarea de principio a fin siguiendo las reglas del tablero. */
export const pedirImplementar = (t: Pick<Tarea, 'numero' | 'titulo'>): string =>
  `Implementa la tarea #${t.numero} «${t.titulo}». Pásala a «en curso» al empezar, cumple sus criterios de aceptación y subtareas uno a uno marcándolos al terminarlos, verifica que funciona y complétala solo cuando todo se cumpla. Si algo te bloquea o hay que decidir, coméntalo en la tarea y pregúntame.`
