import type { ModoAutonomia } from '@shared/core/permisos'
import { useCuenta } from '../agente/cuenta'

/** Con qué se paga el modelo: suscripción de Claude (por defecto, con inicio de sesión) o clave de API. */
export function BarraCuenta({ autonomia }: { autonomia: ModoAutonomia }) {
  const { cuenta, ocupado, error, elegir, iniciarSesion, cerrarSesion } = useCuenta()
  if (!cuenta) return null
  const suscripcion = cuenta.proveedor === 'suscripcion'
  const sinSesion = suscripcion && !cuenta.sesion
  return (
    <div className={`ag-cuenta${sinSesion ? ' sin-sesion' : ''}`}>
      <div className="segmentado" role="group" aria-label="Cuenta del modelo">
        <button className={suscripcion ? 'on' : ''} disabled={ocupado !== ''} onClick={() => void elegir('suscripcion')} title="Usa tu suscripción de Claude (Pro/Max) a través del CLI «claude»">
          Suscripción
        </button>
        <button className={!suscripcion ? 'on' : ''} disabled={ocupado !== ''} onClick={() => void elegir('api')} title="Usa una clave de la API de Anthropic (se cobra por tokens)">
          API
        </button>
      </div>
      {suscripcion ? (
        cuenta.sesion ? (
          <>
            <span className="ag-cuenta-estado ok">● Sesión iniciada{cuenta.email ? `: ${cuenta.email}` : ''}</span>
            {autonomia === 'preguntar' && (
              <span className="ag-cuenta-nota" title="Con la suscripción el CLI no puede pedir confirmación: lo que requiere permiso se deniega.">
                Solo lectura: elige «Aceptar ediciones» para modificar archivos
              </span>
            )}
            <span className="ag-espacio" />
            <button className="ag-cuenta-btn" disabled={ocupado !== ''} onClick={() => void cerrarSesion()}>
              {ocupado === 'cerrando' ? 'Cerrando…' : 'Cerrar sesión'}
            </button>
          </>
        ) : (
          <>
            <span className="ag-cuenta-estado">{ocupado === 'iniciando' ? 'Completa el inicio de sesión en el navegador (correo, Google o SSO)…' : (cuenta.aviso ?? 'Inicia sesión con tu cuenta de Claude.')}</span>
            <span className="ag-espacio" />
            {cuenta.cli && (
              <button className="ag-cuenta-btn primario" disabled={ocupado !== ''} onClick={() => void iniciarSesion()}>
                {ocupado === 'iniciando' ? 'Esperando…' : cuenta.email ? 'Cambiar de cuenta' : 'Iniciar sesión'}
              </button>
            )}
          </>
        )
      ) : (
        <>
          <span className={`ag-cuenta-estado${cuenta.claveApi ? ' ok' : ''}`}>{cuenta.claveApi ? '● Clave de API detectada' : 'Falta ANTHROPIC_API_KEY (entorno o env del proveedor «claude»)'}</span>
        </>
      )}
      {error && <span className="ag-cuenta-error">{error}</span>}
    </div>
  )
}
