import { describe, expect, it } from 'vitest'
import { bloqueAjustes, clasificarLateral, clasificarPorReglas, leerClasificacion } from '../src/main/core/ajuste-tarea'

describe('«Preguntar ahora»: pregunta o ajuste de la tarea', () => {
  it('reglas: preguntas sobre lo que pasa', () => {
    for (const t of ['¿qué estás haciendo?', 'cómo va', '¿cuánto falta?', 'por qué tocaste ese archivo', '¿ya terminaste los tests?']) expect(clasificarPorReglas(t).tipo).toBe('pregunta')
  })
  it('reglas: indicaciones que cambian la tarea (también con forma de pregunta)', () => {
    for (const t of ['no toques el archivo de rutas', 'mejor usa zod en vez de yup', 'cambia el color a azul', 'también agrega tests', 'añade un log ahí', 'detente', '¿puedes usar pnpm en vez de npm?', 'ok. ahora quita el botón']) {
      expect(clasificarPorReglas(t).tipo, t).toBe('ajuste')
    }
  })
  it('reglas: pregunta + indicación', () => {
    expect(clasificarPorReglas('¿por qué usas axios? cambia a fetch').tipo).toBe('ambos')
  })

  it('lee la respuesta del modelo y cae a lo escrito si falta la instrucción', () => {
    expect(leerClasificacion('{"tipo":"ajuste","instruccion":"Usa fetch en vez de axios."}', 'x')).toMatchObject({ tipo: 'ajuste', instruccion: 'Usa fetch en vez de axios.', por: 'modelo' })
    expect(leerClasificacion('aquí va: {"tipo":"ambos","pregunta":"¿por qué?"}', 'orig')).toMatchObject({ tipo: 'ambos', instruccion: 'orig', pregunta: '¿por qué?' })
    expect(leerClasificacion('nada', 'x')).toBeUndefined()
    expect(leerClasificacion('{"tipo":"otro"}', 'x')).toBeUndefined()
  })

  it('usa el modelo y, si falla o tarda, las reglas', async () => {
    expect(await clasificarLateral('quiero que el botón sea rojo', 'reg', async () => '{"tipo":"ajuste","instruccion":"Haz el botón rojo."}')).toMatchObject({ tipo: 'ajuste', instruccion: 'Haz el botón rojo.' })
    expect(await clasificarLateral('cambia el color a azul', 'reg', async () => { throw new Error('caído') })).toMatchObject({ tipo: 'ajuste', por: 'reglas' })
    expect(await clasificarLateral('cambia el color a azul', 'reg', () => new Promise(() => undefined), 50)).toMatchObject({ tipo: 'ajuste', por: 'reglas' })
  })

  it('pregunta corta y clara: no gasta llamada al modelo', async () => {
    let llamado = false
    await clasificarLateral('¿cómo vas?', 'reg', async () => ((llamado = true), '{}'))
    expect(llamado).toBe(false)
  })

  it('el mensaje de continuación lleva las indicaciones y pide no empezar de nuevo', () => {
    const b = bloqueAjustes(['Usa fetch', 'No toques rutas'])
    expect(b).toContain('1. Usa fetch')
    expect(b).toContain('2. No toques rutas')
    expect(b).toMatch(/no la empieces de nuevo/)
  })
})
