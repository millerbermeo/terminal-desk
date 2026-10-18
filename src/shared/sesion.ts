/** Estado de la sesión contra el servidor (API de Odesk Agent). */
export interface EstadoSesion {
  activa: boolean
  email?: string
  usuarioId?: string
  /** Dirección del servidor al que se conecta esta instalación. */
  servidor: string
  /** El token se guardó cifrado en disco; si no, se pierde al cerrar la app. */
  persistente?: boolean
}

/** ¿Es una dirección segura para mandar credenciales? https, o http solo hacia esta misma máquina. */
export function servidorSeguro(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
  } catch {
    return false
  }
}

export interface CredencialesSesion {
  email: string
  password: string
}

export type ResultadoSesion =
  | { ok: true; estado: EstadoSesion }
  /** `verificacionPendiente`: la contraseña es correcta pero falta activar la cuenta con el código del correo. */
  | { ok: false; mensaje: string; verificacionPendiente?: boolean }

/** Pasos que no abren sesión (registro, reenvíos, olvido, cambio de contraseña). */
export type ResultadoPaso = { ok: true; mensaje: string } | { ok: false; mensaje: string }

/** Bóveda de claves (cifrada en el equipo con una frase que el servidor nunca ve). */
export interface EstadoBoveda {
  /** El servidor tiene una bóveda para esta cuenta. */
  configurada: boolean
  /** Este equipo tiene la clave (no hace falta escribir la frase). */
  desbloqueada: boolean
  /** La clave está guardada cifrada con el llavero del sistema; si no, se pide la frase en cada arranque. */
  persistente: boolean
}

export type ResultadoBoveda = { ok: true; estado: EstadoBoveda } | { ok: false; mensaje: string }

export interface ResumenSincronizacion {
  ok: boolean
  mensaje: string
}

/** Operaciones de cuenta: un solo canal IPC tipado. */
export interface OperacionesCuenta {
  registrar: { entrada: { email: string; password: string }; salida: ResultadoPaso }
  /** `password`: la del registro (o la del login que pidió activar): el servidor la exige junto con el código. */
  verificar: { entrada: { email: string; code: string; password: string }; salida: ResultadoSesion }
  reenviar: { entrada: { email: string }; salida: ResultadoPaso }
  olvido: { entrada: { email: string }; salida: ResultadoPaso }
  restablecer: { entrada: { email: string; code: string; password: string }; salida: ResultadoSesion }
  cambiarPassword: { entrada: { actual: string; nueva: string }; salida: ResultadoPaso }
  cerrarTodas: { entrada: Record<string, never>; salida: EstadoSesion }
  /** Sube y baja ya los datos de la cuenta y la bóveda (normalmente se hace solo cada 30 s). */
  sincronizar: { entrada: Record<string, never>; salida: ResumenSincronizacion }
  bovedaEstado: { entrada: Record<string, never>; salida: ResultadoBoveda }
  bovedaCrear: { entrada: { frase: string }; salida: ResultadoBoveda }
  bovedaDesbloquear: { entrada: { frase: string }; salida: ResultadoBoveda }
  bovedaCambiarFrase: { entrada: { actual: string; nueva: string }; salida: ResultadoBoveda }
  bovedaBloquear: { entrada: Record<string, never>; salida: ResultadoBoveda }
  /** Borra la bóveda del servidor (si se olvidó la frase). */
  bovedaReiniciar: { entrada: Record<string, never>; salida: ResultadoBoveda }
}
export type NombreOperacionCuenta = keyof OperacionesCuenta
