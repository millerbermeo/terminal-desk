import { useCallback, useEffect, useState } from 'react'
import type { EstadoBoveda, ResultadoBoveda } from '@shared/sesion'

interface Props {
  email?: string
  onCerrarSesion: () => void
  onCerrarTodas: () => void
  onCerrar: () => void
}

/** Panel de la cuenta: contraseña, sincronización con la nube, bóveda de claves y cerrar la sesión. */
export function Cuenta({ email, onCerrarSesion, onCerrarTodas, onCerrar }: Props) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !enviando) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, enviando])

  /** Ejecuta una operación mostrando «Trabajando…», el mensaje de éxito o el error. */
  const correr = useCallback(async (fn: () => Promise<{ ok: boolean; mensaje?: string } | void>, exito = '', fallo = 'No se pudo completar.') => {
    setEnviando(true)
    setError('')
    setAviso('')
    try {
      const r = await fn()
      if (r && !r.ok) setError(r.mensaje ?? fallo)
      else setAviso((r && r.mensaje) || exito)
      return !r || r.ok
    } catch {
      setError(fallo)
      return false
    } finally {
      setEnviando(false)
    }
  }, [])

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !enviando && onCerrar()}>
      <div className="modal modal-chico" role="dialog" aria-modal="true" aria-label="Cuenta">
        <div className="modal-cab">
          <h3>Cuenta</h3>
          <button type="button" className="icono" onClick={onCerrar} aria-label="Cerrar" disabled={enviando}>
            ✕
          </button>
        </div>
        <p className="modal-texto">{email ? <>Has entrado como <strong>{email}</strong>.</> : 'Sesión iniciada.'}</p>
        {aviso && !error && <p className="modal-texto">{aviso}</p>}
        {error && (
          <p className="tareas-error-texto" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </p>
        )}

        <CambiarPassword enviando={enviando} correr={correr} />
        <Sincronizacion enviando={enviando} correr={correr} />
        <BovedaClaves enviando={enviando} correr={correr} />

        <h4 style={{ margin: 0 }}>Sesión</h4>
        <div className="cfg-acciones">
          <button type="button" disabled={enviando} onClick={onCerrarSesion}>
            Cerrar sesión
          </button>
          <button type="button" disabled={enviando} onClick={onCerrarTodas} title="Por si perdiste un equipo o crees que alguien entró con tu cuenta">
            Cerrar sesión en todos los equipos
          </button>
        </div>
      </div>
    </div>
  )
}

type Correr = (fn: () => Promise<{ ok: boolean; mensaje?: string } | void>, exito?: string, fallo?: string) => Promise<boolean>

function CambiarPassword({ enviando, correr }: { enviando: boolean; correr: Correr }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const valida = nueva.length >= 8 && nueva === repetida
  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valida || enviando) return
        if (await correr(() => window.api.sesion.cuenta('cambiarPassword', { actual, nueva }), '', 'No se pudo cambiar la contraseña.')) {
          setActual('')
          setNueva('')
          setRepetida('')
        }
      }}
    >
      <h4 style={{ margin: 0 }}>Cambiar contraseña</h4>
      <label style={{ maxWidth: 'none' }}>
        Contraseña actual
        <input type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
        <span className="ayuda">Si entraste con Google y nunca pusiste una, déjala vacía.</span>
      </label>
      <label style={{ maxWidth: 'none' }}>
        Contraseña nueva
        <input type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        <span className="ayuda">Mínimo 8 caracteres. Se cerrará la sesión en tus otros equipos.</span>
      </label>
      <label style={{ maxWidth: 'none' }}>
        Repite la nueva
        <input type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        {repetida && nueva !== repetida && <span className="ayuda">No coinciden.</span>}
      </label>
      <div className="cfg-acciones">
        <button className="primario" type="submit" disabled={!valida || enviando}>
          Cambiar contraseña
        </button>
      </div>
    </form>
  )
}

function Sincronizacion({ enviando, correr }: { enviando: boolean; correr: Correr }) {
  return (
    <>
      <h4 style={{ margin: 0 }}>Sincronización</h4>
      <p className="modal-texto">
        Tareas, conversaciones, memoria, permisos, comandos, preferencias, proveedores y servidores MCP se guardan en tu cuenta y se
        sincronizan solos cada 30 segundos entre tus equipos.
      </p>
      <div className="cfg-acciones">
        <button type="button" disabled={enviando} onClick={() => void correr(() => window.api.sesion.cuenta('sincronizar', {}), '', 'No se pudo sincronizar.')}>
          Sincronizar ahora
        </button>
      </div>
    </>
  )
}

/** Bóveda: las claves (proveedores, MCP, cliente API, GitHub) viajan cifradas con una frase que solo tú conoces. */
function BovedaClaves({ enviando, correr }: { enviando: boolean; correr: Correr }) {
  const [estado, setEstado] = useState<EstadoBoveda | null>(null)
  const [frase, setFrase] = useState('')
  const [repetida, setRepetida] = useState('')
  const [nueva, setNueva] = useState('')
  const [cambiando, setCambiando] = useState(false)

  const tomar = (r: ResultadoBoveda): { ok: boolean; mensaje?: string } => {
    if (r.ok) setEstado(r.estado)
    return r.ok ? { ok: true } : r
  }
  useEffect(() => {
    void window.api.sesion
      .cuenta('bovedaEstado', {})
      .then((r) => r.ok && setEstado(r.estado))
      .catch(() => undefined)
  }, [])

  const limpiar = (): void => {
    setFrase('')
    setRepetida('')
    setNueva('')
    setCambiando(false)
  }

  return (
    <>
      <h4 style={{ margin: 0 }}>Claves en la nube (cifradas)</h4>
      <p className="modal-texto">
        Las claves de API de tus proveedores y servidores MCP, el cliente API y el token de GitHub se cifran en este equipo con una frase
        que solo tú conoces: el servidor no puede leerlas. <strong>Si olvidas la frase no se pueden recuperar.</strong>
      </p>
      {!estado && <p className="modal-texto">Comprobando…</p>}
      {estado && !estado.configurada && (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (await correr(async () => tomar(await window.api.sesion.cuenta('bovedaCrear', { frase })), 'Bóveda creada: tus claves ya están cifradas en la nube.', 'No se pudo crear la bóveda.')) limpiar()
          }}
        >
          <label style={{ maxWidth: 'none' }}>
            Frase de la bóveda
            <input type="password" autoComplete="new-password" value={frase} onChange={(e) => setFrase(e.target.value)} />
            <span className="ayuda">Mínimo 10 caracteres. Distinta de tu contraseña. Guárdala en un lugar seguro.</span>
          </label>
          <label style={{ maxWidth: 'none' }}>
            Repite la frase
            <input type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          </label>
          <div className="cfg-acciones">
            <button className="primario" type="submit" disabled={enviando || frase.length < 10 || frase !== repetida}>
              Activar bóveda
            </button>
          </div>
        </form>
      )}
      {estado?.configurada && !estado.desbloqueada && (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (await correr(async () => tomar(await window.api.sesion.cuenta('bovedaDesbloquear', { frase })), 'Bóveda desbloqueada en este equipo: se bajaron tus claves.', 'No se pudo desbloquear.')) limpiar()
          }}
        >
          <label style={{ maxWidth: 'none' }}>
            Frase de la bóveda
            <input type="password" autoComplete="current-password" value={frase} onChange={(e) => setFrase(e.target.value)} />
            <span className="ayuda">Tu cuenta ya tiene bóveda: escribe su frase para usar tus claves en este equipo.</span>
          </label>
          <div className="cfg-acciones">
            <button className="primario" type="submit" disabled={enviando || !frase}>
              Desbloquear
            </button>
            <button
              type="button"
              disabled={enviando}
              title="Si olvidaste la frase: borra la bóveda del servidor (lo guardado en ella se pierde) para crear otra"
              onClick={() => void correr(async () => tomar(await window.api.sesion.cuenta('bovedaReiniciar', {})), 'Bóveda borrada. Puedes crear una nueva.', 'No se pudo borrar la bóveda.')}
            >
              Olvidé la frase
            </button>
          </div>
        </form>
      )}
      {estado?.desbloqueada && (
        <>
          <p className="modal-texto">
            Bóveda activa en este equipo{estado.persistente ? '.' : ' (sin llavero del sistema: tendrás que escribir la frase cada vez que abras la app).'}
          </p>
          {cambiando ? (
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              onSubmit={async (e) => {
                e.preventDefault()
                if (await correr(async () => tomar(await window.api.sesion.cuenta('bovedaCambiarFrase', { actual: frase, nueva })), 'Frase cambiada. En tus otros equipos tendrás que desbloquear con la nueva.', 'No se pudo cambiar la frase.')) limpiar()
              }}
            >
              <label style={{ maxWidth: 'none' }}>
                Frase actual
                <input type="password" value={frase} onChange={(e) => setFrase(e.target.value)} />
              </label>
              <label style={{ maxWidth: 'none' }}>
                Frase nueva
                <input type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
              </label>
              <div className="cfg-acciones">
                <button className="primario" type="submit" disabled={enviando || !frase || nueva.length < 10}>
                  Cambiar frase
                </button>
                <button type="button" disabled={enviando} onClick={limpiar}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="cfg-acciones">
              <button type="button" disabled={enviando} onClick={() => setCambiando(true)}>
                Cambiar frase
              </button>
              <button
                type="button"
                disabled={enviando}
                title="Olvida la clave en este equipo (la bóveda sigue en tu cuenta)"
                onClick={() => void correr(async () => tomar(await window.api.sesion.cuenta('bovedaBloquear', {})), 'Bóveda bloqueada en este equipo.')}
              >
                Bloquear en este equipo
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
