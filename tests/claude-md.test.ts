import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { indiceClaudeMd, planClaudeMd, titulosMarkdown, umbralClaudeMd } from '../src/main/core/claude-md'
import { argumentosCli } from '../src/main/core/suscripcion'

const grande = (secciones: number, lineasPorSeccion = 30): string =>
  [
    '# CLAUDE.md',
    '',
    '## Comandos',
    '```bash',
    '# esto es un comentario, no un título',
    'pnpm dev',
    '```',
    ...Array.from({ length: secciones }, (_, i) => [`## Sección ${i + 1}`, ...Array.from({ length: lineasPorSeccion }, (_, j) => `Regla ${i + 1}.${j} con bastante texto para ocupar espacio en la línea.`)]).flat()
  ].join('\n')

let dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  dirs = []
})
const temporal = async (): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), 'claude-md-'))
  dirs.push(d)
  return d
}

describe('CLAUDE.md por partes', () => {
  it('ignora los # dentro de bloques de código', () => {
    const t = titulosMarkdown(grande(2).split('\n'))
    expect(t.map((x) => x.texto)).toEqual(['CLAUDE.md', 'Comandos', 'Sección 1', 'Sección 2'])
  })

  it('índice: comienzo hasta un límite de sección y rangos de líneas correctos', () => {
    const texto = grande(20)
    const lineas = texto.split('\n')
    const idx = indiceClaudeMd(texto, '/p/CLAUDE.md')
    expect(idx).toContain('<comienzo>')
    expect(idx).toContain('pnpm dev')
    expect(idx.length).toBeLessThan(texto.length / 4)
    // Cada entrada apunta a la línea de su título.
    for (const m of idx.matchAll(/^- (\d+)-(\d+) · (Sección \d+)$/gm)) {
      expect(lineas[Number(m[1]) - 1]).toBe(`## ${m[3]}`)
      expect(Number(m[2])).toBeGreaterThanOrEqual(Number(m[1]))
    }
    expect(idx).toMatch(/- \d+-\d+ · Sección 20/)
    expect(idx).toMatch(new RegExp(`- \\d+-${lineas.length} · Sección 20`))
  })

  it('sin títulos, parte el archivo en tramos', () => {
    const texto = Array.from({ length: 600 }, (_, i) => `línea ${i} con texto de relleno suficiente para pasar el umbral`).join('\n')
    expect(indiceClaudeMd(texto, '/p/CLAUDE.md')).toMatch(/- \d+-\d+ · línea/)
  })

  it('plan: excluye solo los CLAUDE.md grandes del proyecto y de sus carpetas padre', async () => {
    const raiz = await temporal()
    const proyecto = join(raiz, 'app')
    await mkdir(join(proyecto, '.claude'), { recursive: true })
    await writeFile(join(raiz, 'CLAUDE.md'), grande(40))
    await writeFile(join(proyecto, 'CLAUDE.md'), '# pequeño\nreglas cortas\n')
    await writeFile(join(proyecto, '.claude', 'CLAUDE.md'), grande(40))
    const plan = await planClaudeMd(proyecto, {})
    expect(plan.excluir.sort()).toEqual([join(proyecto, '.claude', 'CLAUDE.md'), join(raiz, 'CLAUDE.md')].sort())
    expect(plan.guia).toContain('CLAUDE.md por partes')
    expect(plan.guia).not.toContain('reglas cortas')
  })

  it('ODESK_CLAUDE_MD_MAX=0 lo desactiva', async () => {
    const d = await temporal()
    await writeFile(join(d, 'CLAUDE.md'), grande(40))
    expect(umbralClaudeMd({ ODESK_CLAUDE_MD_MAX: '0' })).toBe(0)
    expect(await planClaudeMd(d, { ODESK_CLAUDE_MD_MAX: '0' })).toEqual({ excluir: [], guia: '' })
  })

  it('terminales ✦: archivos inmutables con la exclusión y la guía, nada si no hace falta', async () => {
    const casa = await temporal()
    vi.stubEnv('HOME', casa)
    vi.resetModules()
    try {
      const { argsClaudeMd } = await import('../src/main/agentes')
      const d = await temporal()
      expect(await argsClaudeMd(d)).toBe('')
      await writeFile(join(d, 'CLAUDE.md'), grande(40))
      const a = await argsClaudeMd(d)
      expect(await argsClaudeMd(d)).toBe(a) // misma carpeta mientras no cambie
      const ajustes = /--settings '?([^' ]+)'?/.exec(a)![1]!
      const guia = /--append-system-prompt-file '?([^' ]+)'?/.exec(a)![1]!
      expect(JSON.parse(await readFile(ajustes, 'utf8'))).toEqual({ claudeMdExcludes: [join(d, 'CLAUDE.md')] })
      expect(await readFile(guia, 'utf8')).toContain('CLAUDE.md por partes')
      expect(ajustes.startsWith(casa)).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('el CLI recibe la exclusión por --settings', () => {
    const args = argumentosCli({ autonomia: 'preguntar', verificaciones: [], cwd: '/p', excluirClaudeMd: ['/p/CLAUDE.md'] }, true)
    const i = args.indexOf('--settings')
    expect(JSON.parse(args[i + 1]!)).toEqual({ claudeMdExcludes: ['/p/CLAUDE.md'] })
    expect(argumentosCli({ autonomia: 'preguntar', verificaciones: [], cwd: '/p' }, true)).not.toContain('--settings')
  })
})
