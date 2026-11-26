import { describe, expect, it } from 'vitest'
import { alturaNecesaria } from '../src/renderer/agente/auto-altura'

describe('altura automática del campo del chat', () => {
  it('crece con el contenido entre el mínimo y el tope', () => {
    expect(alturaNecesaria(20, 46, 400)).toEqual({ alto: 46, desborda: false })
    expect(alturaNecesaria(130, 46, 400)).toEqual({ alto: 130, desborda: false })
    expect(alturaNecesaria(400, 46, 400)).toEqual({ alto: 400, desborda: false })
  })
  it('al pasar del tope se queda en el tope y se desplaza por dentro', () => {
    expect(alturaNecesaria(900, 46, 400)).toEqual({ alto: 400, desborda: true })
  })
  it('un tope menor que el mínimo no rompe nada', () => {
    expect(alturaNecesaria(10, 46, 30)).toEqual({ alto: 46, desborda: false })
  })
})
