import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'

vi.mock('../src/main/autenticacion', () => ({ verificarPassword: async (p: string) => (p === 'buena' ? { ok: true } : { ok: false, motivo: 'incorrecta' }) }))
import { grepSensible, motivoBashSensible } from '../src/main/core/guardrails/acceso-sensible'
import { crearPermisoCli } from '../src/main/core/hitl/permiso-cli'
import { verificarSudo } from '../src/main/core/hitl/sudo'
import { PuertaHumana } from '../src/main/core/orchestrator/puerta'
import { permisosCli } from '../src/main/core/suscripcion'
import { archivosGuardia } from '../src/main/guardia'

describe('motivoBashSensible', () => {
  it.each([
    'cat .env',
    'cat apps/api/.env.production',
    'grep DATABASE .env.local',
    'source .env && npm start',
    'printenv',
    'env | grep KEY',
    'export -p',
    'echo $OPENAI_API_KEY',
    'echo "${DB_PASSWORD}"',
    'node -e "console.log(process.env)"',
    'vercel env pull',
    'heroku config -a mi-app',
    'kubectl get secret db -o yaml',
    'aws secretsmanager get-secret-value --secret-id prod/db',
    'gcloud secrets versions access latest --secret=x',
    'cat ~/.aws/credentials',
    'cat ~/.ssh/id_ed25519',
    'cat /proc/1/environ',
    'gh auth token',
    'docker inspect api'
  ])('pide contraseña: %s', (c) => expect(motivoBashSensible(c)).not.toBeNull())

  it.each([
    'ls src',
    'cat .env.example',
    'git status',
    'grep -rn "process.env" src',
    'pnpm test',
    'env NODE_ENV=test pnpm test',
    'set -e; pnpm build',
    'cat ~/.ssh/id_ed25519.pub',
    'echo $PATH',
    'gh secret list'
  ])('no pide: %s', (c) => expect(motivoBashSensible(c)).toBeNull())
})

describe('grepSensible', () => {
  it('detecta rutas y filtros de archivos de credenciales', () => {
    expect(grepSensible({ pattern: 'DB', path: '.env' })).not.toBeNull()
    expect(grepSensible({ pattern: 'DB', glob: '**/.env*' })).not.toBeNull()
    expect(grepSensible({ pattern: 'DB', path: 'src' })).toBeNull()
    expect(grepSensible({ pattern: 'DB', glob: '.env.example' })).toBeNull()
  })
})

describe('permiso del CLI: acceso a credenciales con la contraseña del equipo', () => {
  const montar = (autonomia?: 'autonomo') => {
    const puerta = new PuertaHumana()
    const eventos: EventoAgente[] = []
    const permiso = crearPermisoCli({ puerta, ejecucionId: 'e1', alEvento: (e) => void eventos.push(e), validar: async () => null, reglas: async () => [], guardarRegla: async () => undefined, ...(autonomia ? { autonomia } : {}) })
    const solicitudes = () => eventos.filter((e): e is Extract<EventoAgente, { tipo: 'solicitud_humana' }> => e.tipo === 'solicitud_humana')
    return { puerta, solicitudes, permiso }
  }
  const autorizar = async (m: ReturnType<typeof montar>, n: number) => {
    await vi.waitFor(() => expect(m.solicitudes()).toHaveLength(n))
    const s = m.solicitudes()[n - 1]!
    expect(s).toMatchObject({ sudo: true, credenciales: true })
    expect(await verificarSudo(s.solicitudId, 'buena')).toEqual({ ok: true })
    m.puerta.responder(s.solicitudId, { aprobado: true })
  }

  it('Bash de solo lectura sobre .env: pregunta (también en autónomo) y deja pasar con la contraseña', async () => {
    for (const autonomia of [undefined, 'autonomo'] as const) {
      const m = montar(autonomia)
      const r = m.permiso({ herramienta: 'Bash', entrada: { command: 'cat .env' } })
      await autorizar(m, 1)
      expect(await r).toEqual({ permitir: true })
    }
  })

  it('denegar o aprobar sin contraseña verificada no deja pasar', async () => {
    const m = montar()
    const r = m.permiso({ herramienta: 'Bash', entrada: { command: 'printenv' } })
    await vi.waitFor(() => expect(m.solicitudes()).toHaveLength(1))
    m.puerta.responder(m.solicitudes()[0]!.solicitudId, { aprobado: true })
    expect((await r).permitir).toBe(false)
  })

  it('Grep sobre .env y credenciales_obtener piden la contraseña', async () => {
    const m = montar()
    const g = m.permiso({ herramienta: 'Grep', entrada: { pattern: 'KEY', path: '.env' } })
    await autorizar(m, 1)
    expect(await g).toEqual({ permitir: true })
    const c = m.permiso({ herramienta: 'mcp__odesk__credenciales_obtener', entrada: { nombre: 'admin' } })
    await autorizar(m, 2)
    expect(await c).toEqual({ permitir: true })
  })

  it('un comando normal de solo lectura sigue sin preguntar', async () => {
    const m = montar()
    expect(await m.permiso({ herramienta: 'Bash', entrada: { command: 'ls src' } })).toEqual({ permitir: true })
    expect(m.solicitudes()).toHaveLength(0)
  })

  it('credenciales_obtener no va en las herramientas permitidas del CLI en ningún modo', () => {
    for (const a of ['preguntar', 'ediciones', 'autonomo'] as const) expect(permisosCli(a, [], true)).not.toContain('mcp__odesk__credenciales_obtener')
  })
})

describe('gancho de la guardia: archivos de credenciales por nombre y Grep', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
  })
  const ejecutar = async (evento: unknown) => {
    dir = await mkdtemp(join(tmpdir(), 'gancho-sensible-'))
    const script = join(dir, 'secretos.cjs')
    await writeFile(script, archivosGuardia()['hooks/secretos.cjs']!)
    await writeFile(join(dir, '.env'), 'PUERTO=3000\n')
    const r = spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: dir, ...(evento as object) }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    return r.stdout.trim() ? (JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision : undefined
  }

  it('Read de .env (aunque no tenga secretos visibles) y Grep sobre .env contestan «ask»; lo demás no interfiere', async () => {
    expect(await ejecutar({ tool_name: 'Read', tool_input: { file_path: '.env' } })).toBe('ask')
    expect(await ejecutar({ tool_name: 'Grep', tool_input: { pattern: 'x', path: '.env' } })).toBe('ask')
    expect(await ejecutar({ tool_name: 'Grep', tool_input: { pattern: 'x', glob: '**/.env*' } })).toBe('ask')
    expect(await ejecutar({ tool_name: 'Grep', tool_input: { pattern: 'x', path: 'src' } })).toBeUndefined()
    expect(await ejecutar({ tool_name: 'Read', tool_input: { file_path: '.env.example' } })).toBeUndefined()
  })

  it('el gancho de secretos también está en Grep', () => {
    const hooks = JSON.parse(archivosGuardia()['hooks/hooks.json']!) as { hooks: { PreToolUse: { matcher: string }[] } }
    expect(hooks.hooks.PreToolUse.map((h) => h.matcher)).toEqual(['Read', 'Grep'])
  })
})
