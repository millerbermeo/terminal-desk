/** Con qué se paga el modelo: la suscripción de Claude (vía el CLI `claude`) o una clave de la API de Anthropic. */
export type ProveedorModelo = 'suscripcion' | 'api'

export interface EstadoCuenta {
  /** Proveedor elegido (por defecto, la suscripción). */
  proveedor: ProveedorModelo
  /** El CLI `claude` está instalado (necesario para la suscripción). */
  cli: boolean
  /** Hay una sesión de suscripción (claude.ai) iniciada. */
  sesion: boolean
  email?: string
  /** Método de la sesión que informa el CLI (`claude.ai`, `console`…). */
  metodo?: string
  /** Hay una `ANTHROPIC_API_KEY` disponible (entorno o proveedor «claude»). */
  claveApi: boolean
  /** Por qué la suscripción no se puede usar ahora (sin CLI o sin sesión). */
  aviso?: string
}
