import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { arranque: { operar: async () => [], onEstado: () => () => undefined, onTerminal: () => () => undefined } },
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('comandos de arranque: interfaz', () => {
  it('pinta la lista vacía, el formulario y el botón de arrancar desactivado', async () => {
    const { ArranqueProyecto } = await import('../src/renderer/components/ArranqueProyecto')
    const html = renderToString(<ArranqueProyecto proyecto={{ id: 'p1', nombre: 'Tienda', ruta: '/x' }} onCerrar={() => undefined} onVer={() => undefined} />)
    expect(html).toContain('aria-label="Comandos de arranque de Tienda"')
    expect(html).toContain('Aún no hay comandos de arranque')
    expect(html).toContain('Arrancar todo')
    expect(html).toContain('Arrancar siempre')
    expect(html).toContain('Hasta que el puerto esté abierto')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Arrancar todo/s)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Añadir<\/button>/)
    expect(html).toContain('Ver servicios')
  })

  it('la sección Servicios sin nada en marcha explica cómo empezar y no pinta terminales', async () => {
    vi.doMock('../src/renderer/components/TerminalGrid', () => ({ TerminalGrid: () => <div className="rejilla-falsa" /> })) // la rejilla real arrastra el chat, el editor y media app
    const { Servicios } = await import('../src/renderer/components/Servicios')
    const html = renderToString(
      <Servicios visible terminales={[]} grupoDe={() => ({ id: 'g', nombre: 'G' })} estados={{}} onCerrar={() => undefined} onPty={() => undefined} onDetener={() => undefined} onDetenerProyectos={() => undefined} />
    )
    expect(html).toContain('Ningún servicio en marcha')
    expect(html.replace(/<!-- -->/g, '')).toContain('0 servicios')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Detener todo/s)
    expect(html).not.toContain('rejilla-falsa') // vacío: ni siquiera se monta la rejilla
  })
})
