import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

process.env.HOME = process.env.HOME ?? tmpdir()
const { GestorCaveman, REPO_CAVEMAN } = await import('../src/main/caveman')
import type { EjecutarGit } from '../src/main/caveman'

const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'caveman-'))
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

/** Git falso: `ls-remote` devuelve `remoto()` y `clone` crea un plugin válido con ese commit. */
function gitFalso(remoto: () => string, llamadas: string[][] = []): EjecutarGit {
  let clon = ''
  return async (args, { cwd }) => {
    llamadas.push(args)
    if (args[0] === 'ls-remote') {
      if (!remoto()) throw new Error('sin red')
      return `${remoto()}\tHEAD`
    }
    if (args[0] === 'clone') {
      clon = args[args.length - 1]!
      await mkdir(join(clon, '.claude-plugin'), { recursive: true })
      await mkdir(join(clon, '.git'), { recursive: true })
      await writeFile(join(clon, '.claude-plugin', 'plugin.json'), '{"name":"caveman"}')
      return ''
    }
    if (args[0] === 'rev-parse') return cwd === clon ? remoto() : ''
    throw new Error(`git inesperado: ${args.join(' ')}`)
  }
}

describe('GestorCaveman', () => {
  it('descarga la primera vez y deja un plugin válido sin .git', async () => {
    const llamadas: string[][] = []
    const g = new GestorCaveman({ dir: tmp, git: gitFalso(() => SHA1, llamadas), inicioClaude: join(tmp, 'no-existe.json') })
    expect(await g.rutaPlugin()).toBeUndefined()
    await g.actualizar()
    const ruta = await g.rutaPlugin()
    expect(ruta).toBe(join(tmp, 'caveman', `v-${SHA1.slice(0, 12)}`))
    expect(await readdir(ruta!, { recursive: true })).not.toContain('.git')
    expect(llamadas.find((a) => a[0] === 'clone')).toContain(REPO_CAVEMAN)
  })

  it('no vuelve a clonar si GitHub sigue en el mismo commit', async () => {
    const llamadas: string[][] = []
    const g = new GestorCaveman({ dir: tmp, git: gitFalso(() => SHA1, llamadas), inicioClaude: join(tmp, 'x.json') })
    await g.actualizar()
    await g.actualizar()
    expect(llamadas.filter((a) => a[0] === 'clone')).toHaveLength(1)
  })

  it('actualiza a un commit nuevo y conserva la versión anterior para sesiones en marcha', async () => {
    let remoto = SHA1
    const g = new GestorCaveman({ dir: tmp, git: gitFalso(() => remoto), inicioClaude: join(tmp, 'x.json') })
    await g.actualizar()
    remoto = SHA2
    await g.actualizar()
    expect((await g.estado())?.sha).toBe(SHA2)
    expect(await g.rutaPlugin()).toBe(join(tmp, 'caveman', `v-${SHA2.slice(0, 12)}`))
    const carpetas = (await readdir(join(tmp, 'caveman'))).filter((n) => n.startsWith('v-'))
    expect(carpetas.sort()).toEqual([`v-${SHA1.slice(0, 12)}`, `v-${SHA2.slice(0, 12)}`])
  })

  it('sin red conserva la copia vigente y anota el error', async () => {
    let remoto = SHA1
    const g = new GestorCaveman({ dir: tmp, git: gitFalso(() => remoto), inicioClaude: join(tmp, 'x.json') })
    await g.actualizar()
    remoto = ''
    const e = await g.actualizar()
    expect(e?.sha).toBe(SHA1)
    expect(e?.error).toContain('sin red')
    expect(await g.rutaPlugin()).toBeDefined()
  })

  it('arranca con el Caveman que ya instaló Claude Code mientras no hay red', async () => {
    const instalado = join(tmp, 'cache')
    await mkdir(join(instalado, '.claude-plugin'), { recursive: true })
    await writeFile(join(instalado, '.claude-plugin', 'plugin.json'), '{"name":"caveman"}')
    const lista = join(tmp, 'installed_plugins.json')
    await writeFile(lista, JSON.stringify({ plugins: { 'caveman@caveman': [{ installPath: instalado, gitCommitSha: SHA1 }] } }))
    const g = new GestorCaveman({ dir: join(tmp, 'datos'), git: gitFalso(() => ''), inicioClaude: lista })
    await g.actualizar()
    expect(await g.rutaPlugin()).toBe(join(tmp, 'datos', 'caveman', `v-${SHA1.slice(0, 12)}`))
  })

  it('desactivado no devuelve plugin ni consulta GitHub', async () => {
    const llamadas: string[][] = []
    const g = new GestorCaveman({ dir: tmp, git: gitFalso(() => SHA1, llamadas), desactivado: true })
    await g.actualizar()
    expect(await g.rutaPlugin()).toBeUndefined()
    expect(llamadas).toHaveLength(0)
  })
})

describe('Caveman ligero y ajustes del usuario', () => {
  it('el ligero lleva solo los ganchos de arranque y prompt, la skill caveman y los scripts', async () => {
    const g = new GestorCaveman({ dir: tmp, git: gitFalso(() => SHA1), inicioClaude: join(tmp, 'x.json') })
    await g.actualizar()
    const completa = (await g.rutaPlugin())!
    await writeFile(
      join(completa, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'caveman', hooks: { SessionStart: [1], SubagentStart: [2], UserPromptSubmit: [3], SessionEnd: [4] } })
    )
    await mkdir(join(completa, 'src', 'hooks'), { recursive: true })
    await mkdir(join(completa, 'skills', 'caveman'), { recursive: true })
    await mkdir(join(completa, 'skills', 'otra'), { recursive: true })
    await mkdir(join(completa, 'agents'), { recursive: true })
    const ligera = (await g.rutaPluginLigero())!
    expect(ligera).toBe(join(tmp, 'caveman', `ligero-${SHA1.slice(0, 12)}`))
    const hooks = JSON.parse(await (await import('node:fs/promises')).readFile(join(ligera, '.claude-plugin', 'plugin.json'), 'utf8')).hooks
    expect(Object.keys(hooks).sort()).toEqual(['SessionStart', 'UserPromptSubmit'])
    expect((await readdir(join(ligera, 'skills'))).sort()).toEqual(['caveman'])
    expect(await readdir(ligera)).not.toContain('agents')
  })

  it('detecta si los ajustes ya activan Caveman', async () => {
    const { cavemanEnAjustes } = await import('../src/main/caveman')
    const w = (o: unknown) => writeFile(join(tmp, 'settings.json'), JSON.stringify(o))
    expect(await cavemanEnAjustes(tmp)).toBe(false) // sin archivo
    await w({ hooks: { SessionStart: [{ hooks: [{ command: 'node ~/.claude/hooks/caveman-activate.js' }] }] } })
    expect(await cavemanEnAjustes(tmp)).toBe(true)
    await w({ enabledPlugins: { 'caveman@caveman': false } })
    expect(await cavemanEnAjustes(tmp)).toBe(false)
    await w({ enabledPlugins: { 'caveman@caveman': true } })
    expect(await cavemanEnAjustes(tmp)).toBe(true)
  })
})
