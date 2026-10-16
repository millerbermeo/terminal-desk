import type { EstadoEjecucion, Uso } from './agente'

export interface ResultadoAsercion {
  tipo: string
  ok: boolean
  detalle: string
}

export interface ResultadoCaso {
  id: string
  descripcion: string
  pasa: boolean
  aserciones: ResultadoAsercion[]
  estadoAgente?: EstadoEjecucion
  pasos: number
  uso: Uso
  duracionMs: number
  trazaId?: string
  error?: string
}

export interface InformeEval {
  suite: string
  fecha: string // ISO
  modelo?: string
  total: number
  pasan: number
  tasa: number // 0..1
  umbral: number
  superaUmbral: boolean
  uso: Uso
  duracionMs: number
  casos: ResultadoCaso[]
}

export interface ComparacionInformes {
  regresiones: string[] // casos que pasaban y ahora fallan
  mejoras: string[] // casos que fallaban y ahora pasan
  nuevos: string[]
  deltaTasa: number
}

export interface InfoSuite {
  id: string
  descripcion: string
  casos: number
}

export interface ResultadoEvals {
  informe: InformeEval
  comparacion?: ComparacionInformes // frente al informe anterior de la misma suite
}
