import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MediosLlamada, nombreGrabacion, type FuenteCaptura } from '../src/main/chat/medios'

const imagen = (vacia = false) => ({ isEmpty: () => vacia, toJPEG: () => Buffer.from('jpg'), toPNG: () => Buffer.from('png') })
const fuente = (id: string, name: string, icono = false): FuenteCaptura => ({ id, name, thumbnail: imagen(), appIcon: icono ? imagen() : null })

let dir: string
let reloj: number
let grabando: boolean[]
const crear = (fuentes: FuenteCaptura[] = [fuente('screen:0:0', 'Pantalla 1'), fuente('window:7:0', 'Editor', true)], wayland = false) =>
  new MediosLlamada({ listarFuentes: async () => fuentes, carpetaGrabaciones: () => join(dir, 'Odesk Code'), ahora: () => reloj, wayland, alGrabar: (h) => grabando.push(h) })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'medios-'))
  reloj = new Date(2026, 10, 15, 23, 40, 5).getTime()
  grabando = []
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('compartir pantalla (main)', () => {
  it('lista pantallas y ventanas con miniatura e icono; en Wayland no se refresca', async () => {
    const m = crear()
    const r = await m.listar()
    expect(r.refrescar).toBe(true)
    expect(r.fuentes).toEqual([
      { id: 'screen:0:0', nombre: 'Pantalla 1', tipo: 'pantalla', miniatura: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` },
      { id: 'window:7:0', nombre: 'Editor', tipo: 'ventana', miniatura: expect.stringMatching(/^data:image\/jpeg/), icono: expect.stringMatching(/^data:image\/png/) }
    ])
    expect((await crear(undefined, true).listar()).refrescar).toBe(false)
  })

  it('sin elegir en el selector no se concede ninguna captura', () => {
    expect(crear().responderCaptura()).toBeNull()
  })

  it('la elección sirve una sola vez y caduca', async () => {
    const m = crear()
    await m.listar()
    m.elegir('window:7:0')
    expect(m.responderCaptura()?.video.id).toBe('window:7:0')
    expect(m.responderCaptura()).toBeNull()
    m.elegir('screen:0:0')
    reloj += 16_000
    expect(m.responderCaptura()).toBeNull()
  })

  it('no acepta una fuente que no salió en el último listado', async () => {
    const m = crear()
    await m.listar()
    expect(() => m.elegir('screen:99:0')).toThrow(/ya no está disponible/)
    expect(() => m.elegir({})).toThrow()
  })
})

describe('grabaciones (main)', () => {
  it('nombre de archivo legible y sin caracteres prohibidos', () => {
    expect(nombreGrabacion('Ana / "Dev": <x>', new Date(2026, 10, 15, 9, 5, 7))).toBe('Llamada con Ana Dev x - 2026-11-15 09.05.07.webm')
    expect(nombreGrabacion('   ', new Date(2026, 0, 1))).toMatch(/^Llamada con contacto - /)
  })

  it('escribe los trozos en orden y al terminar deja el archivo en la carpeta de videos', async () => {
    const m = crear()
    const { id } = await m.iniciarGrabacion('Ana')
    expect(grabando).toEqual([true])
    await Promise.all([m.trozo(id, new Uint8Array([1, 2])), m.trozo(id, new Uint8Array([3])), m.trozo(id, new Uint8Array([4, 5]))])
    const r = await m.terminarGrabacion(id)
    expect(r.nombre).toBe('Llamada con Ana - 2026-11-15 23.40.05.webm')
    expect([...(await readFile(r.ruta))]).toEqual([1, 2, 3, 4, 5])
    expect(await readdir(join(dir, 'Odesk Code'))).toEqual([r.nombre]) // sin el .parcial
    expect(grabando).toEqual([true, false])
    expect(m.esGuardada(r.ruta)).toBe(true)
    expect(m.esGuardada('/etc/passwd')).toBe(false)
    await expect(m.trozo(id, new Uint8Array([9]))).rejects.toThrow(/no existe/)
  })

  it('no pisa otra grabación con el mismo nombre', async () => {
    const m = crear()
    const a = await m.iniciarGrabacion('Ana')
    const b = await m.iniciarGrabacion('Ana')
    const ra = await m.terminarGrabacion(a.id)
    const rb = await m.terminarGrabacion(b.id)
    expect(rb.nombre).toBe(ra.nombre.replace('.webm', ' (2).webm'))
  })

  it('cancelar borra lo grabado; cerrar la app guarda lo que haya', async () => {
    const m = crear()
    const a = await m.iniciarGrabacion('Ana')
    await m.trozo(a.id, new Uint8Array([1]))
    await m.cancelarGrabacion(a.id)
    expect(await readdir(join(dir, 'Odesk Code'))).toEqual([])
    const b = await m.iniciarGrabacion('Luis')
    await m.trozo(b.id, new Uint8Array([7]))
    await m.cerrarTodo()
    expect(await readdir(join(dir, 'Odesk Code'))).toEqual(['Llamada con Luis - 2026-11-15 23.40.05.webm'])
  })

  it('rechaza trozos que no son bytes', async () => {
    const m = crear()
    const { id } = await m.iniciarGrabacion('Ana')
    await expect(m.trozo(id, 'hola')).rejects.toThrow(/no válido/)
    await m.cancelarGrabacion(id)
  })
})
