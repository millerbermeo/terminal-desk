import { randomBytes } from 'node:crypto'
import { appendFile, mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POLITICA_HISTORIAL, type Version } from '@shared/historial'
import { AlmacenHistorial, nuevoIdVersion } from '../src/main/historial/almacen'
import { carpetaIgnorada, esBinario, esDemasiadoGrande, motivoOmitir } from '../src/main/historial/reglas'

const DIA = 86_400_000
const AHORA = Date.parse('2026-10-17T12:00:00Z')
const carpeta = (): Promise<string> => mkdtemp(join(tmpdir(), 'hist-'))

async function version(a: AlmacenHistorial, ruta: string, contenido: Buffer | null, hace: number, extra: Partial<Version> = {}): Promise<Version> {
  const hash = contenido ? await a.guardarContenido(contenido) : null
  const ts = AHORA - hace
  const v: Version = { id: nuevoIdVersion(ts), ruta, hash, bytes: contenido?.length ?? 0, fecha: new Date(ts).toISOString(), origen: 'usuario', autor: {}, mas: 0, menos: 0, eliminada: contenido === null, ...extra }
  await a.anotar(v)
  return v
}

describe('almacén de versiones', () => {
  it('guarda el contenido comprimido y una sola vez; se recupera igual (también binario)', async () => {
    const a = new AlmacenHistorial(await carpeta())
    const texto = Buffer.from('linea repetida\n'.repeat(5000))
    const h1 = await a.guardarContenido(texto)
    const h2 = await a.guardarContenido(Buffer.from(texto))
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect((await a.leerContenido(h1)).equals(texto)).toBe(true)
    const { bytes } = await a.estadisticas()
    expect(bytes).toBeLessThan(texto.length / 20) // comprimido
    const binario = randomBytes(5000)
    expect((await a.leerContenido(await a.guardarContenido(binario))).equals(binario)).toBe(true)
    expect(esBinario(binario)).toBe(true)
    const objetos = await readdir(join(a.dir, 'objetos'))
    expect((await Promise.all(objetos.map((o) => readdir(join(a.dir, 'objetos', o))))).flat()).toHaveLength(2)
  })

  it('guarda las versiones en orden y sobreviven a reabrir el almacén; ignora una línea cortada a medias', async () => {
    const dir = await carpeta()
    const a = new AlmacenHistorial(dir)
    const v1 = await version(a, 'src/a.ts', Buffer.from('uno'), 3 * DIA)
    const v2 = await version(a, 'src/a.ts', Buffer.from('dos'), 2 * DIA)
    await version(a, 'b.md', Buffer.from('x'), DIA)
    expect((await a.versiones('src/a.ts')).map((v) => v.id)).toEqual([v1.id, v2.id])
    expect(await a.ultima('src/a.ts')).toMatchObject({ id: v2.id })
    // corte de luz a mitad de una línea
    const indice = join(dir, 'indice')
    const archivo = (await readdir(indice)).find(async (f) => (await readFile(join(indice, f), 'utf8')).includes('src/a.ts'))!
    for (const f of await readdir(indice)) if ((await readFile(join(indice, f), 'utf8')).includes('src/a.ts')) await appendFile(join(indice, f), '{"id":"roto","ruta":"src/a.ts","ha')
    void archivo
    const reabierto = new AlmacenHistorial(dir)
    expect((await reabierto.versiones('src/a.ts')).map((v) => v.id)).toEqual([v1.id, v2.id])
    expect((await reabierto.archivos()).map((f) => f.ruta).sort()).toEqual(['b.md', 'src/a.ts'])
    expect(await reabierto.estadisticas()).toMatchObject({ archivos: 2, versiones: 3 })
  })

  it('los ids se ordenan por fecha', () => {
    const ids = [3 * DIA, 2 * DIA, DIA, 0].map((h) => nuevoIdVersion(AHORA - h))
    expect([...ids].sort()).toEqual(ids)
    expect(nuevoIdVersion(AHORA)).not.toBe(nuevoIdVersion(AHORA))
  })

  it('un archivo borrado queda como versión «eliminada»', async () => {
    const a = new AlmacenHistorial(await carpeta())
    await version(a, 'x.txt', Buffer.from('contenido'), 2 * DIA)
    await version(a, 'x.txt', null, DIA)
    expect((await a.archivos())[0]).toMatchObject({ ruta: 'x.txt', versiones: 2, eliminado: true })
  })
})

describe('recorte del historial', () => {
  it('conserva todo 30 días, luego una por día y una por semana, y descarta lo de más de un año (la última siempre se queda)', async () => {
    const a = new AlmacenHistorial(await carpeta())
    const c = (t: string): Buffer => Buffer.from(t)
    // un mismo día de hace 40 días: tres versiones (se queda la más reciente); otro día; una semana de hace 120 días: dos; una de hace 400
    const viejaA = await version(a, 'f.txt', c('vieja'), 400 * DIA)
    const d40a = await version(a, 'f.txt', c('d40a'), 40 * DIA + 3 * 3_600_000)
    const d40b = await version(a, 'f.txt', c('d40b'), 40 * DIA + 2 * 3_600_000)
    const d40c = await version(a, 'f.txt', c('d40c'), 40 * DIA + 1 * 3_600_000)
    const d45 = await version(a, 'f.txt', c('d45'), 45 * DIA)
    const s120a = await version(a, 'f.txt', c('s120a'), 120 * DIA)
    const s120b = await version(a, 'f.txt', c('s120b'), 119 * DIA)
    const reciente1 = await version(a, 'f.txt', c('r1'), 3 * DIA)
    const reciente2 = await version(a, 'f.txt', c('r2'), 2 * DIA)
    const ultima = await version(a, 'f.txt', c('final'), 1 * DIA)
    const r = await a.limpiar(AHORA)
    const quedan = new Set((await a.versiones('f.txt')).map((v) => v.id))
    expect(quedan.has(viejaA.id)).toBe(false) // más de un año
    expect(quedan.has(d40c.id)).toBe(true) // la última de ese día
    expect([d40a.id, d40b.id].some((id) => quedan.has(id))).toBe(false)
    expect(quedan.has(d45.id)).toBe(true) // otro día
    expect([s120a.id, s120b.id].filter((id) => quedan.has(id))).toHaveLength(1) // una por semana
    for (const v of [reciente1, reciente2, ultima]) expect(quedan.has(v.id)).toBe(true) // lo reciente, completo
    expect(r.versionesBorradas).toBe(4)
    // los contenidos que ya nadie usa se borran del disco
    expect((await Promise.all((await readdir(join(a.dir, 'objetos'))).map((o) => readdir(join(a.dir, 'objetos', o))))).flat()).toHaveLength(quedan.size)
    expect(r.bytesLiberados).toBeGreaterThan(0)
  })

  it('un archivo borrado hace más de un año desaparece del todo; uno borrado hace poco se puede recuperar', async () => {
    const a = new AlmacenHistorial(await carpeta())
    await version(a, 'viejo.txt', Buffer.from('a'), 500 * DIA)
    await version(a, 'viejo.txt', null, 400 * DIA)
    await version(a, 'reciente.txt', Buffer.from('b'), 5 * DIA)
    await version(a, 'reciente.txt', null, 4 * DIA)
    await a.limpiar(AHORA)
    expect((await a.archivos()).map((f) => f.ruta)).toEqual(['reciente.txt'])
  })

  it('si supera el máximo de espacio descarta lo más antiguo, sin tocar la última versión de cada archivo ni contar dos veces el contenido repetido', async () => {
    const a = new AlmacenHistorial(await carpeta())
    const kb = (n: number): Buffer => randomBytes(n * 1024) // sin compresión posible: el tamaño en disco ≈ el real
    const repetido = kb(100)
    const unoV1 = await version(a, 'uno.bin', kb(100), 10 * DIA)
    const unoV2 = await version(a, 'uno.bin', repetido, 9 * DIA)
    const unoV3 = await version(a, 'uno.bin', kb(100), 8 * DIA)
    const unoV4 = await version(a, 'uno.bin', repetido, 7 * DIA) // mismo contenido que la v2: ocupa una sola vez
    const dosV1 = await version(a, 'dos.bin', kb(100), 6 * DIA)
    const dosV2 = await version(a, 'dos.bin', kb(100), 5 * DIA)
    const antes = (await a.estadisticas()).bytes
    expect(antes).toBeGreaterThan(450 * 1024) // 5 contenidos distintos de 100 KB
    const r = await a.limpiar(AHORA, { ...POLITICA_HISTORIAL, maxBytes: 300 * 1024 })
    const despues = (await a.estadisticas()).bytes
    expect(despues).toBeLessThanOrEqual(300 * 1024)
    expect(r.versionesBorradas).toBeGreaterThan(0)
    const quedan = new Set([...(await a.versiones('uno.bin')), ...(await a.versiones('dos.bin'))].map((v) => v.id))
    expect(quedan.has(unoV4.id)).toBe(true) // la última de cada archivo
    expect(quedan.has(dosV2.id)).toBe(true)
    expect(quedan.has(unoV1.id)).toBe(false) // lo más antiguo se fue primero
    void [unoV2, unoV3, dosV1]
  })

  it('sin nada que recortar no cambia nada', async () => {
    const a = new AlmacenHistorial(await carpeta())
    await version(a, 'a.txt', Buffer.from('a'), DIA)
    expect(await a.limpiar(AHORA)).toEqual({ versionesBorradas: 0, bytesLiberados: 0 })
  })

  it('borrar un archivo o todo el proyecto libera el espacio', async () => {
    const dir = await carpeta()
    const a = new AlmacenHistorial(dir)
    await version(a, 'a.txt', Buffer.from('aaa'), DIA)
    await version(a, 'b.txt', Buffer.from('bbb'), DIA)
    await a.borrarArchivo('a.txt')
    expect((await a.archivos()).map((f) => f.ruta)).toEqual(['b.txt'])
    expect((await a.estadisticas()).bytes).toBeGreaterThan(0)
    await a.borrarTodo()
    expect((await a.archivos())).toEqual([])
    expect(await stat(dir).then(() => true, () => false)).toBe(false)
  })
})

describe('qué se registra', () => {
  it('omite dependencias, resultados de compilar, carpetas ocultas, secretos, binarios y archivos generados', () => {
    for (const r of ['node_modules/x/index.js', 'src/node_modules/y.js', 'dist/app.js', 'build/o.js', '.git/config', '.cache/x.json', '.local/share/a.txt', 'a/.venv/lib.py']) expect(motivoOmitir(r), r).toBe('carpeta')
    for (const r of ['.env', 'config/.env.local', 'clave.pem', 'id_rsa', 'credentials.json']) expect(motivoOmitir(r), r).toBe('sensible')
    for (const r of ['foto.png', 'doc.pdf', 'a.zip', 'app.min.js', 'x.js.map', 'salida.log', 'datos.sqlite']) expect(motivoOmitir(r), r).toBe('no-texto')
    for (const r of ['package-lock.json', 'pnpm-lock.yaml', 'sub/yarn.lock']) expect(motivoOmitir(r), r).toBe('generado')
    for (const r of ['.guardado.ts.123.tmp', 'archivo~', 'x.swp']) expect(motivoOmitir(r), r).toBe('temporal')
  })

  it('registra el código y la configuración habituales (incluidas las carpetas ocultas útiles)', () => {
    for (const r of ['src/app.ts', 'README.md', 'package.json', '.gitignore', '.github/workflows/ci.yml', '.vscode/settings.json', 'docs/guia.md', 'bin/cli.js', 'scripts/build.sh', '.env.example']) expect(motivoOmitir(r), r).toBeNull()
    expect(carpetaIgnorada('node_modules')).toBe(true)
    expect(carpetaIgnorada('.github')).toBe(false)
    expect(carpetaIgnorada('src')).toBe(false)
  })

  it('un archivo de más de 1 MB es demasiado grande', () => {
    expect(esDemasiadoGrande(1_000_000)).toBe(false)
    expect(esDemasiadoGrande(1_000_001)).toBe(true)
  })
})
