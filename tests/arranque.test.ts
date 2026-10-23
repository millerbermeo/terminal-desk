import { describe, expect, it } from 'vitest'
import {
  aplicarComando,
  claveComando,
  clasificarPuerto,
  contieneTexto,
  dentroDe,
  describirConflicto,
  limpiarLista,
  moverComando,
  normalizarCarpeta,
  ordenar,
  proyectoDeCarpeta,
  puertoSugerido,
  quitarComando,
  sinAnsi,
  validarComando,
  type ComandoArranque,
  type ProyectoRuta
} from '../src/shared/arranque'

let n = 0
const id = (): string => `c${++n}`
const base = (extra: Partial<ComandoArranque> = {}): ComandoArranque => ({ id: 'x', nombre: 'API', comando: 'pnpm dev', orden: 0, esperar: 'nada', esperaMs: 0, siempre: false, ...extra })

describe('arranque: normalización', () => {
  it('la carpeta se normaliza (./, barras, final)', () => {
    expect(normalizarCarpeta('./api/')).toBe('api')
    expect(normalizarCarpeta('api\\src\\')).toBe('api/src')
    expect(normalizarCarpeta('.')).toBe('')
    expect(normalizarCarpeta(undefined)).toBe('')
    expect(normalizarCarpeta('a//b')).toBe('a/b')
  })
  it('dos comandos son iguales por texto y carpeta, sin importar espacios ni mayúsculas', () => {
    expect(claveComando({ comando: '  pnpm   DEV ' })).toBe(claveComando({ comando: 'pnpm dev', cwd: '.' }))
    expect(claveComando({ comando: 'pnpm dev', cwd: 'api' })).not.toBe(claveComando({ comando: 'pnpm dev', cwd: 'web' }))
    expect(claveComando({ comando: 'pnpm dev', cwd: './api/' })).toBe(claveComando({ comando: 'pnpm dev', cwd: 'api' }))
  })
})

describe('arranque: validación', () => {
  it('exige nombre y comando', () => {
    expect(validarComando({ nombre: ' ', comando: 'x' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'API', comando: '  ' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando(null, [], 'a')).toMatchObject({ ok: false })
  })
  it('un comando por entrada: rechaza saltos de línea y caracteres de control (no se puede colar Ctrl+C ni otra línea)', () => {
    expect(validarComando({ nombre: 'a', comando: 'pnpm i\npnpm dev' }, [], 'a')).toMatchObject({ ok: false, mensaje: expect.stringContaining('Un comando por entrada') })
    expect(validarComando({ nombre: 'a', comando: 'pnpm dev\u0003' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'pnpm dev\r' }, [], 'a')).toMatchObject({ ok: true }) // el final se recorta
  })
  it('la carpeta debe ser relativa y no salir del proyecto', () => {
    for (const cwd of ['/etc', '~/x', 'C:\\x', '../otro', 'a/../../b']) expect(validarComando({ nombre: 'a', comando: 'x', cwd }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', cwd: './api/src' }, [], 'a')).toMatchObject({ ok: true, comando: { cwd: 'api/src' } })
  })
  it('puerto entre 1 y 65535; esperar puerto lo exige; esperar texto exige el texto', () => {
    expect(validarComando({ nombre: 'a', comando: 'x', puerto: 0 }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', puerto: 70000 }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', puerto: 'abc' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', puerto: 3000.5 }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', esperar: 'puerto' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', esperar: 'texto' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', puerto: '3000' }, [], 'a')).toMatchObject({ ok: true, comando: { puerto: 3000, esperar: 'puerto', esperaMs: 90_000 } })
  })
  it('el texto de «listo» no puede estar en el propio comando (la terminal lo repite al escribirlo)', () => {
    expect(validarComando({ nombre: 'a', comando: 'pnpm dev', esperar: 'texto', textoListo: 'DEV' }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'pnpm dev', esperar: 'texto', textoListo: 'ready in' }, [], 'a')).toMatchObject({ ok: true, comando: { textoListo: 'ready in' } })
  })
  it('la espera tiene valores por defecto y límites', () => {
    expect(validarComando({ nombre: 'a', comando: 'x', esperar: 'tiempo' }, [], 'a')).toMatchObject({ ok: true, comando: { esperaMs: 3000 } })
    expect(validarComando({ nombre: 'a', comando: 'x', esperar: 'tiempo', esperaMs: -1 }, [], 'a')).toMatchObject({ ok: false })
    expect(validarComando({ nombre: 'a', comando: 'x', esperar: 'tiempo', esperaMs: 9_999_999 }, [], 'a')).toMatchObject({ ok: false })
  })
})

describe('arranque: no se repiten comandos en un mismo proyecto', () => {
  const lista = [base({ id: 'a', nombre: 'API', comando: 'pnpm dev', cwd: 'api', puerto: 3000 })]
  it('mismo comando en la misma carpeta', () => {
    expect(validarComando({ nombre: 'Otra', comando: ' PNPM  dev ', cwd: './api/' }, lista, 'z')).toMatchObject({ ok: false, mensaje: expect.stringContaining('mismo comando') })
  })
  it('el mismo comando en otra carpeta SÍ es válido (monorepo)', () => {
    expect(validarComando({ nombre: 'Web', comando: 'pnpm dev', cwd: 'web' }, lista, 'z')).toMatchObject({ ok: true })
  })
  it('mismo nombre (sin importar mayúsculas)', () => {
    expect(validarComando({ nombre: 'api', comando: 'otra cosa' }, lista, 'z')).toMatchObject({ ok: false, mensaje: expect.stringContaining('llamado') })
  })
  it('mismo puerto', () => {
    expect(validarComando({ nombre: 'Web', comando: 'vite', puerto: 3000 }, lista, 'z')).toMatchObject({ ok: false, mensaje: expect.stringContaining('puerto 3000') })
  })
  it('al editar no choca consigo mismo', () => {
    expect(validarComando({ nombre: 'API', comando: 'pnpm dev', cwd: 'api', puerto: 3000 }, lista, 'a')).toMatchObject({ ok: true })
  })
})

describe('arranque: lista, orden y edición', () => {
  it('aplicarComando añade al final, edita conservando la posición y respeta el tope', () => {
    let l: ComandoArranque[] = []
    for (const [nombre, comando] of [['Base', 'docker compose up -d'], ['API', 'pnpm api'], ['Web', 'pnpm web']] as const) {
      const r = aplicarComando(l, { nombre, comando }, id)
      expect(r.ok).toBe(true)
      if (r.ok) l = r.lista
    }
    expect(l.map((c) => [c.nombre, c.orden])).toEqual([['Base', 0], ['API', 1], ['Web', 2]])
    const e = aplicarComando(l, { id: l[1]!.id, nombre: 'API 2', comando: 'pnpm api --x' }, id)
    expect(e.ok && e.lista.map((c) => c.nombre)).toEqual(['Base', 'API 2', 'Web'])
    const dup = aplicarComando(l, { nombre: 'Otro', comando: 'PNPM web' }, id)
    expect(dup).toMatchObject({ ok: false })
    let lleno: ComandoArranque[] = []
    for (let i = 0; i < 30; i++) {
      const r = aplicarComando(lleno, { nombre: `c${i}`, comando: `cmd ${i}` }, id)
      if (r.ok) lleno = r.lista
    }
    expect(lleno).toHaveLength(30)
    expect(aplicarComando(lleno, { nombre: 'extra', comando: 'extra' }, id)).toMatchObject({ ok: false })
  })
  it('mover y quitar renumeran', () => {
    const l = [base({ id: 'a', nombre: 'A', comando: 'a', orden: 0 }), base({ id: 'b', nombre: 'B', comando: 'b', orden: 1 }), base({ id: 'c', nombre: 'C', comando: 'c', orden: 2 })]
    expect(moverComando(l, 'c', 0).map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(moverComando(l, 'a', 99).map((x) => [x.id, x.orden])).toEqual([['b', 0], ['c', 1], ['a', 2]])
    expect(moverComando(l, 'zz', 0).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(quitarComando(l, 'b').map((x) => [x.id, x.orden])).toEqual([['a', 0], ['c', 1]])
    expect(ordenar([l[2]!, l[0]!, l[1]!]).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('limpiarLista descarta basura y repetidos de un archivo editado a mano', () => {
    const l = limpiarLista([
      { id: 'a', nombre: 'A', comando: 'pnpm dev', orden: 5 },
      { id: 'b', nombre: 'B', comando: 'pnpm  DEV' }, // repetido
      { id: 'c', nombre: '', comando: 'x' },
      { nombre: 'sin id', comando: 'y' },
      'texto',
      { id: 'd', nombre: 'D', comando: 'ok', puerto: 99999 }
    ])
    expect(l.map((c) => c.id)).toEqual(['a'])
    expect(limpiarLista('no')).toEqual([])
  })
})

describe('arranque: utilidades', () => {
  it('puertoSugerido lo saca del propio comando', () => {
    expect(puertoSugerido('vite --port 5174')).toBe(5174)
    expect(puertoSugerido('next dev -p 4000')).toBe(4000)
    expect(puertoSugerido('PORT=8080 node server.js')).toBe(8080)
    expect(puertoSugerido('pnpm dev')).toBeUndefined()
    expect(puertoSugerido('x --port 99999')).toBeUndefined()
  })
  it('sinAnsi y contieneTexto ignoran colores y mayúsculas', () => {
    expect(sinAnsi('\u001b[32mready\u001b[0m in 300ms')).toBe('ready in 300ms')
    expect(contieneTexto('\u001b[1m\u001b[32mREADY\u001b[0m in', 'ready')).toBe(true)
    expect(contieneTexto('nada', '')).toBe(false)
    expect(contieneTexto('nada', 'ready')).toBe(false)
  })
})

describe('arranque: de quién es un puerto', () => {
  const proyectos: ProyectoRuta[] = [
    { id: 'p1', nombre: 'Tienda', ruta: '/home/dev/tienda' },
    { id: 'p2', nombre: 'Blog', ruta: '/home/dev/blog' },
    { id: 'p3', nombre: 'Tienda API', ruta: '/home/dev/tienda/api' }
  ]
  const ctx = { proyectoId: 'p1', comandoId: 'c1', ptys: [], proyectos }
  it('dentroDe y proyectoDeCarpeta (el más específico gana)', () => {
    expect(dentroDe('/home/dev/tienda/api/src', '/home/dev/tienda/')).toBe(true)
    expect(dentroDe('/home/dev/tienda-vieja', '/home/dev/tienda')).toBe(false)
    expect(proyectoDeCarpeta('/home/dev/tienda/api/src', proyectos)?.id).toBe('p3')
    expect(proyectoDeCarpeta('/home/dev/tienda/web', proyectos)?.id).toBe('p1')
    expect(proyectoDeCarpeta('/tmp', proyectos)).toBeUndefined()
  })
  it('por la terminal que lo lanzó (pid o ancestro)', () => {
    const ptys = [{ pid: 500, proyectoId: 'p1', comandoId: 'c1' }, { pid: 600, proyectoId: 'p1', comandoId: 'c2' }, { pid: 700, proyectoId: 'p2', comandoId: 'c9' }]
    expect(clasificarPuerto({ pid: 900, ancestros: [800, 500] }, { ...ctx, ptys })).toMatchObject({ tipo: 'en-marcha', comandoId: 'c1' })
    expect(clasificarPuerto({ pid: 900, ancestros: [600] }, { ...ctx, ptys })).toMatchObject({ tipo: 'mismo-proyecto', comandoId: 'c2' })
    expect(clasificarPuerto({ pid: 700, ancestros: [] }, { ...ctx, ptys })).toMatchObject({ tipo: 'otro-proyecto', proyectoId: 'p2', proyectoNombre: 'Blog', comandoId: 'c9' })
  })
  it('por la carpeta de trabajo si no cuelga de una terminal de la app', () => {
    expect(clasificarPuerto({ pid: 1, cwd: '/home/dev/tienda/web', ancestros: [] }, ctx)).toMatchObject({ tipo: 'mismo-proyecto', proyectoId: 'p1' })
    expect(clasificarPuerto({ pid: 1, cwd: '/home/dev/blog', ancestros: [] }, ctx)).toMatchObject({ tipo: 'otro-proyecto', proyectoId: 'p2', proyectoNombre: 'Blog' })
    expect(clasificarPuerto({ pid: 1, cwd: '/usr/bin', ancestros: [] }, ctx)).toEqual({ tipo: 'ajeno' })
    expect(clasificarPuerto({ pid: 1, ancestros: [] }, ctx)).toEqual({ tipo: 'ajeno' })
    expect(clasificarPuerto(undefined, ctx)).toEqual({ tipo: 'ajeno' })
  })
  it('describe cada conflicto', () => {
    const c = { comandoId: 'c', comandoNombre: 'API', puerto: 3000, bloquea: true, puedeLiberar: true }
    expect(describirConflicto({ ...c, tipo: 'otro-proyecto', proyectoNombre: 'Blog', otroComando: 'Web' })).toBe('El puerto 3000 está ocupado por «Blog» (Web), de otro proyecto')
    expect(describirConflicto({ ...c, tipo: 'ajeno', proceso: 'postgres', pid: 12 })).toContain('postgres (pid 12)')
    expect(describirConflicto({ ...c, tipo: 'ajeno' })).toContain('otro programa')
    expect(describirConflicto({ ...c, tipo: 'configurado-en-otro', proyectoNombre: 'Blog', bloquea: false })).toContain('también está configurado')
  })
})
