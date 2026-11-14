import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'

vi.mock('../src/main/autenticacion', () => ({
  verificarPassword: async (p: string) => (p === 'buena' ? { ok: true } : { ok: false, motivo: 'incorrecta' })
}))

const { crearPermisoCli } = await import('../src/main/core/hitl/permiso-cli')
const { PuertaHumana } = await import('../src/main/core/orchestrator/puerta')
const { armarSudo, reescribirSudo, sinSudo, usaSudo, verificarSudo } = await import('../src/main/core/hitl/sudo')

const ejecutar = promisify(execFile)

function montar(autonomia?: 'autonomo') {
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
  const solicitudes = (): Extract<EventoAgente, { tipo: 'solicitud_humana' }>[] => eventos.filter((e) => e.tipo === 'solicitud_humana') as never
  return { puerta, eventos, solicitudes, permiso }
}

describe.skipIf(process.platform === 'win32')('sudo desde el Asistente', () => {
  it('detecta sudo como programa y lo quita para los guardrails', () => {
    expect(usaSudo('sudo apt update')).toBe(true)
    expect(usaSudo('cd x && sudo -u root ls')).toBe(true)
    expect(usaSudo('echo pseudo; nosudo x')).toBe(false)
    expect(sinSudo('sudo -u root rm -rf /')).toBe('rm -rf /')
    expect(sinSudo('cd x && sudo -E apt install y')).toBe('cd x && apt install y')
    expect(reescribirSudo('ls && sudo apt update', '/a b/askpass.sh', 't1')).toBe("export SUDO_ASKPASS='/a b/askpass.sh' ODESK_SUDO_TOKEN='t1'; ls && sudo -A apt update")
  })

  it('pide la contraseña, la verifica y reescribe el comando a sudo -A (sin la contraseña en el comando)', async () => {
    const { puerta, solicitudes, permiso } = montar()
    const r = permiso({ herramienta: 'Bash', entrada: { command: 'sudo apt update' } })
    await vi.waitFor(() => expect(solicitudes().length).toBe(1))
    const s = solicitudes()[0]!
    expect(s).toMatchObject({ sudo: true, clase: 'accion', contenido: '$ sudo apt update' })
    expect(await verificarSudo(s.solicitudId, 'mala')).toEqual({ ok: false, motivo: 'incorrecta' })
    expect(await verificarSudo(s.solicitudId, 'buena')).toEqual({ ok: true })
    puerta.responder(s.solicitudId, { aprobado: true })
    const res = await r
    expect(res.permitir).toBe(true)
    const cmd = String((res as unknown as { entrada: { command: string } }).entrada.command)
    expect(cmd).toMatch(/^export SUDO_ASKPASS='[^']+askpass\.sh' ODESK_SUDO_TOKEN='[0-9a-f]{48}'; sudo -A apt update$/)
    expect(cmd).not.toContain('buena')
    // la solicitud ya terminó: no admite otra contraseña
    expect(await verificarSudo(s.solicitudId, 'buena')).toEqual({ ok: false, motivo: 'expirada' })
  })

  it('denegar o aprobar sin contraseña verificada no ejecuta', async () => {
    const { puerta, solicitudes, permiso } = montar()
    const r1 = permiso({ herramienta: 'Bash', entrada: { command: 'sudo ls' } })
    await vi.waitFor(() => expect(solicitudes().length).toBe(1))
    puerta.responder(solicitudes()[0]!.solicitudId, { aprobado: false })
    expect(await r1).toMatchObject({ permitir: false, mensaje: expect.stringMatching(/denegó/) })
    const r2 = permiso({ herramienta: 'Bash', entrada: { command: 'sudo ls' } })
    await vi.waitFor(() => expect(solicitudes().length).toBe(2))
    puerta.responder(solicitudes()[1]!.solicitudId, { aprobado: true })
    expect(await r2).toMatchObject({ permitir: false, mensaje: expect.stringMatching(/contraseña/) })
  })

  it('en autónomo pregunta por sudo, pero deniega si lo de dentro es catastrófico', async () => {
    const { solicitudes, eventos, permiso } = montar('autonomo')
    expect(await permiso({ herramienta: 'Bash', entrada: { command: 'sudo rm -rf /' } })).toMatchObject({ permitir: false })
    expect(eventos).toEqual([expect.objectContaining({ tipo: 'guardrail' })])
    void permiso({ herramienta: 'Bash', entrada: { command: 'sudo systemctl restart nginx' } })
    await vi.waitFor(() => expect(solicitudes()).toHaveLength(1))
  })

  it('el ayudante SUDO_ASKPASS entrega la contraseña solo con el token válido', async () => {
    const { askpass, token } = await armarSudo('s3creta')
    const { stdout } = await ejecutar(askpass, [], { env: { ...process.env, ODESK_SUDO_TOKEN: token } })
    expect(stdout).toBe('s3creta\n')
    await expect(ejecutar(askpass, [], { env: { ...process.env, ODESK_SUDO_TOKEN: 'falso' } })).rejects.toBeTruthy()
  })
})
