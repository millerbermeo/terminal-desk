import type { DatosProyectos, Proveedor, ProveedorEstado } from './modelos'

export const Canales = {
  proveedoresListar: 'proveedores:listar',
  proveedoresGuardar: 'proveedores:guardar',
  proveedoresEliminar: 'proveedores:eliminar',
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
  proveedorId?: string // si se indica, se ejecuta su comando al abrir
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

export type ResultadoEliminarGrupo =
  | { ok: true; datos: DatosProyectos }
  | { ok: false; motivo: 'incorrecta' | 'no-disponible' }

export type ResultadoProveedor = { ok: true; proveedores: ProveedorEstado[] } | { ok: false; mensaje: string }

/** Si hay errores no se agrega nada (todo o nada). */
export interface ResultadoAgregar {
  datos: DatosProyectos
  errores: ErrorProyecto[]
}

/** API expuesta en window.api por el preload. */
export interface ApiCentro {
  proveedores: {
    listar(): Promise<ProveedorEstado[]>
    /** id vacío = crear. */
    guardar(proveedor: Proveedor): Promise<ResultadoProveedor>
    eliminar(id: string): Promise<ProveedorEstado[]>
  }
  proyectos: {
    listar(): Promise<DatosProyectos>
    validarRuta(ruta: string): Promise<ValidacionRuta>
    agregar(solicitud: SolicitudAgregar): Promise<ResultadoAgregar>
    eliminar(id: string): Promise<DatosProyectos>
    /** Exige la contraseña del usuario del sistema. */
    eliminarGrupo(id: string, password: string): Promise<ResultadoEliminarGrupo>
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
