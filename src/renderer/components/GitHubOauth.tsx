import { useEffect, useRef, useState } from 'react'
import { URL_CREAR_OAUTH, type CodigoDispositivo, type EstadoGitHub } from '@shared/github'
import { mensajeDe } from '../tareas/useTareas'

const gh = window.api.github.operar
const abrir = (url: string): void => void window.api.navegador.externo(url).catch(() => undefined)

interface Props {
  gha: EstadoGitHub
  /** Se conectó (o cambió la configuración): el estado nuevo de GitHub. */
  onEstado: (e: EstadoGitHub, conectado: boolean) => void
  onError: (mensaje: string) => void
}

/**
 * «Iniciar sesión con GitHub»: pide un código, lo muestra y abre github.com/login/device; mientras el usuario lo autoriza en el
 * navegador, la app espera y guarda el token cifrado. Si aún no hay una OAuth App configurada, guía para crearla (una sola vez).
 */
export function GitHubOauth({ gha, onEstado, onError }: Props) {
  const [codigo, setCodigo] = useState<CodigoDispositivo | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [clientId, setClientId] = useState('')
  const [configurando, setConfigurando] = useState(!gha.oauth)
  const [guardando, setGuardando] = useState(false)
  const cancelado = useRef(false)

  // Al salir de la pantalla no se deja una espera abierta en main.
  useEffect(
    () => () => {
      if (codigo) void gh('dispositivoCancelar', {}).catch(() => undefined)
    },
    [codigo]
  )

  const iniciar = async (): Promise<void> => {
    cancelado.current = false
    onError('')
    try {
      const c = await gh('dispositivoIniciar', {})
      setCodigo(c)
      abrir(c.urlVerificacion)
      const estado = await gh('dispositivoEsperar', {})
      setCodigo(null)
      onEstado(estado, true)
    } catch (e) {
      setCodigo(null)
      if (!cancelado.current) onError(mensajeDe(e))
    }
  }

  const cancelar = (): void => {
    cancelado.current = true
    setCodigo(null)
    void gh('dispositivoCancelar', {}).catch(() => undefined)
  }

  const copiar = (): void => {
    if (!codigo) return
    void navigator.clipboard.writeText(codigo.codigoUsuario).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    })
  }

  const guardar = async (id: string): Promise<void> => {
    setGuardando(true)
    onError('')
    try {
      const e = await gh('configurarOauth', { clientId: id })
      onEstado(e, false)
      setClientId('')
      setConfigurando(!e.oauth)
    } catch (err) {
      onError(mensajeDe(err))
    } finally {
      setGuardando(false)
    }
  }

  if (codigo) {
    return (
      <div className="oa-caja" role="status" aria-live="polite">
        <p className="oa-paso">Escribe este código en GitHub para autorizar la app:</p>
        <div className="oa-codigo" aria-label={`Código ${codigo.codigoUsuario}`}>
          {codigo.codigoUsuario.split('').map((c, i) => (
            <span key={i} className={c === '-' ? 'oa-guion' : 'oa-letra'}>
              {c}
            </span>
          ))}
        </div>
        <div className="oa-acciones">
          <button onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar código'}</button>
          <button className="primario" onClick={() => abrir(codigo.urlVerificacion)}>
            Abrir GitHub ↗
          </button>
        </div>
        <p className="vc-nota oa-espera">
          <span className="spinner" /> Esperando que lo autorices… (caduca en {Math.round(codigo.expiraEn / 60)} min)
        </p>
        <button className="peligro" onClick={cancelar}>
          Cancelar
        </button>
      </div>
    )
  }

  return (
    <div className="oa-caja">
      {gha.oauth && (
        <>
          <button className="primario oa-entrar" onClick={() => void iniciar()}>
            Iniciar sesión con GitHub
          </button>
          <p className="vc-nota">Se abre GitHub, escribes un código y listo: sin copiar tokens. Puedes revocar el acceso cuando quieras en GitHub → Settings → Applications.</p>
        </>
      )}
      {configurando ? (
        <div className="oa-config">
          <p className="oa-paso">Para entrar con un código, crea una vez una «OAuth App» propia (es gratis y tarda un minuto):</p>
          <ol className="gh-pasos">
            <li>
              En GitHub crea una OAuth App: nombre <code>Odesk Agent</code>, cualquier URL en «Homepage» y en «Callback».
              <div>
                <button onClick={() => abrir(URL_CREAR_OAUTH)}>Crear OAuth App ↗</button>
              </div>
            </li>
            <li>
              Marca <strong>«Enable Device Flow»</strong>. «Expire user access tokens» puede quedar marcado: la app renueva la sesión sola. Guarda.
            </li>
            <li>Copia el <strong>Client ID</strong> (no hace falta el secreto) y pégalo aquí.</li>
          </ol>
          <form
            className="td-fila"
            onSubmit={(e) => {
              e.preventDefault()
              void guardar(clientId)
            }}
          >
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (Iv1.… u Ov23…)" autoComplete="off" spellCheck={false} aria-label="Client ID de la OAuth App" />
            <button className="primario" type="submit" disabled={guardando || !clientId.trim()}>
              Guardar
            </button>
            {gha.oauth && (
              <button type="button" onClick={() => setConfigurando(false)}>
                Cancelar
              </button>
            )}
          </form>
        </div>
      ) : (
        <button className="enlace oa-cambiar" onClick={() => setConfigurando(true)}>
          Cambiar el Client ID
        </button>
      )}
    </div>
  )
}
