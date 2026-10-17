import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { analizarDiff, siguienteVersion, validarNombreRef, validarRutaRepo } from '@shared/versiones'
import {
  analizarArchivosCommit,
  analizarEstado,
  analizarLog,
  analizarRamas,
  analizarRefs,
  analizarRemotos,
  explicarError,
  ocultarCredenciales
} from '../src/main/core/git/analisis'
import { ejecutarOperacionGit } from '../src/main/core/git/operaciones'
import { Repositorio } from '../src/main/core/git/repositorio'

beforeAll(async () => {
  // Sin la configuración global del usuario: la identidad y los alias de sus pruebas no deben influir.
  const casa = await mkdtemp(join(tmpdir(), 'git-casa-'))
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  for (const v of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[v]
})

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env } }).trim()
const carpeta = (): Promise<string> => mkdtemp(join(tmpdir(), 'git-proy-'))
const escribir = async (dir: string, archivo: string, texto: string): Promise<void> => {
  await mkdir(join(dir, archivo, '..'), { recursive: true })
  await writeFile(join(dir, archivo), texto)
}

/** Repositorio con identidad y un primer commit. */
async function repoConCommit(): Promise<{ dir: string; r: Repositorio }> {
  const dir = await carpeta()
  const r = new Repositorio(dir)
  await r.iniciar('main')
  await r.fijarIdentidad('Ana Prueba', 'ana@example.com')
  await escribir(dir, 'a.txt', 'uno\ndos\ntres\n')
  await r.preparar(['a.txt'])
  await r.commit('Primer commit')
  return { dir, r }
}

describe('analizadores de la salida de git', () => {
  it('estado v2: rama, upstream, adelante/atrás, modificados, renombrados, conflictos y sin seguimiento', () => {
    const salida = [
      '# branch.oid 1234567890abcdef',
      '# branch.head feat/x',
      '# branch.upstream origin/feat/x',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/a b.ts',
      '1 A. N... 000000 100644 100644 000 ccc nuevo.ts',
      '2 R. N... 100644 100644 100644 ddd eee R100 destino.ts',
      'origen.ts',
      'u UU N... 100644 100644 100644 100644 f1 f2 f3 choque.ts',
      '? libre.txt',
      '! ignorado.log',
      ''
    ].join('\0')
    const e = analizarEstado(salida)
    expect(e).toMatchObject({ rama: 'feat/x', upstream: 'origin/feat/x', adelante: 2, atras: 1, sinCommits: false, truncado: false })
    expect(e.archivos).toEqual([
      { ruta: 'src/a b.ts', indice: '.', trabajo: 'M', conflicto: false, sinSeguimiento: false },
      { ruta: 'nuevo.ts', indice: 'A', trabajo: '.', conflicto: false, sinSeguimiento: false },
      { ruta: 'destino.ts', anterior: 'origen.ts', indice: 'R', trabajo: '.', conflicto: false, sinSeguimiento: false },
      { ruta: 'choque.ts', indice: 'U', trabajo: 'U', conflicto: true, sinSeguimiento: false },
      { ruta: 'libre.txt', indice: '.', trabajo: '.', conflicto: false, sinSeguimiento: true }
    ])
  })

  it('estado: repositorio nuevo y HEAD desacoplado', () => {
    expect(analizarEstado('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ sinCommits: true, rama: 'main' })
    const d = analizarEstado('# branch.oid abcdef1234567\0# branch.head (detached)\0')
    expect(d.rama).toBeUndefined()
    expect(d.desacoplado).toBe('abcdef1')
  })

  it('refs, log, ramas y archivos de un commit', () => {
    expect(analizarRefs('HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0.0, refs/heads/feat/x')).toEqual([
      { tipo: 'cabeza', nombre: 'main' },
      { tipo: 'remota', nombre: 'origin/main' },
      { tipo: 'etiqueta', nombre: 'v1.0.0' },
      { tipo: 'rama', nombre: 'feat/x' }
    ])
    const log = analizarLog(['aaaaaaa1\0aaaaaaa\0Ana\0a@x.com\x002026-01-02T03:04:05+00:00\0bbbbbbb1 ccccccc1\0HEAD -> refs/heads/main\0Asunto uno\x1e', '\nddddddd1\0ddddddd\0Beto\0b@x.com\x002026-01-01T00:00:00+00:00\0\0\0Raíz\x1e'].join(''))
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ corto: 'aaaaaaa', autor: 'Ana', padres: ['bbbbbbb1', 'ccccccc1'], asunto: 'Asunto uno' })
    expect(log[1]).toMatchObject({ padres: [], refs: [] })
    const ramas = analizarRamas(['refs/heads/main\0main\0*\0origin/main\0[ahead 2, behind 1]\0abc1234\0Asunto\x002026-01-01T00:00:00+00:00\x1e', 'refs/remotes/origin/HEAD\0origin/HEAD\0 \0\0\0abc1234\0x\0\x1e', 'refs/remotes/origin/viejo\0origin/viejo\0 \0\0\0abc1234\0y\0\x1e', 'refs/heads/solo\0solo\0 \0origin/solo\0[gone]\0abc1234\0z\0\x1e'].join('\n'))
    expect(ramas.map((r) => r.nombre)).toEqual(['main', 'origin/viejo', 'solo'])
    expect(ramas[0]).toMatchObject({ actual: true, adelante: 2, atras: 1, upstream: 'origin/main', remota: false })
    expect(ramas[1]).toMatchObject({ remota: true })
    expect(ramas[2]).toMatchObject({ huerfana: true })
    const archivos = analizarArchivosCommit('M\0a.ts\0R100\0viejo.ts\0nuevo.ts\0A\0b.bin\0', '3\t1\ta.ts\0-\t-\tb.bin\0' + '5\t0\t\0viejo.ts\0nuevo.ts\0')
    expect(archivos).toEqual([
      { ruta: 'a.ts', estado: 'M', adiciones: 3, eliminaciones: 1 },
      { ruta: 'nuevo.ts', anterior: 'viejo.ts', estado: 'R', adiciones: 5, eliminaciones: 0 },
      { ruta: 'b.bin', estado: 'A', adiciones: null, eliminaciones: null }
    ])
  })

  it('oculta las credenciales de las URL de los remotos', () => {
    expect(ocultarCredenciales('https://usuario:ghp_secreto@github.com/o/r.git')).toBe('https://***@github.com/o/r.git')
    expect(ocultarCredenciales('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
    expect(analizarRemotos('origin\thttps://u:t@h.com/r.git (fetch)\norigin\thttps://u:t@h.com/r.git (push)\n')).toEqual([{ nombre: 'origin', url: 'https://***@h.com/r.git' }])
  })

  it('traduce los errores habituales a un mensaje que dice qué hacer', () => {
    expect(explicarError('Author identity unknown\n*** Please tell me who you are.')).toMatch(/nombre y correo/)
    expect(explicarError('fatal: Authentication failed for x')).toMatch(/autenticar/)
    expect(explicarError('! [rejected] main -> main (fetch first)\nerror: failed to push some refs', 'push')).toMatch(/Trae/)
    expect(explicarError('error: Your local changes to the following files would be overwritten by checkout')).toMatch(/stash/)
    expect(explicarError('fatal: unrecognized cosa rara', 'log')).toMatch(/git log falló/)
  })

  it('analiza un diff con numeración de líneas', () => {
    const d = analizarDiff('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n uno\n-dos\n+DOS\n tres\n\\ No newline at end of file\n')
    expect(d).toMatchObject({ adiciones: 1, eliminaciones: 1 })
    expect(d.lineas.map((l) => l.tipo)).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'ctx', 'info'])
    expect(d.lineas[6]).toMatchObject({ viejo: 2, texto: 'dos' })
    expect(d.lineas[7]).toMatchObject({ nuevo: 2, texto: 'DOS' })
    expect(d.lineas[8]).toMatchObject({ viejo: 3, nuevo: 3 })
  })

  it('calcula la siguiente versión semántica y valida nombres y rutas', () => {
    expect(siguienteVersion([], 'parche')).toBe('v0.0.1')
    expect(siguienteVersion([], 'mayor')).toBe('v1.0.0')
    expect(siguienteVersion(['v1.2.3', 'v1.10.0', 'beta', 'v1.9.9'], 'parche')).toBe('v1.10.1')
    expect(siguienteVersion(['v1.2.3', 'v1.10.0'], 'menor')).toBe('v1.11.0')
    expect(siguienteVersion(['2.0.5'], 'mayor')).toBe('3.0.0')
    expect(validarRutaRepo('src/a.ts')).toBeNull()
    for (const mala of ['', '../x', 'a/../../x', '/etc/passwd', 'C:\\x', '-rf', 'a\nb']) expect(validarRutaRepo(mala), mala).not.toBeNull()
    expect(validarNombreRef('feat/login-2')).toBeNull()
    for (const mala of ['', '-x', 'a b', 'a..b', 'a~1', 'a:b', 'x.lock', '/x', 'x/']) expect(validarNombreRef(mala), mala).not.toBeNull()
  })
})

describe('Repositorio (git real)', () => {
  it('una carpeta sin repositorio se inicializa; falta la identidad hasta que se configura', async () => {
    const dir = await carpeta()
    const r = new Repositorio(dir)
    expect(await r.estado()).toMatchObject({ repo: false })
    const e = await r.iniciar('principal')
    expect(e).toMatchObject({ repo: true, rama: 'principal', sinCommits: true })
    await expect(r.iniciar()).rejects.toThrow(/ya está/)
    expect(await r.identidad()).toEqual({})
    await escribir(dir, 'a.txt', 'hola\n')
    await r.preparar()
    await expect(r.commit('x')).rejects.toThrow(/nombre y correo/)
    await expect(r.fijarIdentidad('Ana', 'sin-arroba')).rejects.toThrow(/correo/)
    expect(await r.fijarIdentidad('Ana', 'ana@example.com')).toEqual({ nombre: 'Ana', correo: 'ana@example.com', origen: 'local' })
    const c = await r.commit('Primero')
    expect(c.hash).toMatch(/^[0-9a-f]{7,}$/)
    expect(c.estado).toMatchObject({ sinCommits: false, archivos: [] })
  })

  it('preparar, diff, despreparar y descartar (modificados, añadidos y sin seguimiento)', async () => {
    const { dir, r } = await repoConCommit()
    await escribir(dir, 'a.txt', 'uno\nDOS\ntres\n')
    await escribir(dir, 'nuevo.txt', 'nuevo\n')
    await escribir(dir, 'carpeta/hondo/b.txt', 'b\n')
    let e = await r.estado()
    expect(e.archivos.map((a) => [a.ruta, a.indice, a.trabajo, a.sinSeguimiento])).toEqual([
      ['a.txt', '.', 'M', false],
      ['carpeta/hondo/b.txt', '.', '.', true],
      ['nuevo.txt', '.', '.', true]
    ])
    expect((await r.diff('a.txt')).texto).toMatch(/-dos\n\+DOS/)
    expect((await r.diff('nuevo.txt')).texto).toMatch(/\+nuevo/)
    expect((await r.diff('carpeta/hondo/b.txt')).texto).toMatch(/\+b/)

    e = await r.preparar(['a.txt'])
    expect(e.archivos.find((a) => a.ruta === 'a.txt')).toMatchObject({ indice: 'M', trabajo: '.' })
    expect((await r.diff('a.txt', true)).texto).toMatch(/\+DOS/)
    expect((await r.diff('a.txt')).texto).toBe('')
    e = await r.despreparar(['a.txt'])
    expect(e.archivos.find((a) => a.ruta === 'a.txt')).toMatchObject({ indice: '.', trabajo: 'M' })

    e = await r.preparar(['nuevo.txt'])
    expect(e.archivos.find((a) => a.ruta === 'nuevo.txt')).toMatchObject({ indice: 'A' })
    e = await r.descartar(['a.txt', 'nuevo.txt', 'carpeta/hondo/b.txt'])
    expect(e.archivos).toEqual([])
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('uno\ndos\ntres\n')
    expect(existsSync(join(dir, 'nuevo.txt'))).toBe(false)
    expect(existsSync(join(dir, 'carpeta/hondo/b.txt'))).toBe(false)

    // todo a la vez
    await escribir(dir, 'x.txt', 'x\n')
    await escribir(dir, 'y.txt', 'y\n')
    expect((await r.preparar()).archivos.every((a) => a.indice === 'A')).toBe(true)
    expect((await r.despreparar()).archivos.every((a) => a.sinSeguimiento)).toBe(true)
  })

  it('en un repositorio sin commits también se puede preparar y despreparar', async () => {
    const dir = await carpeta()
    const r = new Repositorio(dir)
    await r.iniciar()
    await escribir(dir, 'a.txt', 'a\n')
    expect((await r.preparar()).archivos[0]).toMatchObject({ indice: 'A' })
    expect((await r.diff('a.txt', true)).texto).toMatch(/\+a/)
    expect((await r.despreparar()).archivos[0]).toMatchObject({ sinSeguimiento: true })
  })

  it('renombrar: el estado lo reconoce y descartar deja todo como estaba', async () => {
    const { dir, r } = await repoConCommit()
    sh(dir, 'mv', 'a.txt', 'b.txt')
    const e = await r.preparar()
    expect(e.archivos[0]).toMatchObject({ ruta: 'b.txt', anterior: 'a.txt', indice: 'R' })
    await r.descartar(['b.txt'])
    expect(existsSync(join(dir, 'a.txt'))).toBe(true)
    expect(existsSync(join(dir, 'b.txt'))).toBe(false)
    expect((await r.estado()).archivos).toEqual([])
  })

  it('commit: valida mensaje y cambios preparados, y se puede enmendar', async () => {
    const { dir, r } = await repoConCommit()
    await expect(r.commit('   ')).rejects.toThrow(/mensaje/)
    await expect(r.commit('algo')).rejects.toThrow(/No hay cambios preparados/)
    await escribir(dir, 'a.txt', 'cambio\n')
    await r.preparar()
    await expect(r.commit('')).rejects.toThrow(/mensaje/)
    await r.commit('Cambio\n\nDetalle largo')
    const { commits } = await r.historial()
    expect(commits.map((c) => c.asunto)).toEqual(['Cambio', 'Primer commit'])
    await r.commit('Cambio corregido', true)
    expect((await r.historial()).commits.map((c) => c.asunto)).toEqual(['Cambio corregido', 'Primer commit'])
    const actual = (await r.historial()).commits[0]!
    const detalle = await r.detalleCommit(actual.hash)
    expect(detalle.archivos).toEqual([{ ruta: 'a.txt', estado: 'M', adiciones: 1, eliminaciones: 3 }])
    expect(detalle.commit.refs).toContainEqual({ tipo: 'cabeza', nombre: 'main' })
    expect((await r.diff('a.txt', false, actual.hash)).texto).toMatch(/\+cambio/)
  })

  it('historial: paginación, filtro por archivo y detalle del commit raíz', async () => {
    const { dir, r } = await repoConCommit()
    for (const n of [1, 2, 3]) {
      await escribir(dir, `f${n}.txt`, `${n}\n`)
      await r.preparar([`f${n}.txt`])
      await r.commit(`Commit ${n}`)
    }
    const p1 = await r.historial({ limite: 2 })
    expect(p1.commits.map((c) => c.asunto)).toEqual(['Commit 3', 'Commit 2'])
    expect(p1.hayMas).toBe(true)
    const p2 = await r.historial({ limite: 2, saltar: 2 })
    expect(p2.commits.map((c) => c.asunto)).toEqual(['Commit 1', 'Primer commit'])
    expect(p2.hayMas).toBe(false)
    expect((await r.historial({ ruta: 'f2.txt' })).commits.map((c) => c.asunto)).toEqual(['Commit 2'])
    const raiz = p2.commits.at(-1)!
    expect((await r.detalleCommit(raiz.hash)).archivos).toEqual([{ ruta: 'a.txt', estado: 'A', adiciones: 3, eliminaciones: 0 }])
    await expect(r.detalleCommit('no-es-hash')).rejects.toThrow(/no válido/)
  })

  it('ramas: crear, cambiar, fusionar (avance rápido y con commit), eliminar y proteger la actual', async () => {
    const { dir, r } = await repoConCommit()
    await expect(r.crearRama('rama con espacios')).rejects.toThrow()
    await expect(r.crearRama('-malo')).rejects.toThrow()
    let e = await r.crearRama('feat/uno', undefined, true)
    expect(e.rama).toBe('feat/uno')
    await escribir(dir, 'uno.txt', '1\n')
    await r.preparar()
    await r.commit('Uno')
    await expect(r.crearRama('feat/uno')).rejects.toThrow(/Ya existe/)
    e = await r.cambiarRama('main')
    expect(e.rama).toBe('main')
    expect(existsSync(join(dir, 'uno.txt'))).toBe(false)
    let f = await r.fusionar('feat/uno')
    expect(f).toMatchObject({ conflictos: false })
    expect(existsSync(join(dir, 'uno.txt'))).toBe(true)
    await expect(r.fusionar('main')).rejects.toThrow(/consigo misma/)
    await expect(r.fusionar('no-existe')).rejects.toThrow(/No existe/)
    await expect(r.eliminarRama('main')).rejects.toThrow(/en la que estás/)
    const ramas = await r.eliminarRama('feat/uno')
    expect(ramas.map((x) => x.nombre)).toEqual(['main'])
    expect(ramas[0]).toMatchObject({ actual: true, remota: false })

    // fusión con commit de merge: el detalle del merge lista los archivos del lado fusionado
    await r.crearRama('lado', undefined, true)
    await escribir(dir, 'lado.txt', 'l\n')
    await r.preparar()
    await r.commit('Lado')
    await r.cambiarRama('main')
    await escribir(dir, 'principal.txt', 'p\n')
    await r.preparar()
    await r.commit('Principal')
    f = await r.fusionar('lado')
    expect(f.conflictos).toBe(false)
    const merge = (await r.historial()).commits[0]!
    expect(merge.padres).toHaveLength(2)
    expect((await r.detalleCommit(merge.hash)).archivos.map((a) => a.ruta)).toEqual(['lado.txt'])
    expect((await r.historial({ todas: true })).commits.length).toBeGreaterThan(3)
  })

  it('conflictos: se detectan, se impide confirmar, se resuelven o se aborta', async () => {
    const { dir, r } = await repoConCommit()
    await r.crearRama('otra', undefined, true)
    await escribir(dir, 'a.txt', 'uno\nOTRA\ntres\n')
    await r.preparar()
    await r.commit('Cambio en otra')
    await r.cambiarRama('main')
    await escribir(dir, 'a.txt', 'uno\nMAIN\ntres\n')
    await r.preparar()
    await r.commit('Cambio en main')

    const f = await r.fusionar('otra')
    expect(f.conflictos).toBe(true)
    expect(f.estado.operacion).toBe('fusion')
    expect(f.estado.archivos).toEqual([expect.objectContaining({ ruta: 'a.txt', conflicto: true })])
    expect((await r.diff('a.txt')).texto).toMatch(/<<<<<<<|\+\+<<<<<<</)
    await expect(r.commit('intento')).rejects.toThrow(/conflicto/)
    await expect(r.descartar(['a.txt'])).rejects.toThrow(/conflicto/)

    let e = await r.abortar()
    expect(e.operacion).toBeUndefined()
    expect(e.archivos).toEqual([])
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('uno\nMAIN\ntres\n')
    await expect(r.abortar()).rejects.toThrow(/No hay ninguna operación/)

    // resolver a mano: se prepara el archivo y el commit concluye la fusión
    await r.fusionar('otra')
    await writeFile(join(dir, 'a.txt'), 'uno\nRESUELTO\ntres\n')
    e = await r.preparar(['a.txt'])
    expect(e.archivos.some((a) => a.conflicto)).toBe(false)
    expect(e.operacion).toBe('fusion')
    await r.commit('Fusión resuelta')
    e = await r.estado()
    expect(e.operacion).toBeUndefined()
    expect((await r.historial()).commits[0]!.padres).toHaveLength(2)
  })

  it('revertir crea un commit inverso y avisa de los conflictos', async () => {
    const { dir, r } = await repoConCommit()
    await escribir(dir, 'a.txt', 'uno\ndos\ntres\ncuatro\n')
    await r.preparar()
    const c = await r.commit('Añade cuatro')
    const objetivo = (await r.historial()).commits[0]!
    const res = await r.revertir(objetivo.hash)
    expect(res.conflictos).toBe(false)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('uno\ndos\ntres\n')
    expect((await r.historial()).commits[0]!.asunto).toMatch(/^Revert/)
    expect(c.hash).toBeTruthy()
  })

  it('versiones (etiquetas): crear, listar, commits desde la última y eliminar', async () => {
    const { dir, r } = await repoConCommit()
    expect(await r.etiquetas()).toEqual({ etiquetas: [], desdeUltima: null })
    await expect(r.crearEtiqueta('mala etiqueta')).rejects.toThrow()
    let t = await r.crearEtiqueta('v1.0.0', 'Primera versión estable')
    expect(t[0]).toMatchObject({ nombre: 'v1.0.0', anotada: true, mensaje: 'Primera versión estable', autor: 'Ana Prueba' })
    await expect(r.crearEtiqueta('v1.0.0')).rejects.toThrow(/Ya existe/)
    expect((await r.etiquetas()).desdeUltima).toBe(0)
    await escribir(dir, 'b.txt', 'b\n')
    await r.preparar()
    await r.commit('Después')
    expect((await r.etiquetas()).desdeUltima).toBe(1)
    t = await r.crearEtiqueta('v1.1.0')
    expect(t.map((x) => x.nombre).sort()).toEqual(['v1.0.0', 'v1.1.0'])
    expect(t.find((x) => x.nombre === 'v1.1.0')?.mensaje).toBe('Versión v1.1.0')
    expect(siguienteVersion(t.map((x) => x.nombre), 'parche')).toBe('v1.1.1')
    t = await r.eliminarEtiqueta('v1.0.0')
    expect(t.map((x) => x.nombre)).toEqual(['v1.1.0'])
  })

  it('stash: guardar (también sin seguimiento), listar, aplicar, quitar y eliminar', async () => {
    const { dir, r } = await repoConCommit()
    await expect(r.guardarStash()).rejects.toThrow(/No hay cambios/)
    await escribir(dir, 'a.txt', 'uno\nGUARDADO\ntres\n')
    await escribir(dir, 'nuevo.txt', 'n\n')
    const res = await r.guardarStash('trabajo a medias', true)
    expect(res.estado.archivos).toEqual([])
    expect(res.stashes).toHaveLength(1)
    expect(res.stashes[0]!.mensaje).toMatch(/trabajo a medias/)
    expect(existsSync(join(dir, 'nuevo.txt'))).toBe(false)
    const ap = await r.aplicarStash(0, true)
    expect(ap.conflictos).toBe(false)
    expect(existsSync(join(dir, 'nuevo.txt'))).toBe(true)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toContain('GUARDADO')
    expect(await r.stashes()).toEqual([])
    await escribir(dir, 'a.txt', 'otra vez\n')
    await r.guardarStash()
    expect(await r.eliminarStash(0)).toEqual([])
    await expect(r.aplicarStash(-1)).rejects.toThrow(/no válido/)
  })

  it('remotos: enviar enlaza la rama, obtener/traer sincronizan y las etiquetas se envían', async () => {
    const { dir, r } = await repoConCommit()
    expect(await r.remotos()).toEqual([])
    await expect(r.enviar()).rejects.toThrow(/no tiene remotos/)
    const remotoDir = await mkdtemp(join(tmpdir(), 'git-remoto-'))
    sh(remotoDir, 'init', '--bare', '-q', '-b', 'main')
    await expect(r.agregarRemoto('-malo', remotoDir)).rejects.toThrow()
    expect(await r.agregarRemoto('origin', remotoDir)).toEqual([{ nombre: 'origin', url: remotoDir }])
    let e = (await r.enviar()).estado
    expect(e).toMatchObject({ upstream: 'origin/main', adelante: 0, atras: 0 })

    // otra persona sube un commit
    const otra = await mkdtemp(join(tmpdir(), 'git-otra-'))
    sh(otra, 'clone', '-q', remotoDir, '.')
    sh(otra, 'config', 'user.name', 'Beto')
    sh(otra, 'config', 'user.email', 'beto@example.com')
    await escribir(otra, 'remoto.txt', 'r\n')
    sh(otra, 'add', '-A')
    sh(otra, 'commit', '-q', '-m', 'Desde el remoto')
    sh(otra, 'push', '-q')

    e = (await r.obtener()).estado
    expect(e).toMatchObject({ atras: 1, adelante: 0 })
    expect((await r.ramas()).find((x) => x.nombre === 'origin/main')).toBeTruthy()
    const t = await r.traer()
    expect(t.conflictos).toBe(false)
    expect(t.estado).toMatchObject({ atras: 0 })
    expect(existsSync(join(dir, 'remoto.txt'))).toBe(true)

    // enviar sin traer antes: el remoto rechaza y se explica qué hacer
    await escribir(dir, 'local.txt', 'l\n')
    await r.preparar()
    await r.commit('Local')
    await escribir(otra, 'otro.txt', 'o\n')
    sh(otra, 'add', '-A')
    sh(otra, 'commit', '-q', '-m', 'Otro del remoto')
    sh(otra, 'push', '-q')
    await expect(r.enviar()).rejects.toThrow(/Trae/)
    await expect(r.traer()).rejects.toThrow(/divergido|avanzar/)
    const rebase = await r.traer(true)
    expect(rebase.conflictos).toBe(false)
    e = (await r.enviar()).estado
    expect(e).toMatchObject({ adelante: 0, atras: 0 })

    await r.crearEtiqueta('v2.0.0')
    expect(await r.enviarEtiqueta('v2.0.0')).toBeTruthy()
    expect(sh(remotoDir, 'tag', '-l')).toBe('v2.0.0')
    await expect(r.enviarEtiqueta('no-existe')).rejects.toThrow(/No existe/)
  })

  it('traer sin rama remota enlazada explica qué hacer; cambiar a una rama remota la crea en local', async () => {
    const { dir, r } = await repoConCommit()
    await expect(r.traer()).rejects.toThrow(/no sigue/)
    const remotoDir = await mkdtemp(join(tmpdir(), 'git-remoto-'))
    sh(remotoDir, 'init', '--bare', '-q', '-b', 'main')
    await r.agregarRemoto('origin', remotoDir)
    await r.enviar()
    await r.crearRama('feat/remota', undefined, true)
    await escribir(dir, 'f.txt', 'f\n')
    await r.preparar()
    await r.commit('Feat')
    await r.enviar()
    await r.cambiarRama('main')
    sh(dir, 'branch', '-D', 'feat/remota')
    await r.obtener()
    const e = await r.cambiarRama('origin/feat/remota', true)
    expect(e).toMatchObject({ rama: 'feat/remota', upstream: 'origin/feat/remota' })
  })

  it('rechaza rutas peligrosas y operaciones desconocidas', async () => {
    const { r } = await repoConCommit()
    for (const ruta of ['../fuera', '/etc/passwd', '-rf']) {
      await expect(r.preparar([ruta]), ruta).rejects.toThrow()
      await expect(r.descartar([ruta]), ruta).rejects.toThrow()
      await expect(r.diff(ruta), ruta).rejects.toThrow()
    }
    await expect(r.preparar([])).rejects.toThrow(/al menos un archivo/)
    await expect(r.cambiarRama('--detach')).rejects.toThrow()
    const dir = await carpeta()
    const carpetaDe = async (id: string): Promise<string> => {
      if (id !== 'p1') throw new Error('El proyecto ya no existe.')
      return dir
    }
    await expect(ejecutarOperacionGit(carpetaDe, 'borrarTodo', { proyectoId: 'p1' })).rejects.toThrow(/desconocida/)
    await expect(ejecutarOperacionGit(carpetaDe, '__proto__', { proyectoId: 'p1' })).rejects.toThrow(/desconocida/)
    await expect(ejecutarOperacionGit(carpetaDe, 'estado', {})).rejects.toThrow(/proyecto/)
    await expect(ejecutarOperacionGit(carpetaDe, 'estado', { proyectoId: 'otro' })).rejects.toThrow(/ya no existe/)
    expect(await ejecutarOperacionGit(carpetaDe, 'estado', { proyectoId: 'p1' })).toMatchObject({ repo: false })
  })

  it('un proyecto dentro de un repositorio mayor usa las rutas de la raíz', async () => {
    const { dir, r: repo } = await repoConCommit()
    await escribir(dir, 'sub/x.txt', 'x\n')
    const sub = new Repositorio(join(dir, 'sub'))
    const e = await sub.estado()
    expect(e).toMatchObject({ repo: true })
    expect(e.archivos[0]).toMatchObject({ ruta: 'sub/x.txt', sinSeguimiento: true })
    await sub.preparar(['sub/x.txt'])
    expect((await sub.diff('sub/x.txt', true)).texto).toMatch(/\+x/)
    await repo.estado()
  })

  it('las escrituras concurrentes no se pisan (index.lock)', async () => {
    const { dir, r } = await repoConCommit()
    for (const n of [1, 2, 3, 4, 5, 6]) await escribir(dir, `c${n}.txt`, `${n}\n`)
    const resultados = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => r.preparar([`c${n}.txt`])))
    expect(resultados).toHaveLength(6)
    expect((await r.estado()).archivos.filter((a) => a.indice === 'A')).toHaveLength(6)
  })
})
