import { useEffect, useState } from 'react'
import { URL_CREAR_TOKEN, nombreRepoValido, type EstadoGitHub, type Issue, type MetodoFusion, type PullRequest, type ResumenCI } from '@shared/github'
import { fechaRelativa } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import { git, type ContextoGit } from '../versiones/useGit'
import { EstadoVacio } from './EstadoVacio'
import { IconoGlobo, IconoMas, IconoRama } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'
import { ModalFormulario } from './ModalFormulario'

const gh = window.api.github.operar
const abrir = (url: string): void => void window.api.navegador.externo(url).catch(() => undefined)

const ETIQUETA_CI: Record<ResumenCI['estado'], string> = { exito: '✓ Comprobaciones correctas', fallo: '✗ Fallan comprobaciones', pendiente: '⏳ Comprobaciones en curso', ninguno: 'Sin comprobaciones' }
const CLASE_CI: Record<ResumenCI['estado'], string> = { exito: 'chip-ok', fallo: 'api-estado-servidor', pendiente: 'chip-aviso', ninguno: '' }

function EstadoCI({ ci }: { ci: ResumenCI }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="gh-ci">
      <button className={`chip ${CLASE_CI[ci.estado]}`} onClick={() => setAbierto(!abierto)} aria-expanded={abierto} disabled={ci.checks.length === 0}>
        {ETIQUETA_CI[ci.estado]} {ci.checks.length > 0 && `(${ci.checks.length})`}
      </button>
      {abierto && (
        <ul className="gh-checks">
          {ci.checks.map((c) => (
            <li key={c.nombre}>
              <span className={`chip ${c.estado === 'exito' ? 'chip-ok' : c.estado === 'fallo' ? 'api-estado-servidor' : c.estado === 'pendiente' ? 'chip-aviso' : ''}`}>{c.estado}</span>{' '}
              {c.url ? (
                <button className="enlace" onClick={() => abrir(c.url!)}>
                  {c.nombre}
                </button>
              ) : (
                c.nombre
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Dialogo = { tipo: 'desconectar' } | { tipo: 'fusionar'; pr: PullRequest } | { tipo: 'issue' } | null

/** GitHub del proyecto: cuenta conectada con un token, publicar el repositorio, pull request de la rama, listas e incidencias. */
export function VersionesGitHub({ c }: { c: ContextoGit }) {
  const { proyectoId, estado, run, avisar, ocupado, tick } = c
  const [gha, setGha] = useState<EstadoGitHub | null>(null)
  const [token, setToken] = useState('')
  const [prActual, setPrActual] = useState<{ pr: PullRequest | null; ci?: ResumenCI } | null>(null)
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [fallo, setFallo] = useState('')
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [metodo, setMetodo] = useState<MetodoFusion>('squash')
  const [pub, setPub] = useState({ nombre: '', descripcion: '', privado: true, organizacion: '', protocolo: 'https' as 'https' | 'ssh' })
  const [nuevoPr, setNuevoPr] = useState({ titulo: '', cuerpo: '', borrador: false })
  const bloqueado = ocupado !== ''

  useEffect(() => {
    let vigente = true
    gh('estado', { proyectoId })
      .then((e) => vigente && (setGha(e), setFallo('')))
      .catch((e) => vigente && setFallo(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [proyectoId, tick])

  const hayRepo = Boolean(gha?.conectado && gha.remoto?.esGitHub && gha.repo)
  useEffect(() => {
    if (!hayRepo) return void (setPrActual(null), setPrs([]), setIssues([]))
    let vigente = true
    Promise.all([gh('prActual', { proyectoId }), gh('prs', { proyectoId }), gh('issues', { proyectoId })])
      .then(([a, p, i]) => vigente && (setPrActual(a), setPrs(p), setIssues(i)))
      .catch((e) => vigente && setFallo(mensajeDe(e)))
    return () => {
      vigente = false
    }
  }, [hayRepo, proyectoId, tick, estado.rama])

  // Valores por defecto de los formularios: el nombre del proyecto y el asunto del último commit.
  useEffect(() => {
    git('historial', { proyectoId, limite: 1 }).then((r) => setNuevoPr((n) => (n.titulo ? n : { ...n, titulo: r.commits[0]?.asunto ?? '' }))).catch(() => undefined)
    setPub((p) => (p.nombre ? p : { ...p, nombre: nombreRepoValido(estado.raiz?.split('/').pop() ?? 'proyecto') }))
  }, [proyectoId, estado.raiz, estado.rama])

  const actualizar = (): void => void c.recargar()

  if (!gha) return fallo ? <p className="vc-nota error" style={{ padding: 24 }}>{fallo}</p> : <p className="tareas-vacio">Cargando…</p>

  if (!gha.conectado) {
    return (
      <div className="vc-pagina">
        <EstadoVacio
          icono={<IconoGlobo />}
          titulo="Conecta tu cuenta de GitHub"
          texto="Con tu cuenta conectada puedes clonar repositorios, publicar este proyecto, abrir pull requests y revisar incidencias y el CI sin salir de la app. El asistente también puede hacerlo por ti."
        />
        <section className="cfg-grupo" style={{ maxWidth: 620, margin: '0 auto' }}>
          <div className="vc-form">
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
                void run('Conectando…', () => gh('conectar', { token })).then((r) => {
                  if (!r) return
                  setGha(r)
                  setToken('')
                  avisar(`Conectado como ${r.usuario?.usuario ?? 'tu cuenta'}.`)
                  actualizar()
                })
              }}
            >
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… o github_pat_…" autoComplete="off" spellCheck={false} aria-label="Token de GitHub" />
              <button className="primario" type="submit" disabled={bloqueado || !token.trim()}>
                Conectar
              </button>
            </form>
            <p className="vc-nota">El token se guarda cifrado con el llavero de tu sistema y no sale de esta máquina salvo hacia GitHub. Puedes revocarlo cuando quieras en GitHub → Settings → Tokens.</p>
          </div>
        </section>
      </div>
    )
  }

  const remoto = gha.remoto
  const rama = estado.rama
  const esBase = Boolean(rama && gha.repo && rama === gha.repo.ramaPorDefecto)

  return (
    <div className="vc-pagina">
      {fallo && <p className="vc-nota error">{fallo}</p>}

      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>Cuenta</h3>
          <button className="peligro" disabled={bloqueado} onClick={() => setDialogo({ tipo: 'desconectar' })}>
            Desconectar
          </button>
        </div>
        <div className="cfg-proyecto">
          <IconoGlobo />
          <strong>@{gha.usuario?.usuario ?? 'conectado'}</strong>
          <span className="rec-desc">{gha.host}</span>
          <span className={`chip ${gha.persistente ? 'chip-ok' : 'chip-aviso'}`} title={gha.persistente ? 'Guardado cifrado con el llavero del sistema' : 'Tu sistema no ofrece un llavero seguro: el token solo se mantiene mientras la aplicación esté abierta'}>
            {gha.persistente ? 'token guardado' : 'solo en esta sesión'}
          </span>
        </div>
      </section>

      <section className="cfg-grupo">
        <div className="cfg-grupo-cab">
          <h3>Repositorio</h3>
          {gha.repo && <button onClick={() => abrir(gha.repo!.url)}>Abrir en GitHub ↗</button>}
        </div>
        {remoto?.esGitHub && gha.repo ? (
          <div className="cfg-proyecto vc-rama-fila">
            <IconoRama />
            <strong className="vc-rama-nombre">{gha.repo.completo}</strong>
            <span className="chip">{gha.repo.privado ? 'privado' : 'público'}</span>
            <span className="rec-desc">{gha.repo.descripcion || `rama por defecto: ${gha.repo.ramaPorDefecto}`}</span>
          </div>
        ) : remoto?.esGitHub ? (
          <p className="vc-nota error" style={{ padding: 16 }}>No se pudo leer {remoto.propietario}/{remoto.repo}: {gha.errorRepo}</p>
        ) : remoto ? (
          <p className="vc-nota" style={{ padding: 16 }}>El remoto «{remoto.nombre}» apunta a <code>{remoto.host}</code>, que no es GitHub. Las funciones de GitHub no aplican a este proyecto.</p>
        ) : (
          <form
            className="vc-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run('Publicando en GitHub…', () => gh('crearRepo', { proyectoId, nombre: pub.nombre, descripcion: pub.descripcion, privado: pub.privado, protocolo: pub.protocolo, ...(pub.organizacion.trim() ? { organizacion: pub.organizacion.trim() } : {}) })).then((r) => {
                if (!r) return
                avisar('Repositorio creado y código enviado a GitHub.')
                actualizar()
              })
            }}
          >
            <p className="vc-nota">Este proyecto aún no está en GitHub. Crea el repositorio, se enlaza como <code>origin</code> y se envía la rama actual.</p>
            {estado.sinCommits && <p className="vc-nota error">Haz primero un commit (pestaña Cambios): GitHub necesita algo que recibir.</p>}
            <label>
              Nombre del repositorio
              <input value={pub.nombre} onChange={(e) => setPub({ ...pub, nombre: e.target.value })} />
            </label>
            <label>
              Descripción (opcional)
              <input value={pub.descripcion} onChange={(e) => setPub({ ...pub, descripcion: e.target.value })} />
            </label>
            <div className="td-rejilla">
              <label>
                Organización (opcional)
                <input value={pub.organizacion} onChange={(e) => setPub({ ...pub, organizacion: e.target.value })} placeholder="tu cuenta personal" />
              </label>
              <label>
                Protocolo del remoto
                <select value={pub.protocolo} onChange={(e) => setPub({ ...pub, protocolo: e.target.value as 'https' | 'ssh' })}>
                  <option value="https">HTTPS (usa tu token)</option>
                  <option value="ssh">SSH (usa tu clave)</option>
                </select>
              </label>
            </div>
            <div className="vc-commit-pie">
              <label className="vc-casilla">
                <input type="checkbox" checked={pub.privado} onChange={(e) => setPub({ ...pub, privado: e.target.checked })} /> Privado
              </label>
              <button className="primario" type="submit" disabled={bloqueado || estado.sinCommits || !pub.nombre.trim()}>
                Crear y publicar
              </button>
            </div>
          </form>
        )}
      </section>

      {hayRepo && prActual && rama && (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>Pull request de «{rama}»</h3>
            {prActual.ci && <EstadoCI ci={prActual.ci} />}
          </div>
          {prActual.pr ? (
            <div className="cfg-proyecto vc-rama-fila">
              <IconoRama />
              <strong className="vc-rama-nombre">#{prActual.pr.numero}</strong>
              <span className="rec-desc">
                {prActual.pr.titulo} → {prActual.pr.base}
              </span>
              {prActual.pr.borrador && <span className="chip chip-aviso">borrador</span>}
              <span className="vc-acciones visibles">
                <button onClick={() => abrir(prActual.pr!.url)}>Abrir ↗</button>
                <select value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoFusion)} aria-label="Cómo fusionar" title="Cómo se fusiona">
                  <option value="squash">Squash</option>
                  <option value="merge">Merge</option>
                  <option value="rebase">Rebase</option>
                </select>
                <button className="primario" disabled={bloqueado || prActual.pr.borrador} title={prActual.pr.borrador ? 'Es un borrador: márcalo como listo en GitHub' : undefined} onClick={() => setDialogo({ tipo: 'fusionar', pr: prActual.pr! })}>
                  Fusionar…
                </button>
              </span>
            </div>
          ) : esBase ? (
            <p className="vc-nota" style={{ padding: 16 }}>Estás en «{rama}», la rama principal del repositorio. Crea una rama para tus cambios (pestaña Ramas) y podrás abrir un pull request desde ella.</p>
          ) : (
            <form
              className="vc-form"
              onSubmit={(e) => {
                e.preventDefault()
                void run('Creando pull request…', () => gh('crearPr', { proyectoId, titulo: nuevoPr.titulo, cuerpo: nuevoPr.cuerpo, borrador: nuevoPr.borrador })).then((pr) => {
                  if (!pr) return
                  avisar(`Pull request #${pr.numero} creado.`)
                  setNuevoPr({ titulo: '', cuerpo: '', borrador: false })
                  actualizar()
                })
              }}
            >
              <p className="vc-nota">
                No hay un pull request para «{rama}» hacia «{gha.repo?.ramaPorDefecto}».{estado.adelante > 0 || !estado.upstream ? ' La rama se enviará antes a GitHub.' : ''}
              </p>
              <label>
                Título
                <input value={nuevoPr.titulo} onChange={(e) => setNuevoPr({ ...nuevoPr, titulo: e.target.value })} />
              </label>
              <label>
                Descripción
                <textarea rows={4} value={nuevoPr.cuerpo} onChange={(e) => setNuevoPr({ ...nuevoPr, cuerpo: e.target.value })} placeholder="Qué cambia, por qué y cómo probarlo…" />
              </label>
              <div className="vc-commit-pie">
                <label className="vc-casilla">
                  <input type="checkbox" checked={nuevoPr.borrador} onChange={(e) => setNuevoPr({ ...nuevoPr, borrador: e.target.checked })} /> Abrir como borrador
                </label>
                <button className="primario" type="submit" disabled={bloqueado || !nuevoPr.titulo.trim() || estado.sinCommits}>
                  Crear pull request
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {hayRepo && (
        <>
          <section className="cfg-grupo">
            <div className="cfg-grupo-cab">
              <h3>
                Pull requests abiertos <small>{prs.filter((p) => p.estado === 'abierta').length}</small>
              </h3>
            </div>
            {prs.length === 0 && <EstadoVacio variante="compacto" icono={<IconoRama />} titulo="Sin pull requests abiertos" texto="Cuando abras uno aparecerá aquí." />}
            {prs.map((p) => (
              <div className="cfg-proyecto vc-rama-fila" key={p.numero}>
                <strong className="vc-rama-nombre">#{p.numero}</strong>
                <span className="rec-desc">
                  {p.titulo} · {p.rama} → {p.base} · {p.autor} · {fechaRelativa(p.actualizada)}
                </span>
                {p.borrador && <span className="chip chip-aviso">borrador</span>}
                <span className="vc-acciones visibles">
                  <button onClick={() => abrir(p.url)}>Abrir ↗</button>
                  <button disabled={bloqueado} title="Trae su rama y cambia a ella para revisarla" onClick={() => void run('Trayendo el pull request…', () => gh('traerPr', { proyectoId, numero: p.numero })).then((r) => r && (avisar(`Ahora estás en «${r.rama}».`), actualizar()))}>
                    Traer rama
                  </button>
                </span>
              </div>
            ))}
          </section>

          <section className="cfg-grupo">
            <div className="cfg-grupo-cab">
              <h3>
                Incidencias abiertas <small>{issues.length}</small>
              </h3>
              <button disabled={bloqueado} onClick={() => setDialogo({ tipo: 'issue' })}>
                <IconoMas /> Nueva incidencia
              </button>
            </div>
            {issues.length === 0 && <EstadoVacio variante="compacto" icono={<IconoGlobo />} titulo="Sin incidencias abiertas" texto="Las incidencias del repositorio aparecerán aquí." />}
            {issues.map((i) => (
              <div className="cfg-proyecto vc-rama-fila" key={i.numero}>
                <strong className="vc-rama-nombre">#{i.numero}</strong>
                <span className="rec-desc">
                  {i.titulo} · {i.autor} · {fechaRelativa(i.actualizada)}
                </span>
                {i.etiquetas.slice(0, 3).map((e) => (
                  <span key={e} className="chip">
                    {e}
                  </span>
                ))}
                <span className="vc-acciones visibles">
                  <button onClick={() => abrir(i.url)}>Abrir ↗</button>
                </span>
              </div>
            ))}
          </section>
        </>
      )}

      {dialogo?.tipo === 'desconectar' && (
        <ModalConfirmar
          titulo="Desconectar GitHub"
          texto="Se borra el token de este equipo. No se revoca en GitHub: hazlo en GitHub → Settings → Tokens si ya no lo vas a usar."
          etiqueta="Desconectar"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() => void run('Desconectando…', () => gh('desconectar', {})).then((r) => r && (setGha(r), avisar('Cuenta desconectada.')))}
        />
      )}
      {dialogo?.tipo === 'fusionar' && (
        <ModalConfirmar
          titulo={`Fusionar #${dialogo.pr.numero}`}
          texto={`Se fusiona «${dialogo.pr.titulo}» en ${dialogo.pr.base} con ${metodo === 'squash' ? 'squash (un solo commit)' : metodo === 'rebase' ? 'rebase' : 'un commit de merge'}. En GitHub no se puede deshacer del todo (solo revertir).`}
          etiqueta="Fusionar"
          onCerrar={() => setDialogo(null)}
          onConfirmar={() => void run('Fusionando…', () => gh('fusionarPr', { proyectoId, numero: dialogo.pr.numero, metodo })).then((r) => r && (avisar(r.mensaje), actualizar()))}
        />
      )}
      {dialogo?.tipo === 'issue' && (
        <ModalFormulario
          titulo="Nueva incidencia"
          campos={[
            { id: 'titulo', etiqueta: 'Título', obligatorio: true },
            { id: 'cuerpo', etiqueta: 'Descripción', multilinea: true },
            { id: 'etiquetas', etiqueta: 'Etiquetas (separadas por comas, deben existir)', placeholder: 'bug, ui' }
          ]}
          etiquetaBoton="Crear incidencia"
          onCerrar={() => setDialogo(null)}
          onEnviar={async (v) => {
            const etiquetas = (v.etiquetas ?? '').split(',').map((x) => x.trim()).filter(Boolean)
            const i = await run('Creando incidencia…', () => gh('crearIssue', { proyectoId, titulo: v.titulo!, cuerpo: v.cuerpo ?? '', ...(etiquetas.length ? { etiquetas } : {}) }))
            if (i) (avisar(`Incidencia #${i.numero} creada.`), actualizar())
            return Boolean(i)
          }}
        />
      )}
    </div>
  )
}
