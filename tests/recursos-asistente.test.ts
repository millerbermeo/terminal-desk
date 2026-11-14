import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Recurso } from '@shared/modelos'

process.env.HOME = process.env.HOME ?? tmpdir()
const { archivosPlugin, recursosDeCarpeta } = await import('../src/main/agentes')
const { argumentosCli, entornoEjecucion, herramientasCli } = await import('../src/main/core/suscripcion')
const { guiaRecursos } = await import('../src/main/core/avisos')

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'recursos-'))
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

describe('herramientas Agent y Skill del Asistente', () => {
  it('cada una solo si el proyecto tiene algo que usar con ella (las dos pesan en el contexto de todas las llamadas)', () => {
    const env = {}
    expect(herramientasCli(undefined, env)).not.toEqual(expect.arrayContaining(['Agent']))
    expect(herramientasCli({ agentes: true, skills: false }, env)).toContain('Agent')
    expect(herramientasCli({ agentes: true, skills: false }, env)).not.toContain('Skill')
    expect(herramientasCli({ agentes: false, skills: true }, env)).toContain('Skill')
    expect(herramientasCli({ agentes: false, skills: true }, env)).not.toContain('Agent')
    expect(herramientasCli({ agentes: true, skills: true }, { ODESK_HERRAMIENTAS: 'todas' })).toBeUndefined()
  })

  it('cambiar los recursos cambia los argumentos (y por tanto lanza otro proceso persistente)', () => {
    const base = { autonomia: 'autonomo' as const, verificaciones: [], cwd: tmp }
    const tools = (a: string[]) => a[a.indexOf('--tools') + 1]
    expect(tools(argumentosCli({ ...base, recursos: { agentes: false, skills: true } }, true))).toMatch(/,Skill$/)
    expect(tools(argumentosCli(base, true))).not.toMatch(/Agent|Skill/)
  })

  it('sin las skills del propio CLI: solo las del proyecto', () => {
    expect(entornoEjecucion().CLAUDE_CODE_DISABLE_BUNDLED_SKILLS).toBe('1')
  })
})

describe('recursosDeCarpeta', () => {
  it('detecta los agentes y skills que el repo trae en .claude/ (el CLI los carga aunque no estén en la biblioteca)', async () => {
    expect(await recursosDeCarpeta(tmp)).toEqual({ agentes: false, skills: false })
    await mkdir(join(tmp, '.claude', 'skills', 'vacia'), { recursive: true }) // sin SKILL.md no cuenta
    await mkdir(join(tmp, '.claude', 'agents'), { recursive: true })
    await writeFile(join(tmp, '.claude', 'agents', 'notas.txt'), 'x')
    expect(await recursosDeCarpeta(tmp)).toEqual({ agentes: false, skills: false })
    await writeFile(join(tmp, '.claude', 'agents', 'revisor.md'), '---\nname: revisor\n---\n')
    await mkdir(join(tmp, '.claude', 'skills', 'commit'))
    await writeFile(join(tmp, '.claude', 'skills', 'commit', 'SKILL.md'), '---\nname: commit\n---\n')
    await writeFile(join(tmp, '.claude', 'skills', 'commit', 'SKILL.md'), '---\nname: commit\ndescription: "Úsala al escribir mensajes de commit"\n---\n')
    expect(await recursosDeCarpeta(tmp)).toEqual({
      agentes: true,
      skills: true,
      lista: [{ tipo: 'agente', nombre: 'revisor', descripcion: '' }, { tipo: 'skill', nombre: 'commit', descripcion: 'Úsala al escribir mensajes de commit' }]
    })
  })
})

describe('guiaRecursos', () => {
  it('sin recursos no añade nada al prompt; con ellos, solo el criterio de lo que hay', () => {
    expect(guiaRecursos({ agentes: false, skills: false })).toBe('')
    const soloSkills = guiaRecursos({ agentes: false, skills: true })
    expect(soloSkills).toContain('skill')
    expect(soloSkills).not.toMatch(/herramienta Agent|delégala/)
    expect(guiaRecursos({ agentes: true, skills: true })).toMatch(/Agent[\s\S]*Skill/)
  })

  it('con la lista, nombra cada recurso con su «cuándo» para que el modelo decida contra una tabla', () => {
    const g = guiaRecursos({
      agentes: true,
      skills: true,
      lista: [
        { tipo: 'agente', nombre: 'revisor', descripcion: 'Revisa cambios antes de confirmar.\nBusca errores' },
        { tipo: 'skill', nombre: 'commit', descripcion: 'x'.repeat(400) }
      ]
    })
    expect(g).toContain('- revisor: Revisa cambios antes de confirmar. Busca errores')
    expect(g).toMatch(/- commit: x{100,179}…/)
    expect(g).toMatch(/Una sola vez por conversación/)
    expect(g).toMatch(/No ve esta conversación/)
  })
})

describe('archivosPlugin', () => {
  it('genera el plugin con un archivo por agente y skill, nombres en kebab-case y sin colisiones', () => {
    const r = (id: string, tipo: Recurso['tipo'], nombre: string): Recurso => ({ id, tipo, nombre, descripcion: 'd', contenido: 'c', ambito: 'proyecto', proyectoId: 'p' })
    const a = archivosPlugin('P', [r('1', 'agente', 'Revisor de código'), r('2', 'agente', 'revisor de codigo'), r('3', 'skill', 'Formato')])
    expect(Object.keys(a).sort()).toEqual(['.claude-plugin/plugin.json', 'agents/revisor-de-codigo-2.md', 'agents/revisor-de-codigo.md', 'skills/formato/SKILL.md'])
    expect(a['skills/formato/SKILL.md']).toContain('name: "formato"')
  })
})
