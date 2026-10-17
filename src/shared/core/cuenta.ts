/** Con qué se paga el modelo: la suscripción de Claude (vía el CLI `claude`) o una clave de la API de Anthropic. */
export type ProveedorModelo = 'suscripcion' | 'api'

/** Una cuenta de suscripción de Claude. Cada una tiene su propia sesión del CLI, aislada en su carpeta de configuración. */
export interface CuentaSuscripcion {
  id: string
  nombre: string
  /** Es la cuenta que ya tenía el CLI (`~/.claude`); no se puede quitar. */
  principal: boolean
  /** Hay una sesión de suscripción iniciada en esta cuenta. */
  sesion: boolean
  email?: string
  /** Por qué no se puede usar (p. ej. la sesión es de consola, no de suscripción). */
  aviso?: string
  /** Se alcanzó su límite de uso; hasta cuándo (ms desde epoch) se da por agotada. */
  limiteHasta?: number
}

export interface EstadoCuenta {
  /** Proveedor elegido (por defecto, la suscripción). */
  proveedor: ProveedorModelo
  /** El CLI `claude` está instalado (necesario para la suscripción). */
  cli: boolean
  /** Hay una sesión de suscripción (claude.ai) iniciada en la cuenta activa. */
  sesion: boolean
  /** Cuentas de suscripción (siempre incluye la principal) y cuál se usa ahora. */
  cuentas: CuentaSuscripcion[]
  cuentaActivaId: string
  /** Pasar solo a otra cuenta cuando la activa llega a su límite de uso. */
  cambioAutomatico: boolean
  email?: string
  /** Método de la sesión que informa el CLI (`claude.ai`, `console`…). */
  metodo?: string
  /** Hay una `ANTHROPIC_API_KEY` disponible (entorno o proveedor «claude»). */
  claveApi: boolean
  /** Por qué la suscripción no se puede usar ahora (sin CLI o sin sesión). */
  aviso?: string
}
