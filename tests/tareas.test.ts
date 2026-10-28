import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatosProyectos } from '@shared/modelos'
import { ESTADOS_POR_DEFECTO, evaluarTransicion, haceCiclo, referenciasTareas, siguienteTarea, validarEstados, type Tarea } from '@shared/tareas'
import { aplicarMencionTarea, detectarMencionTarea, opcionesTarea } from '../src/renderer/agente/tareas-chat'
import { HERRAMIENTAS_ODESK } from '@shared/herramientas-odesk'
import { HERRAMIENTAS_TAREAS } from '@shared/tareas-herramientas'
import { AlmacenJson } from '../src/main/core/memory/almacen'
import { llamarTareas, rutaSocketTareas } from '../src/main/core/tareas/cliente'
import { ejecutarHerramientaTareas } from '../src/main/core/tareas/herramientas'
import { archivoMcpTareas, configurarMcpTareas } from '../src/main/core/tareas/mcp-config'
import { servirMcpTareas } from '../src/main/core/tareas/mcp-servidor'
import { ejecutarOperacionTareas } from '../src/main/core/tareas/operaciones'
import { iniciarServidorTareas } from '../src/main/core/tareas/servidor'
import { ServicioTareas, type Documento } from '../src/main/core/tareas/servicio'
import { permisosCli } from '../src/main/core/suscripcion'

const DATOS: DatosProyectos = {
  grupos: [{ id: 'g1', nombre: 'Web' }],
  proyectos: [
    { id: 'p1', nombre: 'Tienda', ruta: '/tmp/tienda', grupo: 'g1' },
    { id: 'p2', nombre: 'Blog', ruta: '/tmp/blog' }
  ]
}

let dir: string
let cambios: number
let s: ServicioTareas

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tareas-'))
  cambios = 0
  s = new ServicioTareas(new AlmacenJson<Documento>(join(dir, 'tareas'), 0o600), { proyectos: async () => DATOS, alCambiar: () => void cambios++ })
})

const estado = (id: string) => ESTADOS_POR_DEFECTO.find((e) => e.id === id)!
const base = (p: Partial<Tarea>): Tarea => ({
  id: 'x', numero: 1, titulo: 't', descripcion: '', estado: 'pendiente', prioridad: 'media', etiquetas: [], creada: 0, actualizada: 0,
  criterios: [], checklist: [], dependeDe: [], referencias: [], comentarios: [], notasTecnicas: '', orden: 10, ...p
})

describe('reglas puras', () => {
  it('completar exige criterios, subtareas y dependencias; bloquear, descartar y reabrir exigen motivo', () => {
    const dep = base({ id: 'd', numero: 2 })
    const t = base({ criterios: [{ id: 'c', texto: 'pasa el test', hecho: false }], checklist: [{ id: 's', texto: 'migrar', hecho: false }], dependeDe: ['d'] })
    const todas = [t, dep]
    expect(evaluarTransicion(t, estado('completada'), todas, ESTADOS_POR_DEFECTO)).toMatch(/criterios/)
    t.criterios[0]!.hecho = true
    expect(evaluarTransicion(t, estado('completada'), todas, ESTADOS_POR_DEFECTO)).toMatch(/subtareas/)
    t.checklist[0]!.hecho = true
    expect(evaluarTransicion(t, estado('completada'), todas, ESTADOS_POR_DEFECTO)).toMatch(/#2/)
    dep.estado = 'cancelada' // una dependencia descartada ya no bloquea
    expect(evaluarTransicion(t, estado('completada'), todas, ESTADOS_POR_DEFECTO)).toBeNull()
    expect(evaluarTransicion(t, estado('bloqueada'), todas, ESTADOS_POR_DEFECTO)).toMatch(/bloqueada/)
    expect(evaluarTransicion(t, estado('bloqueada'), todas, ESTADOS_POR_DEFECTO, 'espera la API')).toBeNull()
    expect(evaluarTransicion(t, estado('cancelada'), todas, ESTADOS_POR_DEFECTO)).toMatch(/descarta/)
    expect(evaluarTransicion(base({ estado: 'completada' }), estado('en-progreso'), [], ESTADOS_POR_DEFECTO)).toMatch(/reabre/)
    expect(evaluarTransicion(base({}), estado('en-progreso'), [], ESTADOS_POR_DEFECTO)).toBeNull()
  })

  it('detecta ciclos de dependencias, también indirectos', () => {
    const a = base({ id: 'a', dependeDe: ['b'] })
    const b = base({ id: 'b', dependeDe: ['c'] })
    const c = base({ id: 'c' })
    expect(haceCiclo('c', ['a'], [a, b, c])).toBe(true)
    expect(haceCiclo('a', ['c'], [a, b, c])).toBe(false)
  })

  it('la siguiente tarea es la abierta, sin bloqueos, con más prioridad y lo que ya está en curso primero', () => {
    const dep = base({ id: 'd', numero: 1 })
    const bloqueada = base({ id: 'b', numero: 2, prioridad: 'urgente', dependeDe: ['d'] })
    const alta = base({ id: 'a', numero: 3, prioridad: 'alta' })
    const urgente = base({ id: 'u', numero: 4, prioridad: 'urgente' })
    const todas = [dep, bloqueada, alta, urgente]
    expect(siguienteTarea(todas, todas, ESTADOS_POR_DEFECTO)?.id).toBe('u')
    alta.estado = 'en-progreso'
    expect(siguienteTarea(todas, todas, ESTADOS_POR_DEFECTO)?.id).toBe('a')
  })

  it('reconoce las tareas que nombra un mensaje', () => {
    expect(referenciasTareas('implementa la tarea número 20')).toEqual([20])
    expect(referenciasTareas('haz las tareas 3, 5 y 7 y luego #12')).toEqual([3, 5, 7, 12])
    expect(referenciasTareas('tarea nº 4, tarea #9 y otra vez la tarea 4')).toEqual([4, 9])
    expect(referenciasTareas('el color #fff, issue&#20 y el paso 3')).toEqual([])
  })

  it('el «#» del chat sugiere tareas por número o título y deja «#N »', () => {
    const ts = [base({ id: 'a', numero: 20, titulo: 'Pantalla de inicio de sesión' }), base({ id: 'b', numero: 3, titulo: 'Menú' })]
    expect(detectarMencionTarea('haz la #2', 9)).toEqual({ inicio: 7, consulta: '2' })
    expect(detectarMencionTarea('color#2', 7)).toBeNull()
    expect(opcionesTarea(ts, '2').map((t) => t.numero)).toEqual([20])
    expect(opcionesTarea(ts, 'sesion').map((t) => t.numero)).toEqual([20])
    expect(aplicarMencionTarea('haz la #2', 9, { inicio: 7, consulta: '2' }, ts[0]!)).toEqual({ texto: 'haz la #20 ', cursor: 11 })
  })

  it('valida la lista de estados', () => {
    expect(validarEstados(ESTADOS_POR_DEFECTO)).toBeNull()
    expect(validarEstados([{ id: 'a', nombre: 'A', categoria: 'hecha' }])).toMatch(/sin empezar/)
    expect(validarEstados([{ id: 'A!', nombre: 'A', categoria: 'pendiente' }])).toMatch(/inválido/)
    expect(validarEstados([{ id: 'a', nombre: 'A', categoria: 'pendiente' }, { id: 'a', nombre: 'B', categoria: 'hecha' }])).toMatch(/repetido/)
  })
})

describe('ServicioTareas', () => {
  it('crea con número, vínculo (el grupo del proyecto se hereda) y registro de actividad', async () => {
    const t = await s.crear({ titulo: '  Carrito  ', proyectoId: 'p1', criterios: ['suma bien'], checklist: ['modelo', 'vista'], etiquetas: ['ui'] }, 'usuario')
    expect(t).toMatchObject({ numero: 1, titulo: 'Carrito', estado: 'pendiente', prioridad: 'media', proyectoId: 'p1', grupoId: 'g1' })
    expect(t.criterios).toHaveLength(1)
    expect(t.checklist).toHaveLength(2)
    const otra = await s.crear({ titulo: 'Suelta' }, 'ia')
    expect(otra).toMatchObject({ numero: 2 })
    expect(otra.proyectoId).toBeUndefined()
    const act = await s.actividad()
    expect(act.map((a) => [a.autor, a.tipo])).toEqual([['ia', 'creada'], ['usuario', 'creada']])
    expect(cambios).toBe(2)
    await expect(s.crear({ titulo: '' }, 'usuario')).rejects.toThrow(/título|titulo/)
    await expect(s.crear({ titulo: 'x', proyectoId: 'nope' }, 'usuario')).rejects.toThrow(/proyecto/)
    await expect(s.crear({ titulo: 'x', estado: 'completada' }, 'usuario')).rejects.toThrow(/nacer/)
    await expect(s.crear({ titulo: 'x', prioridad: 'ya' as never }, 'usuario')).rejects.toThrow(/prioridad/)
  })

  it('una tarea suelta se vincula después sin perder nada, y al borrar el proyecto queda suelta', async () => {
    const t = await s.crear({ titulo: 'Idea', descripcion: 'd' }, 'usuario')
    await s.comentar('1', 'nota', 'usuario')
    const v = await s.editar('#1', { proyectoId: 'p2' }, 'usuario')
    expect(v).toMatchObject({ id: t.id, proyectoId: 'p2', descripcion: 'd' })
    expect(v.comentarios).toHaveLength(1)
    expect((await s.actividad()).at(0)?.tipo).toBe('vinculada')
    await s.desvincular({ proyectoId: 'p2' })
    expect((await s.obtener('1')).tarea.proyectoId).toBeUndefined()
    expect((await s.editar('1', { proyectoId: 'p1' }, 'usuario')).grupoId).toBe('g1')
    expect(await s.editar('1', { proyectoId: null }, 'usuario')).not.toHaveProperty('proyectoId')
  })

  it('la tarjeta nace sin color, se le pone uno válido y se le quita', async () => {
    const t = await s.crear({ titulo: 'Pintar' }, 'usuario')
    expect(t).not.toHaveProperty('color')
    expect((await s.editar('#1', { color: 'verde' }, 'usuario')).color).toBe('verde')
    await expect(s.editar('#1', { color: 'fucsia' as never }, 'usuario')).rejects.toThrow(/color/)
    expect(await s.editar('#1', { color: null }, 'usuario')).not.toHaveProperty('color')
  })

  it('aplica las reglas de estado igual para usuario e IA y deja el motivo en el historial', async () => {
    await s.crear({ titulo: 'A', criterios: ['c1'] }, 'usuario')
    await expect(s.estado('1', 'completada', 'ia')).rejects.toThrow(/criterios/)
    expect((await s.estado('1', 'en-progreso', 'ia')).inicio).toBeTypeOf('number')
    await s.item({ tarea: '1', lista: 'criterios', accion: 'marcar', itemId: '1' }, 'ia')
    const hecha = await s.estado('1', 'completada', 'ia', 'verificado con tests')
    expect(hecha.completada).toBeTypeOf('number')
    await expect(s.estado('1', 'pendiente', 'usuario')).rejects.toThrow(/reabre/)
    const reabierta = await s.estado('1', 'pendiente', 'usuario', 'faltaba un caso')
    expect(reabierta.completada).toBeUndefined()
    const cambiosEstado = (await s.actividad({ tarea: '1' })).filter((a) => a.tipo === 'estado')
    expect(cambiosEstado.map((a) => [a.autor, a.motivo])).toEqual([['usuario', 'faltaba un caso'], ['ia', 'verificado con tests'], ['ia', undefined]])
    await expect(s.estado('1', 'inventado', 'ia')).rejects.toThrow(/Estado desconocido/)
  })

  it('dependencias: bloquean completar, rechazan ciclos y desaparecen al eliminar la tarea de la que dependen', async () => {
    await s.crear({ titulo: 'Base' }, 'usuario')
    await s.crear({ titulo: 'Sobre la base', dependeDe: ['1'] }, 'usuario')
    await expect(s.estado('2', 'completada', 'usuario')).rejects.toThrow(/#1/)
    await expect(s.dependencias('1', ['2'], 'usuario')).rejects.toThrow(/ciclo/)
    await expect(s.dependencias('1', ['1'], 'usuario')).rejects.toThrow(/sí misma/)
    const det = await s.obtener('1')
    expect(det.bloquea.map((x) => x.numero)).toEqual([2])
    expect((await s.obtener('2')).bloqueadaPor.map((x) => x.numero)).toEqual([1])
    expect((await s.resumen()).bloqueadas.map((b) => b.numero)).toEqual([2])
    await s.eliminar('1', 'usuario')
    expect((await s.obtener('2')).tarea.dependeDe).toEqual([])
    await expect(s.obtener('1')).rejects.toThrow(/No existe/)
  })

  it('crearVarias une las dependencias del lote por posición y no deja nada a medias si falla', async () => {
    const creadas = await s.crearVarias({ tareas: [{ titulo: 'Modelo' }, { titulo: 'API', dependeDeIndices: [0] }, { titulo: 'UI', dependeDeIndices: [0, 1] }] }, 'ia')
    expect(creadas.map((t) => t.numero)).toEqual([1, 2, 3])
    expect((await s.obtener('3')).tarea.dependeDe).toHaveLength(2)
    await expect(s.crearVarias({ tareas: [{ titulo: 'Ok' }, { titulo: 'Mal', dependeDeIndices: [5] }] }, 'ia')).rejects.toThrow(/anterior/)
    expect(await s.listar()).toHaveLength(3)
  })

  it('mover reordena la columna y respeta las reglas al cambiar de columna', async () => {
    for (const n of ['A', 'B', 'C']) await s.crear({ titulo: n }, 'usuario')
    const ids = (await s.listar()).map((t) => t.id)
    await s.mover('3', 'pendiente', 'usuario', (await s.obtener('1')).tarea.id)
    const orden = (await s.listar({ estados: ['pendiente'] })).map((t) => t.titulo)
    expect(orden).toHaveLength(3)
    const columna = [...(await s.leer()).tareas].sort((a, b) => a.orden - b.orden).map((t) => t.titulo)
    expect(columna).toEqual(['C', 'A', 'B'])
    await s.crear({ titulo: 'Con criterio', criterios: ['x'] }, 'usuario')
    await expect(s.mover('4', 'completada', 'usuario')).rejects.toThrow(/criterios/)
    expect(ids).toHaveLength(3)
  })

  it('las listas de criterios y subtareas se gestionan por posición o id', async () => {
    await s.crear({ titulo: 'T' }, 'usuario')
    await s.item({ tarea: '1', lista: 'criterios', accion: 'anadir', texto: 'uno' }, 'ia')
    await s.item({ tarea: '1', lista: 'checklist', accion: 'anadir', texto: 'paso' }, 'ia')
    await s.item({ tarea: '1', lista: 'checklist', accion: 'marcar', itemId: '1' }, 'ia')
    let t = (await s.obtener('1')).tarea
    expect(t.checklist[0]!.hecho).toBe(true)
    await s.item({ tarea: '1', lista: 'checklist', accion: 'marcar', itemId: t.checklist[0]!.id, hecho: false }, 'ia')
    await s.item({ tarea: '1', lista: 'criterios', accion: 'editar', itemId: '1', texto: 'uno bis' }, 'ia')
    t = (await s.obtener('1')).tarea
    expect([t.checklist[0]!.hecho, t.criterios[0]!.texto]).toEqual([false, 'uno bis'])
    await s.item({ tarea: '1', lista: 'criterios', accion: 'quitar', itemId: '1' }, 'ia')
    expect((await s.obtener('1')).tarea.criterios).toEqual([])
    await expect(s.item({ tarea: '1', lista: 'criterios', accion: 'marcar', itemId: '9' }, 'ia')).rejects.toThrow(/No existe/)
  })

  it('referencias: valida enlaces y deduce el tipo', async () => {
    await s.crear({ titulo: 'T' }, 'usuario')
    let t = await s.referencia({ tarea: '1', accion: 'anadir', destino: 'https://example.com/doc', titulo: 'Doc' }, 'usuario')
    expect(t.referencias[0]).toMatchObject({ tipo: 'enlace', titulo: 'Doc' })
    t = await s.referencia({ tarea: '1', accion: 'anadir', destino: 'src/app.ts' }, 'usuario')
    expect(t.referencias[1]).toMatchObject({ tipo: 'archivo', titulo: 'src/app.ts' })
    await expect(s.referencia({ tarea: '1', accion: 'anadir', tipo: 'enlace', destino: 'javascript:alert(1)' }, 'usuario')).rejects.toThrow(/http/)
    t = await s.referencia({ tarea: '1', accion: 'quitar', referenciaId: '1' }, 'usuario')
    expect(t.referencias).toHaveLength(1)
  })

  it('cambiar los estados exige reasignar las tareas de los que se quitan', async () => {
    await s.crear({ titulo: 'T', estado: 'lista' }, 'usuario')
    const sin = ESTADOS_POR_DEFECTO.filter((e) => e.id !== 'lista')
    await expect(s.guardarEstados([...sin], undefined, 'usuario')).rejects.toThrow(/Lista para implementar/)
    await s.guardarEstados([...sin, { id: 'qa', nombre: 'QA', categoria: 'en_curso' }], { lista: 'qa' }, 'usuario')
    expect((await s.obtener('1')).tarea.estado).toBe('qa')
    expect((await s.estados()).some((e) => e.id === 'qa')).toBe(true)
  })

  it('el contexto para la IA resume lo abierto, lo bloqueado y la siguiente, con las reglas de trabajo', async () => {
    expect(await s.contextoParaIA('p1', 'Tienda')).toMatch(/aún no hay ninguna/)
    await s.crear({ titulo: 'Base', proyectoId: 'p1', prioridad: 'alta', criterios: ['a'] }, 'usuario')
    await s.crear({ titulo: 'Encima', proyectoId: 'p1', dependeDe: ['1'] }, 'usuario')
    await s.crear({ titulo: 'Otro proyecto', proyectoId: 'p2' }, 'usuario')
    const c = await s.contextoParaIA('p1', 'Tienda')
    expect(c).toMatch(/2 abiertas/)
    expect(c).toMatch(/#1 \[Pendiente · alta\] Base.*criterios 0\/1/)
    expect(c).toMatch(/#2 .*espera a #1/)
    expect(c).not.toMatch(/Otro proyecto/)
    expect(c).toMatch(/Siguiente recomendada: #1/)
    expect(c).toMatch(/solo cuando todos se cumplan/)
  })

  it('el Asistente ve las tareas sueltas del grupo y recibe la ficha completa de las que nombra el mensaje', async () => {
    await s.crear({ titulo: 'Del proyecto', proyectoId: 'p1', descripcion: 'Detalle largo', criterios: ['Valida el correo'], checklist: ['Formulario'] }, 'usuario')
    await s.crear({ titulo: 'Suelta del grupo', grupoId: 'g1' }, 'usuario')
    await s.crear({ titulo: 'De otro proyecto', proyectoId: 'p2', notasTecnicas: 'Usar zod' }, 'usuario')
    const c = await s.contextoParaIA('p1', 'Tienda')
    expect(c).toMatch(/#2 .*Suelta del grupo/)
    expect(c).not.toMatch(/De otro proyecto/)
    expect(c).not.toMatch(/ficha completa/)
    expect((await s.paraAsistente('p1')).map((t) => t.numero).sort()).toEqual([1, 2])
    const f = await s.contextoParaIA('p1', 'Tienda', 'implementa la tarea número 1 y mira la #3 y la #99')
    expect(f).toMatch(/ficha completa/)
    expect(f).toMatch(/Detalle largo/)
    expect(f).toMatch(/\[ \] Valida el correo/)
    expect(f).toMatch(/Subtareas:\n {2}\[ \] Formulario/)
    expect(f).toMatch(/#3 «De otro proyecto».*Blog[\s\S]*Usar zod/)
    expect(f).toMatch(/#99: no existe/)
  })

  it('la interfaz usa las mismas operaciones por IPC y rechaza las desconocidas', async () => {
    const t = (await ejecutarOperacionTareas(s, 'crear', { titulo: 'Desde la UI' })) as Tarea
    expect(t.numero).toBe(1)
    expect(await ejecutarOperacionTareas(s, 'listar', {})).toHaveLength(1)
    expect((await s.actividad()).at(0)?.autor).toBe('usuario')
    await expect(ejecutarOperacionTareas(s, 'borrarTodo', {})).rejects.toThrow(/desconocida/)
    await expect(ejecutarOperacionTareas(s, '__proto__', {})).rejects.toThrow(/desconocida/)
  })
})

describe('herramientas de la IA', () => {
  it('usan el proyecto de la conversación por defecto, actúan como «ia» y devuelven los errores de las reglas sin lanzar', async () => {
    const ctx = { proyectoId: 'p1' }
    const r = await ejecutarHerramientaTareas(s, 'crear_tarea', { titulo: 'Login', criterios: ['entra con email'], vence: '2030-01-31' }, ctx)
    expect(r.error).toBeUndefined()
    const t = (await s.obtener('1')).tarea
    expect(t).toMatchObject({ proyectoId: 'p1', grupoId: 'g1' })
    expect(new Date(t.vence!).getFullYear()).toBe(2030)
    expect((await s.actividad()).at(0)?.autor).toBe('ia')

    const rechazo = await ejecutarHerramientaTareas(s, 'cambiar_estado_tarea', { tarea: '1', estado: 'completada' }, ctx)
    expect(rechazo.error).toBe(true)
    expect(rechazo.texto).toMatch(/criterios/)
    expect((await s.obtener('1')).tarea.estado).toBe('pendiente')

    await ejecutarHerramientaTareas(s, 'crear_tarea', { titulo: 'En otro', proyecto_id: 'p2' }, ctx)
    const lista = JSON.parse((await ejecutarHerramientaTareas(s, 'listar_tareas', {}, ctx)).texto)
    expect(lista.tareas.map((x: { titulo: string }) => x.titulo)).toEqual(['Login'])
    const todas = JSON.parse((await ejecutarHerramientaTareas(s, 'listar_tareas', { todos_los_proyectos: true }, ctx)).texto)
    expect(todas.total).toBe(2)
    expect(JSON.parse((await ejecutarHerramientaTareas(s, 'obtener_tarea', { tarea: '#1' }, ctx)).texto).tarea.vence).toMatch(/^2030-/)

    expect((await ejecutarHerramientaTareas(s, 'crear_tarea', {}, ctx)).texto).toMatch(/titulo/)
    expect((await ejecutarHerramientaTareas(s, 'crear_tarea', { titulo: 'x', vence: 'mañana' }, ctx)).texto).toMatch(/AAAA-MM-DD/)
    expect((await ejecutarHerramientaTareas(s, 'borrar_tarea', { tarea: '1' }, ctx)).error).toBe(true)
    expect((await ejecutarHerramientaTareas(s, 'listar_proyectos', {}, ctx)).texto).toMatch(/Tienda/)
  })

  it('crear_tareas arma un plan con dependencias y siguiente_tarea elige la que se puede empezar', async () => {
    const r = await ejecutarHerramientaTareas(s, 'crear_tareas', { proyecto_id: 'p1', tareas: [{ titulo: 'Modelo' }, { titulo: 'API', depende_de_indices: [0], prioridad: 'urgente' }] })
    expect(JSON.parse(r.texto)).toHaveLength(2)
    expect(await ejecutarHerramientaTareas(s, 'siguiente_tarea', { proyecto_id: 'p1' }).then((x) => JSON.parse(x.texto).titulo)).toBe('Modelo')
    const res = JSON.parse((await ejecutarHerramientaTareas(s, 'resumen_tareas', { proyecto_id: 'p1' })).texto)
    expect(res).toMatchObject({ total: 2, abiertas: 2, progreso: 0 })
    expect(res.sinCriterios).toHaveLength(2)
    expect(res.bloqueadas.map((b: { numero: number }) => b.numero)).toEqual([2])
  })

  it('la IA no tiene herramienta para borrar tareas y las escrituras se declaran como tales', () => {
    expect(HERRAMIENTAS_TAREAS.some((h) => /borrar|eliminar/.test(h.nombre))).toBe(false)
    expect(HERRAMIENTAS_TAREAS.filter((h) => h.riesgo === 'lectura').map((h) => h.nombre)).toEqual(expect.arrayContaining(['listar_tareas', 'obtener_tarea', 'resumen_tareas']))
    expect(HERRAMIENTAS_TAREAS.find((h) => h.nombre === 'cambiar_estado_tarea')?.riesgo).toBe('escritura')
  })
})

describe('permisos del CLI con tareas', () => {
  it('siempre permite consultar; cambiar solo desde «Aceptar ediciones»', () => {
    const preguntar = permisosCli('preguntar', [], true)
    expect(preguntar).toContain('mcp__odesk__listar_tareas')
    expect(preguntar).not.toContain('mcp__odesk__crear_tarea')
    const ediciones = permisosCli('ediciones', [], true)
    expect(ediciones).toContain('mcp__odesk__crear_tarea')
    expect(ediciones).toContain('mcp__odesk__cambiar_estado_tarea')
    expect(permisosCli('preguntar', [], false).some((p) => p.includes('mcp__odesk__'))).toBe(false)
  })
})

describe('socket local y servidor MCP', () => {
  it('la IA (otro proceso) usa las tareas por el socket; el token protege; sin app abierta avisa', async () => {
    expect((await llamarTareas(dir, 'listar_tareas', {})).texto).toMatch(/no está abierto/)

    const servidor = await iniciarServidorTareas(dir, (n, e, c) => ejecutarHerramientaTareas(s, n, e, c))
    try {
      const r = await llamarTareas(dir, 'crear_tarea', { titulo: 'Por socket', proyecto_id: 'p1' })
      expect(r.error).toBeUndefined()
      expect((await s.obtener('1')).tarea).toMatchObject({ titulo: 'Por socket', proyectoId: 'p1' })
      expect((await s.actividad()).at(0)?.autor).toBe('ia')
      // El proyecto por defecto viaja con la petición (lo pone el entorno del servidor MCP)
      await llamarTareas(dir, 'crear_tarea', { titulo: 'Sin proyecto explícito' }, 'p2')
      expect((await s.obtener('2')).tarea.proyectoId).toBe('p2')
      expect((await llamarTareas(dir, 'cambiar_estado_tarea', { tarea: '1', estado: 'bloqueada' })).error).toBe(true)

      // Token incorrecto: se cierra la conexión sin ejecutar nada
      await writeFile(join(dir, 'tareas.token'), 'x'.repeat(48) + '\n')
      expect((await llamarTareas(dir, 'crear_tarea', { titulo: 'Intruso' })).error).toBe(true)
      expect(await s.listar()).toHaveLength(2)
    } finally {
      await servidor.cerrar()
    }
  })

  it('con una carpeta de datos de ruta larga usa un socket corto y funciona igual', async () => {
    const larga = join(dir, 'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40))
    await mkdir(larga, { recursive: true })
    expect(rutaSocketTareas(dir).length).toBeLessThanOrEqual(100)
    expect(rutaSocketTareas(larga).length).toBeLessThanOrEqual(100)
    expect(rutaSocketTareas(larga)).not.toBe(rutaSocketTareas(dir))
    const servidor = await iniciarServidorTareas(larga, (n, e, c) => ejecutarHerramientaTareas(s, n, e, c))
    try {
      expect((await llamarTareas(larga, 'crear_tarea', { titulo: 'Ruta larga' })).error).toBeUndefined()
      expect(await s.listar()).toHaveLength(1)
    } finally {
      await servidor.cerrar()
    }
  })

  it('habla MCP por stdio: initialize, tools/list y tools/call (con isError cuando una regla lo impide)', async () => {
    const servidor = await iniciarServidorTareas(dir, (n, e, c) => ejecutarHerramientaTareas(s, n, e, c))
    const entrada = new PassThrough()
    const salida = new PassThrough()
    interface Rpc {
      id?: number
      result?: { tools: { name: string; inputSchema: { type: string } }[]; isError?: boolean; content: { text: string }[]; protocolVersion?: string; capabilities?: unknown; serverInfo?: unknown }
      error?: { code: number }
    }
    const respuestas: Rpc[] = []
    salida.on('data', (d: Buffer) => respuestas.push(...d.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l))))
    const fin = servirMcpTareas(entrada, salida, (h, e) => llamarTareas(dir, h, e, 'p1'))
    const enviar = (o: unknown): boolean => entrada.write(JSON.stringify(o) + '\n')
    try {
      enviar({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
      enviar({ jsonrpc: '2.0', method: 'notifications/initialized' })
      enviar({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      enviar({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crear_tarea', arguments: { titulo: 'Vía MCP' } } })
      // El servidor atiende las peticiones a la vez: la 4 usa la tarea que crea la 3, así que se envía cuando ya hay respuesta (si no, a veces llegaba antes).
      while (!respuestas.some((r) => r.id === 3)) await new Promise((r) => setTimeout(r, 5))
      enviar({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cambiar_estado_tarea', arguments: { tarea: '1', estado: 'bloqueada' } } })
      enviar({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'no_existe', arguments: {} } })
      enviar({ jsonrpc: '2.0', id: 6, method: 'otra/cosa' })
      entrada.end()
      await fin
      const por = (id: number): Rpc => respuestas.find((r) => r.id === id)!
      expect(por(1).result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'odesk' } })
      expect(por(2).result!.tools.map((t: { name: string }) => t.name)).toEqual(HERRAMIENTAS_ODESK.map((h) => h.nombre))
      expect(por(2).result!.tools[0]!.inputSchema.type).toBe('object')
      expect(por(3).result!.isError).toBeUndefined()
      expect((await s.obtener('1')).tarea).toMatchObject({ titulo: 'Vía MCP', proyectoId: 'p1' })
      expect(por(4).result!.isError).toBe(true)
      expect(por(4).result!.content[0]!.text).toMatch(/motivo|bloqueada/i)
      expect(por(5).error!.code).toBe(-32602)
      expect(por(6).error!.code).toBe(-32601)
      expect(respuestas.some((r) => r.id === undefined)).toBe(false) // las notificaciones no se responden
    } finally {
      await servidor.cerrar()
    }
  })

  it('el archivo --mcp-config apunta al servidor compilado, con el proyecto en el entorno, y es estable', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'raiz-'))
    await mkdir(join(raiz, 'out', 'main'), { recursive: true })
    await writeFile(join(raiz, 'out', 'main', 'mcp-tareas.js'), '')
    configurarMcpTareas({ raizApp: raiz, dirDatos: dir })
    const a = (await archivoMcpTareas('p1'))!
    expect(a).toBe((await archivoMcpTareas('p1'))!)
    expect(a).not.toBe((await archivoMcpTareas('p2'))!)
    const cfg = JSON.parse(await readFile(a, 'utf8'))
    expect(cfg.mcpServers['odesk']).toMatchObject({ args: [join(raiz, 'out', 'main', 'mcp-tareas.js')], env: { ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: dir, ODESK_PROYECTO_ID: 'p1' } })
    // Sin el servidor compilado no se ofrece (y nada se rompe)
    configurarMcpTareas({ raizApp: join(raiz, 'no-existe'), dirDatos: dir })
    expect(await archivoMcpTareas('p1')).toBeUndefined()
  })
})
