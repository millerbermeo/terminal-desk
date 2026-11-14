import { describe, expect, it } from 'vitest'
import { ESTADOS_POR_DEFECTO, type Tarea } from '../src/shared/tareas'
import {
  FILTRO_VACIO,
  agruparTareas,
  aplicarFiltroVista,
  barraCronograma,
  celdasMes,
  contarFiltros,
  desplazarTramo,
  diaClave,
  moverSeleccion,
  ordenarTareas,
  progresoTarea,
  rangoCronograma,
  rangoIds,
  superaLimite,
  tareasPorDia,
  totalEstimacion,
  vencimientoEnDia
} from '../src/shared/tareas-vista'

const AHORA = new Date(2026, 10, 18, 10, 0, 0).getTime() // miércoles 18 de noviembre de 2026
const estados = ESTADOS_POR_DEFECTO
const base = (n: number, extra: Partial<Tarea> = {}): Tarea => ({
  id: `t${n}`,
  numero: n,
  titulo: `Tarea ${n}`,
  descripcion: '',
  estado: 'pendiente',
  prioridad: 'media',
  etiquetas: [],
  creada: AHORA,
  actualizada: AHORA,
  criterios: [],
  checklist: [],
  dependeDe: [],
  referencias: [],
  comentarios: [],
  notasTecnicas: '',
  orden: n,
  ...extra
})
const ctx = { estados, nombreProyecto: new Map([['p1', 'Web'], ['p2', 'API']]) }

describe('filtros de la vista', () => {
  const t = [
    base(1, { prioridad: 'urgente', responsable: 'ia', vence: AHORA - 86_400_000 }),
    base(2, { estado: 'completada', vence: AHORA - 86_400_000 }),
    base(3, { etiquetas: ['ui'], vence: AHORA + 2 * 86_400_000 }),
    base(4, { dependeDe: ['t3'] }),
    base(5, { estado: 'bloqueada', hito: 'v1' })
  ]
  const f = (p: Partial<typeof FILTRO_VACIO>) => aplicarFiltroVista(t, t, estados, { ...FILTRO_VACIO, ...p }, AHORA).map((x) => x.numero)

  it('sin filtros devuelve todo; sin terminadas quita las hechas', () => {
    expect(f({})).toEqual([1, 2, 3, 4, 5])
    expect(f({ verTerminadas: false })).toEqual([1, 3, 4, 5])
  })
  it('por prioridad, etiqueta, responsable y hito', () => {
    expect(f({ prioridades: ['urgente'] })).toEqual([1])
    expect(f({ etiquetas: ['ui'] })).toEqual([3])
    expect(f({ responsables: ['ia'] })).toEqual([1])
    expect(f({ responsables: ['sin'] })).toEqual([2, 3, 4, 5])
    expect(f({ hito: 'v1' })).toEqual([5])
  })
  it('vencidas excluye las terminadas; esta semana incluye las vencidas y las de hoy a domingo', () => {
    expect(f({ vencimiento: 'vencidas' })).toEqual([1])
    expect(f({ vencimiento: 'semana' })).toEqual([1, 3]) // la 1 venció ayer y la 3 vence el viernes 20: ambas hasta el domingo 22
    expect(f({ vencimiento: 'sin-fecha' })).toEqual([4, 5])
  })
  it('bloqueadas: por estado o por dependencia abierta', () => {
    expect(f({ bloqueadas: true })).toEqual([4, 5])
  })
  it('búsqueda por texto, número y etiqueta', () => {
    expect(f({ texto: '#3' })).toEqual([3])
    expect(f({ texto: 'ui' })).toEqual([3])
  })
  it('cuenta los filtros activos', () => {
    expect(contarFiltros(FILTRO_VACIO)).toBe(0)
    expect(contarFiltros({ ...FILTRO_VACIO, prioridades: ['alta'], bloqueadas: true, verTerminadas: false })).toBe(3)
  })
})

describe('agrupar y ordenar', () => {
  const t = [
    base(1, { prioridad: 'baja', proyectoId: 'p2', etiquetas: ['a', 'b'] }),
    base(2, { prioridad: 'urgente', proyectoId: 'p1' }),
    base(3, { prioridad: 'alta' }),
    base(4, { estado: 'en-progreso', responsable: 'usuario', hito: 'v2' })
  ]
  it('por prioridad: de mayor a menor', () => {
    expect(agruparTareas(t, 'prioridad', ctx).map((g) => g.nombre)).toEqual(['Urgente', 'Alta', 'Media', 'Baja'])
  })
  it('por proyecto: por nombre y «Sin proyecto» al final', () => {
    expect(agruparTareas(t, 'proyecto', ctx).map((g) => g.nombre)).toEqual(['API', 'Web', 'Sin proyecto'])
  })
  it('por etiqueta: una tarea con varias aparece en cada una', () => {
    const g = agruparTareas(t, 'etiqueta', ctx)
    expect(g.map((x) => x.nombre)).toEqual(['a', 'b', 'Sin etiqueta'])
    expect(g[0]!.tareas[0]!.numero).toBe(1)
    expect(g[1]!.tareas[0]!.numero).toBe(1)
  })
  it('por estado respeta el orden del flujo; ninguno es un solo grupo', () => {
    expect(agruparTareas(t, 'estado', ctx).map((g) => g.clave)).toEqual(['pendiente', 'en-progreso'])
    expect(agruparTareas(t, 'ninguno', ctx)).toHaveLength(1)
  })
  it('ordenar deja los vacíos siempre al final', () => {
    const v = [base(1), base(2, { vence: 200 }), base(3, { vence: 100 })]
    expect(ordenarTareas(v, 'vence', 'asc', ctx).map((x) => x.numero)).toEqual([3, 2, 1])
    expect(ordenarTareas(v, 'vence', 'desc', ctx).map((x) => x.numero)).toEqual([2, 3, 1])
    expect(ordenarTareas(t, 'prioridad', 'desc', ctx).map((x) => x.numero)).toEqual([2, 3, 4, 1])
  })
})

describe('progreso, límites y selección', () => {
  it('progreso junta subtareas y criterios', () => {
    const p = progresoTarea({ checklist: [{ id: 'a', texto: 'x', hecho: true }], criterios: [{ id: 'b', texto: 'y', hecho: false }, { id: 'c', texto: 'z', hecho: true }] })
    expect(p).toEqual({ hechos: 2, total: 3, pct: 67 })
    expect(progresoTarea({ checklist: [], criterios: [] }).pct).toBe(0)
  })
  it('suma estimaciones y detecta el límite', () => {
    expect(totalEstimacion([base(1, { estimacion: 2.5 }), base(2), base(3, { estimacion: 3 })])).toBe(5.5)
    expect(superaLimite(4, 3)).toBe(true)
    expect(superaLimite(3, 3)).toBe(false)
    expect(superaLimite(10, undefined)).toBe(false)
  })
  it('moverSeleccion no da la vuelta y rangoIds incluye los extremos', () => {
    const ids = ['a', 'b', 'c']
    expect(moverSeleccion(ids, undefined, 1)).toBe('a')
    expect(moverSeleccion(ids, undefined, -1)).toBe('c')
    expect(moverSeleccion(ids, 'c', 1)).toBe('c')
    expect(moverSeleccion(ids, 'b', -1)).toBe('a')
    expect(moverSeleccion([], 'a', 1)).toBeUndefined()
    expect(rangoIds(ids, 'c', 'a')).toEqual(['a', 'b', 'c'])
  })
})

describe('calendario', () => {
  it('el mes ocupa 42 celdas desde un lunes', () => {
    const c = celdasMes(2026, 10) // noviembre de 2026 empieza en domingo
    expect(c).toHaveLength(42)
    expect(c[0]!.getDay()).toBe(1)
    expect(diaClave(c[0]!.getTime())).toBe('2026-10-26')
    expect(c.some((d) => diaClave(d.getTime()) === '2026-11-30')).toBe(true)
  })
  it('agrupa por día de vencimiento y reprograma al final del día', () => {
    const m = tareasPorDia([base(1, { vence: vencimientoEnDia('2026-11-20') }), base(2, { vence: vencimientoEnDia('2026-11-20') }), base(3)])
    expect(m.get('2026-11-20')).toHaveLength(2)
    expect(new Date(vencimientoEnDia('2026-11-20')).getHours()).toBe(23)
  })
})

describe('cronograma', () => {
  it('el rango cubre barras y hoy, y la barra cae dentro', () => {
    const t = base(1, { inicio: AHORA - 3 * 86_400_000, vence: AHORA + 20 * 86_400_000 })
    const r = rangoCronograma([t], AHORA)
    expect(r.inicio).toBeLessThan(t.inicio!)
    expect(r.fin).toBeGreaterThan(t.vence!)
    const b = barraCronograma(t, r)!
    expect(b.izq).toBeGreaterThan(0)
    expect(b.izq + b.ancho).toBeLessThanOrEqual(100.001)
    expect(barraCronograma(base(2), r)).toBeUndefined()
  })
  it('desplazar mueve las dos fechas', () => {
    expect(desplazarTramo({ inicio: 1000, vence: 2000 }, 1)).toEqual({ inicio: 1000 + 86_400_000, vence: 2000 + 86_400_000 })
    expect(desplazarTramo({ vence: 2000 }, -1)).toEqual({ vence: 2000 - 86_400_000 })
  })
})
