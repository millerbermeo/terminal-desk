import { describe, expect, it } from 'vitest'
import { aplicarMencion, detectarMencion, opcionesMencion } from '../src/renderer/agente/menciones'

const archivos = ['README.md', 'src/main/archivos.ts', 'src/renderer/Home.tsx', 'src/renderer/pages/Home.tsx', 'dist/agentes.js']

describe('detectarMencion', () => {
  it('reconoce @ al inicio o tras un espacio, hasta el cursor', () => {
    expect(detectarMencion('@Ho', 3)).toEqual({ inicio: 0, consulta: 'Ho' })
    expect(detectarMencion('mira @src/ma', 12)).toEqual({ inicio: 5, consulta: 'src/ma' })
    expect(detectarMencion('mira @', 6)).toEqual({ inicio: 5, consulta: '' })
  })
  it('no es mención: correo, espacio después o cursor antes del @', () => {
    expect(detectarMencion('a@b.com', 7)).toBeNull()
    expect(detectarMencion('@Home y más', 11)).toBeNull()
    expect(detectarMencion('hola @Home', 3)).toBeNull()
  })
  it('usa solo lo anterior al cursor', () => {
    expect(detectarMencion('@Home.tsx', 3)).toEqual({ inicio: 0, consulta: 'Ho' })
  })
})

describe('aplicarMencion', () => {
  it('un archivo cierra con espacio y deja el cursor después', () => {
    expect(aplicarMencion('mira @Ho', 8, { inicio: 5, consulta: 'Ho' }, 'src/Home.tsx', false)).toEqual({ texto: 'mira @src/Home.tsx ', cursor: 19 })
  })
  it('una carpeta termina en / para seguir bajando', () => {
    expect(aplicarMencion('@sr', 3, { inicio: 0, consulta: 'sr' }, 'src', true)).toEqual({ texto: '@src/', cursor: 5 })
  })
  it('conserva el texto que había después del cursor', () => {
    expect(aplicarMencion('ver @Ho y listo', 7, { inicio: 4, consulta: 'Ho' }, 'Home.tsx', false)).toEqual({ texto: 'ver @Home.tsx y listo', cursor: 14 })
  })
})

describe('opcionesMencion', () => {
  it('sin consulta, lo más cercano a la raíz, carpetas antes que archivos', () => {
    const o = opcionesMencion(archivos, '')
    expect(o.slice(0, 3).map((x) => x.ruta)).toEqual(['dist', 'src', 'README.md'])
    expect(o[0]!.carpeta).toBe(true)
  })
  it('filtra por nombre y marca las carpetas', () => {
    const o = opcionesMencion(archivos, 'home')
    expect(o.map((x) => x.ruta)).toEqual(['src/renderer/Home.tsx', 'src/renderer/pages/Home.tsx'])
    expect(opcionesMencion(archivos, 'rend')[0]).toMatchObject({ ruta: 'src/renderer', carpeta: true })
  })
  it('sin coincidencias devuelve vacío', () => {
    expect(opcionesMencion(archivos, 'zzzz')).toEqual([])
  })
})
