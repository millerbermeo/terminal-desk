import { useCallback, useEffect, useRef, useState } from 'react'
import type { EstadoBoveda, ResultadoBoveda, SesionDispositivo } from '@shared/sesion'
import { fechaRelativa } from '@shared/versiones'
import { confirmar } from '../confirmar'
import { IconoCerrar } from './Iconos'

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
  /** Con un diálogo de confirmación abierto, Esc lo cierra a él, no al panel. */
  const confirmando = useRef(false)

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !enviando && !confirmando.current) onCerrar()
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
            <IconoCerrar />
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
        <Dispositivos enviando={enviando} correr={correr} confirmando={confirmando} />

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

/** Sistema legible a partir de `process.platform` (o del user-agent si la sesión no vino de la app). */
function sistemaDe(d: SesionDispositivo): string {
  const p = d.platform ?? ''
  if (p === 'linux') return 'Linux'
  if (p === 'darwin') return 'macOS'
  if (p === 'win32') return 'Windows'
  if (p) return p
  const ua = d.userAgent ?? ''
  if (/windows/i.test(ua)) return 'Windows'
  if (/mac os|macintosh/i.test(ua)) return 'macOS'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS'
  if (/linux/i.test(ua)) return 'Linux'
  return ''
}

/** Nombre a mostrar: el del equipo; si la sesión no vino de la app, qué la abrió. */
function nombreDe(d: SesionDispositivo): string {
  if (d.deviceName) return d.deviceName
  const ua = d.userAgent ?? ''
  if (/electron|odesk/i.test(ua)) return 'Odesk (equipo sin identificar)'
  if (/chrome|firefox|safari|edg/i.test(ua)) return 'Navegador'
  if (/node|undici|curl|postman|insomnia/i.test(ua)) return 'Cliente de API'
  return 'Equipo sin identificar'
}

/**
 * «Dispositivos conectados»: cada sesión abierta de la cuenta (equipo, sistema, versión, IP, última actividad) con la opción de
 * cerrarla tras confirmar. La de este equipo no se cierra aquí: para eso está «Cerrar sesión».
 */
function Dispositivos({ enviando, correr, confirmando }: { enviando: boolean; correr: Correr; confirmando: { current: boolean } }) {
  const [lista, setLista] = useState<SesionDispositivo[] | null>(null)
  const [error, setError] = useState('')
  const [cerrando, setCerrando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setLista(await window.api.sesion.cuenta('dispositivos', {}))
      setError('')
    } catch {
      setError('No se pudo cargar la lista de dispositivos.')
    }
  }, [])
  useEffect(() => void cargar(), [cargar])

  const preguntar = async (o: Parameters<typeof confirmar>[0]): Promise<boolean> => {
    confirmando.current = true
    try {
      return await confirmar(o)
    } finally {
      confirmando.current = false
    }
  }

  const cerrar = async (d: SesionDispositivo): Promise<void> => {
    const sistema = sistemaDe(d)
    const detalle = [sistema, d.ip ? `IP ${d.ip}` : '', `activo ${fechaRelativa(d.lastSeenAt)}`].filter(Boolean).join(' · ')
    const ok = await preguntar({
      titulo: `Cerrar sesión en «${nombreDe(d)}»`,
      tono: 'peligro',
      etiqueta: 'Cerrar sesión',
      texto: `${detalle}\n\nEse dispositivo dejará de tener acceso a tu cuenta al momento: tendrá que volver a iniciar sesión.\n\nSi no lo reconoces, cambia también tu contraseña.`
    })
    if (!ok) return
    setCerrando(d.id)
    await correr(() => window.api.sesion.cuenta('cerrarDispositivo', { id: d.id }).then(() => undefined), `Sesión cerrada en «${nombreDe(d)}».`, 'No se pudo cerrar la sesión de ese dispositivo.')
    setCerrando(null)
    await cargar()
  }

  const otros = lista?.filter((d) => !d.actual) ?? []
  const cerrarOtros = async (): Promise<void> => {
    const ok = await preguntar({
      titulo: 'Cerrar sesión en los demás dispositivos',
      tono: 'peligro',
      etiqueta: `Cerrar ${otros.length === 1 ? '1 sesión' : `${otros.length} sesiones`}`,
      texto: `Se cerrará la sesión en ${otros.length === 1 ? '1 dispositivo' : `${otros.length} dispositivos`}. Este equipo sigue conectado.\n\nCada uno tendrá que volver a iniciar sesión.`
    })
    if (!ok) return
    await correr(
      () => window.api.sesion.cuenta('cerrarOtros', {}).then((r) => ({ ok: true, mensaje: r.cerradas === 1 ? 'Se cerró 1 sesión.' : `Se cerraron ${r.cerradas} sesiones.` })),
      '',
      'No se pudo cerrar la sesión en los demás dispositivos.'
    )
    await cargar()
  }

  return (
    <section className="cta-dispositivos" aria-label="Dispositivos conectados">
      <div className="cta-dispositivos-cab">
        <h4 style={{ margin: 0 }}>Dispositivos conectados</h4>
        <button type="button" className="enlace" onClick={() => void cargar()} disabled={enviando}>
          Actualizar
        </button>
      </div>
      {error && <p className="tareas-error-texto">{error}</p>}
      {!lista && !error && <p className="modal-texto">Cargando…</p>}
      {lista && (
        <ul className="cta-dispositivos-lista">
          {lista.map((d) => {
            const sistema = sistemaDe(d)
            return (
              <li key={d.id} className={d.actual ? 'actual' : ''}>
                <div className="cta-disp-info">
                  <div className="cta-disp-nombre">
                    <strong>{nombreDe(d)}</strong>
                    {d.actual && <span className="chip">Este equipo</span>}
                  </div>
                  <div className="cta-disp-meta">
                    {[sistema, d.appVersion ? `v${d.appVersion}` : '', d.ip ?? ''].filter(Boolean).join(' · ')}
                  </div>
                  <div className="cta-disp-meta" title={`Inició sesión: ${new Date(d.createdAt).toLocaleString()}\nÚltima actividad: ${new Date(d.lastSeenAt).toLocaleString()}`}>
                    {d.actual ? 'Activo ahora' : `Activo ${fechaRelativa(d.lastSeenAt)}`} · sesión desde {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {!d.actual && (
                  <button type="button" className="peligro" disabled={enviando || cerrando === d.id} onClick={() => void cerrar(d)}>
                    {cerrando === d.id ? 'Cerrando…' : 'Cerrar sesión'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {otros.length > 1 && (
        <div className="cfg-acciones">
          <button type="button" disabled={enviando} onClick={() => void cerrarOtros()}>
            Cerrar sesión en los demás ({otros.length})
          </button>
        </div>
      )}
    </section>
  )
}

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
