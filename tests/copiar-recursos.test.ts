import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

process.env.HOME = process.env.HOME ?? tmpdir()
const { copiarRecursosCarpeta, listarRecursosCarpeta } = await import('../src/main/copiar-recursos')

let tmp: string
let a: string
let b: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'copiar-'))
  a = join(tmp, 'a')
  b = join(tmp, 'b')
  await mkdir(join(a, '.claude', 'agents'), { recursive: true })
  await mkdir(join(a, '.claude', 'skills', 'mi-skill', 'extra'), { recursive: true })
  await mkdir(b, { recursive: true })
  await writeFile(join(a, '.claude', 'agents', 'revisor.md'), '---\nname: revisor\ndescription: "Revisa código"\n---\ncuerpo')
  await writeFile(join(a, '.claude', 'skills', 'mi-skill', 'SKILL.md'), '---\nname: mi-skill\ndescription: Hace algo\n---\nx')
  await writeFile(join(a, '.claude', 'skills', 'mi-skill', 'extra', 'datos.txt'), 'datos')
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

describe('copiar agentes y skills entre carpetas', () => {
  it('lista agentes y skills con su descripción', async () => {
    const l = await listarRecursosCarpeta(a)
    expect(l.map((r) => `${r.tipo}:${r.clave}:${r.descripcion}`)).toEqual(['agente:revisor.md:Revisa código', 'skill:mi-skill:Hace algo'])
  })

  it('copia el agente y la skill completa; no pisa lo existente salvo sobrescribir', async () => {
    const items = [{ tipo: 'agente' as const, clave: 'revisor.md' }, { tipo: 'skill' as const, clave: 'mi-skill' }]
    expect((await copiarRecursosCarpeta(a, b, items, false)).map((r) => r.estado)).toEqual(['copiado', 'copiado'])
    expect(await readFile(join(b, '.claude', 'skills', 'mi-skill', 'extra', 'datos.txt'), 'utf8')).toBe('datos')

    await writeFile(join(b, '.claude', 'agents', 'revisor.md'), 'local')
    expect((await copiarRecursosCarpeta(a, b, items, false)).map((r) => r.estado)).toEqual(['existe', 'existe'])
    expect(await readFile(join(b, '.claude', 'agents', 'revisor.md'), 'utf8')).toBe('local')

    await copiarRecursosCarpeta(a, b, items, true)
    expect(await readFile(join(b, '.claude', 'agents', 'revisor.md'), 'utf8')).toContain('cuerpo')
  })

  it('rechaza rutas fuera de .claude y el mismo proyecto', async () => {
    const r = await copiarRecursosCarpeta(a, b, [{ tipo: 'agente', clave: '../../x' }, { tipo: 'skill', clave: 'no-existe' }], false)
    expect(r.map((x) => x.estado)).toEqual(['error', 'error'])
    expect((await copiarRecursosCarpeta(a, a, [{ tipo: 'agente', clave: 'revisor.md' }], false))[0]!.estado).toBe('error')
  })

  it('no sigue enlaces simbólicos', async () => {
    await writeFile(join(tmp, 'secreto.txt'), 's')
    await symlink(join(tmp, 'secreto.txt'), join(a, '.claude', 'skills', 'mi-skill', 'enlace.txt'))
    await copiarRecursosCarpeta(a, b, [{ tipo: 'skill', clave: 'mi-skill' }], false)
    await expect(readFile(join(b, '.claude', 'skills', 'mi-skill', 'enlace.txt'))).rejects.toThrow()
  })
})
