import type { DatosProyectos } from './modelos'

export const Canales = {
  proyectosListar: 'proyectos:listar',
  proyectosValidarRuta: 'proyectos:validar-ruta',
  proyectosAgregar: 'proyectos:agregar',
  proyectosEliminar: 'proyectos:eliminar',
  grupoEliminar: 'grupo:eliminar',
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

export interface NuevoProyecto {
  nombre: string
  ruta: string // absoluta, relativa al home, o con ~
}

export interface SolicitudAgregar {
  grupoId?: string // grupo existente
  grupoNuevo?: string // o nombre de grupo a crear
  proyectos: NuevoProyecto[]
}

export interface ErrorProyecto {
  indice: number
  mensaje: string
}

export interface ValidacionRuta {
  ok: boolean
  ruta: string // ruta absoluta resuelta
  mensaje?: string // motivo si no es válida
}

/** Si hay errores no se agrega nada (todo o nada). */
export interface ResultadoAgregar {
  datos: DatosProyectos
  errores: ErrorProyecto[]
}

/** API expuesta en window.api por el preload. */
export interface ApiCentro {
  proyectos: {
    listar(): Promise<DatosProyectos>
    validarRuta(ruta: string): Promise<ValidacionRuta>
    agregar(solicitud: SolicitudAgregar): Promise<ResultadoAgregar>
    eliminar(id: string): Promise<DatosProyectos>
    eliminarGrupo(id: string): Promise<DatosProyectos>
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
