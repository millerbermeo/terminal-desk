import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import { LlmFalso, texto, usar } from './ayudas'

// `DIR` (~/.centro-proyectos) se calcula al importar: se apunta HOME a una carpeta temporal antes.
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
let repo: string
let Nucleo: new () => TipoNucleo

beforeAll(async () => {
  const home = await mkdtemp(join(tmpdir(), 'home-'))
  vi.stubEnv('HOME', home)
  repo = join(home, 'proyecto')
  await mkdir(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@example.com')
  git(repo, 'config', 'user.name', 'T')
  await writeFile(join(repo, 'a.txt'), 'uno\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'inicial')
  await mkdir(join(home, '.centro-proyectos'))
  await writeFile(join(home, '.centro-proyectos', 'proyectos.json'), JSON.stringify({ grupos: [], proyectos: [{ id: 'p1', nombre: 'P', ruta: repo }] }))
  ;({ Nucleo } = await import('../src/main/core/index'))
})

/** Lanza un flujo con un LLM guionizado y contesta a las solicitudes humanas con `decidir`. */
async function correr(llm: LlmFalso, decidir: (e: Extract<EventoAgente, { tipo: 'solicitud_humana' }>) => { aprobado: boolean }, aislado = true) {
  const nucleo = new Nucleo()
  await nucleo.preferencias.fijar('api')
  ;(nucleo as unknown as { llm: () => Promise<LlmFalso> }).llm = async () => llm
  const eventos: EventoAgente[] = []
  const terminado = new Promise<Extract<EventoAgente, { tipo: 'flujo_fin' }>>((resolver) => {
    void nucleo.ejecutar({ prompt: 'crea nuevo.txt', proyectoId: 'p1', modo: 'flujo', aislado }, (e) => {
      eventos.push(e)
      if (e.tipo === 'solicitud_humana') queueMicrotask(() => nucleo.responder(e.solicitudId, decidir(e)))
      if (e.tipo === 'flujo_fin') resolver(e)
    })
  })
  return { fin: await terminado, eventos, nucleo }
}

describe('Nucleo: flujo aislado en git worktree', () => {
  it('genera en el worktree, confirma en su rama y no toca el repo original', async () => {
    const llm = new LlmFalso([
      texto('PLAN'),
      usar('w', 'escribir_archivo', { ruta: 'nuevo.txt', contenido: 'hola' }),
      texto('creado nuevo.txt')
    ])
    const { fin, eventos, nucleo } = await correr(llm, () => ({ aprobado: true }))
    expect(fin).toMatchObject({ estado: 'completado' })
    // La traza queda guardada con el flujo completo
    const id = eventos[0]!.ejecucionId
    await vi.waitFor(async () => expect((await nucleo.obtenerTraza(id))?.estado).toBe('completado'))
    const traza = (await nucleo.obtenerTraza(id))!
    expect(traza).toMatchObject({ modo: 'flujo', proyectoId: 'p1' })
    expect(traza.spans.filter((s) => s.tipo === 'evento' && s.nombre === 'flujo_nodo').map((s) => s.atributos!.nodo)).toEqual(['planificacion', 'aprobacion', 'generacion', 'pruebas', 'confirmacion'])
    expect(traza.spans.some((s) => s.tipo === 'agente' && s.nombre === 'generador')).toBe(true)
    expect(traza.spans.some((s) => s.tipo === 'herramienta' && s.nombre === 'escribir_archivo')).toBe(true)
    expect((await nucleo.listarTrazas()).some((t) => t.id === id)).toBe(true)
    const wt = eventos.find((e) => e.tipo === 'worktree' && e.accion === 'creado')
    const conf = eventos.find((e) => e.tipo === 'worktree' && e.accion === 'confirmado')
    expect(wt && conf).toBeTruthy()
    const rama = (conf as Extract<EventoAgente, { tipo: 'worktree' }>).rama
    expect(git(repo, 'show', `${rama}:nuevo.txt`)).toBe('hola')
    expect(existsSync(join(repo, 'nuevo.txt'))).toBe(false) // el árbol del usuario sigue limpio
    expect(git(repo, 'status', '--short')).toBe('')
    expect(fin.resumen).toContain(rama)
  })

  it('un plan rechazado hasta el final descarta el worktree', async () => {
    const llm = new LlmFalso([texto('p1'), texto('p2'), texto('p3')])
    const { fin, eventos } = await correr(llm, () => ({ aprobado: false }))
    expect(fin.estado).toBe('rechazado')
    const creado = eventos.find((e) => e.tipo === 'worktree' && e.accion === 'creado') as Extract<EventoAgente, { tipo: 'worktree' }>
    expect(eventos.some((e) => e.tipo === 'worktree' && e.accion === 'descartado')).toBe(true)
    expect(existsSync(creado.ruta)).toBe(false)
  })

  it('si el diff trae credenciales no confirma y conserva el worktree', async () => {
    const llm = new LlmFalso([
      texto('PLAN'),
      // Se cuela por una vía que el guardrail de escritura no ve: un archivo que no pasa por escribir_archivo
      // (aquí se simula escribiendo directamente en el worktree desde el hook de eventos).
      texto('hecho')
    ])
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('api')
    ;(nucleo as unknown as { llm: () => Promise<LlmFalso> }).llm = async () => llm
    const secreto = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    const eventos: EventoAgente[] = []
    const fin = await new Promise<Extract<EventoAgente, { tipo: 'flujo_fin' }>>((resolver) => {
      void nucleo.ejecutar({ prompt: 'x', proyectoId: 'p1', modo: 'flujo' }, (e) => {
        eventos.push(e)
        if (e.tipo === 'worktree' && e.accion === 'creado') void writeFile(join(e.ruta, 'filtrado.txt'), `token = "${secreto}"`)
        if (e.tipo === 'solicitud_humana') queueMicrotask(() => nucleo.responder(e.solicitudId, { aprobado: true }))
        if (e.tipo === 'flujo_fin') resolver(e)
      })
    })
    expect(fin.estado).toBe('fallido')
    expect(fin.resumen).toContain('credenciales')
    expect(eventos.some((e) => e.tipo === 'guardrail')).toBe(true)
    const conservado = eventos.find((e) => e.tipo === 'worktree' && e.accion === 'conservado') as Extract<EventoAgente, { tipo: 'worktree' }>
    expect(existsSync(conservado.ruta)).toBe(true)
    expect(JSON.stringify(eventos)).not.toContain(secreto)
    expect(await readFile(join(conservado.ruta, 'filtrado.txt'), 'utf8')).toContain('token')
    expect(git(repo, 'branch', '--list', conservado.rama)).not.toBe('')
    expect(git(repo, 'log', '--oneline', conservado.rama)).not.toContain('agente:')
  })

  it('rechaza el flujo aislado en un repo sin commits', async () => {
    const vacio = await mkdtemp(join(tmpdir(), 'vacio-'))
    git(vacio, 'init', '-q')
    const home = process.env.HOME!
    await writeFile(join(home, '.centro-proyectos', 'proyectos.json'), JSON.stringify({ grupos: [], proyectos: [{ id: 'p2', nombre: 'V', ruta: vacio }] }))
    const nucleo = new Nucleo()
    await nucleo.preferencias.fijar('api')
    ;(nucleo as unknown as { llm: () => Promise<LlmFalso> }).llm = async () => new LlmFalso([])
    await expect(nucleo.ejecutar({ prompt: 'x', proyectoId: 'p2', modo: 'flujo' }, () => undefined)).rejects.toThrow(/repositorio git/)
  })
})
