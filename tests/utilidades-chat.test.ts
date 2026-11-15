import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '../src/shared/core/agente'
import {
  alternarFijada,
  buscarEnTurnos,
  cambiosDeEdicion,
  cursorEnBorde,
  estimarEnvio,
  etiquetasEnUso,
  exportarMarkdown,
  filtrarSesiones,
  leerOrganizacion,
  limpiarParaVoz,
  navegarPrompts,
  nombreArchivoExportado,
  olvidarSesion,
  ordenarSesiones,
  organizacionVacia,
  parsearEtiquetas,
  ponerEtiquetas,
  promptsEnviados,
  revertirCambio,
  rutaRelativa,
  textoRespuesta,
  type TurnoBasico
} from '../src/renderer/agente/utilidades-chat'

const texto = (t: string, profundidad = 0): EventoAgente => ({ ejecucionId: 'e', agente: 'a', profundidad, tipo: 'texto', texto: t })
const herramienta = (): EventoAgente => ({ ejecucionId: 'e', agente: 'a', profundidad: 0, tipo: 'herramienta_inicio', llamada: { id: '1', nombre: 'Read', entrada: {} } })
const turno = (prompt: string, eventos: EventoAgente[] = [], extra: Partial<TurnoBasico> = {}): TurnoBasico => ({ prompt, eventos, estado: 'completado', destino: 'p', ...extra })

afterEach(() => vi.unstubAllGlobals())

describe('textoRespuesta', () => {
  it('junta solo el texto del agente principal', () => {
    expect(textoRespuesta({ eventos: [texto('Hola'), texto('interno', 1), herramienta(), texto('Listo')] })).toBe('Hola\n\nListo')
  })
  it('sin texto cerrado usa lo que se está escribiendo', () => {
    expect(textoRespuesta({ eventos: [], parcial: ' a medias ' })).toBe('a medias')
  })
})

describe('historial de prompts', () => {
  it('quita vacíos, repetidos seguidos y preguntas laterales', () => {
    expect(promptsEnviados([{ prompt: 'a' }, { prompt: ' ' }, { prompt: 'a' }, { prompt: 'lat', lateral: true }, { prompt: 'b' }, { prompt: 'a' }])).toEqual(['a', 'b', 'a'])
  })
  it('flecha arriba recorre hacia atrás y abajo vuelve al borrador', () => {
    const p = ['uno', 'dos', 'tres']
    const a = navegarPrompts(p, 0, 'arriba', 'borrador')!
    expect(a).toEqual({ pasos: 1, texto: 'tres' })
    const b = navegarPrompts(p, a.pasos, 'arriba', 'borrador')!
    expect(b.texto).toBe('dos')
    expect(navegarPrompts(p, 3, 'arriba', 'x')).toBeUndefined() // ya es el más antiguo
    expect(navegarPrompts(p, 1, 'abajo', 'borrador')).toEqual({ pasos: 0, texto: 'borrador' })
    expect(navegarPrompts(p, 0, 'abajo', 'x')).toBeUndefined()
    expect(navegarPrompts([], 0, 'arriba', 'x')).toBeUndefined()
  })
  it('solo navega con el cursor en el borde del texto', () => {
    expect(cursorEnBorde('a\nb', 1, 1, 'arriba')).toBe(true)
    expect(cursorEnBorde('a\nb', 3, 3, 'arriba')).toBe(false)
    expect(cursorEnBorde('a\nb', 3, 3, 'abajo')).toBe(true)
    expect(cursorEnBorde('a\nb', 0, 3, 'arriba')).toBe(false) // hay selección
  })
})

describe('buscarEnTurnos', () => {
  const turnos = [turno('Arregla la configuración', [texto('Hecho')]), turno('Otra cosa', [texto('Cambié el LOGIN')]), turno('Nada', [])]
  it('ignora acentos y mayúsculas, y busca en lo pedido y lo respondido', () => {
    expect(buscarEnTurnos(turnos, 'configuracion')).toEqual([0])
    expect(buscarEnTurnos(turnos, 'login')).toEqual([1])
  })
  it('exige todas las palabras', () => {
    expect(buscarEnTurnos(turnos, 'otra login')).toEqual([1])
    expect(buscarEnTurnos(turnos, 'otra hecho')).toEqual([])
  })
  it('una consulta vacía no coincide con nada', () => {
    expect(buscarEnTurnos(turnos, '  ')).toEqual([])
  })
})

describe('exportarMarkdown', () => {
  it('escribe pedido y respuesta de cada turno', () => {
    const md = exportarMarkdown({ titulo: 'Mi chat', fecha: new Date('2026-01-02T10:00:00Z'), turnos: [turno('Hola', [texto('¿Qué tal?'), herramienta(), herramienta()]), turno('Falla', [], { estado: 'error' })] })
    expect(md).toContain('# Mi chat')
    expect(md).toContain('_Exportada el 2026-01-02 · 2 mensajes_')
    expect(md).toContain('## Tú\n\nHola\n\n## Asistente\n\n¿Qué tal?')
    expect(md).toContain('_2 acciones_')
    expect(md).toContain('_(sin respuesta de texto)_')
    expect(md).toContain('_error_')
    expect(md.endsWith('\n')).toBe(true)
  })
  it('nombre de archivo seguro', () => {
    expect(nombreArchivoExportado('¡Arregla el login! / urgente', new Date('2026-03-04T00:00:00Z'))).toBe('arregla-el-login-urgente-2026-03-04.md')
    expect(nombreArchivoExportado('???', new Date('2026-03-04T00:00:00Z'))).toBe('conversacion-2026-03-04.md')
  })
})

describe('estimarEnvio', () => {
  it('cuenta ~4 caracteres por token y el contexto resultante', () => {
    expect(estimarEnvio('a'.repeat(400), { tokens: 9_900, ventana: 20_000 })).toEqual({ entrada: 100, porcentajeDespues: 50 })
  })
  it('sin ventana no inventa el porcentaje y nunca pasa de 100', () => {
    expect(estimarEnvio('hola')).toEqual({ entrada: 1 })
    expect(estimarEnvio('a'.repeat(4000), { tokens: 1_000, ventana: 1_000 }).porcentajeDespues).toBe(100)
  })
})

describe('cambios de edición', () => {
  it('Edit, MultiEdit y Write', () => {
    expect(cambiosDeEdicion('Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })).toEqual([{ ruta: '/p/a.ts', antes: 'x', despues: 'y', reescribe: false }])
    expect(cambiosDeEdicion('MultiEdit', { file_path: '/p/a.ts', edits: [{ old_string: '1', new_string: '2' }, { nada: true }, { old_string: '3', new_string: '' }] })).toHaveLength(2)
    expect(cambiosDeEdicion('Write', { file_path: '/p/b.ts', content: 'hola' })).toEqual([{ ruta: '/p/b.ts', antes: '', despues: 'hola', reescribe: true }])
  })
  it('entradas raras no rompen', () => {
    expect(cambiosDeEdicion('Edit', { file_path: 3 })).toEqual([])
    expect(cambiosDeEdicion('Edit', { file_path: '/a' })).toEqual([])
    expect(cambiosDeEdicion('Bash', { command: 'ls' })).toEqual([])
    expect(cambiosDeEdicion('MultiEdit', { file_path: '/a', edits: 'no' })).toEqual([])
  })
})

describe('revertirCambio', () => {
  it('deshace un cambio que aparece una sola vez', () => {
    expect(revertirCambio('a\nconst y = 2\nb', 'const x = 1', 'const y = 2')).toEqual({ ok: true, contenido: 'a\nconst x = 1\nb' })
  })
  it('si el texto ya no está, está repetido o se había borrado, no toca nada', () => {
    expect(revertirCambio('otra cosa', 'x', 'y')).toEqual({ ok: false, motivo: 'ya-cambiado' })
    expect(revertirCambio('y y', 'x', 'y')).toEqual({ ok: false, motivo: 'ambiguo' })
    expect(revertirCambio('abc', 'x', '')).toEqual({ ok: false, motivo: 'sin-referencia' })
  })
  it('conserva los símbolos especiales de reemplazo ($&)', () => {
    expect(revertirCambio('A y B', "$& $1", 'y')).toEqual({ ok: true, contenido: 'A $& $1 B' })
  })
})

describe('rutaRelativa', () => {
  it('relativa dentro del proyecto, nada fuera de él', () => {
    expect(rutaRelativa('/home/u/p/src/a.ts', '/home/u/p')).toBe('src/a.ts')
    expect(rutaRelativa('/home/u/p/src/a.ts', '/home/u/p/')).toBe('src/a.ts')
    expect(rutaRelativa('/home/u/otro/a.ts', '/home/u/p')).toBeUndefined()
    expect(rutaRelativa('/home/u/pp/a.ts', '/home/u/p')).toBeUndefined()
    expect(rutaRelativa('C:\\u\\p\\a.ts', 'C:\\u\\p')).toBe('a.ts')
  })
})

describe('limpiarParaVoz', () => {
  it('quita código, enlaces y marcas', () => {
    expect(limpiarParaVoz('# Título\n- **uno** con `code`\n```ts\nconst a = 1\n```\nMira [docs](http://x.y) o http://z.w')).toBe('Título uno con code (bloque de código) Mira docs o (enlace)')
  })
})

describe('organizar conversaciones', () => {
  const lista = [
    { id: 'a', titulo: 'Arreglar login' },
    { id: 'b', titulo: 'Refactor API' },
    { id: 'c', titulo: 'Documentación' }
  ]
  it('fija y desfija; la última fijada va arriba', () => {
    let o = alternarFijada(organizacionVacia(), 'c')
    o = alternarFijada(o, 'b')
    expect(ordenarSesiones(lista, o).map((s) => s.id)).toEqual(['b', 'c', 'a'])
    o = alternarFijada(o, 'b')
    expect(ordenarSesiones(lista, o).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })
  it('etiquetas: normaliza, sin repetidos, con tope', () => {
    expect(parsearEtiquetas(' Trabajo, urgente ,trabajo;;  ')).toEqual(['trabajo', 'urgente'])
    expect(parsearEtiquetas('a,b,c,d,e,f,g')).toHaveLength(5)
    expect(parsearEtiquetas('x'.repeat(60))[0]).toHaveLength(24)
    let o = ponerEtiquetas(organizacionVacia(), 'a', 'uno, dos')
    expect(o.etiquetas).toEqual({ a: ['uno', 'dos'] })
    o = ponerEtiquetas(o, 'a', '')
    expect(o.etiquetas).toEqual({})
  })
  it('filtra por título, etiqueta y contenido', () => {
    const o = ponerEtiquetas(organizacionVacia(), 'b', 'backend')
    expect(filtrarSesiones(lista, o, { texto: 'login' }).map((s) => s.id)).toEqual(['a'])
    expect(filtrarSesiones(lista, o, { texto: 'backend' }).map((s) => s.id)).toEqual(['b'])
    expect(filtrarSesiones(lista, o, { etiqueta: 'backend' }).map((s) => s.id)).toEqual(['b'])
    expect(filtrarSesiones(lista, o, { texto: 'documentacion' }).map((s) => s.id)).toEqual(['c'])
    expect(filtrarSesiones(lista, o, { texto: 'jwt', contenido: new Map([['a', 'cambié el JWT']]) }).map((s) => s.id)).toEqual(['a'])
    expect(filtrarSesiones(lista, o, {})).toHaveLength(3)
  })
  it('olvida lo de una conversación borrada y lista las etiquetas en uso', () => {
    let o = alternarFijada(ponerEtiquetas(organizacionVacia(), 'a', 'x, y'), 'a')
    o = ponerEtiquetas(o, 'b', 'y, z')
    expect(etiquetasEnUso(o)).toEqual(['x', 'y', 'z'])
    o = olvidarSesion(o, 'a')
    expect(o.fijadas).toEqual([])
    expect(etiquetasEnUso(o)).toEqual(['y', 'z'])
  })
  it('lee lo guardado ignorando basura', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ fijadas: ['a', 3], etiquetas: { a: ['x', 9], b: 'no' } }) })
    expect(leerOrganizacion()).toEqual({ fijadas: ['a'], etiquetas: { a: ['x'] } })
    vi.stubGlobal('localStorage', { getItem: () => '{roto' })
    expect(leerOrganizacion()).toEqual(organizacionVacia())
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado') } })
    expect(leerOrganizacion()).toEqual(organizacionVacia())
  })
})
