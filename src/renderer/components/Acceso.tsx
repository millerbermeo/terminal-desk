import { useEffect, useState } from 'react'
import { servidorSeguro, type EstadoSesion, type ResultadoSesion } from '@shared/sesion'

interface Props {
  servidor: string
  onEntrar: (estado: EstadoSesion) => void
  /** Se cambió la dirección del servidor: hay que recargar el estado de la sesión. */
  onServidor: (estado: EstadoSesion) => void
}

/** entrar → (sin activar) codigo · registrar → codigo · olvido → restablecer */
type Modo = 'entrar' | 'registrar' | 'codigo' | 'olvido' | 'restablecer'

const TITULOS: Record<Modo, string> = {
  entrar: 'Iniciar sesión',
  registrar: 'Crear cuenta',
  codigo: 'Activa tu cuenta',
  olvido: 'Recuperar contraseña',
  restablecer: 'Nueva contraseña'
}

/** Pantalla de acceso al servidor: entrar, crear la cuenta y activarla con el código del correo, o recuperar la contraseña. */
export function Acceso({ servidor, onEntrar, onServidor }: Props) {
  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verPassword, setVerPassword] = useState(false)
  const [editandoServidor, setEditandoServidor] = useState(false)
  const [urlNueva, setUrlNueva] = useState(servidor)
  const [googleListo, setGoogleListo] = useState(false)
  useEffect(() => {
    let vigente = true
    setGoogleListo(false)
    void window.api.sesion.googleDisponible().then((d) => vigente && setGoogleListo(d), () => undefined)
    return () => {
      vigente = false
    }
  }, [servidor])

  const ir = (m: Modo, mensaje = ''): void => {
    setModo(m)
    setError('')
    setAviso(mensaje)
    setCodigo('')
    if (m === 'restablecer' || m === 'registrar') setPassword('')
  }

  /** Ejecuta una llamada mostrando «Trabajando…» y el error si lo hay. */
  const correr = async (fn: () => Promise<void>, falloGenerico: string): Promise<void> => {
    if (enviando) return
    setEnviando(true)
    setError('')
    try {
      await fn()
    } catch {
      setError(falloGenerico)
    } finally {
      setEnviando(false)
    }
  }

  const tratarSesion = (r: ResultadoSesion): void => {
    if (r.ok) onEntrar(r.estado)
    else if (r.verificacionPendiente) ir('codigo', r.mensaje)
    else setError(r.mensaje)
  }

  const correoOk = /^\S+@\S+\.\S+$/.test(email.trim())
  const codigoOk = /^\d{6}$/.test(codigo.trim())
  const completo: Record<Modo, boolean> = {
    entrar: correoOk && password.length > 0,
    registrar: correoOk && password.length >= 8,
    codigo: correoOk && codigoOk,
    olvido: correoOk,
    restablecer: correoOk && codigoOk && password.length >= 8
  }

  const enviar = (): Promise<void> => {
    const e = email.trim()
    switch (modo) {
      case 'entrar':
        return correr(async () => tratarSesion(await window.api.sesion.iniciar({ email: e, password })), 'No se pudo iniciar sesión.')
      case 'registrar':
        return correr(async () => {
          const r = await window.api.sesion.cuenta('registrar', { email: e, password })
          if (r.ok) ir('codigo', r.mensaje)
          else setError(r.mensaje)
        }, 'No se pudo crear la cuenta.')
      case 'codigo':
        // La contraseña es la que se escribió al crear la cuenta (o al entrar): llegar a este paso siempre pasa por uno de los dos.
        return correr(async () => tratarSesion(await window.api.sesion.cuenta('verificar', { email: e, code: codigo.trim(), password })), 'No se pudo activar la cuenta.')
      case 'olvido':
        return correr(async () => {
          const r = await window.api.sesion.cuenta('olvido', { email: e })
          if (r.ok) ir('restablecer', r.mensaje)
          else setError(r.mensaje)
        }, 'No se pudo pedir el código.')
      case 'restablecer':
        return correr(
          async () => tratarSesion(await window.api.sesion.cuenta('restablecer', { email: e, code: codigo.trim(), password })),
          'No se pudo cambiar la contraseña.'
        )
    }
  }

  const reenviar = (): Promise<void> =>
    correr(async () => {
      const r = await window.api.sesion.cuenta(modo === 'restablecer' ? 'olvido' : 'reenviar', { email: email.trim() })
      if (r.ok) setAviso(r.mensaje)
      else setError(r.mensaje)
    }, 'No se pudo reenviar el código.')

  const cambiarServidor = (): Promise<void> =>
    correr(async () => {
      const r = await window.api.sesion.fijarServidor(urlNueva)
      if (r.ok) {
        setEditandoServidor(false)
        onServidor(r.estado)
      } else setError(r.mensaje)
    }, 'No se pudo cambiar el servidor.')

  const entrarConGoogle = (): Promise<void> => correr(async () => tratarSesion(await window.api.sesion.iniciarConGoogle()), 'No se pudo completar el acceso con Google.')

  const pideCodigo = modo === 'codigo' || modo === 'restablecer'
  const pidePassword = modo === 'entrar' || modo === 'registrar' || modo === 'restablecer'
  const boton: Record<Modo, string> = { entrar: 'Entrar', registrar: 'Crear cuenta', codigo: 'Activar cuenta', olvido: 'Enviar código', restablecer: 'Cambiar contraseña' }

  return (
    <div className="modal-fondo">
      <form
        className="modal modal-chico"
        aria-label={TITULOS[modo]}
        onSubmit={(ev) => {
          ev.preventDefault()
          if (completo[modo]) void enviar()
        }}
      >
        <div className="modal-cab">
          <h3>{TITULOS[modo]}</h3>
        </div>
        {modo === 'entrar' || modo === 'registrar' ? (
          <p className="modal-texto">
            Tus proyectos y agentes viven en el servidor ({servidor}){' '}
            <button type="button" className="icono" disabled={enviando} onClick={() => setEditandoServidor(!editandoServidor)}>
              {editandoServidor ? 'cancelar' : 'cambiar'}
            </button>
          </p>
        ) : (
          <p className="modal-texto">
            {modo === 'codigo' && 'Escribe el código de 6 dígitos que te enviamos por correo.'}
            {modo === 'olvido' && 'Te enviaremos un código para elegir una contraseña nueva. Se cerrará la sesión en todos tus equipos.'}
            {modo === 'restablecer' && 'Escribe el código del correo y tu nueva contraseña.'}
          </p>
        )}
        {editandoServidor && (
          <label style={{ maxWidth: 'none' }}>
            Dirección del servidor
            <input value={urlNueva} placeholder="https://api.midominio.com" onChange={(e) => setUrlNueva(e.target.value)} />
            <span className="ayuda">
              <button type="button" disabled={enviando || !urlNueva.trim()} onClick={() => void cambiarServidor()}>
                Usar este servidor
              </button>
            </span>
          </label>
        )}
        {!servidorSeguro(servidor) && (
          <p className="tareas-error-texto" role="alert">
            Este servidor no usa https y no es de esta máquina: la app no enviará tu contraseña. Cambia a una dirección https://.
          </p>
        )}
        <label style={{ maxWidth: 'none' }}>
          Correo
          <input type="email" autoFocus={!pideCodigo} autoComplete="username" value={email} disabled={pideCodigo && enviando} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {pideCodigo && (
          <label style={{ maxWidth: 'none' }}>
            Código
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            />
            <span className="ayuda">
              Vence en 15 minutos.{' '}
              <button type="button" className="icono" disabled={enviando || !correoOk} onClick={() => void reenviar()}>
                Enviar otro
              </button>
            </span>
          </label>
        )}
        {pidePassword && (
          <label style={{ maxWidth: 'none' }}>
            {modo === 'restablecer' ? 'Contraseña nueva' : 'Contraseña'}
            <span style={{ position: 'relative', display: 'block' }}>
              <input
                type={verPassword ? 'text' : 'password'}
                autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', paddingRight: 36, boxSizing: 'border-box' }}
              />
              <button
                type="button"
                aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verPassword}
                onClick={() => setVerPassword(!verPassword)}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  padding: 4,
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {verPassword ? (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  ) : (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </span>
            {modo !== 'entrar' && <span className="ayuda">Mínimo 8 caracteres.</span>}
          </label>
        )}
        {modo === 'entrar' && googleListo && (
          <button type="button" disabled={enviando} onClick={() => void entrarConGoogle()}>
            {enviando ? 'Esperando al navegador…' : 'Continuar con Google'}
          </button>
        )}
        {aviso && !error && <p className="modal-texto">{aviso}</p>}
        {error && (
          <p className="tareas-error-texto" role="alert">
            {error}
          </p>
        )}
        <div className="cfg-acciones">
          <button className="primario" type="submit" disabled={!completo[modo] || enviando}>
            {enviando ? 'Trabajando…' : boton[modo]}
          </button>
          {modo === 'entrar' && (
            <>
              <button type="button" disabled={enviando} onClick={() => ir('registrar')}>
                Crear cuenta
              </button>
              <button type="button" className="icono" disabled={enviando} onClick={() => ir('olvido')}>
                ¿Olvidaste tu contraseña?
              </button>
            </>
          )}
          {modo !== 'entrar' && (
            <button type="button" disabled={enviando} onClick={() => ir('entrar')}>
              Volver
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
