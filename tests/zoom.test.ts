import { describe, expect, it } from 'vitest'
import { accionDeTecla, nivelSiguiente, porcentajeDe, ZOOM_MAX, ZOOM_MIN } from '@shared/zoom'

describe('zoom', () => {
  it('Ctrl +, Ctrl − y Ctrl 0; sin Ctrl o con Alt no hacen nada', () => {
    const t = (key: string, o: object = { control: true }) => accionDeTecla({ type: 'keyDown', key, ...o })
    expect(t('+')).toBe('acercar')
    expect(t('=')).toBe('acercar')
    expect(t('-')).toBe('alejar')
    expect(t('0')).toBe('restablecer')
    expect(t('+', { meta: true })).toBe('acercar')
    expect(t('+', {})).toBeUndefined()
    expect(t('+', { control: true, alt: true })).toBeUndefined()
    expect(t('a')).toBeUndefined()
    expect(accionDeTecla({ type: 'keyUp', key: '+', control: true })).toBeUndefined()
  })
  it('niveles en pasos de 0,5, con tope, y 100 % en 0', () => {
    expect(porcentajeDe(0)).toBe(100)
    expect(nivelSiguiente(0, 'acercar')).toBe(0.5)
    expect(nivelSiguiente(0.5, 'alejar')).toBe(0)
    expect(nivelSiguiente(3, 'restablecer')).toBe(0)
    expect(nivelSiguiente(ZOOM_MAX, 'acercar')).toBe(ZOOM_MAX)
    expect(nivelSiguiente(ZOOM_MIN, 'alejar')).toBe(ZOOM_MIN)
    expect(porcentajeDe(1)).toBe(120)
  })
})
