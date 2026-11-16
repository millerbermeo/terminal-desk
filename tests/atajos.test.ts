import { describe, expect, it } from 'vitest'
import { ATAJOS_DEF, atajoGlobal, coincide, coincideCombo, formatearCombo, type TeclaEvento } from '@shared/atajos'

const t = (key: string, o: Partial<TeclaEvento> = {}): TeclaEvento => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })

describe('atajos', () => {
  it('los modificadores tienen que coincidir exactamente', () => {
    expect(coincideCombo(t('P', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+P')).toBe(true)
    expect(coincideCombo(t('p', { ctrlKey: true }), 'Ctrl+Shift+P')).toBe(false)
    expect(coincideCombo(t('P', { metaKey: true, shiftKey: true }), 'Ctrl+Shift+P')).toBe(true)
    expect(coincideCombo(t('P', { ctrlKey: true, shiftKey: true, altKey: true }), 'Ctrl+Shift+P')).toBe(false)
  })
  it('dígitos por code (Alt+1) y teclas con nombre', () => {
    expect(coincide(t('¡', { altKey: true, code: 'Digit1' }), 'terminal-1')).toBe(true)
    expect(coincide(t('1', { altKey: true, code: 'Digit2' }), 'terminal-1')).toBe(false)
    expect(coincide(t('Tab', { ctrlKey: true }), 'pestana-siguiente')).toBe(true)
    expect(coincide(t('Tab', { ctrlKey: true, shiftKey: true }), 'pestana-anterior')).toBe(true)
    expect(coincide(t('F1'), 'ayuda')).toBe(true)
    expect(coincide(t('.', { ctrlKey: true }), 'chat-cancelar')).toBe(true)
  })
  it('un atajo informativo no se intercepta', () => {
    expect(coincide(t('s', { ctrlKey: true }), 'ed-guardar')).toBe(false)
  })
  it('atajoGlobal ignora los del chat y los que no existen', () => {
    expect(atajoGlobal(t('P', { ctrlKey: true, shiftKey: true }))).toBe('navegador-rapido')
    expect(atajoGlobal(t('N', { ctrlKey: true, shiftKey: true }))).toBeUndefined()
    expect(atajoGlobal(t('c', { ctrlKey: true }))).toBeUndefined()
    expect(atajoGlobal(t('3', { ctrlKey: true, code: 'Digit3' }))).toBe('ir-asistente')
  })
  it('no hay dos atajos activos con el mismo combo en el mismo ámbito', () => {
    const vistos = new Map<string, string>()
    for (const a of ATAJOS_DEF.filter((x) => !x.informativo))
      for (const c of a.combos) {
        const k = `${a.donde ? 'chat' : 'global'}|${c}`
        expect(vistos.get(k), `${c} repetido en ${a.id}`).toBeUndefined()
        vistos.set(k, a.id)
      }
  })
  it('formatea para mostrar', () => {
    expect(formatearCombo('Ctrl+Shift+P')).toBe('Ctrl + Mayús + P')
    expect(formatearCombo('Ctrl+Shift+P', true)).toBe('⌘ + ⇧ + P')
    expect(formatearCombo('F1')).toBe('F1')
    expect(formatearCombo('Alt+ArrowUp')).toBe('Alt + ↑')
  })
})
