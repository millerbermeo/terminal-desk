import type { DecisionHumana, EjecucionIniciada, EventoAgente, InfoServidorMcp, InfoWorktree, ResultadoPublicar, SolicitudAgente } from './core/agente'
import type { InfoSuite, InformeEval, ResultadoEvals } from './core/evals'
import type { ResumenTraza, Traza } from './core/traza'
import type { CambioArchivo, EntradaArchivo, MarcaGit, ResultadoGuardar, ResultadoLeer } from './archivos'
import type { Adjunto } from './core/adjuntos'
import type { ComandoUsuario } from './core/comandos'
import type { NuevaRegla, ReglaPermiso } from './core/permisos'
import type { InfoModelo, ResumenUso } from './core/uso'
import type { EstadoCuenta, ProveedorModelo } from './core/cuenta'
import type { NombreOperacionTareas, OperacionesTareas } from './tareas'
import type { ResumenSesion, SesionGuardada, TurnoGuardado } from './core/sesion'
import type { EntradaMemoria, NuevaEntradaMemoria } from './core/memoria'
import type { BibliotecaAgentes, DatosProyectos, Proveedor, ProveedorEstado, Recurso } from './modelos'

export const Canales = {
  agentesListar: 'agentes:listar',
  agentesGuardar: 'agentes:guardar',
  agentesEliminar: 'agentes:eliminar',
  agentesActivar: 'agentes:activar',
  proveedoresListar: 'proveedores:listar',
  proveedoresGuardar: 'proveedores:guardar',
  proveedoresEliminar: 'proveedores:eliminar',
  proyectosListar: 'proyectos:listar',
  proyectosValidarRuta: 'proyectos:validar-ruta',
  proyectosAgregar: 'proyectos:agregar',
  proyectosElegirCarpetas: 'proyectos:elegir-carpetas',
  proyectosSugerirRutas: 'proyectos:sugerir-rutas',
  proyectosEliminar: 'proyectos:eliminar',
  grupoEliminar: 'grupo:eliminar',
  terminalCrear: 'terminal:crear',
  terminalEscribir: 'terminal:escribir',
  terminalRedimensionar: 'terminal:redimensionar',
  terminalCerrar: 'terminal:cerrar',
  terminalAdjuntar: 'terminal:adjuntar',
  ventanaSeparar: 'ventana:separar',
  ventanaTomar: 'ventana:tomar',
  ventanaDevolver: 'ventana:devolver',
  ventanaRecibir: 'ventana:recibir',
  coreEjecutar: 'core:ejecutar',
  coreCancelar: 'core:cancelar',
  coreMcpEstado: 'core:mcp-estado',
  coreMcpReiniciar: 'core:mcp-reiniciar',
  coreEvento: 'core:evento',
  coreResponder: 'core:responder',
  coreWorktreesListar: 'core:worktrees-listar',
  coreWorktreeDescartar: 'core:worktree-descartar',
  coreWorktreePublicar: 'core:worktree-publicar',
  coreTrazasListar: 'core:trazas-listar',
  coreTrazaObtener: 'core:traza-obtener',
  coreTrazaEliminar: 'core:traza-eliminar',
  coreEvalsSuites: 'core:evals-suites',
  coreEvalsEjecutar: 'core:evals-ejecutar',
  coreEvalsInformes: 'core:evals-informes',
  coreModelosListar: 'core:modelos-listar',
  coreCuentaEstado: 'core:cuenta-estado',
  coreCuentaProveedor: 'core:cuenta-proveedor',
  coreCuentaIniciar: 'core:cuenta-iniciar',
  coreCuentaCerrar: 'core:cuenta-cerrar',
  tareasOperar: 'tareas:operar',
  tareasCambio: 'tareas:cambio',
  coreCuentaAgregar: 'core:cuenta-agregar',
  coreCuentaQuitar: 'core:cuenta-quitar',
  coreCuentaActivar: 'core:cuenta-activar',
  coreCuentaAuto: 'core:cuenta-auto',
  coreUsoObtener: 'core:uso-obtener',
  coreUso: 'core:uso',
  coreAdjuntoSubir: 'core:adjunto-subir',
  coreAdjuntoLeer: 'core:adjunto-leer',
  coreAdjuntoEliminar: 'core:adjunto-eliminar',
  coreComandosListar: 'core:comandos-listar',
  coreComandosEfectivos: 'core:comandos-efectivos',
  coreComandosGuardar: 'core:comandos-guardar',
  coreComandosEliminar: 'core:comandos-eliminar',
  coreComandoEjecutar: 'core:comando-ejecutar',
  corePermisosListar: 'core:permisos-listar',
  corePermisosAgregar: 'core:permisos-agregar',
  corePermisosEliminar: 'core:permisos-eliminar',
  coreSesionesListar: 'core:sesiones-listar',
  coreSesionObtener: 'core:sesion-obtener',
  coreSesionTranscripcion: 'core:sesion-transcripcion',
  coreSesionBorrar: 'core:sesion-borrar',
  coreMemoriaListar: 'core:memoria-listar',
  coreMemoriaGuardar: 'core:memoria-guardar',
  coreMemoriaEliminar: 'core:memoria-eliminar',
  terminalDatos: 'terminal:datos',
  terminalSalida: 'terminal:salida'
} as const

/** Canales del editor de archivos integrado. */
export const CanalesArchivos = {
  listar: 'archivos:listar',
  leer: 'archivos:leer',
  guardar: 'archivos:guardar',
  crear: 'archivos:crear',
  renombrar: 'archivos:renombrar',
  borrar: 'archivos:borrar',
  estadoGit: 'archivos:estado-git',
  vigilar: 'archivos:vigilar',
  cambio: 'archivos:cambio'
} as const

export interface OpcionesTerminal {
  cwd?: string
  proveedorId?: string // si se indica, se ejecuta su comando al abrir
  proyectoId?: string // si es Claude, se le cargan los agentes y skills activos de este proyecto
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
  fin: number // posición acumulada de la salida tras este trozo (para no duplicar al adjuntar)
}

export interface HistorialTerminal {
  texto: string
  fin: number // el historial incluye la salida hasta esta posición
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

/** Pestaña que se pasa a una ventana nueva: las terminales siguen vivas (mismo pty). */
export interface PayloadVentana {
  ventanaId: string // id de la pestaña de origen (clave del grupo)
  nombre: string
  modo: 'rejilla' | 'pestanas'
  terminales: { id: string; titulo: string; ptyId: string; cwd?: string; proveedorId?: string; proyectoId?: string; vista?: 'terminal' | 'asistente' | 'archivos' }[]
}

export type ResultadoRecurso = { ok: true; biblioteca: BibliotecaAgentes } | { ok: false; mensaje: string }

export interface DestinoActivacion {
  tipo: 'proyecto' | 'grupo'
  id: string
}

/** Si hay errores no se agrega nada (todo o nada). */
export interface ResultadoAgregar {
  datos: DatosProyectos
  errores: ErrorProyecto[]
}

/** API expuesta en window.api por el preload. */
export interface ApiCentro {
  /** Editor de archivos de un proyecto: todo queda confinado a su carpeta. */
  archivos: {
    /** Contenido de una carpeta (ruta relativa; vacía = raíz): carpetas primero, sin `.git` ni `node_modules`. */
    listar(proyectoId: string, ruta?: string): Promise<EntradaArchivo[]>
    leer(proyectoId: string, ruta: string): Promise<ResultadoLeer>
    /** Guarda de forma atómica; con `mtimeEsperado` no pisa un archivo que cambió en disco (devuelve `conflicto`). */
    guardar(proyectoId: string, ruta: string, contenido: string, mtimeEsperado?: number): Promise<ResultadoGuardar>
    crear(proyectoId: string, ruta: string, tipo: 'archivo' | 'carpeta'): Promise<void>
    renombrar(proyectoId: string, desde: string, hasta: string): Promise<void>
    /** A la papelera del sistema (recuperable). */
    borrar(proyectoId: string, ruta: string): Promise<void>
    estadoGit(proyectoId: string): Promise<Record<string, MarcaGit>>
    /** Carpetas cuyos cambios en disco se quieren recibir (sustituye a las anteriores de este proyecto en esta ventana). */
    vigilar(proyectoId: string, carpetas: string[]): Promise<void>
    onCambio(cb: (c: CambioArchivo) => void): () => void
  }
  core: {
    /** Lanza el agente. El progreso y el resultado llegan por onEvento. */
    ejecutar(solicitud: SolicitudAgente): Promise<EjecucionIniciada>
    /** Responde a una `solicitud_humana` (aprobar/rechazar un plan o un resultado). */
    responder(solicitudId: string, decision: DecisionHumana): Promise<boolean>
    worktreesListar(proyectoId: string): Promise<InfoWorktree[]>
    /** Elimina el worktree y su rama (se pierde lo no integrado): la UI debe confirmarlo. */
    worktreeDescartar(proyectoId: string, id: string): Promise<InfoWorktree[]>
    /** `git push` de la rama; pide confirmación humana por onEvento (solicitud_humana). */
    worktreePublicar(proyectoId: string, id: string): Promise<ResultadoPublicar>
    /** Observabilidad: trazas de ejecuciones (prompts, herramientas, tiempos y tokens), más recientes primero. */
    trazasListar(limite?: number): Promise<ResumenTraza[]>
    trazaObtener(id: string): Promise<Traza | undefined>
    trazaEliminar(id: string): Promise<void>
    /** Evals: suites disponibles, ejecución (puede tardar minutos y consume tokens) e historial de informes. */
    evalsSuites(): Promise<InfoSuite[]>
    evalsEjecutar(suiteId: string, casos?: string[]): Promise<ResultadoEvals>
    evalsInformes(suiteId: string): Promise<InformeEval[]>
    /** Modelos disponibles para la clave (con su ventana de contexto); si la API no responde, los conocidos. */
    modelos(): Promise<InfoModelo[]>
    /** Cuenta con la que se paga el modelo: proveedor elegido (suscripción por defecto) y estado de la sesión. */
    cuentaEstado(): Promise<EstadoCuenta>
    cuentaProveedor(proveedor: ProveedorModelo): Promise<EstadoCuenta>
    /** Abre el navegador para iniciar sesión con la cuenta de Claude (correo, Google o SSO); resuelve al terminar. */
    cuentaIniciarSesion(id?: string): Promise<EstadoCuenta>
    cuentaCerrarSesion(id?: string): Promise<EstadoCuenta>
    /** Crea una cuenta de suscripción (carpeta propia, aislada) y la activa; falta iniciar sesión en ella. */
    cuentaAgregar(nombre: string): Promise<EstadoCuenta>
    cuentaQuitar(id: string): Promise<EstadoCuenta>
    cuentaActivar(id: string): Promise<EstadoCuenta>
    /** Cambiar solo a otra cuenta cuando la activa llega a su límite de uso. */
    cuentaCambioAutomatico(activo: boolean): Promise<EstadoCuenta>
    /** Consumo de esta aplicación hoy y límites de tasa que informa la API. */
    uso(): Promise<ResumenUso>
    /** Cambios en el consumo en tiempo real (tras cada llamada al modelo). */
    onUso(cb: (r: ResumenUso) => void): () => void
    /** Valida y guarda un archivo (imagen, PDF o texto) para adjuntarlo a un mensaje; lanza con un motivo claro si no es admisible. */
    adjuntoSubir(nombre: string, datos: Uint8Array): Promise<Adjunto>
    /** Contenido de una imagen adjunta (para mostrar su miniatura). */
    adjuntoLeer(id: string): Promise<{ mime: string; base64: string } | undefined>
    adjuntoEliminar(id: string): Promise<void>
    /** Comandos propios (`/nombre`). `ambito` vacío = globales. */
    comandosListar(ambito?: string): Promise<ComandoUsuario[]>
    /** Los de un proyecto más los globales (el del proyecto manda). */
    comandosEfectivos(proyectoId?: string): Promise<ComandoUsuario[]>
    comandosGuardar(comando: ComandoUsuario, ambito?: string): Promise<ComandoUsuario[]>
    comandosEliminar(nombre: string, ambito?: string): Promise<ComandoUsuario[]>
    /** Ejecuta un comando propio de tipo `ejecutable`; el resultado llega por onEvento (`comando_salida`). */
    comandoEjecutar(proyectoId: string, nombre: string, argumentos: string): Promise<{ ejecucionId: string }>
    /** Reglas de permisos persistentes. `ambito` vacío = globales (valen para todos los proyectos). */
    permisosListar(ambito?: string): Promise<ReglaPermiso[]>
    permisosAgregar(regla: NuevaRegla, ambito?: string): Promise<ReglaPermiso[]>
    permisosEliminar(id: string, ambito?: string): Promise<ReglaPermiso[]>
    /** Historial: conversaciones guardadas (del proyecto, o de todos si se omite), más recientes primero. */
    sesionesListar(proyectoId?: string): Promise<ResumenSesion[]>
    /** Lo que se veía en pantalla en una conversación guardada, para retomarla. */
    sesionObtener(sesionId: string): Promise<SesionGuardada | undefined>
    /** Guarda lo que se ve en pantalla (turnos terminados) de una conversación. */
    sesionTranscripcion(sesionId: string, turnos: TurnoGuardado[], proyectoId?: string): Promise<void>
    /** Elimina una conversación del historial. */
    sesionBorrar(sesionId: string): Promise<void>
    /** Memoria de largo plazo: proyectoId vacío = global (todos los proyectos). */
    memoriaListar(proyectoId?: string): Promise<EntradaMemoria[]>
    memoriaGuardar(entrada: NuevaEntradaMemoria, proyectoId?: string): Promise<EntradaMemoria[]>
    memoriaEliminar(id: string, proyectoId?: string): Promise<EntradaMemoria[]>
    cancelar(ejecucionId: string): Promise<void>
    mcpEstado(): Promise<InfoServidorMcp[]>
    /** Relee mcp.json y reconecta los servidores. */
    mcpReiniciar(): Promise<InfoServidorMcp[]>
    onEvento(cb: (e: EventoAgente) => void): () => void
  }
  /** Tareas de proyectos: una sola operación tipada (`OperacionesTareas`); la interfaz actúa como «usuario». */
  tareas: {
    operar<K extends NombreOperacionTareas>(op: K, entrada: OperacionesTareas[K]['entrada']): Promise<OperacionesTareas[K]['salida']>
    /** Algo cambió las tareas (la propia interfaz, o la IA por herramientas o MCP): hay que volver a leer. */
    onCambio(cb: () => void): () => void
  }
  agentes: {
    listar(): Promise<BibliotecaAgentes>
    /** id vacío = crear */
    guardar(recurso: Recurso): Promise<ResultadoRecurso>
    eliminar(id: string): Promise<BibliotecaAgentes>
    /** Activa o desactiva un recurso compartido para un grupo o un proyecto. */
    activar(destino: DestinoActivacion, recursoId: string, activo: boolean): Promise<BibliotecaAgentes>
  }
  ventana: {
    /** Abre una ventana nueva con estas terminales (opcionalmente en la posición de pantalla indicada). */
    separar(payload: PayloadVentana, pos?: { x: number; y: number }): void
    /** En una ventana separada: recoge lo que se le pasó (una sola vez). */
    tomar(token: string): Promise<PayloadVentana | null>
    /** Devuelve las terminales a la ventana principal (como pestaña) y cierra esta ventana sin matar los procesos. */
    devolver(payload: PayloadVentana): void
    /** En la ventana principal: llegan terminales devueltas desde una ventana separada. */
    onRecibir(cb: (payload: PayloadVentana) => void): () => void
  }
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
    /** Diálogo nativo para elegir una o varias carpetas; devuelve [] si se cancela. */
    elegirCarpetas(): Promise<string[]>
    /** Carpetas que empiezan por lo escrito (autocompletado de rutas), hasta 30. */
    sugerirRutas(prefijo: string): Promise<string[]>
    eliminar(id: string): Promise<DatosProyectos>
    /** Exige la contraseña del usuario del sistema. */
    eliminarGrupo(id: string, password: string): Promise<ResultadoEliminarGrupo>
  }
  terminal: {
    crear(opciones: OpcionesTerminal): Promise<string>
    /** Toma el control de un pty existente: devuelve lo ya mostrado (para repintarlo) y desde ahí recibe sus datos. */
    adjuntar(ptyId: string, cols: number, rows: number): Promise<HistorialTerminal>
    escribir(id: string, datos: string): void
    redimensionar(id: string, cols: number, rows: number): void
    cerrar(id: string): void
    onDatos(cb: (e: DatosTerminal) => void): () => void
    onSalida(cb: (e: SalidaTerminal) => void): () => void
  }
}
