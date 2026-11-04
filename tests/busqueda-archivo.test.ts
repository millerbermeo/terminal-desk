import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { coincidenciaDesde, consultaDe, contarCoincidencias, semillaDeSeleccion, type OpcionesBusqueda } from '../src/renderer/editor/busquedaArchivo'

const op = (texto: string, mas: Partial<OpcionesBusqueda> = {}): OpcionesBusqueda => ({ texto, reemplazo: '', mayusculas: false, palabra: false, regex: false, ...mas })
const doc = 'const suma = 1\nconst Resta = 2\nconsole.log(suma, resumen)\n'
const estado = (anchor = 0, head = anchor): EditorState => EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

describe('buscador dentro del archivo', () => {
  it('cuenta coincidencias y sabe cuál está seleccionada', () => {
    const q = consultaDe(op('suma'))
    expect(contarCoincidencias(estado(), q)).toEqual({ total: 2, actual: 0, valida: true, tope: false })
    const segunda = doc.lastIndexOf('suma')
    expect(contarCoincidencias(estado(segunda, segunda + 4), q).actual).toBe(2)
    expect(contarCoincidencias(estado(), consultaDe(op('')))).toMatchObject({ total: 0, valida: true })
  })

  it('respeta mayúsculas, palabra completa y expresiones regulares', () => {
    expect(contarCoincidencias(estado(), consultaDe(op('resta'))).total).toBe(1)
    expect(contarCoincidencias(estado(), consultaDe(op('resta', { mayusculas: true }))).total).toBe(0)
    expect(contarCoincidencias(estado(), consultaDe(op('cons'))).total).toBe(3)
    expect(contarCoincidencias(estado(), consultaDe(op('cons', { palabra: true }))).total).toBe(0)
    expect(contarCoincidencias(estado(), consultaDe(op('= \\d', { regex: true }))).total).toBe(2)
    expect(contarCoincidencias(estado(), consultaDe(op('(', { regex: true })))).toMatchObject({ total: 0, valida: false })
  })

  it('salta a la primera coincidencia desde el cursor y da la vuelta al llegar al final', () => {
    const q = consultaDe(op('suma'))
    expect(coincidenciaDesde(estado(), q, 0)).toEqual({ from: 6, to: 10 })
    expect(coincidenciaDesde(estado(), q, 11)).toEqual({ from: doc.lastIndexOf('suma'), to: doc.lastIndexOf('suma') + 4 })
    expect(coincidenciaDesde(estado(), q, doc.length)).toEqual({ from: 6, to: 10 })
    expect(coincidenciaDesde(estado(), consultaDe(op('nada')), 0)).toBeUndefined()
  })

  it('siembra el campo con la selección solo si es de una línea', () => {
    expect(semillaDeSeleccion(estado(6, 10))).toBe('suma')
    expect(semillaDeSeleccion(estado(3))).toBeUndefined()
    expect(semillaDeSeleccion(estado(0, 20))).toBeUndefined()
  })
})
