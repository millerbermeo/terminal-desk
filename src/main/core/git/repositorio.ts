import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  enConflicto,
  preparados,
  validarNombreRef,
  validarRutaRepo,
  type ArchivoCambio,
  type Commit,
  type DetalleCommit,
  type DiffArchivo,
  type EstadoGit,
  type Etiqueta,
  type Identidad,
  type OperacionEnCurso,
  type Rama,
  type Remoto,
  type ResultadoCambioConflicto,
  type ResultadoRemoto,
  type Stash
} from '@shared/versiones'
import {
  FORMATO_ETIQUETAS,
  FORMATO_LOG,
  FORMATO_RAMAS,
  analizarArchivosCommit,
  analizarEstado,
  analizarNumstat,
  analizarEtiquetas,
  analizarLog,
  analizarRamas,
  analizarRemotos,
  analizarStashes,
  explicarError
} from './analisis'
import { git, type OpcionesGit, type ResultadoGit } from './git'

const MSG_SIN_GIT = 'Git no está instalado o no está en el PATH. Instálalo (https://git-scm.com) y reinicia la aplicación.'
const MAX_DIFF = 400_000
const HASH = /^[0-9a-fA-F]{4,64}$/
const NOMBRE_REMOTO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/

// Las escrituras de un mismo repositorio van de una en una: dos operaciones a la vez se pelean por `index.lock`.
const colas = new Map<string, Promise<unknown>>()
function enCola<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const p = (colas.get(clave) ?? Promise.resolve()).then(fn, fn)
  colas.set(clave, p.catch(() => undefined))
  return p
}

const existe = (ruta: string): Promise<boolean> => stat(ruta).then(() => true, () => false)

const sinSalto = (t: string, campo: string, max: number): string => {
  const v = typeof t === 'string' ? t.trim() : ''
  if (!v) throw new Error(`Falta ${campo}.`)
  if (v.length > max || /[\r\n\0]/.test(v)) throw new Error(`${campo[0]!.toUpperCase()}${campo.slice(1)} no válido.`)
  return v
}

/**
 * Operaciones de git sobre un proyecto. Todo se ejecuta sin shell, con las rutas como literales y detrás de `--`, y desde la raíz del
 * repositorio (las rutas del estado son relativas a ella, aunque el proyecto sea una subcarpeta).
 */
/** Credenciales para un remoto (variables de entorno para git): solo las da para los servidores que la aplicación conoce. */
export type ProveedorCredenciales = (urlRemoto: string) => Promise<Record<string, string> | undefined>

export type ModoEstado = 'completo' | 'agrupado' | 'ligero'

/** Repositorios cuyo `status` completo no cabe en memoria: se consultan agrupando los archivos sin seguimiento. */
const GRANDES = new Set<string>()

export class Repositorio {
  private raiz?: string

  constructor(
    private readonly carpeta: string,
    private readonly credenciales?: ProveedorCredenciales
  ) {}

  /** Entorno de git para hablar con un remoto (p. ej. el token de GitHub vía GIT_ASKPASS); vacío si no hay credenciales para él. */
  private async entornoRed(remoto?: string): Promise<Record<string, string>> {
    if (!this.credenciales) return {}
    const lista = (await this.g(['remote'])).stdout.split('\n').map((x) => x.trim()).filter(Boolean)
    const nombre = remoto ?? (lista.includes('origin') ? 'origin' : lista[0])
    if (!nombre) return {}
    const r = await this.g(['remote', 'get-url', nombre])
    return r.ok ? ((await this.credenciales(r.stdout.trim())) ?? {}) : {}
  }

  // ---------------------------------------------------------------- base

  private ejecutar(cwd: string, args: readonly string[], o: OpcionesGit = {}): Promise<ResultadoGit> {
    return git(cwd, args, { ...o, env: { GIT_LITERAL_PATHSPECS: '1', ...o.env } })
  }

  private g(args: readonly string[], o?: OpcionesGit): Promise<ResultadoGit> {
    return this.ejecutar(this.raiz ?? this.carpeta, args, o)
  }

  private async ok(args: readonly string[], o?: OpcionesGit): Promise<string> {
    const r = await this.g(args, o)
    if (r.sinGit) throw new Error(MSG_SIN_GIT)
    if (!r.ok) throw new Error(explicarError(r.stderr, args[0]))
    return r.stdout
  }

  private escribir<T>(fn: () => Promise<T>): Promise<T> {
    return enCola(this.carpeta, async () => {
      await this.resolverRaiz()
      return fn()
    })
  }

  /** Raíz del repositorio (`undefined` si la carpeta no está en uno). */
  private async resolverRaiz(): Promise<string | undefined> {
    const r = await this.ejecutar(this.carpeta, ['rev-parse', '--show-toplevel'])
    if (r.sinGit) throw new Error(MSG_SIN_GIT)
    if (!r.ok) {
      this.raiz = undefined
      if (/not a git repository/i.test(r.stderr)) return undefined
      throw new Error(explicarError(r.stderr, 'rev-parse'))
    }
    this.raiz = r.stdout.trim()
    return this.raiz
  }

  private async exigirRepo(): Promise<string> {
    const raiz = await this.resolverRaiz()
    if (!raiz) throw new Error('Esta carpeta no es un repositorio git. Inicialízalo primero.')
    return raiz
  }

  private async operacionEnCurso(): Promise<OperacionEnCurso | undefined> {
    const r = await this.g(['rev-parse', '--absolute-git-dir'])
    if (!r.ok) return undefined
    const dir = r.stdout.trim()
    if ((await existe(join(dir, 'rebase-merge'))) || (await existe(join(dir, 'rebase-apply')))) return 'rebase'
    if (await existe(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
    if (await existe(join(dir, 'REVERT_HEAD'))) return 'revert'
    if (await existe(join(dir, 'MERGE_HEAD'))) return 'fusion'
    return undefined
  }

  private async refExiste(ref: string): Promise<boolean> {
    return (await this.g(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).ok
  }

  private async validarRama(nombre: unknown, comprobar = true): Promise<string> {
    const motivo = validarNombreRef(nombre)
    if (motivo) throw new Error(motivo)
    const n = (nombre as string).trim()
    if (comprobar && !(await this.g(['check-ref-format', '--branch', n])).ok) throw new Error(`«${n}» no es un nombre de rama válido para git.`)
    return n
  }

  private rutas(lista: unknown): string[] {
    if (!Array.isArray(lista) || lista.length === 0) throw new Error('Indica al menos un archivo.')
    if (lista.length > 5000) throw new Error('Demasiados archivos a la vez.')
    return lista.map((r) => {
      const motivo = validarRutaRepo(r)
      if (motivo) throw new Error(motivo)
      return r as string
    })
  }

  private hash(h: unknown): string {
    if (typeof h !== 'string' || !HASH.test(h)) throw new Error('Identificador de commit no válido.')
    return h
  }

  // ---------------------------------------------------------------- estado

  /**
   * `git status`. Lista los archivos sin seguimiento uno a uno (`all`); si el repositorio tiene tantos que la salida no cabe (una carpeta
   * personal convertida en repo, `node_modules` sin ignorar…), recuerda esa carpeta y pasa a agruparlos por directorio (`normal`).
   * `agrupado`: los sin seguimiento por carpeta (más barato). `ligero`: sin archivos sin seguimiento (solo lo versionado): para consultas
   * frecuentes en segundo plano.
   */
  async estado(modoPedido: ModoEstado = 'completo'): Promise<EstadoGit> {
    const raiz = await this.resolverRaiz()
    if (!raiz) return { repo: false, sinCommits: true, adelante: 0, atras: 0, archivos: [], remotos: [] }
    const consultar = (modo: 'all' | 'normal' | 'no'): Promise<ResultadoGit> => this.g(['status', '--porcelain=v2', '--branch', '-z', `--untracked-files=${modo}`], { env: { GIT_OPTIONAL_LOCKS: '0' } })
    let modo: 'all' | 'normal' | 'no' = modoPedido === 'ligero' ? 'no' : modoPedido === 'agrupado' || GRANDES.has(raiz) ? 'normal' : 'all'
    let st = await consultar(modo)
    if (!st.ok && st.desbordado && modo === 'all') {
      GRANDES.add(raiz)
      modo = 'normal'
      st = await consultar(modo)
    }
    if (!st.ok) throw new Error(explicarError(st.stderr, 'status'))
    const a = analizarEstado(st.stdout)
    if (modo === 'normal' && modoPedido === 'completo') a.truncado = true // los sin seguimiento salen agrupados por carpeta
    const remotos = (await this.g(['remote'])).stdout.split('\n').map((x) => x.trim()).filter(Boolean)
    const operacion = await this.operacionEnCurso()
    return {
      repo: true,
      raiz,
      ...(a.rama ? { rama: a.rama } : {}),
      ...(a.desacoplado ? { desacoplado: a.desacoplado } : {}),
      sinCommits: a.sinCommits,
      ...(a.upstream ? { upstream: a.upstream } : {}),
      adelante: a.adelante,
      atras: a.atras,
      ...(operacion ? { operacion } : {}),
      archivos: a.archivos,
      ...(a.truncado ? { truncado: true } : {}),
      remotos
    }
  }

  /** Líneas añadidas y quitadas de lo versionado respecto al último commit, por archivo (vacío si no hay commits o tarda demasiado). */
  async lineasCambiadas(): Promise<Map<string, { mas: number; menos: number }>> {
    const r = await this.g(['diff', '--numstat', '-z', 'HEAD', '--'], { timeoutMs: 8000, env: { GIT_OPTIONAL_LOCKS: '0' } })
    return r.ok ? analizarNumstat(r.stdout) : new Map()
  }

  iniciar(rama?: string): Promise<EstadoGit> {
    return enCola(this.carpeta, async () => {
      if (await this.resolverRaiz()) throw new Error('Esta carpeta ya está dentro de un repositorio git.')
      const nombre = await (async () => {
        const n = (rama ?? 'main').trim() || 'main'
        const motivo = validarNombreRef(n)
        if (motivo) throw new Error(motivo)
        return n
      })()
      const init = await this.ejecutar(this.carpeta, ['init', '-q'])
      if (init.sinGit) throw new Error(MSG_SIN_GIT)
      if (!init.ok) throw new Error(explicarError(init.stderr, 'init'))
      // Compatible con versiones antiguas de git (sin `init -b`): se apunta HEAD a la rama elegida mientras no hay commits.
      await this.ejecutar(this.carpeta, ['symbolic-ref', 'HEAD', `refs/heads/${nombre}`])
      return this.estado()
    })
  }

  // ---------------------------------------------------------------- cambios

  async diff(ruta: string, preparado = false, hash?: string): Promise<DiffArchivo> {
    await this.exigirRepo()
    const motivo = validarRutaRepo(ruta)
    if (motivo) throw new Error(motivo)
    let r: ResultadoGit
    if (hash !== undefined) {
      const h = this.hash(hash)
      const padre = (await this.g(['rev-list', '--parents', '-n', '1', h])).stdout.trim().split(' ')[1]
      r = padre
        ? await this.g(['diff', '--no-color', '--no-ext-diff', '--find-renames', padre, h, '--', ruta])
        : await this.g(['show', '--no-color', '--no-ext-diff', '--format=', '--find-renames', h, '--', ruta])
    } else {
      const sinSeguimiento = !preparado && (await this.g(['ls-files', '--others', '--exclude-standard', '--', ruta])).stdout.trim() !== ''
      r = sinSeguimiento
        ? await this.g(['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', ruta], { okCodigos: [1] })
        : await this.g(['diff', ...(preparado ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--find-renames', '--', ruta])
    }
    if (!r.ok) throw new Error(explicarError(r.stderr, 'diff'))
    const binario = /^Binary files .* differ$/m.test(r.stdout) || r.stdout.includes('GIT binary patch')
    const truncado = r.stdout.length > MAX_DIFF
    return { texto: truncado ? r.stdout.slice(0, MAX_DIFF) : r.stdout, binario, truncado }
  }

  /** Diferencias de todos los archivos que git ya conoce (los nuevos sin seguimiento no entran: se piden por su ruta). */
  async diffGlobal(preparado = false): Promise<DiffArchivo> {
    await this.exigirRepo()
    const r = await this.g(['diff', ...(preparado ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--find-renames'])
    if (!r.ok) throw new Error(explicarError(r.stderr, 'diff'))
    const truncado = r.stdout.length > MAX_DIFF
    return { texto: truncado ? r.stdout.slice(0, MAX_DIFF) : r.stdout, binario: false, truncado }
  }

  /** Trae la rama de un pull request de GitHub (`pull/N/head`) como `<remoto>/pr/N` y cambia a una rama local que la sigue. */
  traerPullRequest(numero: number, remoto?: string): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      if (!Number.isInteger(numero) || numero < 1) throw new Error('Número de pull request no válido.')
      const r = await this.remotoElegido(remoto)
      const salida = await this.g(['fetch', r, `+pull/${numero}/head:refs/remotes/${r}/pr/${numero}`], { timeoutMs: 180_000, env: await this.entornoRed(r) })
      if (!salida.ok) throw new Error(explicarError(salida.stderr, 'fetch'))
      const local = `pr/${numero}`
      const yaLocal = (await this.g(['rev-parse', '--verify', '--quiet', `refs/heads/${local}`])).ok
      await this.ok(yaLocal ? ['switch', local] : ['switch', '-c', local, '--track', `${r}/pr/${numero}`])
      return this.estado()
    })
  }

  preparar(rutas?: string[]): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      if (rutas === undefined) await this.ok(['add', '-A'])
      else await this.ok(['add', '-A', '--', ...this.rutas(rutas)])
      return this.estado()
    })
  }

  despreparar(rutas?: string[]): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const sinCommits = (await this.estado()).sinCommits
      const lista = rutas === undefined ? undefined : this.rutas(rutas)
      if (sinCommits) await this.ok(['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...(lista ?? ['.'])])
      else if (!lista) await this.ok(['reset', '-q'])
      else await this.ok(['restore', '--staged', '--', ...lista])
      return this.estado()
    })
  }

  descartar(rutas: string[]): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const lista = this.rutas(rutas)
      const actual = await this.estado()
      const porRuta = new Map<string, ArchivoCambio>(actual.archivos.map((a) => [a.ruta, a]))
      for (const ruta of lista) {
        const a = porRuta.get(ruta)
        if (!a) continue // ya no tiene cambios
        if (a.conflicto) throw new Error(`«${ruta}» está en conflicto: resuélvelo o aborta la operación en curso en vez de descartarlo.`)
        if (a.sinSeguimiento) await this.ok(['clean', '-f', '-q', '--', ruta])
        else if (a.indice === 'A') await this.ok(['rm', '-f', '-q', '--', ruta])
        else if (a.indice === 'R' || a.indice === 'C') {
          await this.ok(['rm', '-f', '-q', '--', ruta])
          if (a.anterior && a.indice === 'R') await this.ok(['restore', '--source=HEAD', '--staged', '--worktree', '--', a.anterior])
        } else await this.ok(['restore', '--source=HEAD', '--staged', '--worktree', '--', ruta])
      }
      return this.estado()
    })
  }

  commit(mensaje: string, enmendar = false): Promise<{ hash: string; estado: EstadoGit }> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const texto = typeof mensaje === 'string' ? mensaje.trim() : ''
      if (!enmendar && !texto) throw new Error('Escribe un mensaje para el commit.')
      if (texto.length > 20_000) throw new Error('El mensaje es demasiado largo.')
      const estado = await this.estado()
      if (enConflicto(estado).length) throw new Error('Hay archivos en conflicto: resuélvelos y prepáralos antes de confirmar.')
      if (!enmendar && preparados(estado).length === 0 && !estado.operacion) throw new Error('No hay cambios preparados. Prepara los archivos que quieras incluir.')
      const args = ['commit', ...(enmendar ? ['--amend'] : []), ...(texto ? ['-F', '-'] : ['--no-edit'])]
      await this.ok(args, { ...(texto ? { entrada: texto + '\n' } : {}), env: { GIT_EDITOR: 'true' } })
      const hash = (await this.ok(['rev-parse', '--short', 'HEAD'])).trim()
      return { hash, estado: await this.estado() }
    })
  }

  // ---------------------------------------------------------------- historial

  async historial(o: { limite?: number; saltar?: number; rama?: string; todas?: boolean; ruta?: string } = {}): Promise<{ commits: Commit[]; hayMas: boolean }> {
    await this.exigirRepo()
    const limite = Math.min(Math.max(Math.trunc(o.limite ?? 50), 1), 500)
    const saltar = Math.max(Math.trunc(o.saltar ?? 0), 0)
    const args = ['log', '--decorate=full', `--format=${FORMATO_LOG}`, '-n', String(limite + 1), '--skip', String(saltar)]
    if (o.todas) args.push('--all')
    else if (o.rama) {
      const rama = await this.validarRama(o.rama, false)
      if (!(await this.refExiste(rama))) throw new Error(`No existe «${rama}».`)
      args.push(rama)
    }
    if (o.ruta !== undefined) {
      const motivo = validarRutaRepo(o.ruta)
      if (motivo) throw new Error(motivo)
      args.push('--', o.ruta)
    } else args.push('--')
    const r = await this.g(args)
    if (!r.ok) {
      if (/does not have any commits yet|bad default revision 'HEAD'|unknown revision/i.test(r.stderr)) return { commits: [], hayMas: false }
      throw new Error(explicarError(r.stderr, 'log'))
    }
    const commits = analizarLog(r.stdout)
    return { commits: commits.slice(0, limite), hayMas: commits.length > limite }
  }

  async detalleCommit(hash: string): Promise<DetalleCommit> {
    await this.exigirRepo()
    const h = this.hash(hash)
    const meta = analizarLog(await this.ok(['show', '-s', '--decorate=full', `--format=${FORMATO_LOG}`, h]))[0]
    if (!meta) throw new Error('No existe ese commit.')
    const cuerpo = (await this.ok(['show', '-s', '--format=%b', h])).trim()
    // Contra el primer padre (en un merge, lo que aporta la rama fusionada); el commit raíz se compara con el árbol vacío.
    const comparar = meta.padres[0] ? [meta.padres[0], meta.hash] : ['--root', meta.hash]
    const estados = await this.ok(['diff-tree', '--no-commit-id', '-r', '-M', '--name-status', '-z', ...comparar])
    const cifras = await this.ok(['diff-tree', '--no-commit-id', '-r', '-M', '--numstat', '-z', ...comparar])
    return { commit: meta, cuerpo, archivos: analizarArchivosCommit(estados, cifras) }
  }

  // ---------------------------------------------------------------- ramas

  async ramas(): Promise<Rama[]> {
    await this.exigirRepo()
    const r = await this.g(['for-each-ref', `--format=${FORMATO_RAMAS}`, 'refs/heads', 'refs/remotes'])
    if (!r.ok) throw new Error(explicarError(r.stderr, 'for-each-ref'))
    return analizarRamas(r.stdout)
  }

  crearRama(nombre: string, desde?: string, cambiar = false): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const n = await this.validarRama(nombre)
      let origen: string | undefined
      if (desde) {
        const motivo = validarNombreRef(desde)
        if (motivo && !HASH.test(desde)) throw new Error(motivo)
        if (!(await this.refExiste(desde))) throw new Error(`No existe «${desde}».`)
        origen = desde
      }
      if (await this.g(['rev-parse', '--verify', '--quiet', `refs/heads/${n}`]).then((r) => r.ok)) throw new Error(`Ya existe la rama «${n}».`)
      await this.ok(cambiar ? ['switch', '-c', n, ...(origen ? [origen] : [])] : ['branch', n, ...(origen ? [origen] : [])])
      return this.estado()
    })
  }

  cambiarRama(nombre: string, remota = false): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const n = await this.validarRama(nombre, false)
      if (remota) {
        const local = n.slice(n.indexOf('/') + 1)
        if (!n.includes('/') || !local) throw new Error('Nombre de rama remota no válido.')
        if (!(await this.g(['rev-parse', '--verify', '--quiet', `refs/remotes/${n}`])).ok) throw new Error(`No existe la rama remota «${n}».`)
        const yaLocal = (await this.g(['rev-parse', '--verify', '--quiet', `refs/heads/${local}`])).ok
        await this.ok(yaLocal ? ['switch', local] : ['switch', '-c', local, '--track', n])
      } else {
        if (!(await this.g(['rev-parse', '--verify', '--quiet', `refs/heads/${n}`])).ok) throw new Error(`No existe la rama «${n}».`)
        await this.ok(['switch', n])
      }
      return this.estado()
    })
  }

  eliminarRama(nombre: string, forzar = false): Promise<Rama[]> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const n = await this.validarRama(nombre, false)
      const estado = await this.estado()
      if (estado.rama === n) throw new Error('No puedes eliminar la rama en la que estás: cambia de rama primero.')
      await this.ok(['branch', forzar ? '-D' : '-d', n])
      return this.ramas()
    })
  }

  /** Resultado de una operación que puede dejar conflictos (fusión, revert, pull, stash). */
  private async conConflictos(r: ResultadoGit, operacion: string): Promise<ResultadoCambioConflicto> {
    if (r.sinGit) throw new Error(MSG_SIN_GIT)
    const estado = await this.estado()
    const mensaje = (r.stdout + '\n' + r.stderr).trim()
    const conflictos = enConflicto(estado).length > 0
    if (!r.ok && !conflictos) throw new Error(explicarError(r.stderr || r.stdout, operacion))
    return { estado, mensaje, conflictos }
  }

  fusionar(rama: string): Promise<ResultadoCambioConflicto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const n = await this.validarRama(rama, false)
      const actual = await this.estado()
      if (actual.rama === n) throw new Error('No se puede fusionar una rama consigo misma.')
      const existe = (await this.g(['rev-parse', '--verify', '--quiet', `refs/heads/${n}`])).ok || (await this.g(['rev-parse', '--verify', '--quiet', `refs/remotes/${n}`])).ok
      if (!existe) throw new Error(`No existe la rama «${n}».`)
      return this.conConflictos(await this.g(['merge', '--no-edit', n], { env: { GIT_EDITOR: 'true' } }), 'merge')
    })
  }

  revertir(hash: string): Promise<ResultadoCambioConflicto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const h = this.hash(hash)
      const padres = (await this.ok(['rev-list', '--parents', '-n', '1', h])).trim().split(' ').length - 1
      return this.conConflictos(await this.g(['revert', '--no-edit', ...(padres > 1 ? ['-m', '1'] : []), h], { env: { GIT_EDITOR: 'true' } }), 'revert')
    })
  }

  abortar(): Promise<EstadoGit> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const op = await this.operacionEnCurso()
      if (!op) throw new Error('No hay ninguna operación en curso que abortar.')
      await this.ok([op === 'fusion' ? 'merge' : op, '--abort'])
      return this.estado()
    })
  }

  continuar(): Promise<ResultadoCambioConflicto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      if ((await this.operacionEnCurso()) !== 'rebase') throw new Error('Solo se puede continuar un rebase en curso (una fusión se termina con un commit).')
      return this.conConflictos(await this.g(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } }), 'rebase')
    })
  }

  // ---------------------------------------------------------------- remotos

  async remotos(): Promise<Remoto[]> {
    await this.exigirRepo()
    return analizarRemotos(await this.ok(['remote', '-v']))
  }

  agregarRemoto(nombre: string, url: string): Promise<Remoto[]> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const n = nombreRemoto(nombre)
      const u = sinSalto(url, 'la URL', 2000)
      if (u.startsWith('-') || /\s/.test(u)) throw new Error('URL no válida.')
      await this.ok(['remote', 'add', n, u])
      return this.remotos()
    })
  }

  private async remotoElegido(remoto?: string): Promise<string> {
    const lista = (await this.ok(['remote'])).split('\n').map((x) => x.trim()).filter(Boolean)
    if (lista.length === 0) throw new Error('Este repositorio no tiene remotos. Agrega uno (por ejemplo, el de GitHub) primero.')
    if (remoto !== undefined) {
      if (!lista.includes(remoto)) throw new Error(`No existe el remoto «${remoto}».`)
      return remoto
    }
    return lista.includes('origin') ? 'origin' : lista[0]!
  }

  obtener(remoto?: string): Promise<ResultadoRemoto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const r = await this.remotoElegido(remoto)
      const salida = await this.g(['fetch', '--prune', r], { timeoutMs: 180_000, env: await this.entornoRed(r) })
      if (!salida.ok) throw new Error(explicarError(salida.stderr, 'fetch'))
      return { estado: await this.estado(), mensaje: (salida.stdout + salida.stderr).trim() || 'Todo al día.' }
    })
  }

  traer(rebase = false): Promise<ResultadoCambioConflicto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const estado = await this.estado()
      if (!estado.rama) throw new Error('Estás en un commit suelto (HEAD desacoplado): cambia a una rama para traer cambios.')
      if (!estado.upstream) throw new Error('La rama no sigue a ninguna rama remota todavía. Envíala primero (push) para enlazarla.')
      const r = await this.g(['pull', '--no-edit', rebase ? '--rebase' : '--ff-only'], { timeoutMs: 180_000, env: { GIT_EDITOR: 'true', ...(await this.entornoRed(estado.upstream?.split('/')[0])) } })
      return this.conConflictos(r, 'pull')
    })
  }

  enviar(remoto?: string): Promise<ResultadoRemoto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const estado = await this.estado()
      if (!estado.rama) throw new Error('Estás en un commit suelto (HEAD desacoplado): crea o cambia a una rama para enviar.')
      if (estado.sinCommits) throw new Error('Aún no hay ningún commit que enviar.')
      const r = await this.remotoElegido(remoto)
      const args = estado.upstream ? ['push'] : ['push', '-u', r, estado.rama]
      const salida = await this.g(args, { timeoutMs: 180_000, env: await this.entornoRed(estado.upstream ? estado.upstream.split('/')[0] : r) })
      if (!salida.ok) throw new Error(explicarError(salida.stderr, 'push'))
      return { estado: await this.estado(), mensaje: (salida.stderr + salida.stdout).trim() || 'Enviado.' }
    })
  }

  // ---------------------------------------------------------------- versiones (etiquetas)

  async etiquetas(): Promise<{ etiquetas: Etiqueta[]; desdeUltima: number | null }> {
    await this.exigirRepo()
    const r = await this.g(['for-each-ref', '--sort=-creatordate', `--format=${FORMATO_ETIQUETAS}`, 'refs/tags'])
    if (!r.ok) throw new Error(explicarError(r.stderr, 'for-each-ref'))
    const etiquetas = analizarEtiquetas(r.stdout)
    let desdeUltima: number | null = null
    const ultima = etiquetas.find((e) => /^v?\d+\.\d+\.\d+$/.test(e.nombre)) ?? etiquetas[0]
    if (ultima) {
      const c = await this.g(['rev-list', '--count', `${ultima.nombre}..HEAD`])
      if (c.ok) desdeUltima = Number(c.stdout.trim())
    }
    return { etiquetas, desdeUltima }
  }

  crearEtiqueta(nombre: string, mensaje?: string, commit?: string): Promise<Etiqueta[]> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const motivo = validarNombreRef(nombre)
      if (motivo) throw new Error(motivo)
      const n = nombre.trim()
      if (!(await this.g(['check-ref-format', `refs/tags/${n}`])).ok) throw new Error(`«${n}» no es un nombre de versión válido para git.`)
      if ((await this.g(['rev-parse', '--verify', '--quiet', `refs/tags/${n}`])).ok) throw new Error(`Ya existe la versión «${n}».`)
      if (commit !== undefined && !HASH.test(commit) && validarNombreRef(commit)) throw new Error('Commit no válido.')
      if (commit !== undefined && !(await this.refExiste(commit))) throw new Error('No existe ese commit.')
      const texto = (mensaje ?? '').trim() || `Versión ${n}`
      await this.ok(['tag', '-a', n, '-F', '-', ...(commit ? [commit] : [])], { entrada: texto + '\n' })
      return (await this.etiquetas()).etiquetas
    })
  }

  eliminarEtiqueta(nombre: string): Promise<Etiqueta[]> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const motivo = validarNombreRef(nombre)
      if (motivo) throw new Error(motivo)
      await this.ok(['tag', '-d', nombre.trim()])
      return (await this.etiquetas()).etiquetas
    })
  }

  enviarEtiqueta(nombre: string, remoto?: string): Promise<string> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const motivo = validarNombreRef(nombre)
      if (motivo) throw new Error(motivo)
      const n = nombre.trim()
      if (!(await this.g(['rev-parse', '--verify', '--quiet', `refs/tags/${n}`])).ok) throw new Error(`No existe la versión «${n}».`)
      const r = await this.remotoElegido(remoto)
      const salida = await this.g(['push', r, `refs/tags/${n}`], { timeoutMs: 180_000, env: await this.entornoRed(r) })
      if (!salida.ok) throw new Error(explicarError(salida.stderr, 'push'))
      return (salida.stderr + salida.stdout).trim() || 'Versión enviada.'
    })
  }

  // ---------------------------------------------------------------- stash

  async stashes(): Promise<Stash[]> {
    await this.exigirRepo()
    const r = await this.g(['stash', 'list', '--format=%gs%x00%aI%x1e'])
    if (!r.ok) throw new Error(explicarError(r.stderr, 'stash'))
    return analizarStashes(r.stdout)
  }

  guardarStash(mensaje?: string, incluirNoSeguidos = false): Promise<{ stashes: Stash[]; estado: EstadoGit }> {
    return this.escribir(async () => {
      await this.exigirRepo()
      const estado = await this.estado()
      if (estado.sinCommits) throw new Error('Aún no hay commits: el stash necesita al menos uno.')
      if (estado.archivos.length === 0) throw new Error('No hay cambios que guardar.')
      const texto = (mensaje ?? '').trim()
      if (texto.length > 500 || /[\r\n\0]/.test(texto)) throw new Error('Mensaje no válido.')
      // Sin rutas del usuario: con pathspecs literales `stash -u` no incluye los archivos nuevos.
      await this.ok(['stash', 'push', ...(incluirNoSeguidos ? ['-u'] : []), ...(texto ? ['-m', texto] : [])], { env: { GIT_LITERAL_PATHSPECS: '0' } })
      return { stashes: await this.stashes(), estado: await this.estado() }
    })
  }

  aplicarStash(indice: number, quitar = false): Promise<ResultadoCambioConflicto> {
    return this.escribir(async () => {
      await this.exigirRepo()
      if (!Number.isInteger(indice) || indice < 0) throw new Error('Stash no válido.')
      return this.conConflictos(await this.g(['stash', quitar ? 'pop' : 'apply', `stash@{${indice}}`]), 'stash')
    })
  }

  eliminarStash(indice: number): Promise<Stash[]> {
    return this.escribir(async () => {
      await this.exigirRepo()
      if (!Number.isInteger(indice) || indice < 0) throw new Error('Stash no válido.')
      await this.ok(['stash', 'drop', `stash@{${indice}}`])
      return this.stashes()
    })
  }

  // ---------------------------------------------------------------- identidad

  async identidad(): Promise<Identidad> {
    const leer = async (clave: string): Promise<{ valor: string; origen: 'local' | 'global' } | undefined> => {
      const r = await this.ejecutar(this.raiz ?? this.carpeta, ['config', '--show-scope', '--get', clave])
      if (!r.ok) return undefined
      const [alcance, ...resto] = r.stdout.trim().split('\t')
      const valor = resto.join('\t').trim()
      return valor ? { valor, origen: alcance === 'local' || alcance === 'worktree' ? 'local' : 'global' } : undefined
    }
    await this.resolverRaiz().catch(() => undefined)
    const nombre = await leer('user.name')
    const correo = await leer('user.email')
    return { ...(nombre ? { nombre: nombre.valor } : {}), ...(correo ? { correo: correo.valor } : {}), ...((nombre ?? correo) ? { origen: (nombre ?? correo)!.origen } : {}) }
  }

  fijarIdentidad(nombre: string, correo: string, global = false): Promise<Identidad> {
    return enCola(this.carpeta, async () => {
      const n = sinSalto(nombre, 'el nombre', 200)
      const c = sinSalto(correo, 'el correo', 200)
      if (!/^[^\s@]+@[^\s@]+$/.test(c)) throw new Error('El correo no parece válido.')
      if (!global && !(await this.resolverRaiz())) throw new Error('Esta carpeta no es un repositorio: guárdalo como configuración global o inicializa el repositorio.')
      const cwd = this.raiz ?? this.carpeta
      for (const [clave, valor] of [['user.name', n], ['user.email', c]] as const) {
        const r = await this.ejecutar(cwd, ['config', ...(global ? ['--global'] : []), clave, valor])
        if (r.sinGit) throw new Error(MSG_SIN_GIT)
        if (!r.ok) throw new Error(explicarError(r.stderr, 'config'))
      }
      return this.identidad()
    })
  }
}

function nombreRemoto(nombre: string): string {
  const n = typeof nombre === 'string' ? nombre.trim() : ''
  if (!NOMBRE_REMOTO.test(n)) throw new Error('Nombre de remoto no válido (letras, números, punto, guion).')
  return n
}
