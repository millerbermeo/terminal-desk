import { describe, expect, it, vi } from 'vitest'
import { LectorTurno, limitesBloqueo, motivoBloqueo } from '../src/main/core/suscripcion'

const L = { silencioMs: 1000, herramientaMs: 5000 }
const base = { conEco: true, terminado: false, esperandoPersona: 0, herramientasAbiertas: 0, silencioMs: 0 }

describe('vigía de bloqueo del turno', () => {
  it('motivo: solo con el mensaje tomado, sin terminar, sin esperar a la persona y pasado el límite que toca', () => {
    expect(motivoBloqueo({ ...base, silencioMs: 999 }, L)).toBeUndefined()
    expect(motivoBloqueo({ ...base, silencioMs: 1000 }, L)).toMatch(/dejó de responder/)
    expect(motivoBloqueo({ ...base, silencioMs: 9999, conEco: false }, L)).toBeUndefined() // de eso se encarga la espera del eco
    expect(motivoBloqueo({ ...base, silencioMs: 9999, terminado: true }, L)).toBeUndefined()
    expect(motivoBloqueo({ ...base, silencioMs: 9_999_999, esperandoPersona: 1 }, L)).toBeUndefined() // un permiso puede tardar
    expect(motivoBloqueo({ ...base, silencioMs: 4000, herramientasAbiertas: 1 }, L)).toBeUndefined() // un Bash largo
    expect(motivoBloqueo({ ...base, silencioMs: 5000, herramientasAbiertas: 1 }, L)).toMatch(/trabado en una herramienta/)
  })

  it('un turno en silencio se corta solo y termina con error (no se queda esperando)', () => {
    vi.useFakeTimers()
    try {
      const eventos: Record<string, unknown>[] = []
      const alBloqueo = vi.fn()
      const l = new LectorTurno({ prompt: 'p', senal: new AbortController().signal, alEvento: (e) => eventos.push(e) }, () => undefined, () => undefined, () => undefined, alBloqueo, L)
      l.iniciar()
      vi.advanceTimersByTime(800)
      l.procesar({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hola' } } } as never)
      vi.advanceTimersByTime(800) // hubo señal hace 800 ms: sigue vivo
      expect(alBloqueo).not.toHaveBeenCalled()
      vi.advanceTimersByTime(3000)
      expect(alBloqueo).toHaveBeenCalledTimes(1)
      const r = l.finalizar(null, '')
      expect(r.resultado.estado).toBe('error')
      expect(r.resultado.error).toMatch(/dejó de responder/)
      expect(r.bloqueo).toBe(true) // quien llama sabe que puede reanudar
      expect(eventos.at(-1)).toMatchObject({ tipo: 'fin', resultado: { estado: 'error' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('con una herramienta en marcha espera más; esperando un permiso no corta nunca', async () => {
    vi.useFakeTimers()
    try {
      const alBloqueo = vi.fn()
      let resolver: (d: { permitir: true }) => void = () => undefined
      const l = new LectorTurno(
        { prompt: 'p', senal: new AbortController().signal, alEvento: () => undefined, retenerFin: true, alPermiso: () => new Promise((ok) => (resolver = ok)) },
        () => undefined,
        () => undefined,
        () => undefined,
        alBloqueo,
        L
      )
      l.iniciar()
      l.procesar({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm build' } }] } } as never)
      vi.advanceTimersByTime(3000)
      expect(alBloqueo).not.toHaveBeenCalled()
      l.procesar({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } } as never)
      vi.advanceTimersByTime(60_000)
      expect(alBloqueo).not.toHaveBeenCalled()
      resolver({ permitir: true })
      await vi.advanceTimersByTimeAsync(0)
      l.procesar({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } as never)
      vi.advanceTimersByTime(3000)
      expect(alBloqueo).toHaveBeenCalledTimes(1) // sin herramientas ni permisos: vuelve el límite corto
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancelar a mano no es un bloqueo', () => {
    vi.useFakeTimers()
    try {
      const c = new AbortController()
      const alBloqueo = vi.fn()
      const l = new LectorTurno({ prompt: 'p', senal: c.signal, alEvento: () => undefined, retenerFin: true }, () => undefined, () => undefined, () => undefined, alBloqueo, L)
      l.iniciar()
      c.abort()
      vi.advanceTimersByTime(10_000)
      expect(alBloqueo).not.toHaveBeenCalled()
      expect(l.finalizar(null, '').resultado.estado).toBe('cancelado')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('límites del vigía', () => {
  it('por defecto 300 s sin herramienta (la API puede tardar 75–185 s en dar el primer token) y 660 s con una', () => {
    expect(limitesBloqueo({})).toEqual({ silencioMs: 300_000, herramientaMs: 660_000 })
    expect(limitesBloqueo({ ODESK_SILENCIO_TURNO_S: '90', ODESK_SILENCIO_HERRAMIENTA_S: 'x' })).toEqual({ silencioMs: 90_000, herramientaMs: 660_000 })
  })
})
