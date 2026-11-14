import { describe, expect, it } from 'vitest'
import { cargarLenguaje, lenguajeDe } from '../src/renderer/editor/lenguajes'
import { bloqueContextoPrevio } from '../src/main/core/consumo'

describe('lenguajes del editor', () => {
  it('reconoce lenguajes más allá de los incluidos', () => {
    expect(lenguajeDe('/p/index.php').nombre).toBe('PHP')
    expect(lenguajeDe('/p/main.go').nombre).toBe('Go')
    expect(lenguajeDe('/p/Dockerfile').nombre).toBe('Dockerfile')
    expect(lenguajeDe('/p/Makefile').nombre).toBe('Shell')
    expect(lenguajeDe('/p/script', '#!/usr/bin/env bash').nombre).toBe('Shell')
    expect(lenguajeDe('/p/notas.txt').nombre).toBe('Texto')
    expect(lenguajeDe('/p/a.ts').extension).toBeTruthy()
  })

  it('carga el resaltado de PHP', async () => {
    expect(await cargarLenguaje('/p/index.php')).toBeTruthy()
    expect(await cargarLenguaje('/p/a.ts')).toBeNull() // ya incluido
  })
})

describe('traspaso de contexto', () => {
  it('el bloque explica que viene de otra conversación', () => {
    const b = bloqueContextoPrevio('## Objetivo\nX', 'traspaso')
    expect(b).toContain('motivo="traspaso"')
    expect(b).toContain('conversación nueva')
    expect(b).toContain('## Objetivo')
  })
})
