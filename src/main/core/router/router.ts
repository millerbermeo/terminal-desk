import type { Complejidad } from '@shared/core/agente'

export interface DecisionRuta {
  complejidad: Complejidad
  modelo: string
  razon: string
  /** La petición pide modificar código y no es trivial: conviene el flujo con plan y aprobación. */
  sugerirFlujo: boolean
}

export interface Clasificador {
  clasificar(peticion: string): { complejidad: Complejidad; razon: string }
}

const normalizar = (t: string): string => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const COMPLEJA = /arquitectur|refactor|migra|redisen|seguridad|concurren|rendimiento|optimiz|sistema|integra|autenticacion|base de datos|escalab/
const SIMPLE = /\btypo\b|renombr|explica|que es\b|que hace|resum|traduc|coment|formato|donde (esta|se define)/
const MODIFICA = /\b(crea|crear|implementa|implementar|anade|agrega|agregar|modifica|cambia|cambiar|corrige|corregir|arregla|elimina|borra|refactor\w*|migra\w*|escribe)\b/
const RUTA = /[\w.-]+\/[\w./-]+|\b\w+\.(ts|tsx|js|jsx|py|go|rs|java|json|css|md)\b/g

export class ClasificadorHeuristico implements Clasificador {
  clasificar(peticion: string): { complejidad: Complejidad; razon: string } {
    const t = normalizar(peticion)
    const razones: string[] = []
    let puntos = 0
    const suma = (n: number, razon: string): void => {
      puntos += n
      razones.push(razon)
    }
    if (t.length > 600) suma(2, 'petición larga')
    else if (t.length > 250) suma(1, 'petición extensa')
    if (COMPLEJA.test(t)) suma(2, 'tema de alcance amplio')
    if ((t.match(RUTA) ?? []).length >= 3) suma(2, 'varios archivos')
    if (t.includes('```')) suma(1, 'incluye código')
    if (MODIFICA.test(t)) suma(1, 'modifica código')
    if (SIMPLE.test(t)) suma(-2, 'tarea acotada')
    if (t.length < 120 && t.trim().endsWith('?')) suma(-1, 'pregunta corta')
    const complejidad: Complejidad = puntos <= 0 ? 'simple' : puntos <= 2 ? 'media' : 'compleja'
    return { complejidad, razon: razones.join(', ') || 'sin señales claras' }
  }
}

export const MODELOS_POR_DEFECTO: Record<Complejidad, string> = {
  simple: 'claude-haiku-5-5',
  media: 'claude-sonnet-5-5',
  compleja: 'claude-opus-5-5'
}

/** Elige el modelo según la complejidad del requerimiento (y recomienda el flujo cuando se va a modificar código). */
export class Router {
  constructor(
    private readonly modelos: Record<Complejidad, string> = MODELOS_POR_DEFECTO,
    private readonly clasificador: Clasificador = new ClasificadorHeuristico()
  ) {}

  decidir(peticion: string): DecisionRuta {
    const { complejidad, razon } = this.clasificador.clasificar(peticion)
    return {
      complejidad,
      modelo: this.modelos[complejidad],
      razon,
      sugerirFlujo: complejidad !== 'simple' && MODIFICA.test(normalizar(peticion))
    }
  }
}
