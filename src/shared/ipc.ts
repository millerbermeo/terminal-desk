import type { DatosProyectos } from './modelos'

export const Canales = {
  proyectosListar: 'proyectos:listar',
  terminalCrear: 'terminal:crear',
  terminalEscribir: 'terminal:escribir',
  terminalRedimensionar: 'terminal:redimensionar',
  terminalCerrar: 'terminal:cerrar',
  terminalDatos: 'terminal:datos',
  terminalSalida: 'terminal:salida'
} as const

export interface OpcionesTerminal {
  cwd?: string
  cols: number
  rows: number
}

export interface SalidaTerminal {
  id: string
  codigo: number
}

export interface DatosTerminal {
  id: string
  datos: string
}

/** API expuesta en window.api por el preload. */
export interface ApiCentro {
  proyectos: {
    listar(): Promise<DatosProyectos>
  }
  terminal: {
    crear(opciones: OpcionesTerminal): Promise<string>
    escribir(id: string, datos: string): void
    redimensionar(id: string, cols: number, rows: number): void
    cerrar(id: string): void
    onDatos(cb: (e: DatosTerminal) => void): () => void
    onSalida(cb: (e: SalidaTerminal) => void): () => void
  }
}
