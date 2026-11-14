import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Cliente from '../src/main/servidor/cliente'
import type * as Proyectos from '../src/main/proyectos'
import { ServidorFalso } from './servidor-falso'

let srv: ServidorFalso
let m: typeof Cliente
let proyectos: typeof Proyectos

beforeAll(async () => {
  vi.stubEnv('HOME', await mkdtemp(join(tmpdir(), 'home-srv-')))
  srv = await new ServidorFalso([{ id: 'a1', nombre: 'Uno', ruta: '/tmp/uno', grupo: 'g1' }]).iniciar()
  srv.grupos.push({ id: 'g1', nombre: 'Grupo' })
  srv.apuntar()
  m = await import('../src/main/servidor/cliente')
  proyectos = await import('../src/main/proyectos')
})
afterAll(() => srv.cerrar())

describe('cliente del servidor', () => {
  it('sin sesión no llega a pedir nada: lanza ErrorSesion', async () => {
    expect((await m.servidor.estado()).activa).toBe(false)
    await expect(proyectos.leerProyectos()).rejects.toBeInstanceOf(m.ErrorSesion)
  })

  it('con sesión traduce proyectos y grupos del servidor al modelo del escritorio', async () => {
    await srv.entrar()
    expect(await m.servidor.estado()).toMatchObject({ activa: true, email: 'test@desk.local' })
    expect(await proyectos.leerProyectos()).toEqual({
      grupos: [{ id: 'g1', nombre: 'Grupo' }],
      proyectos: [{ id: 'a1', nombre: 'Uno', ruta: '/tmp/uno', grupo: 'g1' }]
    })
  })

  it('un corte del servidor no tumba las lecturas: se sigue con lo último que respondió', async () => {
    srv.caido = true
    proyectos.olvidarProyectos()
    try {
      expect((await proyectos.leerProyectos()).proyectos).toEqual([{ id: 'a1', nombre: 'Uno', ruta: '/tmp/uno', grupo: 'g1' }])
      // Lo que escribe no se da por hecho: falla y lo dice.
      await expect(m.servidor.post('/projects', { name: 'x' })).rejects.toThrow(/No se pudo conectar/)
    } finally {
      srv.caido = false
    }
  })

  it('cerrar sesión olvida el token', async () => {
    await m.servidor.cerrar()
    expect((await m.servidor.estado()).activa).toBe(false)
  })

  it('un servidor caído da un mensaje claro', async () => {
    const caido = new m.ClienteServidor('http://127.0.0.1:1')
    await expect(caido.iniciar('a@b.c', 'x')).rejects.toThrow(/No se pudo conectar con el servidor/)
  })
})
