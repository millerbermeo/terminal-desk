import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffEdicion, ProyectoDelChat } from '../src/renderer/components/DiffEdicion'
import { SelectorIdiomaVoz } from '../src/renderer/components/GrabadorVoz'
import { fijarIdiomaDictado, idiomaDictado } from '../src/renderer/agente/grabadora'
import { limpiarParaVoz } from '../src/renderer/agente/utilidades-chat'

afterEach(() => vi.unstubAllGlobals())

describe('diff de las ediciones en el chat', () => {
  const edit = { file_path: '/p/src/a.ts', old_string: 'const a = 1\nconst b = 2', new_string: 'const a = 1\nconst b = 3' }

  it('muestra las líneas quitadas y agregadas con su resumen', () => {
    const html = renderToString(createElement(DiffEdicion, { nombre: 'Edit', entrada: edit }))
    expect(html).toContain('ag-diff-linea quitada')
    expect(html).toContain('ag-diff-linea agregada')
    expect(html).toContain('const b = 3')
    expect(html).toContain('src/a.ts')
  })

  it('ofrece «Devolver» solo si se conoce el proyecto y el cambio no reescribe el archivo', () => {
    const sin = renderToString(createElement(DiffEdicion, { nombre: 'Edit', entrada: edit }))
    expect(sin).not.toContain('Devolver')
    const con = renderToString(createElement(ProyectoDelChat.Provider, { value: 'p1' }, createElement(DiffEdicion, { nombre: 'Edit', entrada: edit })))
    expect(con).toContain('Devolver')
    const escritura = renderToString(createElement(ProyectoDelChat.Provider, { value: 'p1' }, createElement(DiffEdicion, { nombre: 'Write', entrada: { file_path: '/p/n.ts', content: 'x\ny' } })))
    expect(escritura).toContain('archivo completo')
    expect(escritura).not.toContain('Devolver')
  })

  it('una entrada rara no pinta nada ni rompe', () => {
    expect(renderToString(createElement(DiffEdicion, { nombre: 'Edit', entrada: { file_path: 5 } }))).toBe('')
  })

  it('recorta los diffs enormes', () => {
    const grande = Array.from({ length: 500 }, (_, i) => `linea ${i}`).join('\n')
    const html = renderToString(createElement(DiffEdicion, { nombre: 'Write', entrada: { file_path: '/p/g.ts', content: grande } }))
    expect(html).toContain('líneas más')
  })
})

describe('idioma del dictado', () => {
  it('se recuerda y un valor guardado inválido cae a español', () => {
    const datos = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) })
    expect(idiomaDictado()).toBe('es')
    fijarIdiomaDictado('en')
    expect(idiomaDictado()).toBe('en')
    datos.set('voz:idioma', 'zz')
    expect(idiomaDictado()).toBe('es')
  })

  it('sin almacenamiento no falla', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } })
    expect(idiomaDictado()).toBe('es')
    expect(() => fijarIdiomaDictado('fr')).not.toThrow()
  })

  it('el selector lista todos los idiomas y se puede desactivar mientras se graba', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
    const html = renderToString(createElement(SelectorIdiomaVoz, { desactivado: true }))
    for (const c of ['ES', 'EN', 'PT', 'FR', 'DE', 'IT', 'Detectar']) expect(html).toContain(`>${c}<`)
    expect(html).toContain('disabled')
  })
})

describe('leer en voz alta', () => {
  it('no deja que el texto de un bloque de código se lea letra a letra', () => {
    expect(limpiarParaVoz('Corre:\n```bash\nrm -rf /\n```\nListo')).toBe('Corre: (bloque de código) Listo')
  })
})
