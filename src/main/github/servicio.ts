import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  HOST_GITHUB,
  analizarRemoto,
  analizarRepoEscrito,
  nombreRepoValido,
  urlHttps,
  urlSsh,
  type EstadoGitHub,
  type Issue,
  type MetodoFusion,
  type PullRequest,
  type RemotoGitHub,
  type RepoGitHub,
  type ResumenCI
} from '@shared/github'
import { git } from '../core/git/git'
import { Repositorio, type ProveedorCredenciales } from '../core/git/repositorio'
import { explicarError } from '../core/git/analisis'
import { asegurarAskpass } from './askpass'
import { API_GITHUB, ClienteGitHub, ErrorGitHub, aIssue, aPr, aRepo, resumirCI } from './cliente'
import type { AlmacenToken } from './token'

export interface DepsGitHub {
  token: AlmacenToken
  /** Carpeta del proyecto (falla si ya no existe). */
  carpetaDe(proyectoId: string): Promise<string>
  /** Registra una carpeta como proyecto y devuelve su id. */
  agregarProyecto(ruta: string, nombre: string, grupoId?: string): Promise<{ id: string }>
  /** Carpeta de datos de la aplicación (ahí vive el script de credenciales). */
  dirDatos: string
  /** Servidor de la API REST (GitHub Enterprise o pruebas). */
  api?: string
  /** Servidor de los remotos que se considera GitHub. */
  host?: string
  /** Resuelve un alias de `~/.ssh/config` al servidor real. */
  resolverHost?: (host: string) => Promise<string>
}

const SIN_CONEXION = 'Conecta tu cuenta de GitHub primero (Versiones → GitHub).'

/** `ssh -G <alias>` imprime la configuración efectiva sin conectar: de ahí sale el `hostname` real de un alias como «github-trabajo». */
export function resolverAliasSsh(host: string): Promise<string> {
  if (!/^[\w.-]+$/.test(host) || host.startsWith('-')) return Promise.resolve(host)
  return new Promise((ok) => {
    execFile('ssh', ['-G', host], { timeout: 3000 }, (err, salida) => {
      const m = err ? null : /^hostname (\S+)$/m.exec(String(salida))
      ok((m?.[1] ?? host).toLowerCase())
    })
  })
}

const sinSalto = (v: unknown, campo: string, max = 300): string => {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) throw new Error(`Falta ${campo}.`)
  if (t.length > max || /[\r\n\0]/.test(t)) throw new Error(`${campo[0]!.toUpperCase()}${campo.slice(1)} no válido.`)
  return t
}
const textoLargo = (v: unknown, max = 60_000): string => (typeof v === 'string' ? v.slice(0, max) : '')

/**
 * GitHub para los proyectos: conexión con un token (guardado cifrado), repositorios, clonar, publicar, pull requests, incidencias y CI.
 * También da a git las credenciales de GitHub (vía GIT_ASKPASS) para que enviar y traer funcionen por https sin configurar nada.
 */
export class ServicioGitHub {
  private readonly hosts = new Map<string, string>()
  private readonly api: string
  private readonly hostGitHub: string

  constructor(private readonly d: DepsGitHub) {
    this.api = d.api ?? process.env.ODESK_GITHUB_API ?? API_GITHUB
    this.hostGitHub = (d.host ?? process.env.ODESK_GITHUB_HOST ?? HOST_GITHUB).toLowerCase()
  }

  private async hostReal(host: string): Promise<string> {
    const h = host.toLowerCase()
    if (h === this.hostGitHub) return h
    const guardado = this.hosts.get(h)
    if (guardado) return guardado
    // `ssh.github.com` es el acceso SSH de GitHub por el puerto 443 (muy común en ~/.ssh/config): es el mismo GitHub.
    const resuelto = await (this.d.resolverHost ?? resolverAliasSsh)(h)
    const real = resuelto === `ssh.${this.hostGitHub}` ? this.hostGitHub : resuelto
    this.hosts.set(h, real)
    return real
  }

  private async cliente(): Promise<ClienteGitHub> {
    const t = await this.d.token.leer()
    if (!t) throw new Error(SIN_CONEXION)
    return new ClienteGitHub(t.token, this.api)
  }

  private async repositorio(proyectoId: string): Promise<Repositorio> {
    return new Repositorio(await this.d.carpetaDe(String(proyectoId)), (url) => this.credencialesPara(url))
  }

  /**
   * Variables de entorno para que git se autentique con GitHub por https. Solo para el servidor de GitHub configurado y solo si hay
   * un token conectado: a ningún otro remoto se le da el token.
   */
  credencialesPara: ProveedorCredenciales = async (urlRemoto) => {
    if (!/^https:\/\//i.test(urlRemoto)) return undefined
    const a = analizarRemoto(urlRemoto)
    if (!a || a.host !== this.hostGitHub) return undefined
    const t = await this.d.token.leer()
    if (!t) return undefined
    return { GIT_ASKPASS: await asegurarAskpass(this.d.dirDatos), ODESK_GITHUB_TOKEN: t.token }
  }

  /** El remoto del proyecto que apunta a GitHub (`origin` si lo hay, si no el primero). */
  private async remoto(repo: Repositorio): Promise<RemotoGitHub | undefined> {
    let remotos
    try {
      remotos = await repo.remotos()
    } catch {
      return undefined // no es un repositorio
    }
    const ordenados = [...remotos].sort((a, b) => Number(b.nombre === 'origin') - Number(a.nombre === 'origin'))
    for (const r of ordenados) {
      // `remotos()` oculta las credenciales de la URL; para analizar el servidor y el repo basta.
      const a = analizarRemoto(r.url)
      if (!a) continue
      const host = await this.hostReal(a.host)
      return { nombre: r.nombre, url: r.url, host, propietario: a.propietario, repo: a.repo, esGitHub: host === this.hostGitHub }
    }
    return undefined
  }

  private async repoGitHub(proyectoId: string): Promise<{ propietario: string; repo: string; ruta: string; r: Repositorio }> {
    const r = await this.repositorio(proyectoId)
    const remoto = await this.remoto(r)
    if (!remoto?.esGitHub) throw new Error('Este proyecto no tiene un remoto de GitHub. Publícalo primero (Versiones → GitHub → Publicar en GitHub).')
    return { propietario: remoto.propietario, repo: remoto.repo, ruta: `/repos/${encodeURIComponent(remoto.propietario)}/${encodeURIComponent(remoto.repo)}`, r }
  }

  // ---------------------------------------------------------------- cuenta

  async estado(proyectoId?: string): Promise<EstadoGitHub> {
    const t = await this.d.token.leer()
    const base: EstadoGitHub = { conectado: Boolean(t), persistente: t?.persistente ?? false, host: this.hostGitHub, ...(t?.usuario ? { usuario: { usuario: t.usuario } } : {}) }
    if (!proyectoId) return base
    const remoto = await this.remoto(await this.repositorio(proyectoId)).catch(() => undefined)
    if (!remoto) return base
    const e: EstadoGitHub = { ...base, remoto }
    if (t && remoto.esGitHub) {
      try {
        e.repo = aRepo(await new ClienteGitHub(t.token, this.api).pedir('GET', `/repos/${encodeURIComponent(remoto.propietario)}/${encodeURIComponent(remoto.repo)}`))
      } catch (err) {
        e.errorRepo = (err as Error).message
      }
    }
    return e
  }

  async conectar(token: unknown): Promise<EstadoGitHub> {
    const t = typeof token === 'string' ? token.trim() : ''
    if (!t || /\s/.test(t) || t.length > 500) throw new Error('Pega el token completo, sin espacios.')
    const u = await new ClienteGitHub(t, this.api).pedir<{ login?: string; name?: string }>('GET', '/user')
    if (!u?.login) throw new Error('GitHub no devolvió el usuario de ese token.')
    await this.d.token.guardar(t, u.login)
    return { ...(await this.estado()), usuario: { usuario: u.login, ...(u.name ? { nombre: u.name } : {}) } }
  }

  async desconectar(): Promise<EstadoGitHub> {
    await this.d.token.borrar()
    return this.estado()
  }

  // ---------------------------------------------------------------- repositorios

  async repos(texto?: string): Promise<RepoGitHub[]> {
    const c = await this.cliente()
    const lista = await c.pedir<unknown[]>('GET', '/user/repos', { consulta: { sort: 'pushed', per_page: 100, affiliation: 'owner,collaborator,organization_member' } })
    const t = (texto ?? '').trim().toLowerCase()
    return lista.map(aRepo).filter((r) => !t || r.completo.toLowerCase().includes(t) || r.descripcion.toLowerCase().includes(t))
  }

  async clonar(entrada: { repo: unknown; carpetaPadre: unknown; protocolo?: unknown; grupoId?: unknown }): Promise<{ proyectoId: string; ruta: string }> {
    const escrito = sinSalto(entrada.repo, 'el repositorio', 500)
    const local = /^(file:\/\/|\/|[a-zA-Z]:[\\/])/.test(escrito) // un repositorio de esta misma máquina
    const a = local ? undefined : analizarRepoEscrito(escrito)
    if (!a && !local) throw new Error('Escribe el repositorio como «propietario/repo» o con su URL (https o ssh).')
    const esUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(escrito) || /^[^/\s]+@[^/\s]+:/.test(escrito)
    const protocolo = entrada.protocolo === 'ssh' ? 'ssh' : 'https'
    const url = local || esUrl ? escrito : protocolo === 'ssh' ? urlSsh(a!, this.hostGitHub) : urlHttps(a!, this.hostGitHub)
    if (url.startsWith('-')) throw new Error('Dirección no válida.')
    const escritaPadre = typeof entrada.carpetaPadre === 'string' ? entrada.carpetaPadre.trim() : ''
    const padre = escritaPadre === '~' || escritaPadre.startsWith('~/') ? join(homedir(), escritaPadre.slice(1)) : escritaPadre
    if (!padre || !isAbsolute(padre)) throw new Error('Elige la carpeta donde se clonará (ruta completa).')
    if (!(await stat(padre).then((s) => s.isDirectory(), () => false))) throw new Error('La carpeta elegida no existe.')
    const nombre = nombreRepoValido(a ? a.repo : (escrito.replace(/[\\/]+$/, '').replace(/\.git$/, '').split(/[\\/]/).pop() ?? ''))
    const destino = resolve(padre, nombre)
    if (await stat(destino).then(() => true, () => false)) {
      if ((await readdir(destino).catch(() => ['x'])).length > 0) throw new Error(`Ya existe «${destino}» y no está vacía. Elige otra carpeta.`)
    }
    const env = (await this.credencialesPara(url)) ?? {}
    const r = await git(padre, ['clone', '--', url, destino], { timeoutMs: 15 * 60_000, env })
    if (r.sinGit) throw new Error('Git no está instalado o no está en el PATH.')
    if (!r.ok) throw new Error(explicarError(r.stderr, 'clone'))
    const p = await this.d.agregarProyecto(destino, nombre, typeof entrada.grupoId === 'string' && entrada.grupoId ? entrada.grupoId : undefined)
    return { proyectoId: p.id, ruta: destino }
  }

  async crearRepo(entrada: { proyectoId: string; nombre: unknown; descripcion?: unknown; privado?: unknown; organizacion?: unknown; protocolo?: unknown }): Promise<EstadoGitHub> {
    const c = await this.cliente()
    const repo = await this.repositorio(entrada.proyectoId)
    const estado = await repo.estado()
    if (!estado.repo) throw new Error('Este proyecto aún no usa git: inicialízalo primero (pestaña Cambios).')
    if (estado.sinCommits) throw new Error('Haz primero un commit: GitHub necesita algo que recibir.')
    if (estado.remotos.includes('origin')) throw new Error('Este proyecto ya tiene un remoto «origin». Quítalo o usa otro nombre antes de publicarlo.')
    const nombre = nombreRepoValido(sinSalto(entrada.nombre, 'el nombre', 100))
    const org = typeof entrada.organizacion === 'string' && entrada.organizacion.trim() ? entrada.organizacion.trim() : undefined
    if (org && !/^[\w.-]+$/.test(org)) throw new Error('Nombre de organización no válido.')
    const creado = aRepo(
      await c.pedir('POST', org ? `/orgs/${encodeURIComponent(org)}/repos` : '/user/repos', {
        cuerpo: { name: nombre, description: textoLargo(entrada.descripcion, 350), private: entrada.privado !== false, auto_init: false }
      })
    )
    const url = entrada.protocolo === 'ssh' ? creado.urlSsh : creado.urlHttps
    try {
      await repo.agregarRemoto('origin', url)
      await repo.enviar('origin')
    } catch (err) {
      throw new Error(`El repositorio se creó en GitHub (${creado.url}) pero no se pudo enviar el código: ${(err as Error).message}\nPuedes enviarlo después desde Versiones.`, { cause: err })
    }
    return this.estado(entrada.proyectoId)
  }

  // ---------------------------------------------------------------- pull requests

  async prs(proyectoId: string, estado: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    const c = await this.cliente()
    const { ruta } = await this.repoGitHub(proyectoId)
    const s = ['open', 'closed', 'all'].includes(estado) ? estado : 'open'
    return (await c.pedir<unknown[]>('GET', `${ruta}/pulls`, { consulta: { state: s, sort: 'updated', direction: 'desc', per_page: 50 } })).map(aPr)
  }

  async prActual(proyectoId: string): Promise<{ pr: PullRequest | null; ci?: ResumenCI }> {
    const c = await this.cliente()
    const { propietario, ruta, r } = await this.repoGitHub(proyectoId)
    const rama = (await r.estado()).rama
    if (!rama) return { pr: null }
    const lista = await c.pedir<unknown[]>('GET', `${ruta}/pulls`, { consulta: { head: `${propietario}:${rama}`, state: 'open', per_page: 1 } })
    if (lista.length === 0) return { pr: null }
    const pr = aPr(lista[0])
    return { pr, ci: await this.resumenCI(c, ruta, rama) }
  }

  async crearPr(entrada: { proyectoId: string; titulo: unknown; cuerpo?: unknown; base?: unknown; borrador?: unknown }): Promise<PullRequest> {
    const c = await this.cliente()
    const { ruta, r } = await this.repoGitHub(entrada.proyectoId)
    const titulo = sinSalto(entrada.titulo, 'el título', 256)
    const estado = await r.estado()
    if (!estado.rama) throw new Error('Estás en un commit suelto: cambia a una rama para abrir un pull request.')
    const base = typeof entrada.base === 'string' && entrada.base.trim() ? entrada.base.trim() : aRepo(await c.pedir('GET', ruta)).ramaPorDefecto
    if (estado.rama === base) throw new Error(`Estás en «${base}», que es la rama de destino. Crea una rama para tus cambios y vuelve a intentarlo.`)
    // GitHub necesita la rama en el servidor: si es nueva o tiene commits por enviar, se envía antes.
    if (!estado.upstream || estado.adelante > 0) await r.enviar()
    const pr = await c.pedir('POST', `${ruta}/pulls`, { cuerpo: { title: titulo, head: estado.rama, base, body: textoLargo(entrada.cuerpo), draft: entrada.borrador === true } })
    return aPr(pr)
  }

  async fusionarPr(proyectoId: string, numero: unknown, metodo: unknown): Promise<{ mensaje: string }> {
    const n = Number(numero)
    if (!Number.isInteger(n) || n < 1) throw new Error('Número de pull request no válido.')
    const m: MetodoFusion = metodo === 'squash' || metodo === 'rebase' ? metodo : 'merge'
    const c = await this.cliente()
    const { ruta } = await this.repoGitHub(proyectoId)
    const r = await c.pedir<{ message?: string }>('PUT', `${ruta}/pulls/${n}/merge`, { cuerpo: { merge_method: m } })
    return { mensaje: r?.message ?? 'Pull request fusionado.' }
  }

  async traerPr(proyectoId: string, numero: unknown): Promise<{ rama: string }> {
    const n = Number(numero)
    if (!Number.isInteger(n) || n < 1) throw new Error('Número de pull request no válido.')
    const { r } = await this.repoGitHub(proyectoId)
    const estado = await r.traerPullRequest(n)
    return { rama: estado.rama ?? `pr/${n}` }
  }

  // ---------------------------------------------------------------- incidencias y comentarios

  async issues(proyectoId: string, estado: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    const c = await this.cliente()
    const { ruta } = await this.repoGitHub(proyectoId)
    const s = ['open', 'closed', 'all'].includes(estado) ? estado : 'open'
    const lista = await c.pedir<Record<string, unknown>[]>('GET', `${ruta}/issues`, { consulta: { state: s, sort: 'updated', direction: 'desc', per_page: 50 } })
    return lista.filter((i) => !i.pull_request).map(aIssue) // la API mezcla los pull requests con las incidencias
  }

  async crearIssue(entrada: { proyectoId: string; titulo: unknown; cuerpo?: unknown; etiquetas?: unknown }): Promise<Issue> {
    const c = await this.cliente()
    const { ruta } = await this.repoGitHub(entrada.proyectoId)
    const etiquetas = Array.isArray(entrada.etiquetas) ? entrada.etiquetas.filter((e): e is string => typeof e === 'string' && e.trim() !== '').slice(0, 20) : []
    return aIssue(await c.pedir('POST', `${ruta}/issues`, { cuerpo: { title: sinSalto(entrada.titulo, 'el título', 256), body: textoLargo(entrada.cuerpo), ...(etiquetas.length ? { labels: etiquetas } : {}) } }))
  }

  async comentar(proyectoId: string, numero: unknown, texto: unknown): Promise<{ url: string }> {
    const n = Number(numero)
    if (!Number.isInteger(n) || n < 1) throw new Error('Número no válido.')
    const cuerpo = typeof texto === 'string' ? texto.trim() : ''
    if (!cuerpo) throw new Error('Escribe el comentario.')
    const c = await this.cliente()
    const { ruta } = await this.repoGitHub(proyectoId)
    const r = await c.pedir<{ html_url?: string }>('POST', `${ruta}/issues/${n}/comments`, { cuerpo: { body: textoLargo(cuerpo, 65_000) } })
    return { url: r?.html_url ?? '' }
  }

  // ---------------------------------------------------------------- CI

  private async resumenCI(c: ClienteGitHub, ruta: string, ref: string): Promise<ResumenCI> {
    const r = encodeURIComponent(ref)
    try {
      const [checks, estado] = await Promise.all([c.pedir('GET', `${ruta}/commits/${r}/check-runs`, { consulta: { per_page: 50 } }), c.pedir('GET', `${ruta}/commits/${r}/status`)])
      return resumirCI(checks, estado)
    } catch (err) {
      // Una rama que aún no está en GitHub no tiene comprobaciones.
      if (err instanceof ErrorGitHub && (err.estado === 404 || err.estado === 422)) return { estado: 'ninguno', checks: [] }
      throw err
    }
  }

  async ci(proyectoId: string, ref?: unknown): Promise<ResumenCI> {
    const c = await this.cliente()
    const { ruta, r } = await this.repoGitHub(proyectoId)
    const objetivo = typeof ref === 'string' && ref.trim() ? ref.trim() : (await r.estado()).rama
    if (!objetivo) throw new Error('Indica la rama o el commit.')
    return this.resumenCI(c, ruta, objetivo)
  }
}
