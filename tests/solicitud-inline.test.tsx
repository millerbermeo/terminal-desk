import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'

type Oyente = (e: EventoAgente) => void
let emitir: Oyente = () => undefined
const responder = vi.fn(async () => undefined)

beforeEach(() => {
  vi.resetModules()
  responder.mockClear()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { core: { onEvento: (cb: Oyente) => ((emitir = cb), () => undefined), responder } }
  }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const pregunta = (ejecucionId: string, solicitudId: string): EventoAgente =>
  ({
    tipo: 'solicitud_humana', ejecucionId, solicitudId, agente: 'a', profundidad: 0, clase: 'pregunta', contenido: '',
    preguntas: [{ pregunta: '¿Qué base de datos?', encabezado: 'BD', opciones: [{ etiqueta: 'Postgres', descripcion: 'sql' }, { etiqueta: 'Mongo' }] }]
  }) as unknown as EventoAgente

describe('solicitudes dentro del chat', () => {
  it('responder una solicitud la envía al proceso principal con su id', async () => {
    const m = await import('../src/renderer/agente/solicitudes')
    m.escucharSolicitudes()
    emitir(pregunta('e1', 's1'))
    emitir(pregunta('e2', 's2'))
    m.responderSolicitud({ solicitudId: 's1', ejecucionId: 'e1', agente: 'a', clase: 'pregunta', contenido: '' }, { aprobado: true, respuestas: { x: 'y' } })
    expect(responder).toHaveBeenCalledWith('s1', { aprobado: true, respuestas: { x: 'y' } })
    m.limpiarEjecucion('e2')
  })

  it('el panel de pregunta pinta opciones y no es modal', async () => {
    const { PanelSolicitud } = await import('../src/renderer/components/ModalSolicitud')
    const html = renderToString(
      <PanelSolicitud
        solicitud={{ solicitudId: 's', ejecucionId: 'e', agente: 'a', clase: 'pregunta', contenido: '', preguntas: [{ pregunta: '¿Qué base de datos?', opciones: [{ etiqueta: 'Postgres' }, { etiqueta: 'Mongo' }] }] }}
        pendientes={1}
        onResponder={() => undefined}
      />
    )
    expect(html).toContain('El asistente te pregunta')
    expect(html).toContain('Postgres')
    expect(html).toContain('Otra respuesta')
    expect(html).not.toContain('modal-fondo')
    expect(html).not.toContain('aria-modal')
  })
})
