import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { limpiarCredencial } from '../src/shared/credenciales'
import type * as Mod from '../src/main/credenciales'
import { crearEjecutorOdesk } from '../src/main/core/herramientas-odesk'
import { COMPARTIDOS } from '../src/main/perfiles'
import { HERRAMIENTAS_ODESK } from '../src/shared/herramientas-odesk'

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

  it('obtener pide confirmación hasta el modo autónomo', () => {
    expect(HERRAMIENTAS_ODESK.find((h) => h.nombre === 'credenciales_obtener')!.riesgo).toBe('ejecucion')
    expect(HERRAMIENTAS_ODESK.find((h) => h.nombre === 'credenciales_listar')!.riesgo).toBe('lectura')
  })
})
