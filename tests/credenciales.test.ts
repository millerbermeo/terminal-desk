import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { limpiarCredencial } from '../src/shared/credenciales'
import type * as Mod from '../src/main/credenciales'
import { crearEjecutorOdesk } from '../src/main/core/herramientas-odesk'
import { COMPARTIDOS } from '../src/main/perfiles'
import { HERRAMIENTAS_ODESK } from '../src/shared/herramientas-odesk'
import { sinValoresCredencial } from '../src/shared/credenciales-herramientas'
import { esDestructiva } from '../src/main/core/guardrails/destructivo'
import { permisosCli } from '../src/main/core/suscripcion'

describe('credenciales de prueba: validación', () => {
  it('exige nombre, descarta campos sin clave y marca los secretos', () => {
    expect(limpiarCredencial({ nombre: ' ' }, 'a', 1)).toBeNull()
    expect(limpiarCredencial({ nombre: 'Admin', campos: [{ clave: 'u', valor: 'x' }, { clave: ' ', valor: 'y' }, { clave: 'p', valor: 'z', secreto: true }] }, 'a', 1)).toEqual({
      id: 'a', nombre: 'Admin', campos: [{ clave: 'u', valor: 'x' }, { clave: 'p', valor: 'z', secreto: true }], actualizada: 1
    })
  })
})

describe('credenciales de prueba: archivo local', () => {
  let m: typeof Mod
  let casa: string
  beforeAll(async () => {
    casa = await mkdtemp(join(tmpdir(), 'home-cred-'))
    vi.stubEnv('HOME', casa)
    m = await import('../src/main/credenciales')
  })

  it('guarda por ámbito con permisos 0600, edita y elimina', async () => {
    const g = { tipo: 'grupo', id: 'g1' } as const
    const l = await m.guardarCredencial(g, { nombre: 'Admin', campos: [{ clave: 'usuario', valor: 'root' }, { clave: 'clave', valor: 's3', secreto: true }] })
    expect(l).toHaveLength(1)
    const ruta = join(casa, '.odesk-agent', 'credenciales', 'grupo-g1.json')
    expect(((await stat(ruta)).mode & 0o777).toString(8)).toBe('600')
    expect(await readFile(ruta, 'utf8')).toContain('s3')
    const editada = await m.guardarCredencial(g, { id: l[0]!.id, nombre: 'Admin', campos: [{ clave: 'usuario', valor: 'otro' }] })
    expect(editada).toHaveLength(1)
    expect(editada[0]!.campos[0]!.valor).toBe('otro')
    await expect(m.guardarCredencial(g, { nombre: 'admin', campos: [] })).rejects.toThrow(/ya existe/)
    expect(await m.eliminarCredencial(g, l[0]!.id)).toEqual([])
  })

  it('rechaza ámbitos que salen de la carpeta', async () => {
    await expect(m.listarCredenciales({ tipo: 'proyecto', id: '../x' })).rejects.toThrow(/ámbito/)
  })

  it('es personal por equipo: no está entre lo compartido y la IA lista sin valores', async () => {
    expect(COMPARTIDOS.has('credenciales')).toBe(false)
    await m.guardarCredencial({ tipo: 'proyecto', id: 'p1' }, { nombre: 'Sandbox', notas: 'solo pruebas', campos: [{ clave: 'api_key', valor: 'sk-test-123', secreto: true }] })
    const ejecutar = crearEjecutorOdesk({ tareas: {} as never, github: {} as never, carpetaDe: async () => '', credencialesPrueba: m.credencialesDe })
    const listado = await ejecutar('credenciales_listar', {}, { proyectoId: 'p1' })
    expect(listado.texto).toContain('Sandbox')
    expect(listado.texto).toContain('api_key')
    expect(listado.texto).not.toContain('sk-test-123')
    const obtenida = await ejecutar('credenciales_obtener', { nombre: 'sandbox' }, { proyectoId: 'p1' })
    expect(obtenida.texto).toContain('sk-test-123')
    expect((await ejecutar('credenciales_obtener', { nombre: 'nada' }, { proyectoId: 'p1' })).error).toBe(true)
  })

  it('la IA crea, actualiza por nombre, renombra y elimina; nunca devuelve valores', async () => {
    const ejecutar = crearEjecutorOdesk({
      tareas: {} as never, github: {} as never, carpetaDe: async () => '', credencialesPrueba: m.credencialesDe,
      credencialesGestion: { guardar: m.guardarCredencialPorNombre, eliminar: m.eliminarCredencialPorNombre }
    })
    const ctx = { proyectoId: 'p2' }
    const creada = await ejecutar('credenciales_guardar', { nombre: 'Admin', notas: 'panel', campos: [{ clave: 'usuario', valor: 'root' }, { clave: 'password', valor: 'hunter2' }] }, ctx)
    expect(creada.error).toBeUndefined()
    expect(creada.texto).toContain('creada')
    expect(creada.texto).toContain('password (secreto)') // se deduce del nombre del campo
    expect(creada.texto).not.toContain('hunter2')
    // Actualizar: solo cambia lo que se manda; lo demás se conserva.
    const act = await ejecutar('credenciales_guardar', { nombre: 'admin', campos: [{ clave: 'Password', valor: 'nueva' }, { clave: 'url', valor: 'http://x' }], quitar_campos: ['usuario'] }, ctx)
    expect(act.texto).toContain('actualizada')
    const [c] = await m.listarCredenciales({ tipo: 'proyecto', id: 'p2' })
    expect(c).toMatchObject({ nombre: 'Admin', notas: 'panel', campos: [{ clave: 'password', valor: 'nueva', secreto: true }, { clave: 'url', valor: 'http://x' }] })
    await ejecutar('credenciales_guardar', { nombre: 'Admin', nombre_nuevo: 'Root' }, ctx)
    expect((await m.listarCredenciales({ tipo: 'proyecto', id: 'p2' }))[0]!.nombre).toBe('Root')
    // Errores como dato: nueva sin campos, grupo inexistente, borrar lo que no hay.
    expect((await ejecutar('credenciales_guardar', { nombre: 'Vacia' }, ctx)).error).toBe(true)
    expect((await ejecutar('credenciales_guardar', { nombre: 'G', ambito: 'grupo', campos: [{ clave: 'a', valor: 'b' }] }, ctx)).error).toBe(true)
    expect((await ejecutar('credenciales_eliminar', { nombre: 'nada' }, ctx)).error).toBe(true)
    expect((await ejecutar('credenciales_eliminar', { nombre: 'root' }, ctx)).texto).toContain('eliminada')
    expect(await m.listarCredenciales({ tipo: 'proyecto', id: 'p2' })).toEqual([])
  })

  it('los valores que se guardan no pasan a eventos ni confirmaciones, y eliminar siempre pregunta', () => {
    const entrada = { nombre: 'A', campos: [{ clave: 'token', valor: 'sk-test-999' }] }
    expect(JSON.stringify(sinValoresCredencial('mcp__odesk__credenciales_guardar', entrada))).not.toContain('sk-test-999')
    expect(sinValoresCredencial('Bash', entrada)).toBe(entrada)
    expect(entrada.campos[0]!.valor).toBe('sk-test-999') // no toca el original: es lo que se ejecuta
    expect(esDestructiva('mcp__odesk__credenciales_eliminar', {})).toMatch(/elimina/)
    expect(esDestructiva('credenciales_eliminar', {})).toMatch(/elimina/)
    expect(esDestructiva('credenciales_guardar', {})).toBeNull()
    const autonomo = permisosCli('autonomo', [], true)
    expect(autonomo).toContain('mcp__odesk__credenciales_obtener')
    expect(autonomo).not.toContain('mcp__odesk__credenciales_eliminar')
    expect(permisosCli('ediciones', [], true)).toContain('mcp__odesk__credenciales_guardar')
    expect(permisosCli('preguntar', [], true)).not.toContain('mcp__odesk__credenciales_guardar')
  })

  it('obtener pide confirmación hasta el modo autónomo', () => {
    expect(HERRAMIENTAS_ODESK.find((h) => h.nombre === 'credenciales_obtener')!.riesgo).toBe('ejecucion')
    expect(HERRAMIENTAS_ODESK.find((h) => h.nombre === 'credenciales_listar')!.riesgo).toBe('lectura')
  })
})
