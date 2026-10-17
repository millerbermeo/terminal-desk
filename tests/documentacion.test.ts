import { describe, expect, it } from 'vitest'
import { buscar, CATEGORIAS, SECCIONES, textoDe } from '../src/renderer/documentacion/contenido'

describe('guía de la app', () => {
  it('cada sección tiene id único, categoría conocida y lo básico escrito', () => {
    const ids = SECCIONES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SECCIONES) {
      expect(CATEGORIAS, s.id).toContain(s.categoria)
      expect(s.gancho.length, s.id).toBeGreaterThan(0)
      expect(s.resumen.length, s.id).toBeGreaterThan(40)
      expect(s.paraQue.length, s.id).toBeGreaterThan(0)
      expect(s.pasos.length, s.id).toBeGreaterThan(0)
    }
  })

  it('los enlaces entre secciones apuntan a secciones que existen y no a sí mismas', () => {
    const ids = new Set(SECCIONES.map((s) => s.id))
    for (const s of SECCIONES)
      for (const r of s.relacionadas ?? []) {
        expect(ids, `${s.id} -> ${r}`).toContain(r)
        expect(r, s.id).not.toBe(s.id)
      }
  })

  it('todas las categorías tienen al menos una sección (el índice no muestra grupos vacíos)', () => {
    for (const c of CATEGORIAS) expect(SECCIONES.some((s) => s.categoria === c), c).toBe(true)
  })

  it('busca sin distinguir tildes ni mayúsculas y exige todas las palabras', () => {
    expect(buscar('Autónomo').map((s) => s.id)).toEqual(buscar('autonomo').map((s) => s.id))
    expect(buscar('worktree').map((s) => s.id)).toContain('flujo')
    expect(buscar('worktree credenciales').map((s) => s.id)).toContain('flujo')
    expect(buscar('worktree zzz')).toEqual([])
  })

  it('sin texto devuelve todas las secciones', () => {
    expect(buscar('   ')).toHaveLength(SECCIONES.length)
  })

  it('el texto de búsqueda incluye pasos, bloques, atajos y límites', () => {
    const editor = SECCIONES.find((s) => s.id === 'editor')!
    const t = textoDe(editor)
    expect(t).toContain('ctrl+s')
    expect(t).toContain('node_modules')
  })
})
