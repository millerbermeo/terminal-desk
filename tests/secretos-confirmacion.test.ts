import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'

vi.mock('../src/main/proyectos', () => ({ DIR: '/nonexistent' }))
import { Agente } from '../src/main/core/agents/agente'
import { Harness, type ConfirmadorSecretos } from '../src/main/core/agents/harness'
import { ejecutarOperacionGit } from '../src/main/core/git/operaciones'
import { ERROR_SECRETOS, Repositorio } from '../src/main/core/git/repositorio'
import { secretosEnDiff } from '../src/main/core/guardrails/secretos'
import { crearConfirmadorSecretos } from '../src/main/core/hitl/aprobador'
import { crearPermisoCli } from '../src/main/core/hitl/permiso-cli'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'
import { RegistroHerramientas } from '../src/main/core/tools/registro'
import { archivosGuardia } from '../src/main/guardia'
import { LlmFalso, resultadosDe, texto, usar } from './ayudas'

// Se arma en tiempo de ejecución para que el propio archivo de pruebas no parezca contener un token.
const TOKEN = 'gh' + 'p_' + 'A1b2C3d4E5'.repeat(4)
const CON_SECRETO = `const cliente = crear()\nconst token = '${TOKEN}'\n`

let dirs: string[] = []
const temporal = async (prefijo: string): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), prefijo))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  dirs = []
})

beforeAll(async () => {
  const casa = await mkdtemp(join(tmpdir(), 'git-casa-'))
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  vi.stubEnv('GIT_AUTHOR_NAME', 'Prueba')
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'prueba@ejemplo.invalid')
  vi.stubEnv('GIT_COMMITTER_NAME', 'Prueba')
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'prueba@ejemplo.invalid')
})

describe('secretosEnDiff', () => {
  it('solo cuenta líneas añadidas, con archivo y línea de la versión nueva', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@',
      '+const x = 1',
      `+const token = '${TOKEN}'`,
      '@@ -10 +11,0 @@',
      `-const viejo = '${TOKEN}'`
    ].join('\n')
    const hs = secretosEnDiff(diff)
    expect(hs).toHaveLength(1)
    expect(hs[0]).toMatchObject({ archivo: 'src/a.ts', linea: 5 })
    expect(hs[0]!.mensaje).toContain('token de GitHub')
    expect(hs[0]!.mensaje).not.toContain(TOKEN)
  })

  it('ignora archivos borrados y valores de ejemplo', () => {
    const diff = ['--- a/x.env', '+++ /dev/null', '@@ -1 +0,0 @@', `-K=${TOKEN}`, '--- a/y.ts', '+++ b/y.ts', '@@ -0,0 +1 @@', "+const api_key = 'your-api-key-here'"].join('\n')
    expect(secretosEnDiff(diff)).toEqual([])
  })
})

describe('commit manual con credenciales', () => {
  const repo = async (): Promise<string> => {
    const d = await temporal('git-secretos-')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d })
    return d
  }

  it('secretosPreparados las encuentra y el commit se frena sin permiso explícito', async () => {
    const d = await repo()
    await writeFile(join(d, 'config.ts'), CON_SECRETO)
    const r = new Repositorio(d)
    await r.preparar(['config.ts'])
    const hs = await r.secretosPreparados()
    expect(hs).toEqual([expect.objectContaining({ archivo: 'config.ts', linea: 2 })])
    await expect(r.commit('añade config')).rejects.toThrow(ERROR_SECRETOS)
    expect(execFileSync('git', ['rev-list', '--all'], { cwd: d, encoding: 'utf8' }).trim()).toBe('')
  })

  it('con permitirSecretos (la persona aceptó el aviso) se confirma', async () => {
    const d = await repo()
    await writeFile(join(d, 'config.ts'), CON_SECRETO)
    const carpetaDe = async (): Promise<string> => d
    await ejecutarOperacionGit(carpetaDe, 'preparar', { proyectoId: 'p' })
    expect(await ejecutarOperacionGit(carpetaDe, 'secretosPreparados', { proyectoId: 'p' })).toHaveLength(1)
    const r = (await ejecutarOperacionGit(carpetaDe, 'commit', { proyectoId: 'p', mensaje: 'a', permitirSecretos: true })) as { hash: string }
    expect(r.hash).toMatch(/^[0-9a-f]+$/)
  })

  it('un commit limpio no pregunta nada', async () => {
    const d = await repo()
    await writeFile(join(d, 'a.ts'), 'export const a = 1\n')
    const r = new Repositorio(d)
    await r.preparar(['a.ts'])
    expect(await r.secretosPreparados()).toEqual([])
    expect((await r.commit('a')).hash).toBeTruthy()
  })
})

describe('Harness: credenciales en lo que va al modelo', () => {
  const montar = (confirmar?: ConfirmadorSecretos) => {
    const registro = new RegistroHerramientas()
    registro.registrar({ nombre: 'leer', descripcion: 'leer', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: CON_SECRETO }) })
    registro.registrar({ nombre: 'credenciales_obtener', descripcion: 'c', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: TOKEN }) })
    return new Harness({ llm: new LlmFalso([usar('1', 'leer'), texto('fin')]), registro, ...(confirmar ? { confirmarSecretos: confirmar } : {}) })
  }
  const agente = new Agente({ nombre: 'a', descripcion: '', sistema: 's' })
  const resultado = async (h: Harness, eventos: EventoAgente[] = []): Promise<string> => {
    const r = await h.ejecutar(agente, { prompt: 'p', cwd: '.', alEvento: (e) => eventos.push(e) })
    return resultadosDe(r.mensajes.at(-2)!)[0]!.texto
  }

  it('sin confirmador se tapan y el modelo recibe la explicación', async () => {
    const eventos: EventoAgente[] = []
    const t = await resultado(montar(), eventos)
    expect(t).not.toContain(TOKEN)
    expect(t).toContain('[REDACTADO:token de GitHub]')
    expect(t).toContain('se taparon una posible credencial')
    expect(eventos.some((e) => e.tipo === 'guardrail')).toBe(true)
  })

  it('si la persona lo permite, va tal cual; si no, tapado', async () => {
    const vistas: string[] = []
    const si: ConfirmadorSecretos = async (l, hs) => (vistas.push(`${l.nombre}:${hs.length}`), true)
    expect(await resultado(montar(si))).toContain(TOKEN)
    expect(vistas).toEqual(['leer:1'])
    expect(await resultado(montar(async () => false))).not.toContain(TOKEN)
  })

  it('las credenciales de prueba guardadas para el modelo no se revisan', async () => {
    const registro = new RegistroHerramientas()
    registro.registrar({ nombre: 'credenciales_obtener', descripcion: 'c', esquema: { type: 'object' }, riesgo: 'lectura', ejecutar: async () => ({ texto: TOKEN }) })
    const h = new Harness({ llm: new LlmFalso([usar('1', 'credenciales_obtener'), texto('fin')]), registro })
    expect(await resultado(h)).toBe(TOKEN)
  })

  it('crearConfirmadorSecretos pregunta con el aviso redactado; en autónomo no pregunta y tapa', async () => {
    const puerta = new PuertaHumana()
    const eventos: Extract<EventoAgente, { tipo: 'solicitud_humana' }>[] = []
    const alEvento = (e: EventoAgente): void => void (e.tipo === 'solicitud_humana' && eventos.push(e))
    const confirmar = crearConfirmadorSecretos({ puerta, ejecucionId: 'e', alEvento })
    const r = confirmar({ id: '1', nombre: 'leer_archivo', entrada: {} }, [{ regla: 'secreto', mensaje: 'posible token de GitHub (ghp_…(40 caracteres))', linea: 2 }], 'a')
    await vi.waitFor(() => expect(eventos).toHaveLength(1))
    expect(eventos[0]).toMatchObject({ secretos: true, clase: 'accion' })
    expect(eventos[0]!.contenido).toContain('línea 2')
    puerta.responder(eventos[0]!.solicitudId, { aprobado: true })
    expect(await r).toBe(true)

    const autonomo = crearConfirmadorSecretos({ puerta, ejecucionId: 'e', alEvento, autonomia: 'autonomo' })
    expect(await autonomo({ id: '2', nombre: 'leer_archivo', entrada: {} }, [{ regla: 'secreto', mensaje: 'x' }], 'a')).toBe(false)
    expect(eventos).toHaveLength(1)
  })
})

describe('suscripción: Read de un archivo con credenciales', () => {
  const montar = (autonomia?: 'autonomo') => {
    const puerta = new PuertaHumana()
    const eventos: EventoAgente[] = []
    const permiso = crearPermisoCli({
      puerta,
      ejecucionId: 'e1',
      alEvento: (e) => void eventos.push(e),
      validar: async () => null,
      reglas: async () => [],
      guardarRegla: async () => undefined,
      ...(autonomia ? { autonomia } : {})
    })
    const solicitudes = () => eventos.filter((e): e is Extract<EventoAgente, { tipo: 'solicitud_humana' }> => e.tipo === 'solicitud_humana')
    return { puerta, eventos, solicitudes, permiso }
  }

  it('avisa con el modal de credenciales y respeta la decisión', async () => {
    const d = await temporal('leer-secretos-')
    const ruta = join(d, 'config.ts')
    await writeFile(ruta, CON_SECRETO)
    const { puerta, solicitudes, permiso } = montar()
    const r = permiso({ herramienta: 'Read', entrada: { file_path: ruta } })
    await vi.waitFor(() => expect(solicitudes()).toHaveLength(1))
    expect(solicitudes()[0]).toMatchObject({ secretos: true, herramienta: 'Read' })
    expect(solicitudes()[0]!.contenido).not.toContain(TOKEN)
    puerta.responder(solicitudes()[0]!.solicitudId, { aprobado: false })
    const negado = await r
    expect(negado.permitir).toBe(false)

    const r2 = permiso({ herramienta: 'Read', entrada: { file_path: ruta } })
    await vi.waitFor(() => expect(solicitudes()).toHaveLength(2))
    puerta.responder(solicitudes()[1]!.solicitudId, { aprobado: true })
    expect(await r2).toEqual({ permitir: true })
  })

  it('en autónomo se deniega sin preguntar; un archivo limpio se permite sin preguntar', async () => {
    const d = await temporal('leer-secretos-')
    await writeFile(join(d, 'config.ts'), CON_SECRETO)
    await writeFile(join(d, 'limpio.ts'), 'export const a = 1\n')
    const auto = montar('autonomo')
    expect((await auto.permiso({ herramienta: 'Read', entrada: { file_path: join(d, 'config.ts') } })).permitir).toBe(false)
    expect(auto.solicitudes()).toHaveLength(0)
    expect(auto.eventos.some((e) => e.tipo === 'guardrail')).toBe(true)
    const normal = montar()
    expect(await normal.permiso({ herramienta: 'Read', entrada: { file_path: join(d, 'limpio.ts') } })).toEqual({ permitir: true })
  })
})

describe('gancho de la guardia: credenciales en Read', () => {
  const ejecutar = async (evento: unknown) => {
    const d = await temporal('gancho-')
    const script = join(d, 'secretos.cjs')
    await writeFile(script, archivosGuardia()['hooks/secretos.cjs']!)
    const r = spawnSync(process.execPath, [script], { input: JSON.stringify(evento), encoding: 'utf8' })
    expect(r.status).toBe(0)
    return r.stdout.trim() ? (JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }) : undefined
  }

  it('contesta «ask» con el motivo redactado si el archivo tiene credenciales', async () => {
    const d = await temporal('gancho-arch-')
    await writeFile(join(d, 'config.ts'), CON_SECRETO)
    const r = await ejecutar({ tool_name: 'Read', cwd: d, tool_input: { file_path: 'config.ts' } })
    expect(r?.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('línea 2: posible token de GitHub')
    expect(r?.hookSpecificOutput.permissionDecisionReason).not.toContain(TOKEN)
  })

  it('no interfiere con archivos limpios, inexistentes, binarios u otras herramientas', async () => {
    const d = await temporal('gancho-arch-')
    await writeFile(join(d, 'a.ts'), 'export const a = 1\n')
    await writeFile(join(d, 'b.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(CON_SECRETO)]))
    expect(await ejecutar({ tool_name: 'Read', cwd: d, tool_input: { file_path: 'a.ts' } })).toBeUndefined()
    expect(await ejecutar({ tool_name: 'Read', cwd: d, tool_input: { file_path: 'no-existe.ts' } })).toBeUndefined()
    expect(await ejecutar({ tool_name: 'Read', cwd: d, tool_input: { file_path: 'b.bin' } })).toBeUndefined()
    expect(await ejecutar({ tool_name: 'Bash', cwd: d, tool_input: { command: 'ls' } })).toBeUndefined()
  })
})
