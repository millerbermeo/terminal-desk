import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { NuevaRegla, ReglaPermiso } from '@shared/core/permisos'
import { esDestructiva } from '../src/main/core/guardrails/destructivo'
import { crearAprobadorHumano } from '../src/main/core/hitl/aprobador'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'
import { coincideComando, decidir, PermisosStore, reglaDe, validarRegla } from '../src/main/core/permisos/reglas'

const cmd = (comando: string, ...args: string[]) => ({ id: '1', nombre: 'ejecutar_comando', entrada: { comando, args } })
const r = (patron: string, accion: 'permitir' | 'denegar' = 'permitir', tipo: 'comando' | 'herramienta' = 'comando') => ({ tipo, patron, accion })

describe('coincidencia de comandos', () => {
  it('exacto o con comodín final', () => {
    expect(coincideComando('pnpm test', 'pnpm', ['test'])).toBe(true)
    expect(coincideComando('pnpm test', 'pnpm', ['test', '--watch'])).toBe(false)
    expect(coincideComando('git commit *', 'git', ['commit', '-m', 'x'])).toBe(true)
    expect(coincideComando('git commit *', 'git', ['status'])).toBe(false)
    expect(coincideComando('git commit *', 'git', ['commit'])).toBe(true)
    expect(coincideComando('*', 'ls', [])).toBe(false)
    // un binario con ruta no se confunde con el comando del PATH
    expect(coincideComando('git status', './git', ['status'])).toBe(false)
  })
})

describe('validarRegla', () => {
  it('rechaza comodines peligrosos, destructivos y malformados', () => {
    expect(validarRegla(r('pnpm test'))).toBeNull()
    expect(validarRegla(r('git commit *'))).toBeNull()
    expect(validarRegla(r('node *'))).toMatch(/código arbitrario/)
    expect(validarRegla(r('bash -c *'))).toMatch(/código arbitrario/)
    expect(validarRegla(r('node scripts/seed.js'))).toBeNull() // exacto sí
    expect(validarRegla(r('git push'))).toMatch(/destructiva/)
    expect(validarRegla(r('rm -rf build'))).toMatch(/destructiva/)
    expect(validarRegla(r('git * status'))).toMatch(/comodín/)
    expect(validarRegla(r('*'))).toMatch(/comodín/)
    expect(validarRegla(r(''))).toMatch(/vacío/)
    expect(validarRegla(r('*', 'permitir', 'herramienta'))).toMatch(/todas/)
    expect(validarRegla(r('escribir_archivo', 'permitir', 'herramienta'))).toBeNull()
    expect(validarRegla(r('mcp__db__*', 'permitir', 'herramienta'))).toBeNull()
    // denegar sí puede ser amplio
    expect(validarRegla(r('rm *', 'denegar'))).toBeNull()
    expect(validarRegla(r('node *', 'denegar'))).toBeNull()
  })
})

describe('decidir', () => {
  it('denegar gana; permitir no aplica a lo destructivo; sin regla se pregunta', () => {
    expect(decidir([r('pnpm test')], cmd('pnpm', 'test'))).toBe('permitir')
    expect(decidir([r('pnpm test'), r('pnpm *', 'denegar')], cmd('pnpm', 'test'))).toBe('denegar')
    expect(decidir([r('git *')], cmd('git', 'push'))).toBeNull() // destructivo: siempre pregunta
    expect(decidir([r('git *')], cmd('git', 'status'))).toBe('permitir')
    expect(decidir([r('git *')], cmd('git', '-c', 'core.pager=sh', 'log'))).toBeNull() // git -c ejecuta programas
    expect(decidir([r('git push', 'denegar')], cmd('git', 'push'))).toBe('denegar') // denegar incluso lo destructivo
    expect(decidir([], cmd('pnpm', 'test'))).toBeNull()
    expect(decidir([r('escribir_archivo', 'permitir', 'herramienta')], { id: '1', nombre: 'escribir_archivo', entrada: {} })).toBe('permitir')
    expect(decidir([r('mcp__db__*', 'permitir', 'herramienta')], { id: '1', nombre: 'mcp__db__drop_table', entrada: {} })).toBeNull()
    expect(esDestructiva('ejecutar_comando', { comando: 'git', args: ['-c', 'x=y', 'log'] })).not.toBeNull()
  })
  it('reglaDe ofrece la regla exacta, salvo en acciones destructivas', () => {
    expect(reglaDe(cmd('pnpm', 'test'))).toEqual({ tipo: 'comando', patron: 'pnpm test', accion: 'permitir' })
    expect(reglaDe(cmd('git', 'push'))).toBeNull()
    expect(reglaDe({ id: '1', nombre: 'escribir_archivo', entrada: {} })).toEqual({ tipo: 'herramienta', patron: 'escribir_archivo', accion: 'permitir' })
    expect(reglaDe(cmd('node', '-e', 'x'))).toEqual({ tipo: 'comando', patron: 'node -e x', accion: 'permitir' }) // exacto: solo ese
  })
})

describe('PermisosStore', () => {
  it('persiste por proyecto, suma las globales, evita duplicados y valida', async () => {
    const s = new PermisosStore(await mkdtemp(join(tmpdir(), 'perm-')))
    await s.agregar(r('pnpm test'), 'p1')
    await s.agregar(r('pnpm test'), 'p1')
    await s.agregar(r('rm *', 'denegar'))
    expect((await s.listar('p1')).map((x) => x.patron)).toEqual(['pnpm test'])
    expect((await s.efectivas('p1')).map((x) => x.patron).sort()).toEqual(['pnpm test', 'rm *'])
    expect((await s.efectivas('p2')).map((x) => x.patron)).toEqual(['rm *'])
    await expect(s.agregar(r('node *'), 'p1')).rejects.toThrow(/arbitrario/)
    await expect(s.agregar(r('ls'), '../x')).rejects.toThrow(/inválido/)
    const id = (await s.listar('p1'))[0]!.id
    expect(await s.eliminar(id, 'p1')).toEqual([])
  })
})

describe('aprobador con reglas', () => {
  function montar(reglas: ReglaPermiso[], respuestas: { aprobado: boolean; siempre?: boolean }[]) {
    const puerta = new PuertaHumana()
    const eventos: EventoAgente[] = []
    const guardadas: NuevaRegla[] = []
    const alEvento = (e: EventoAgente): void => {
      eventos.push(e)
      if (e.tipo === 'solicitud_humana') queueMicrotask(() => puerta.responder(e.solicitudId, respuestas.shift() ?? { aprobado: false }))
    }
    const aprobar = crearAprobadorHumano({ puerta, ejecucionId: 'e', alEvento, reglas: async () => reglas, guardarRegla: async (x) => void guardadas.push(x) })
    return { aprobar, eventos, guardadas }
  }
  const regla = (patron: string, accion: 'permitir' | 'denegar'): ReglaPermiso => ({ id: 'x', tipo: 'comando', patron, accion, creada: '' })

  it('una regla permite sin preguntar y otra deniega; lo destructivo sigue preguntando', async () => {
    const { aprobar, eventos } = montar([regla('pnpm test', 'permitir'), regla('git *', 'permitir'), regla('curl *', 'denegar')], [{ aprobado: true }])
    expect(await aprobar(cmd('pnpm', 'test'), 'ejecucion', 'a')).toBe(true)
    expect(await aprobar(cmd('curl', 'http://x'), 'ejecucion', 'a')).toBe(false)
    expect(eventos.filter((e) => e.tipo === 'solicitud_humana')).toHaveLength(0)
    expect(await aprobar(cmd('git', 'push'), 'ejecucion', 'a')).toBe(true) // preguntó (y se respondió que sí)
    expect(eventos.filter((e) => e.tipo === 'solicitud_humana')).toHaveLength(1)
    expect(eventos.find((e) => e.tipo === 'solicitud_humana')).toMatchObject({ destructivo: true })
  })

  it('«Permitir siempre» guarda la regla exacta (y no se ofrece en lo destructivo)', async () => {
    const { aprobar, eventos, guardadas } = montar([], [{ aprobado: true, siempre: true }, { aprobado: true, siempre: true }])
    await aprobar(cmd('pnpm', 'build'), 'ejecucion', 'a')
    await aprobar(cmd('git', 'push'), 'ejecucion', 'a')
    expect(guardadas).toEqual([{ tipo: 'comando', patron: 'pnpm build', accion: 'permitir' }])
    const sol = eventos.filter((e) => e.tipo === 'solicitud_humana')
    expect(sol[0]).toMatchObject({ puedeSiempre: true })
    expect(sol[1]).not.toHaveProperty('puedeSiempre')
  })
})
