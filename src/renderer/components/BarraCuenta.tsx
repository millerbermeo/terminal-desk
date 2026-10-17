import { useState } from 'react'
import type { CuentaSuscripcion } from '@shared/core/cuenta'
import type { ModoAutonomia } from '@shared/core/permisos'
import { useCuenta } from '../agente/cuenta'
import { confirmar } from '../confirmar'

/** Con qué se paga el modelo: suscripción de Claude (por defecto, con inicio de sesión) o clave de API. */
const etiqueta = (c: CuentaSuscripcion): string =>
  `${c.nombre}${c.email ? ` · ${c.email}` : c.sesion ? '' : ' · sin sesión'}${c.limiteHasta ? ' · límite alcanzado' : ''}`

export function BarraCuenta({ autonomia }: { autonomia: ModoAutonomia }) {
  const { cuenta, ocupado, error, elegir, iniciarSesion, cerrarSesion, activar, agregar, quitar, cambioAutomatico } = useCuenta()
  const [nueva, setNueva] = useState<string | null>(null) // nombre en edición; null = el formulario está cerrado
  if (!cuenta) return null
  const suscripcion = cuenta.proveedor === 'suscripcion'
  const sinSesion = suscripcion && !cuenta.sesion
  const activa = cuenta.cuentas.find((c) => c.id === cuenta.cuentaActivaId)
  const crear = (): void => {
    const nombre = (nueva ?? '').trim()
    if (!nombre) return
    setNueva(null)
    void agregar(nombre)
  }
  const quitarActiva = async (): Promise<void> => {
    if (!activa || activa.principal) return
    if (await confirmar({ titulo: `Quitar la cuenta «${activa.nombre}»`, etiqueta: 'Quitar cuenta', texto: 'Se cierra su sesión y se borran sus datos locales.\n\nLa conversación sigue en las demás cuentas si se copió.' })) void quitar(activa.id)
  }
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
      {suscripcion && (
        <>
          <select
            className="ag-cuenta-select"
            value={cuenta.cuentaActivaId}
            disabled={ocupado !== ''}
            onChange={(e) => void activar(e.target.value)}
            aria-label="Cuenta de suscripción"
            title="Cuenta de suscripción con la que se ejecuta"
          >
            {cuenta.cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {etiqueta(c)}
              </option>
            ))}
          </select>
          <button className="ag-cuenta-btn" disabled={ocupado !== ''} onClick={() => setNueva('')} title="Añade otra cuenta de Claude (cada una con su propio inicio de sesión)">
            ＋ Cuenta
          </button>
          {activa && !activa.principal && (
            <button className="ag-cuenta-btn" disabled={ocupado !== ''} onClick={() => void quitarActiva()} title="Cierra la sesión de esta cuenta y la quita">
              Quitar
            </button>
          )}
        </>
      )}
      {suscripcion && nueva !== null && (
        <form
          className="ag-cuenta-nueva"
          onSubmit={(e) => {
            e.preventDefault()
            crear()
          }}
        >
          <input autoFocus value={nueva} maxLength={40} placeholder="Nombre (p. ej. Trabajo)" onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNueva(null)} />
          <button className="ag-cuenta-btn primario" type="submit" disabled={!nueva.trim()}>
            Crear
          </button>
          <button className="ag-cuenta-btn" type="button" onClick={() => setNueva(null)}>
            Cancelar
          </button>
        </form>
      )}
      {suscripcion && cuenta.cuentas.length > 1 && (
        <label className="ag-cuenta-auto" title="Si la cuenta activa llega a su límite de uso, el mensaje continúa con otra cuenta con sesión. Solo se reintenta si aún no había ejecutado nada.">
          <input type="checkbox" checked={cuenta.cambioAutomatico} disabled={ocupado !== ''} onChange={(e) => void cambioAutomatico(e.target.checked)} />
          Cambiar sola al llegar al límite
        </label>
      )}
      {suscripcion && activa?.limiteHasta && (
        <span className="ag-cuenta-nota">Límite alcanzado: se renueva {new Date(activa.limiteHasta).toLocaleString()}</span>
      )}
      {suscripcion ? (
        cuenta.sesion ? (
          <>
            <span className="ag-cuenta-estado ok">● Sesión iniciada{cuenta.email ? `: ${cuenta.email}` : ''}</span>
            {autonomia === 'preguntar' && (
              <span className="ag-cuenta-nota" title="Con la suscripción el CLI no puede pedir confirmación: lo que requiere permiso se deniega.">
                Solo lectura: elige «Aceptar ediciones» para modificar archivos o tareas
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
                {ocupado === 'iniciando' ? 'Esperando…' : 'Iniciar sesión'}
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
