import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Registro } from '../src/main/registro'
import { contextoSeguro, sanear, type EntradaRegistro } from '../src/shared/registro'

describe('sanear: lo que no debe salir del equipo', () => {
  it('quita la carpeta personal y los nombres de usuario de las rutas', () => {
    expect(sanear('Error en /home/ana/dev/app/src/x.ts:3', 500, '/home/ana')).toBe('Error en ~/dev/app/src/x.ts:3')
    expect(sanear('at /home/pedro/proyecto/a.js', 500)).toBe('at /home/~/proyecto/a.js')
    expect(sanear('at /Users/maria/code/a.js y C:\\Users\\Luis\\app\\b.js', 500)).toBe('at /Users/~/code/a.js y C:\\Users\\~\\app\\b.js')
  })
  it('oculta tokens, claves y contraseñas con forma conocida', () => {
    const t = sanear('Authorization: Bearer abcdefghijklmnop1234 · ghp_abcdefghijklmnopqrstuvwx · sk-abcdefghijklmnopqrstuv · GOCSPX-abc_DEF-123 · password=hunter2secret · https://ana:clave@host.com/x', 800)
    for (const secreto of ['abcdefghijklmnop1234', 'ghp_abcdefghijklmnopqrstuvwx', 'sk-abcdefghijklmnopqrstuv', 'abc_DEF-123', 'hunter2secret', 'ana:clave']) expect(t).not.toContain(secreto)
    expect(t).toContain('Bearer ***')
  })
  it('oculta un JWT y recorta lo largo', () => {
    expect(sanear('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.firmafirmafirma', 300)).not.toContain('eyJhbGci')
    const largo = sanear('x'.repeat(5000), 100)
    expect(largo.length).toBeLessThan(130)
    expect(largo.endsWith('[recortado]')).toBe(true)
  })
  it('acepta Error y valores raros', () => {
    expect(sanear(new Error('falló'), 100)).toBe('Error: falló')
    expect(sanear(undefined, 100)).toBe('')
    expect(sanear(42, 100)).toBe('42')
  })
  it('el contexto solo lleva escalares y sin rutas personales', () => {
    expect(contextoSeguro({ celdas: 4, ok: true, ruta: '/home/ana/x', obj: { a: 1 }, fn: () => 1 }, '/home/ana')).toEqual({ celdas: 4, ok: true, ruta: '~/x' })
  })
})

async function entorno(extra: { falla?: () => boolean; ahora?: () => number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'registro-'))
  const subidos: EntradaRegistro[][] = []
  const r = new Registro({
    archivo: join(dir, 'logs', 'app.log'),
    archivoPendientes: join(dir, 'logs', 'pendientes.json'),
    subir: async (lote) => {
      if (extra.falla?.()) throw new Error('sin sesión')
      subidos.push(lote)
    },
    version: '1.0.0',
    plataforma: 'linux',
    casa: '/home/ana',
    contexto: () => ({ electron: '44' }),
    ...(extra.ahora ? { ahora: extra.ahora } : {}),
    esperaErrorMs: 5,
    cadaMs: 20
  })
  return { r, dir, subidos }
}
const evento = (m = 'falló algo') => ({ level: 'error' as const, source: 'main', kind: 'prueba', message: m, stack: 'Error\n  at /home/ana/app/a.js:1' })

describe('Registro: archivo y cola de subida', () => {
  it('anota en el archivo sin datos personales, y sube el lote con su contexto', async () => {
    const { r, dir, subidos } = await entorno()
    r.registrar(evento('Falló /home/ana/proyecto'))
    await r.vaciar()
    await r.asentar()
    expect(subidos).toHaveLength(1)
    expect(subidos[0]![0]).toMatchObject({ level: 'error', source: 'main', kind: 'prueba', message: 'Falló ~/proyecto', context: { electron: '44' } })
    expect(subidos[0]![0]!.stack).toContain('~/app/a.js')
    const archivo = await readFile(join(dir, 'logs', 'app.log'), 'utf8')
    expect(archivo).toMatch(/ERROR \[main\/prueba\] Falló ~\/proyecto/)
    expect(archivo).not.toContain('/home/ana')
    expect(r.pendientes()).toBe(0)
  })

  it('si no se puede subir (sin sesión), se queda en cola y se reintenta; nunca lanza', async () => {
    let falla = true
    const { r, subidos } = await entorno({ falla: () => falla })
    r.registrar(evento('a'))
    await expect(r.vaciar()).resolves.toBeUndefined()
    expect(r.pendientes()).toBe(1)
    expect(subidos).toHaveLength(0)
    falla = false
    await r.vaciar()
    expect(subidos).toHaveLength(1)
    expect(r.pendientes()).toBe(0)
  })

  it('la cola sobrevive a un cierre: la siguiente vez se recupera y se sube', async () => {
    const a = await entorno({ falla: () => true })
    a.r.registrar(evento('se quedó sin subir'))
    await a.r.vaciar()
    await a.r.asentar()
    // «reinicio»: otra instancia sobre los mismos archivos
    const subidos: EntradaRegistro[][] = []
    const b = new Registro({ archivo: join(a.dir, 'logs', 'app.log'), archivoPendientes: join(a.dir, 'logs', 'pendientes.json'), subir: async (l) => void subidos.push(l), version: '1', plataforma: 'linux', cadaMs: 10_000 })
    await b.iniciar()
    await b.vaciar()
    b.detener()
    expect(subidos.flat().map((e) => e.message)).toEqual(['se quedó sin subir'])
  })

  it('una ráfaga del mismo error no inunda: pasadas 3 repeticiones seguidas se descartan', async () => {
    let t = 1_000_000
    const { r, subidos } = await entorno({ ahora: () => t })
    for (let i = 0; i < 50; i++) r.registrar(evento('bucle de render'))
    await r.vaciar()
    expect(subidos.flat()).toHaveLength(3)
    t += 11_000 // pasó la ventana: vuelve a contar
    r.registrar(evento('bucle de render'))
    await r.vaciar()
    expect(subidos.flat()).toHaveLength(4)
  })

  it('sube por lotes de 50 y acota la cola a 200', async () => {
    const { r, subidos } = await entorno({ falla: () => false })
    for (let i = 0; i < 260; i++) r.registrar({ ...evento(`distinto ${i}`) })
    expect(r.pendientes()).toBe(200) // los más antiguos se descartan
    await r.vaciar()
    expect(subidos.map((l) => l.length)).toEqual([50, 50, 50, 50])
  })

  it('rota el archivo al pasar de 2 MB', async () => {
    const { r, dir } = await entorno()
    await writeFile(join(dir, 'logs-previo'), '')
    r.registrar(evento('primero'))
    await r.asentar()
    const archivo = join(dir, 'logs', 'app.log')
    await writeFile(archivo, 'x'.repeat(2 * 1024 * 1024 + 10))
    r.registrar(evento('después de rotar'))
    await r.asentar()
    expect(await readFile(`${archivo}.1`, 'utf8')).toMatch(/^x+/)
    expect(await readFile(archivo, 'utf8')).toContain('después de rotar')
  })
})
