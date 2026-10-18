import { describe, expect, it } from 'vitest'
import { aplicarBloques, compararTextos } from '@shared/diff'

const t = (...l: string[]): string => l.join('\n')

describe('compararTextos', () => {
  it('textos iguales: sin bloques', () => {
    expect(compararTextos('a\nb', 'a\nb')).toMatchObject({ iguales: true, bloques: [], agregadas: 0, quitadas: 0, modificadas: 0 })
  })

  it('distingue agregadas, quitadas y modificadas', () => {
    const a = t('uno', 'dos', 'tres', 'cuatro', 'cinco')
    const b = t('uno', 'DOS', 'tres', 'cinco', 'seis')
    const d = compararTextos(a, b)
    // dos→DOS es una modificación; «cuatro» se quitó; «seis» se agregó
    expect(d).toMatchObject({ iguales: false, modificadas: 1, quitadas: 1, agregadas: 1, aproximado: false })
    const l = d.bloques.flatMap((x) => x.lineas)
    expect(l.find((x) => x.texto === 'dos')).toMatchObject({ tipo: 'quitada', modificada: true, a: 2 })
    expect(l.find((x) => x.texto === 'DOS')).toMatchObject({ tipo: 'agregada', modificada: true, b: 2 })
    expect(l.find((x) => x.texto === 'cuatro')).toMatchObject({ tipo: 'quitada' })
    expect(l.find((x) => x.texto === 'cuatro')!.modificada).toBeUndefined()
    expect(l.find((x) => x.texto === 'seis')).toMatchObject({ tipo: 'agregada', b: 5 })
  })

  it('numera las líneas de origen y de destino', () => {
    const d = compararTextos(t('a', 'b', 'c'), t('a', 'x', 'y', 'c'))
    const igual = d.bloques[0]!.lineas.filter((l) => l.tipo === 'igual')
    expect(igual).toEqual([
      { tipo: 'igual', texto: 'a', a: 1, b: 1 },
      { tipo: 'igual', texto: 'c', a: 3, b: 4 }
    ])
  })

  it('un texto vacío cuenta como una línea vacía: la primera línea nueva la sustituye', () => {
    expect(compararTextos('', t('a', 'b'))).toMatchObject({ modificadas: 1, agregadas: 1, quitadas: 0 })
    const vaciado = compararTextos('a\nb\n', '')
    expect(vaciado).toMatchObject({ quitadas: 2, modificadas: 0, agregadas: 0 }) // a y b; la línea final vacía es común
  })

  it('agrupa en bloques con 3 líneas de contexto y separa los cambios lejanos', () => {
    const base = Array.from({ length: 40 }, (_, i) => `l${i + 1}`)
    const cambiado = [...base]
    cambiado[2] = 'CAMBIO A'
    cambiado[30] = 'CAMBIO B'
    const d = compararTextos(t(...base), t(...cambiado))
    expect(d.bloques).toHaveLength(2)
    expect(d.bloques.map((b) => b.id)).toEqual([0, 1])
    const primero = d.bloques[0]!.lineas
    expect(primero.length).toBe(1 + 1 + 2 + 3) // 2 de contexto antes (línea 1-2), quitada, agregada, 3 después
    expect(d.bloques[0]!.aInicio).toBe(1)
    expect(d.bloques[1]!.aInicio).toBe(28)
    // cambios próximos se unen en un solo bloque
    const cerca = [...base]
    cerca[10] = 'X'
    cerca[14] = 'Y'
    expect(compararTextos(t(...base), t(...cerca)).bloques).toHaveLength(1)
  })

  it('un cambio de saltos de línea (CRLF) se ve como modificación', () => {
    expect(compararTextos('a\r\nb', 'a\nb')).toMatchObject({ modificadas: 1 })
  })

  it('textos enormes y muy distintos se comparan por bloques enteros (aproximado)', () => {
    const a = Array.from({ length: 2000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 2000 }, (_, i) => `b${i}`)
    const d = compararTextos(t(...a), t(...b))
    expect(d.aproximado).toBe(true)
    expect(d.modificadas).toBe(2000)
  })

  it('es rápido con archivos grandes con pocos cambios', () => {
    const base = Array.from({ length: 30_000 }, (_, i) => `linea ${i}`)
    const cambiado = [...base]
    cambiado[100] = 'distinta'
    cambiado.splice(20_000, 0, 'insertada')
    const t0 = Date.now()
    const d = compararTextos(t(...base), t(...cambiado))
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(d).toMatchObject({ modificadas: 1, agregadas: 1, quitadas: 0, aproximado: false })
  })
})

describe('aplicarBloques (restaurar cambios concretos)', () => {
  const base = Array.from({ length: 40 }, (_, i) => `l${i + 1}`)
  const actual = [...base]
  actual[2] = 'ACTUAL A'
  actual[30] = 'ACTUAL B'
  const textoActual = t(...actual)
  const textoBase = t(...base)

  it('con todos los bloques da exactamente el texto destino', () => {
    const d = compararTextos(textoActual, textoBase)
    expect(aplicarBloques(textoActual, textoBase, d.bloques.map((b) => b.id))).toBe(textoBase)
  })

  it('sin bloques deja el texto actual', () => {
    expect(aplicarBloques(textoActual, textoBase, [])).toBe(textoActual)
  })

  it('restaura solo el bloque elegido y respeta el otro', () => {
    const d = compararTextos(textoActual, textoBase)
    expect(d.bloques).toHaveLength(2)
    const soloPrimero = aplicarBloques(textoActual, textoBase, [0]).split('\n')
    expect(soloPrimero[2]).toBe('l3') // restaurado
    expect(soloPrimero[30]).toBe('ACTUAL B') // intacto
    const soloSegundo = aplicarBloques(textoActual, textoBase, [1]).split('\n')
    expect(soloSegundo[2]).toBe('ACTUAL A')
    expect(soloSegundo[30]).toBe('l31')
  })

  it('restaura líneas borradas y quita las agregadas', () => {
    const antes = t('a', 'b', 'c', 'd')
    const ahora = t('a', 'c', 'd', 'extra')
    const d = compararTextos(ahora, antes)
    const r = aplicarBloques(ahora, antes, d.bloques.map((b) => b.id))
    expect(r).toBe(antes)
  })

  it('ignora números de bloque que no existen y conserva el final de archivo', () => {
    const a = 'uno\ndos\n'
    const b = 'uno\nDOS\n'
    expect(aplicarBloques(a, b, [99])).toBe(a)
    expect(aplicarBloques(a, b, [0])).toBe(b)
    expect(aplicarBloques(b, b, [0])).toBe(b)
  })
})
