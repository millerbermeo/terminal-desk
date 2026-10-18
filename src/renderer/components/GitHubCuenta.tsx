import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActividadGitHub, CuentaGitHub, EstadoGitHub, ItemActividad, OrgGitHub, RepoGitHub, RepoLocal } from '@shared/github'
import type { DatosProyectos } from '@shared/modelos'
import { fechaRelativa } from '@shared/versiones'
import { confirmar } from '../confirmar'
import { guardarPreferencias, leerPreferencias, type PreferenciasGitHub } from '../github/preferencias'
import { mensajeDe } from '../tareas/useTareas'
import { ConectarGitHub } from './ConectarGitHub'
import { EstadoVacio } from './EstadoVacio'
import { IconoCarpeta, IconoGitHub, IconoReiniciar } from './Iconos'
import { ModalClonar } from './ModalClonar'

const gh = window.api.github.operar
const abrir = (url: string): void => void window.api.navegador.externo(url).catch(() => undefined)

const METODO: Record<CuentaGitHub['conexion']['metodo'], { texto: string; ayuda: string }> = {
  oauth: { texto: 'Inicio de sesión por código (OAuth)', ayuda: 'Autorizaste la app desde github.com. Puedes revocar el acceso en GitHub → Settings → Applications.' },
  'token-clasico': { texto: 'Token clásico', ayuda: 'Un token personal (ghp_…). Se revoca en GitHub → Settings → Developer settings → Tokens.' },
  'token-fino': { texto: 'Token de acceso fino', ayuda: 'Un token de acceso fino (github_pat_…): GitHub no informa sus permisos aquí, se revisan en su página.' },
  app: { texto: 'Aplicación de GitHub', ayuda: 'Token de usuario de una GitHub App (ghu_…).' },
  desconocido: { texto: 'Token', ayuda: 'Un token de acceso.' }
}

const fecha = (iso?: string): string => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const soloFecha = (iso?: string): string => (iso ? new Date(iso).toLocaleDateString('es', { dateStyle: 'long' }) : '—')

function Avatar({ url, nombre, grande = false }: { url?: string; nombre: string; grande?: boolean }) {
  const [falla, setFalla] = useState(false)
  const clase = `gc-avatar${grande ? ' grande' : ''}`
  if (!url || falla) return <span className={clase} aria-hidden="true">{nombre.charAt(0).toUpperCase()}</span>
  return <img className={clase} src={url} alt="" onError={() => setFalla(true)} />
}

function Tarjeta({ titulo, derecha, children, ancha = false }: { titulo: string; derecha?: React.ReactNode; children: React.ReactNode; ancha?: boolean }) {
  return (
    <section className={`cfg-grupo gc-tarjeta${ancha ? ' ancha' : ''}`}>
      <div className="cfg-grupo-cab">
        <h3>{titulo}</h3>
        {derecha}
      </div>
      <div className="gc-cuerpo">{children}</div>
    </section>
  )
}

function Dato({ k, v, ayuda }: { k: string; v: React.ReactNode; ayuda?: string }) {
  return (
    <div className="gc-dato" title={ayuda}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

function ListaActividad({ items, vacio }: { items: ItemActividad[]; vacio: string }) {
  if (items.length === 0) return <p className="vc-nota gc-vacio">{vacio}</p>
  return (
    <ul className="gc-actividad">
      {items.map((i) => (
        <li key={i.url}>
          <button className="gc-item" onClick={() => abrir(i.url)} title={i.url}>
            <span className="gc-item-titulo">{i.titulo}</span>
            <span className="gc-item-meta">
              <span className="mono">{i.repo}#{i.numero}</span>
              {i.borrador && <span className="chip">borrador</span>}
              {i.etiquetas.slice(0, 3).map((e) => (
                <span key={e} className="chip">
                  {e}
                </span>
              ))}
              {i.comentarios > 0 && <small>💬 {i.comentarios}</small>}
              <small>{fechaRelativa(i.actualizada)}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

type TipoRepo = 'todos' | 'privados' | 'publicos' | 'forks' | 'archivados' | 'aqui' | 'no-clonados'
type PestanaActividad = 'misPrs' | 'revisiones' | 'incidencias'

interface Props {
  datos: DatosProyectos
  /** Se agregó un proyecto (al clonar): la aplicación refresca su lista. */
  onDatos: (d: DatosProyectos) => void
}

/**
 * La cuenta de GitHub conectada: perfil, cómo está conectada (permisos, caducidad, límite de peticiones), organizaciones, lo pendiente
 * (pull requests, revisiones, incidencias), tus repositorios (cuáles ya están en este equipo, clonar) y las preferencias de clonado.
 */
export function GitHubCuenta({ datos, onDatos }: Props) {
  const [estado, setEstado] = useState<EstadoGitHub | null>(null)
  const [cuenta, setCuenta] = useState<CuentaGitHub | null>(null)
  const [orgs, setOrgs] = useState<OrgGitHub[] | null>(null)
  const [actividad, setActividad] = useState<ActividadGitHub | null>(null)
  const [repos, setRepos] = useState<RepoGitHub[] | null>(null)
  const [locales, setLocales] = useState<RepoLocal[]>([])
  const [pagina, setPagina] = useState(1)
  const [hayMas, setHayMas] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [fallo, setFallo] = useState('')
  const [aviso, setAviso] = useState('')
  const [cargando, setCargando] = useState(false)
  const [prefs, setPrefs] = useState<PreferenciasGitHub>(leerPreferencias)
  const [pestana, setPestana] = useState<PestanaActividad>('misPrs')
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<TipoRepo>('todos')
  const [clonar, setClonar] = useState<{ repo?: string } | null>(null)
  const [clientId, setClientId] = useState('')
  const [editandoOauth, setEditandoOauth] = useState(false)

  const error = (clave: string) => (e: unknown): void => setErrores((x) => ({ ...x, [clave]: mensajeDe(e) }))

  const cargar = useCallback(async (): Promise<void> => {
    setCargando(true)
    setErrores({})
    try {
      const e = await gh('estado', {})
      setEstado(e)
      setFallo('')
      if (!e.conectado) {
        setCuenta(null)
        setOrgs(null)
        setActividad(null)
        setRepos(null)
        return
      }
      await Promise.all([
        gh('cuenta', {}).then(setCuenta).catch(error('cuenta')),
        gh('orgs', {}).then(setOrgs).catch(error('orgs')),
        gh('actividad', {}).then(setActividad).catch(error('actividad')),
        gh('repos', { pagina: 1 })
          .then((r) => (setRepos(r), setPagina(1), setHayMas(r.length >= 100)))
          .catch(error('repos')),
        gh('reposLocales', {}).then(setLocales).catch(() => setLocales([]))
      ])
    } catch (e) {
      setFallo(mensajeDe(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const masRepos = async (): Promise<void> => {
    try {
      const r = await gh('repos', { pagina: pagina + 1 })
      setRepos((x) => [...(x ?? []), ...r])
      setPagina(pagina + 1)
      setHayMas(r.length >= 100)
    } catch (e) {
      error('repos')(e)
    }
  }

  const cambiarPref = (p: Partial<PreferenciasGitHub>): void => {
    guardarPreferencias(p)
    setPrefs(leerPreferencias())
  }

  const desconectar = async (cambiarCuenta: boolean): Promise<void> => {
    const ok = await confirmar({
      titulo: cambiarCuenta ? '¿Cambiar de cuenta de GitHub?' : '¿Desconectar GitHub?',
      etiqueta: cambiarCuenta ? 'Desconectar y cambiar' : 'Desconectar',
      tono: 'aviso',
      texto: `Se borra el acceso guardado en este equipo; tus repositorios y proyectos no se tocan.\n\nSi lo quieres revocar del todo, hazlo también en GitHub → Settings (${cuenta?.conexion.metodo === 'oauth' ? 'Applications' : 'Tokens'}). Si iniciaste sesión en otros equipos con tu bóveda de claves, allí sigue conectado hasta que lo desconectes también.`
    })
    if (!ok) return
    try {
      setEstado(await gh('desconectar', {}))
      setCuenta(null)
      setOrgs(null)
      setActividad(null)
      setRepos(null)
      setAviso(cambiarCuenta ? 'Desconectado: conecta la otra cuenta.' : 'GitHub desconectado.')
    } catch (e) {
      setFallo(mensajeDe(e))
    }
  }

  const guardarOauth = async (id: string): Promise<void> => {
    try {
      setEstado(await gh('configurarOauth', { clientId: id }))
      setClientId('')
      setEditandoOauth(false)
      setAviso(id ? 'Client ID guardado.' : 'Inicio de sesión por código desactivado.')
      void gh('cuenta', {}).then(setCuenta).catch(() => undefined)
    } catch (e) {
      error('oauth')(e)
    }
  }

  const copiarUrl = (r: RepoGitHub): void => {
    void navigator.clipboard.writeText(prefs.protocolo === 'ssh' ? r.urlSsh : r.urlHttps).then(() => setAviso(`URL de ${r.completo} copiada (${prefs.protocolo.toUpperCase()}).`))
  }

  const aqui = useMemo(() => new Map(locales.map((l) => [l.completo, l])), [locales])
  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return (repos ?? []).filter((r) => {
      if (t && !`${r.completo} ${r.descripcion} ${r.lenguaje ?? ''}`.toLowerCase().includes(t)) return false
      const local = aqui.has(r.completo.toLowerCase())
      switch (tipo) {
        case 'privados':
          return r.privado
        case 'publicos':
          return !r.privado
        case 'forks':
          return r.fork
        case 'archivados':
          return r.archivado
        case 'aqui':
          return local
        case 'no-clonados':
          return !local
        default:
          return true
      }
    })
  }, [repos, texto, tipo, aqui])

  if (!estado) return <div className="config gc">{fallo ? <p className="vc-nota error">{fallo}</p> : <p className="tareas-vacio">Cargando…</p>}</div>

  if (!estado.conectado) {
    return (
      <div className="config gc">
        <div className="cfg-cab">
          <h2>GitHub</h2>
        </div>
        <EstadoVacio icono={<IconoGitHub />} titulo="Conecta tu cuenta de GitHub" texto="Con tu cuenta puedes ver tus repositorios, clonarlos, publicar proyectos, abrir pull requests y revisar lo pendiente sin salir de la app. El asistente también puede hacerlo por ti." />
        {aviso && <p className="vc-nota hv-ok" role="status">✓ {aviso}</p>}
        <section className="cfg-grupo" style={{ maxWidth: 620 }}>
          <div className="vc-form">
            {fallo && <p className="vc-nota error" role="alert">{fallo}</p>}
            <ConectarGitHub
              gha={estado}
              onError={setFallo}
              onEstado={(e, conectado) => {
                setEstado(e)
                if (conectado) {
                  setAviso(`Conectado como ${e.usuario?.usuario ?? 'tu cuenta'}.`)
                  void cargar()
                }
              }}
            />
          </div>
        </section>
      </div>
    )
  }

  const p = cuenta?.perfil
  const c = cuenta?.conexion
  const faltaRepo = c?.permisos && !c.permisos.includes('repo')
  const items = actividad?.[pestana] ?? []

  return (
    <div className="config gc">
      <div className="gc-cab">
        <Avatar url={p?.avatar} nombre={p?.usuario ?? estado.usuario?.usuario ?? '?'} grande />
        <div className="gc-cab-datos">
          <h2>{p?.nombre ?? p?.usuario ?? estado.usuario?.usuario}</h2>
          <p className="vc-nota">
            <span className="mono">@{p?.usuario ?? estado.usuario?.usuario}</span> · {estado.host}
            {p?.tipoCuenta && p.tipoCuenta !== 'User' ? ` · ${p.tipoCuenta}` : ''}
          </p>
        </div>
        <span className="ag-espacio" />
        {p?.url && <button onClick={() => abrir(p.url)}>Abrir perfil ↗</button>}
        <button className="icono" onClick={() => void cargar()} disabled={cargando} title="Actualizar" aria-label="Actualizar">
          {cargando ? <span className="spinner" /> : <IconoReiniciar />}
        </button>
      </div>
      {aviso && <p className="vc-nota hv-ok" role="status">✓ {aviso}</p>}
      {fallo && <p className="vc-nota error">{fallo}</p>}

      <div className="gc-rejilla">
        <Tarjeta titulo="Perfil">
          {errores.cuenta ? (
            <p className="vc-nota error">{errores.cuenta}</p>
          ) : !p ? (
            <p className="tareas-vacio">Cargando…</p>
          ) : (
            <>
              {p.bio && <p className="gc-bio">{p.bio}</p>}
              <dl className="gc-datos">
                <Dato k="Repositorios públicos" v={p.reposPublicos} />
                {p.reposPrivados !== undefined && <Dato k="Repositorios privados" v={p.reposPrivados} />}
                <Dato k="Seguidores" v={p.seguidores} />
                <Dato k="Siguiendo" v={p.siguiendo} />
                <Dato k="Miembro desde" v={soloFecha(p.creada)} />
                {p.correo && <Dato k="Correo público" v={p.correo} />}
                {p.empresa && <Dato k="Empresa" v={p.empresa} />}
                {p.ubicacion && <Dato k="Ubicación" v={p.ubicacion} />}
                {p.sitio && <Dato k="Sitio" v={<button className="enlace" onClick={() => abrir(/^https?:\/\//.test(p.sitio!) ? p.sitio! : `https://${p.sitio}`)}>{p.sitio}</button>} />}
              </dl>
              <p className="vc-nota">Para cambiar tu nombre, foto o correo hazlo en tu perfil de GitHub.</p>
            </>
          )}
        </Tarjeta>

        <Tarjeta
          titulo="Conexión"
          derecha={
            <span className="gc-acciones">
              <button onClick={() => void desconectar(true)}>Cambiar de cuenta</button>
              <button className="peligro" onClick={() => void desconectar(false)}>
                Desconectar
              </button>
            </span>
          }
        >
          {!c ? (
            <p className="tareas-vacio">Cargando…</p>
          ) : (
            <>
              <dl className="gc-datos">
                <Dato k="Método" v={METODO[c.metodo].texto} ayuda={METODO[c.metodo].ayuda} />
                <Dato k="Servidor" v={c.host} />
                <Dato k="Guardado" v={<span className={`chip ${c.persistente ? 'chip-ok' : 'chip-aviso'}`}>{c.persistente ? 'cifrado en este equipo' : 'solo en esta sesión'}</span>} ayuda={c.persistente ? 'Con el llavero del sistema.' : 'Tu sistema no ofrece un llavero seguro: se pierde al cerrar la app.'} />
                <Dato k="Sesión" v={c.renovable ? <span className="chip chip-ok">se renueva sola</span> : <span className="chip">no caduca</span>} />
                {c.expira && <Dato k="El acceso actual caduca" v={fecha(c.expira)} />}
                {c.refrescaHasta && <Dato k="Renovable hasta" v={fecha(c.refrescaHasta)} />}
              </dl>
              <div className="gc-permisos">
                <strong>Permisos del token</strong>
                {c.permisos === null ? (
                  <p className="vc-nota">GitHub no informa los permisos de los tokens de acceso fino. Revísalos en su página de GitHub.</p>
                ) : c.permisos.length === 0 ? (
                  <p className="vc-nota">Sin permisos especiales (solo datos públicos).</p>
                ) : (
                  <div className="chips-sel">
                    {c.permisos.map((x) => (
                      <span key={x} className="chip mono">
                        {x}
                      </span>
                    ))}
                  </div>
                )}
                {faltaRepo && <p className="vc-nota error">Falta el permiso «repo»: no podrás ver ni clonar repositorios privados ni abrir pull requests. Reconecta con un token que lo incluya.</p>}
              </div>
              {c.limite && (
                <div className="gc-limite" title={`Se restablece a las ${new Date(c.limite.reinicia).toLocaleTimeString('es')}.`}>
                  <span>
                    Peticiones a GitHub: <b>{c.limite.restantes}</b> de {c.limite.total}
                  </span>
                  <div className="hl-uso" style={{ width: '100%' }}>
                    <i style={{ width: `${Math.round((c.limite.restantes / c.limite.total) * 100)}%` }} />
                  </div>
                </div>
              )}
              <div className="gc-enlaces">
                <button onClick={() => abrir(c.metodo === 'oauth' ? 'https://github.com/settings/applications' : 'https://github.com/settings/tokens')}>
                  {c.metodo === 'oauth' ? 'Gestionar el acceso en GitHub ↗' : 'Gestionar tokens en GitHub ↗'}
                </button>
                <button onClick={() => abrir('https://github.com/settings/profile')}>Editar mi perfil ↗</button>
              </div>
              <div className="gc-oauth">
                <strong>Inicio de sesión por código</strong>
                {editandoOauth ? (
                  <form
                    className="td-fila"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void guardarOauth(clientId)
                    }}
                  >
                    <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID de tu OAuth App (Ov23…)" autoComplete="off" spellCheck={false} aria-label="Client ID" />
                    <button className="primario" type="submit" disabled={!clientId.trim()}>
                      Guardar
                    </button>
                    <button type="button" onClick={() => setEditandoOauth(false)}>
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <span className="gc-acciones">
                    <span className={`chip ${c.oauth ? 'chip-ok' : ''}`}>{c.oauth ? 'Client ID configurado' : 'sin configurar'}</span>
                    <button onClick={() => setEditandoOauth(true)}>{c.oauth ? 'Cambiar' : 'Configurar'}</button>
                    {c.oauth && (
                      <button className="peligro" onClick={() => void guardarOauth('')}>
                        Quitar
                      </button>
                    )}
                  </span>
                )}
                {errores.oauth && <p className="vc-nota error">{errores.oauth}</p>}
              </div>
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo="Preferencias de clonado">
          <p className="vc-nota">Valen para este equipo: se usan al clonar un repositorio o un proyecto de tu cuenta.</p>
          <div className="gc-form">
            <label>
              Protocolo
              <select value={prefs.protocolo} onChange={(e) => cambiarPref({ protocolo: e.target.value as 'https' | 'ssh' })}>
                <option value="https">HTTPS (usa tu cuenta conectada)</option>
                <option value="ssh">SSH (usa tu clave)</option>
              </select>
            </label>
            <label>
              Carpeta donde clonar
              <span className="td-fila">
                <input value={prefs.carpeta} onChange={(e) => cambiarPref({ carpeta: e.target.value })} placeholder="~/dev (vacío = preguntar)" spellCheck={false} />
                <button type="button" onClick={() => void window.api.proyectos.elegirCarpetas().then((r) => r[0] && cambiarPref({ carpeta: r[0] }))}>
                  <IconoCarpeta /> Examinar
                </button>
              </span>
            </label>
            <label>
              Grupo de los proyectos clonados
              <select value={datos.grupos.some((g) => g.id === prefs.grupo) ? prefs.grupo : ''} onChange={(e) => cambiarPref({ grupo: e.target.value })}>
                <option value="">Sin grupo</option>
                {datos.grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Tarjeta>

        <Tarjeta titulo={`Organizaciones${orgs ? ` (${orgs.length})` : ''}`}>
          {errores.orgs ? (
            <p className="vc-nota error">{errores.orgs}</p>
          ) : !orgs ? (
            <p className="tareas-vacio">Cargando…</p>
          ) : orgs.length === 0 ? (
            <p className="vc-nota gc-vacio">No perteneces a ninguna organización (o el token no tiene el permiso para verlas).</p>
          ) : (
            <ul className="gc-orgs">
              {orgs.map((o) => (
                <li key={o.login}>
                  <button className="gc-org" onClick={() => abrir(o.url)} title={o.url}>
                    <Avatar url={o.avatar} nombre={o.login} />
                    <span>
                      <b>{o.login}</b>
                      {o.descripcion && <small>{o.descripcion}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta
          titulo="Pendiente en GitHub"
          ancha
          derecha={
            <div className="segmentado" role="tablist" aria-label="Qué mostrar">
              {([['misPrs', 'Mis pull requests'], ['revisiones', 'Piden mi revisión'], ['incidencias', 'Incidencias asignadas']] as const).map(([id, nombre]) => (
                <button key={id} role="tab" aria-selected={pestana === id} className={pestana === id ? 'on' : ''} onClick={() => setPestana(id)}>
                  {nombre}
                  {actividad && actividad[id].length > 0 && <span className="vc-cuenta">{actividad[id].length}</span>}
                </button>
              ))}
            </div>
          }
        >
          {errores.actividad ? <p className="vc-nota error">{errores.actividad}</p> : !actividad ? <p className="tareas-vacio">Cargando…</p> : <ListaActividad items={items} vacio={pestana === 'misPrs' ? 'No tienes pull requests abiertos.' : pestana === 'revisiones' ? 'Nadie te ha pedido revisión.' : 'No tienes incidencias asignadas.'} />}
        </Tarjeta>

        <Tarjeta
          titulo={`Mis repositorios${repos ? ` (${visibles.length}${visibles.length !== repos.length ? ` de ${repos.length}` : ''}${hayMas ? '+' : ''})` : ''}`}
          ancha
          derecha={
            <button className="primario" onClick={() => setClonar({})}>
              Clonar…
            </button>
          }
        >
          <div className="gc-filtros">
            <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre, descripción o lenguaje…" aria-label="Buscar repositorio" spellCheck={false} />
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoRepo)} aria-label="Filtrar repositorios">
              <option value="todos">Todos</option>
              <option value="aqui">Ya en este equipo</option>
              <option value="no-clonados">Aún no clonados</option>
              <option value="privados">Privados</option>
              <option value="publicos">Públicos</option>
              <option value="forks">Forks</option>
              <option value="archivados">Archivados</option>
            </select>
          </div>
          {errores.repos ? (
            <p className="vc-nota error">{errores.repos}</p>
          ) : !repos ? (
            <p className="tareas-vacio">Cargando…</p>
          ) : visibles.length === 0 ? (
            <p className="vc-nota gc-vacio">{repos.length === 0 ? 'No hay repositorios en tu cuenta.' : 'Ningún repositorio coincide.'}</p>
          ) : (
            <ul className="gc-repos">
              {visibles.map((r) => {
                const local = aqui.get(r.completo.toLowerCase())
                return (
                  <li key={r.id} className="gc-repo">
                    <div className="gc-repo-datos">
                      <div className="gc-repo-titulo">
                        <button className="enlace" onClick={() => abrir(r.url)} title="Abrir en GitHub">
                          <b>{r.completo}</b>
                        </button>
                        <span className={`chip ${r.privado ? '' : 'chip-ok'}`}>{r.privado ? 'privado' : 'público'}</span>
                        {r.fork && <span className="chip">fork</span>}
                        {r.archivado && <span className="chip chip-aviso">archivado</span>}
                      </div>
                      {r.descripcion && <p className="gc-repo-desc">{r.descripcion}</p>}
                      <p className="gc-repo-meta">
                        {r.lenguaje && <span>● {r.lenguaje}</span>}
                        {r.estrellas > 0 && <span>★ {r.estrellas}</span>}
                        {r.forks > 0 && <span>⑂ {r.forks}</span>}
                        {r.incidenciasAbiertas > 0 && <span>{r.incidenciasAbiertas} incidencias</span>}
                        <span>rama {r.ramaPorDefecto}</span>
                        <span>actualizado {fechaRelativa(r.actualizado)}</span>
                      </p>
                    </div>
                    <div className="gc-repo-acciones">
                      {local ? (
                        <span className="chip chip-ok" title={`Es el proyecto «${local.proyecto}» de este equipo`}>
                          ✓ en este equipo · {local.proyecto}
                        </span>
                      ) : (
                        <button className="primario" onClick={() => setClonar({ repo: r.completo })}>
                          Clonar
                        </button>
                      )}
                      <button className="icono" onClick={() => copiarUrl(r)} title={`Copiar la URL (${prefs.protocolo.toUpperCase()})`} aria-label={`Copiar la URL de ${r.completo}`}>
                        ⧉
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {hayMas && !errores.repos && (
            <button className="gc-mas" onClick={() => void masRepos()}>
              Cargar más repositorios
            </button>
          )}
        </Tarjeta>
      </div>

      {clonar && (
        <ModalClonar
          datos={datos}
          conectado
          {...(clonar.repo ? { repoInicial: clonar.repo } : {})}
          onCerrar={() => setClonar(null)}
          onClonado={() => {
            void window.api.proyectos.listar().then(onDatos)
            void gh('reposLocales', {}).then(setLocales).catch(() => undefined)
            setAviso('Repositorio clonado y agregado como proyecto.')
          }}
        />
      )}
    </div>
  )
}
