import { describe, expect, it } from 'vitest'
import { buscarArchivos, coincidir } from '../src/renderer/editor/busqueda'

const rutas = ['src/main/archivos.ts', 'src/renderer/editor/PanelArchivos.tsx', 'src/renderer/editor/ArbolArchivos.tsx', 'README.md', 'docs/archivos-viejos/notas.md', 'package.json']

describe('buscador de archivos', () => {
  it('ignora mayúsculas y devuelve null si no coincide', () => {
    expect(coincidir('README.md', 'readme')).not.toBeNull()
    expect(coincidir('README.md', 'zzz')).toBeNull()
    expect(coincidir('README.md', '')).toBeNull()
  })
  it('el nombre del archivo pesa más que las carpetas', () => {
    expect(buscarArchivos(rutas, 'archivos')[0]!.ruta).toBe('src/main/archivos.ts')
  })
  it('coincidencia difusa por letras en orden', () => {
    expect(buscarArchivos(rutas, 'pnlarch')[0]!.ruta).toBe('src/renderer/editor/PanelArchivos.tsx')
    expect(buscarArchivos(rutas, 'pkgjson')[0]!.ruta).toBe('package.json')
    expect(buscarArchivos(rutas, 'jsonpkg')).toEqual([])
  })
  it('marca las posiciones coincidentes', () => {
    expect(coincidir('src/app.ts', 'app')!.posiciones).toEqual([4, 5, 6])
  })
  it('busca también por carpeta', () => {
    expect(buscarArchivos(rutas, 'editor/panel').map((c) => c.ruta)).toEqual(['src/renderer/editor/PanelArchivos.tsx'])
    expect(buscarArchivos(rutas, 'editor').map((c) => c.ruta)).toContain('src/renderer/editor/PanelArchivos.tsx')
  })
})
