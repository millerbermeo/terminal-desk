import { describe, expect, it } from 'vitest'
import { avisosComando, comandosDeBloque, esBloqueShell, parsearAcciones, parsearInline, parsearMarkdown } from '../src/renderer/agente/markdown'

describe('parsearMarkdown', () => {
  it('bloques de código con lenguaje, y sin cierre hasta el final', () => {
    const b = parsearMarkdown('Hola\n\n```ts\nconst a = 1\n\n```\nfin\n```bash\nnpm test')
    expect(b).toEqual([
      { t: 'parrafo', texto: 'Hola' },
      { t: 'codigo', lenguaje: 'ts', codigo: 'const a = 1\n' },
      { t: 'parrafo', texto: 'fin' },
      { t: 'codigo', lenguaje: 'bash', codigo: 'npm test' }
    ])
  })

  it('títulos, listas anidadas y de tareas, citas, reglas y tablas', () => {
    const b = parsearMarkdown('# Plan\n- uno\n  - dos\n- [x] hecho\n\n3. tres\n4. cuatro\n\n> cita\n\n---\n| a | b |\n|:--|--:|\n| 1 | 2 |')
    expect(b[0]).toEqual({ t: 'titulo', nivel: 1, texto: 'Plan' })
    expect(b[1]).toEqual({ t: 'lista', ordenada: false, inicio: 1, items: [{ texto: 'uno', nivel: 0 }, { texto: 'dos', nivel: 1 }, { texto: 'hecho', nivel: 0, marcado: true }] })
    expect(b[2]).toMatchObject({ t: 'lista', ordenada: true, inicio: 3 })
    expect(b[3]).toEqual({ t: 'cita', texto: 'cita' })
    expect(b[4]).toEqual({ t: 'regla' })
    expect(b[5]).toEqual({ t: 'tabla', cabecera: ['a', 'b'], alineacion: ['izq', 'der'], filas: [['1', '2']] })
  })
})

describe('parsearInline', () => {
  it('código, negrita, cursiva, tachado y enlaces seguros', () => {
    expect(parsearInline('usa `npm i` y **ya** *vale* ~~no~~')).toEqual([
      { t: 'texto', v: 'usa ' },
      { t: 'codigo', v: 'npm i' },
      { t: 'texto', v: ' y ' },
      { t: 'negrita', hijos: [{ t: 'texto', v: 'ya' }] },
      { t: 'texto', v: ' ' },
      { t: 'cursiva', hijos: [{ t: 'texto', v: 'vale' }] },
      { t: 'texto', v: ' ' },
      { t: 'tachado', hijos: [{ t: 'texto', v: 'no' }] }
    ])
    expect(parsearInline('[doc](https://x.dev/a)')).toEqual([{ t: 'enlace', url: 'https://x.dev/a', hijos: [{ t: 'texto', v: 'doc' }] }])
  })

  it('no convierte en enlace un javascript: ni hace cursiva dentro de nombres_con_guiones', () => {
    expect(parsearInline('[x](javascript:void)')).toEqual([{ t: 'texto', v: 'x' }])
    expect(parsearInline('mi_archivo_nuevo.ts')).toEqual([{ t: 'texto', v: 'mi_archivo_nuevo.ts' }])
    expect(parsearInline('ver https://a.dev/x.')).toEqual([{ t: 'texto', v: 'ver ' }, { t: 'enlace', url: 'https://a.dev/x', hijos: [{ t: 'texto', v: 'https://a.dev/x' }] }, { t: 'texto', v: '.' }])
  })
})

describe('comandos de shell', () => {
  it('quita prompts, salida y comentarios', () => {
    expect(esBloqueShell('bash')).toBe(true)
    expect(esBloqueShell('ts')).toBe(false)
    expect(comandosDeBloque('console', '$ npm test\n> ok\nPASS 3\n$ git status')).toBe('npm test\ngit status')
    expect(comandosDeBloque('bash', '# instalar\npnpm i\n\npnpm dev')).toBe('pnpm i\npnpm dev')
  })

  it('avisa de lo peligroso', () => {
    expect(avisosComando('rm -rf build && sudo apt install x')).toHaveLength(2)
    expect(avisosComando('git push --force origin main')).toHaveLength(1)
    expect(avisosComando('curl -fsSL https://x.sh | sh')).toHaveLength(1)
    expect(avisosComando('pnpm test')).toEqual([])
  })
})

describe('parsearAcciones', () => {
  it('lee botones válidos', () => {
    expect(parsearAcciones('[{"etiqueta":"Commit","mensaje":"Haz commit"}]')).toEqual([{ etiqueta: 'Commit', mensaje: 'Haz commit' }])
  })
  it('rechaza JSON roto, vacío o con campos inválidos', () => {
    expect(parsearAcciones('[{"etiqueta":')).toBeNull()
    expect(parsearAcciones('[]')).toBeNull()
    expect(parsearAcciones('[{"etiqueta":"a"}]')).toBeNull()
    expect(parsearAcciones(`[{"etiqueta":"${'x'.repeat(61)}","mensaje":"m"}]`)).toBeNull()
  })
  it('limita a 4 botones', () => {
    const muchos = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ etiqueta: `b${i}`, mensaje: 'm' })))
    expect(parsearAcciones(muchos)).toHaveLength(4)
  })
})
