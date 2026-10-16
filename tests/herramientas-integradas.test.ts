import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { registrarIntegradas } from '../src/main/core/tools/integradas'
import { clasificarComando } from '../src/main/core/tools/integradas/terminal'

let cwd: string
const registro = new RegistroHerramientas()
registrarIntegradas(registro)

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'core-'))
  await writeFile(join(cwd, 'a.txt'), 'contenido')
  const fuera = await mkdtemp(join(tmpdir(), 'fuera-'))
  await writeFile(join(fuera, 'secreto.txt'), 'secreto')
  await symlink(fuera, join(cwd, 'enlace'))
})

describe('herramientas integradas', () => {
  it('lee, lista y escribe dentro del proyecto', async () => {
    expect(await registro.llamar('leer_archivo', { ruta: 'a.txt' }, { cwd })).toEqual({ texto: 'contenido' })
    expect((await registro.llamar('listar_directorio', {}, { cwd })).texto).toContain('a.txt')
    await registro.llamar('escribir_archivo', { ruta: 'sub/b.txt', contenido: 'nuevo' }, { cwd })
    expect(await readFile(join(cwd, 'sub/b.txt'), 'utf8')).toBe('nuevo')
  })
  it('bloquea .., rutas absolutas y enlaces simbólicos que escapan', async () => {
    for (const ruta of ['../x', '/etc/passwd', 'enlace/secreto.txt', 'enlace/nuevo.txt']) {
      expect((await registro.llamar('leer_archivo', { ruta }, { cwd })).error, ruta).toBe(true)
    }
    expect((await registro.llamar('escribir_archivo', { ruta: 'enlace/nuevo.txt', contenido: 'x' }, { cwd })).error).toBe(true)
  })
  it('ejecutar_comando corre sin shell', async () => {
    const r = await registro.llamar('ejecutar_comando', { comando: 'echo', args: ['a && b'] }, { cwd })
    expect(r.texto).toBe('a && b')
  })
  it('clasifica comandos', () => {
    expect(clasificarComando('git', ['status'])).toBe('lectura')
    expect(clasificarComando('ls', ['-la'])).toBe('lectura')
    expect(clasificarComando('git', ['push'])).toBe('ejecucion')
    expect(clasificarComando('git', ['branch', '-D', 'x'])).toBe('ejecucion')
    expect(clasificarComando('find', ['.', '-delete'])).toBe('ejecucion')
    expect(clasificarComando('rm', ['-rf', 'x'])).toBe('ejecucion')
  })
})
