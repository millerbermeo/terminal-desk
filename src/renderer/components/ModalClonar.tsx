import { useEffect, useMemo, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import type { RepoGitHub } from '@shared/github'
import { mensajeDe } from '../tareas/useTareas'
import { leerPreferencias } from '../github/preferencias'
import { IconoCarpeta } from './Iconos'

interface Props {
  datos: DatosProyectos
  conectado: boolean
  onCerrar: () => void
  /** Se clonó y se registró como proyecto. */
  onClonado: (proyectoId: string) => void
  /** Repositorio con el que se abre (`propietario/repo`). */
  repoInicial?: string
}

const gh = window.api.github.operar

/** Clona un repositorio (de tu cuenta de GitHub, o por URL / propietario/repo) en una carpeta y lo agrega como proyecto. */
export function ModalClonar({ datos, conectado, onCerrar, onClonado, repoInicial }: Props) {
  const pref = leerPreferencias() // protocolo, carpeta y grupo elegidos en la sección GitHub
  const [repo, setRepo] = useState(repoInicial ?? '')
  const [carpeta, setCarpeta] = useState(pref.carpeta)
  const [protocolo, setProtocolo] = useState<'https' | 'ssh'>(pref.protocolo)
  const [grupo, setGrupo] = useState(datos.grupos.some((g) => g.id === pref.grupo) ? pref.grupo : '')
  const [repos, setRepos] = useState<RepoGitHub[] | null>(null)
  const [error, setError] = useState('')
  const [clonando, setClonando] = useState(false)

  useEffect(() => {
    if (!conectado) return
    let vigente = true
    gh('repos', {})
      .then((r) => vigente && setRepos(r))
      .catch((e) => vigente && (setRepos([]), setError(mensajeDe(e))))
    return () => {
      vigente = false
    }
  }, [conectado])
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !clonando) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, clonando])

  const sugeridos = useMemo(() => {
    const t = repo.trim().toLowerCase()
    return (repos ?? []).filter((r) => !t || r.completo.toLowerCase().includes(t)).slice(0, 8)
  }, [repos, repo])
  const completo = repo.trim() !== '' && carpeta.trim() !== ''

  const examinar = (): void => void window.api.proyectos.elegirCarpetas().then((r) => r[0] && setCarpeta(r[0]))
  const clonar = async (): Promise<void> => {
    if (!completo || clonando) return
    setClonando(true)
    setError('')
    try {
      const r = await gh('clonar', { repo, carpetaPadre: carpeta, protocolo, ...(grupo ? { grupoId: grupo } : {}) })
      try {
        localStorage.setItem('odesk.clonar.padre', carpeta.trim()) // la próxima vez ya está puesta
      } catch {
        // sin almacenamiento
      }
      onClonado(r.proyectoId)
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e))
      setClonando(false)
    }
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !clonando && onCerrar()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Clonar repositorio"
        onSubmit={(e) => {
          e.preventDefault()
          void clonar()
        }}
      >
        <div className="modal-cab">
          <h3>Clonar un repositorio</h3>
          <button type="button" className="icono" onClick={onCerrar} aria-label="Cerrar" disabled={clonando}>
            ✕
          </button>
        </div>
        <p className="modal-texto">Descarga el repositorio en una carpeta y lo agrega como proyecto. Para los privados, conecta antes tu cuenta (Versiones → GitHub) o usa una clave SSH.</p>
        <label style={{ maxWidth: 'none' }}>
          Repositorio
          <input autoFocus value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="propietario/repo, https://github.com/… o git@github.com:…" spellCheck={false} />
        </label>
        {conectado && (
          <div className="gh-repos" role="listbox" aria-label="Tus repositorios">
            {repos === null && <p className="vc-nota">Cargando tus repositorios…</p>}
            {repos?.length === 0 && !error && <p className="vc-nota">No se encontraron repositorios en tu cuenta.</p>}
            {sugeridos.map((r) => (
              <button type="button" key={r.id} role="option" aria-selected={repo === r.completo} className={`gh-repo${repo === r.completo ? ' sel' : ''}`} onClick={() => setRepo(r.completo)}>
                <strong>{r.completo}</strong>
                {r.privado && <span className="chip">privado</span>}
                {r.descripcion && <span className="tareas-suave">{r.descripcion}</span>}
              </button>
            ))}
          </div>
        )}
        <label style={{ maxWidth: 'none' }}>
          Carpeta donde clonar
          <span className="td-fila">
            <input value={carpeta} onChange={(e) => setCarpeta(e.target.value)} placeholder="~/dev" spellCheck={false} />
            <button type="button" onClick={examinar}>
              <IconoCarpeta /> Examinar
            </button>
          </span>
          <span className="ayuda">Se crea una subcarpeta con el nombre del repositorio.</span>
        </label>
        <div className="td-rejilla">
          <label>
            Protocolo
            <select value={protocolo} onChange={(e) => setProtocolo(e.target.value as 'https' | 'ssh')}>
              <option value="https">HTTPS (usa tu token conectado)</option>
              <option value="ssh">SSH (usa tu clave)</option>
            </select>
          </label>
          <label>
            Grupo del proyecto
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
              <option value="">Sin grupo</option>
              {datos.grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="tareas-error-texto" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{error}</p>}
        <div className="cfg-acciones">
          <button className="primario" type="submit" disabled={!completo || clonando}>
            {clonando ? 'Clonando…' : 'Clonar'}
          </button>
          <button type="button" onClick={onCerrar} disabled={clonando}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
