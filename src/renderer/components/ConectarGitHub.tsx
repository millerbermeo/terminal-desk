import { useState } from 'react'
import { URL_CREAR_TOKEN, type EstadoGitHub } from '@shared/github'
import { mensajeDe } from '../tareas/useTareas'
import { GitHubOauth } from './GitHubOauth'

const gh = window.api.github.operar
const abrir = (url: string): void => void window.api.navegador.externo(url).catch(() => undefined)

interface Props {
  gha: EstadoGitHub
  /** Cambió el estado (se conectó o se configuró el inicio de sesión por código). */
  onEstado: (e: EstadoGitHub, conectado: boolean) => void
  /** Hay un error que mostrar arriba (cadena vacía para quitarlo). */
  onError: (mensaje: string) => void
  /** Deshabilita el formulario mientras la pantalla hace otra cosa. */
  bloqueado?: boolean
}

/** Las dos formas de conectar GitHub: iniciar sesión con un código (OAuth) o pegar un token. */
export function ConectarGitHub({ gha, onEstado, onError, bloqueado = false }: Props) {
  const [token, setToken] = useState('')
  const [conectando, setConectando] = useState(false)

  const conectar = async (): Promise<void> => {
    setConectando(true)
    onError('')
    try {
      const r = await gh('conectar', { token })
      setToken('')
      onEstado(r, true)
    } catch (e) {
      onError(mensajeDe(e))
    } finally {
      setConectando(false)
    }
  }

  return (
    <>
      <GitHubOauth gha={gha} onError={onError} onEstado={onEstado} />
      <p className="oa-o">o con un token</p>
      <ol className="gh-pasos">
        <li>
          Crea un token en GitHub (se abre con los permisos <code>repo</code> y <code>workflow</code> ya marcados).
          <div>
            <button onClick={() => abrir(URL_CREAR_TOKEN)}>Crear token en GitHub ↗</button>
          </div>
        </li>
        <li>Pulsa «Generate token» en GitHub, copia el token y pégalo aquí.</li>
      </ol>
      <form
        className="td-fila"
        onSubmit={(e) => {
          e.preventDefault()
          void conectar()
        }}
      >
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… o github_pat_…" autoComplete="off" spellCheck={false} aria-label="Token de GitHub" />
        <button className="primario" type="submit" disabled={bloqueado || conectando || !token.trim()}>
          {conectando ? 'Conectando…' : 'Conectar'}
        </button>
      </form>
      <p className="vc-nota">El token se guarda cifrado con el llavero de tu sistema y no sale de esta máquina salvo hacia GitHub. Puedes revocarlo cuando quieras en GitHub → Settings → Tokens.</p>
    </>
  )
}
