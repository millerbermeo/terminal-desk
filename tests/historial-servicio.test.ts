import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ejecutarOperacionHistorial } from '../src/main/historial/operaciones'
import { ServicioHistorial, type DepsHistorial } from '../src/main/historial/servicio'

const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
const carpeta = (p = 'hs-'): Promise<string> => mkdtemp(join(tmpdir(), p))
const PID = 'proyecto-1'
const ANA = { usuario: 'ana', cuenta: 'ana@desk.local', equipoId: 'pc-1', equipo: 'Portátil' }
const abiertos: ServicioHistorial[] = []

beforeAll(async () => {
  const casa = await carpeta('hs-casa-')
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(() => {
  while (abiertos.length) abiertos.pop()!.detener()
})

async function nuevo(extra: Partial<DepsHistorial> = {}, git = false) {
  const raiz = await carpeta('hs-proy-')
  if (git) {
    sh(raiz, 'init', '-q', '-b', 'main')
    sh(raiz, 'config', 'user.name', 'Ana')
    sh(raiz, 'config', 'user.email', 'ana@example.com')
  }
  const vigila = extra.vigilar === true // el vigilante solo se enciende en las pruebas que lo necesitan (con él, los cambios se registran solos y no son deterministas)
  const s = new ServicioHistorial({ dir: await carpeta('hs-dir-'), identidad: async () => ANA, cadaLimpiezaMs: 0, debounceMs: 30, vigilar: false, ...extra })
  abiertos.push(s)
  await s.sincronizarProyectos([{ id: PID, ruta: raiz }])
  if (vigila) await esperar(async () => (await s.estado(PID)).vigilancia !== 'apagada') // el vigilante arranca en segundo plano
  const esc = async (ruta: string, texto: string | Buffer): Promise<void> => {
    await mkdir(join(raiz, ruta, '..'), { recursive: true })
    await writeFile(join(raiz, ruta), texto)
  }
  return { s, raiz, esc }
}
const esperar = async (cond: () => Promise<boolean> | boolean, ms = 4000): Promise<void> => {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('tiempo agotado esperando la condición')
}

describe('captura de versiones', () => {
  it('registra cada cambio con su origen, autor, equipo y líneas; lo repetido no se duplica', async () => {
    const { s, esc } = await nuevo()
    await esc('src/app.ts', 'uno\ndos\n')
    const v1 = (await s.registrarRuta(PID, 'src/app.ts', 'usuario'))!
    expect(v1).toMatchObject({ ruta: 'src/app.ts', origen: 'usuario', autor: ANA, mas: 2, menos: 0, eliminada: false })
    expect(Date.parse(v1.fecha)).toBeGreaterThan(Date.now() - 5000)
    expect(await s.registrarRuta(PID, 'src/app.ts', 'usuario')).toBeNull() // sin cambios
    await esc('src/app.ts', 'uno\nDOS\ntres\n')
    const v2 = (await s.registrarRuta(PID, 'src/app.ts', 'ia', { herramienta: 'Edit', ejecucionId: 'ej-1' }))!
    expect(v2).toMatchObject({ origen: 'ia', herramienta: 'Edit', ejecucionId: 'ej-1', mas: 2, menos: 1 })
    expect(v2.id > v1.id).toBe(true)
    const lista = await s.versiones(PID, 'src/app.ts')
    expect(lista.map((v) => v.id)).toEqual([v2.id, v1.id]) // la más reciente primero
  })

  it('las versiones seguidas dentro del mismo milisegundo se mantienen en orden', async () => {
    const { s, esc } = await nuevo({ ahora: () => 1_800_000_000_000 })
    const ids: string[] = []
    for (const t of ['a', 'b', 'c', 'd']) {
      await esc('x.txt', t)
      ids.push((await s.registrarRuta(PID, 'x.txt', 'usuario'))!.id)
    }
    expect([...ids].sort()).toEqual(ids)
    expect((await s.versiones(PID, 'x.txt')).map((v) => v.id)).toEqual([...ids].reverse())
  })

  it('un borrado queda registrado y, si vuelve a existir, también', async () => {
    const { s, raiz, esc } = await nuevo()
    await esc('a.txt', 'hola\nmundo\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    await rm(join(raiz, 'a.txt'))
    const borrado = (await s.registrarRuta(PID, 'a.txt', 'externo'))!
    expect(borrado).toMatchObject({ eliminada: true, hash: null, menos: 2, mas: 0 })
    expect(await s.registrarRuta(PID, 'a.txt', 'externo')).toBeNull()
    await esc('a.txt', 'volvió\n')
    expect(await s.registrarRuta(PID, 'a.txt', 'usuario')).toMatchObject({ eliminada: false, mas: 1 })
    expect((await s.archivos(PID)).archivos[0]).toMatchObject({ ruta: 'a.txt', versiones: 3, eliminado: false })
  })

  it('no registra secretos, dependencias, binarios, archivos enormes, carpetas ni rutas fuera del proyecto', async () => {
    const { s, raiz, esc } = await nuevo()
    await esc('.env', 'TOKEN=1')
    await esc('node_modules/x/i.js', 'x')
    await esc('imagen.dat', Buffer.from([1, 2, 0, 3]))
    await esc('enorme.txt', 'a'.repeat(1_100_000))
    await mkdir(join(raiz, 'carpeta'))
    await esc('pnpm-lock.yaml', 'x')
    for (const r of ['.env', 'node_modules/x/i.js', 'imagen.dat', 'enorme.txt', 'carpeta', 'pnpm-lock.yaml', '../fuera.txt', '/etc/hostname', '', '.']) {
      expect(await s.registrarRuta(PID, r, 'usuario'), r).toBeNull()
    }
    expect((await s.archivos(PID)).archivos).toEqual([])
    // una ruta absoluta dentro del proyecto sí vale
    await esc('ok.ts', 'x')
    expect(await s.registrarRuta(PID, join(raiz, 'ok.ts'), 'usuario')).toMatchObject({ ruta: 'ok.ts' })
  })

  it('un «..» en medio de la ruta (p. ej. desde el gancho de Claude Code) no lee nada de fuera del proyecto', async () => {
    const { s, raiz, esc } = await nuevo()
    const vecina = `${raiz}-vecina`
    await mkdir(vecina)
    await writeFile(join(vecina, 'secreto.txt'), 'no debe entrar en el historial')
    await esc('src/a.ts', 'x')
    const nombre = vecina.split(/[\\/]/).pop()!
    for (const r of [`src/../../${nombre}/secreto.txt`, `./src/../../${nombre}/secreto.txt`, `src/../..`]) {
      expect(await s.registrarRuta(PID, r, 'ia'), r).toBeNull()
      expect(await s.versiones(PID, r), r).toEqual([])
      await expect(s.leer(PID, r, 'actual'), r).rejects.toThrow(/Ruta no válida/)
    }
    expect((await s.archivos(PID)).archivos).toEqual([])
    // una ruta con «..» que se queda dentro sí vale, y se guarda ya resuelta
    expect(await s.registrarRuta(PID, 'otra/../src/a.ts', 'ia')).toMatchObject({ ruta: 'src/a.ts' })
  })

  it('respeta .gitignore', async () => {
    const { s, esc } = await nuevo({}, true)
    await esc('.gitignore', 'secretos/\n*.generado\n')
    await esc('secretos/clave.txt', 'x')
    await esc('a.generado', 'x')
    await esc('normal.txt', 'x')
    expect(await s.registrarRuta(PID, 'secretos/clave.txt', 'usuario')).toBeNull()
    expect(await s.registrarRuta(PID, 'a.generado', 'usuario')).toBeNull()
    expect(await s.registrarRuta(PID, 'normal.txt', 'usuario')).not.toBeNull()
  })

  it('si el proyecto no existe o está apagado, no registra', async () => {
    const { s, esc } = await nuevo()
    expect(await s.registrarRuta('otro', 'a.txt', 'usuario')).toBeNull()
    await esc('a.txt', 'x')
    await s.ajustar(PID, false)
    expect(await s.registrarRuta(PID, 'a.txt', 'usuario')).toBeNull()
    await s.ajustar(PID, true)
    expect(await s.registrarRuta(PID, 'a.txt', 'usuario')).not.toBeNull()
  })
})

describe('punto de partida desde git', () => {
  it('la primera vez que cambia un archivo versionado guarda antes su versión de HEAD, con la fecha del commit', async () => {
    const { s, raiz, esc } = await nuevo({}, true)
    await esc('app.ts', 'a\nb\nc\n')
    sh(raiz, 'add', '-A')
    sh(raiz, 'commit', '-q', '-m', 'Primero', '--date=2026-01-02T10:00:00')
    await esc('app.ts', 'a\nB\nc\nd\n')
    const v = (await s.registrarRuta(PID, 'app.ts', 'ia', { herramienta: 'Write' }))!
    expect(v).toMatchObject({ origen: 'ia', mas: 2, menos: 1 }) // se compara con lo de git, no con «nada»
    const vs = await s.versiones(PID, 'app.ts')
    expect(vs.map((x) => x.origen)).toEqual(['ia', 'base'])
    expect(vs[1]).toMatchObject({ nota: 'Versión del último commit de git', mas: 3 })
    const d = await s.comparar(PID, 'app.ts', vs[1]!.id, v.id)
    expect(d.diff).toMatchObject({ modificadas: 1, agregadas: 1, quitadas: 0 })
  })

  it('un archivo igual a git solo queda como punto de partida (sin versión nueva); uno borrado sin haberse visto queda registrado', async () => {
    const { s, raiz, esc } = await nuevo({}, true)
    await esc('igual.txt', 'x\n')
    await esc('borrado.txt', 'y\n')
    sh(raiz, 'add', '-A')
    sh(raiz, 'commit', '-q', '-m', 'c')
    expect(await s.registrarRuta(PID, 'igual.txt', 'externo')).toBeNull()
    expect((await s.versiones(PID, 'igual.txt')).map((v) => v.origen)).toEqual(['base'])
    await rm(join(raiz, 'borrado.txt'))
    expect(await s.registrarRuta(PID, 'borrado.txt', 'externo')).toMatchObject({ eliminada: true })
    expect((await s.versiones(PID, 'borrado.txt')).map((v) => v.origen)).toEqual(['externo', 'base'])
  })

  it('un archivo nuevo (que git no tiene) empieza en su primera versión', async () => {
    const { s, esc } = await nuevo({}, true)
    await esc('nuevo.ts', 'x\n')
    expect(await s.registrarRuta(PID, 'nuevo.ts', 'usuario')).toMatchObject({ mas: 1, menos: 0 })
    expect((await s.versiones(PID, 'nuevo.ts')).map((v) => v.origen)).toEqual(['usuario'])
  })
})

describe('escrituras del editor y de la IA', () => {
  it('antes de escribir guarda lo que hubiera cambiado fuera de la app; después, la versión con su origen', async () => {
    const { s, esc } = await nuevo()
    await esc('a.txt', 'original\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    await esc('a.txt', 'editado en otro programa\n') // cambio que la app todavía no vio
    expect(await s.antesDeEscribir(PID, 'a.txt')).toMatchObject({ origen: 'externo', nota: 'Estado justo antes de escribir' })
    await esc('a.txt', 'escrito por la IA\n')
    expect(await s.despuesDeEscribir(PID, 'a.txt', 'ia', { herramienta: 'Edit', ejecucionId: 'e1' })).toMatchObject({ origen: 'ia', herramienta: 'Edit' })
    expect((await s.versiones(PID, 'a.txt')).map((v) => v.origen)).toEqual(['ia', 'externo', 'usuario'])
    // si no había nada nuevo antes de escribir, no inventa versiones
    expect(await s.antesDeEscribir(PID, 'a.txt')).toBeNull()
  })
})

describe('consulta, comparación y filtros', () => {
  async function conHistoria() {
    const e = await nuevo()
    await e.esc('uno.ts', 'a\n')
    await e.s.registrarRuta(PID, 'uno.ts', 'usuario')
    await e.esc('uno.ts', 'a\nb\n')
    await e.s.registrarRuta(PID, 'uno.ts', 'ia', { herramienta: 'Write' })
    await e.esc('docs/dos.md', 'x\n')
    await e.s.registrarRuta(PID, 'docs/dos.md', 'externo')
    return e
  }

  it('lista los archivos con historial (el más reciente primero) y filtra por texto, origen, autor y fecha', async () => {
    const { s } = await conHistoria()
    const todos = await s.archivos(PID)
    expect(todos.archivos.map((f) => [f.ruta, f.versiones])).toEqual([['docs/dos.md', 1], ['uno.ts', 2]])
    expect((await s.archivos(PID, { texto: 'UNO' })).archivos.map((f) => f.ruta)).toEqual(['uno.ts'])
    expect((await s.archivos(PID, { origen: 'ia' })).archivos.map((f) => f.ruta)).toEqual(['uno.ts'])
    expect((await s.archivos(PID, { origen: 'externo' })).archivos.map((f) => f.ruta)).toEqual(['docs/dos.md'])
    expect((await s.archivos(PID, { autor: 'ANA' })).archivos).toHaveLength(2)
    expect((await s.archivos(PID, { autor: 'beto' })).archivos).toHaveLength(0)
    expect((await s.archivos(PID, { autor: 'portátil' })).archivos).toHaveLength(2) // también por equipo
    expect((await s.archivos(PID, { desde: new Date(Date.now() + 60_000).toISOString() })).archivos).toHaveLength(0)
    const uno = await s.archivos(PID, {}, 1)
    expect(uno).toMatchObject({ hayMas: true })
    expect(uno.archivos).toHaveLength(1)
  })

  it('versiones por archivo con filtro de origen', async () => {
    const { s } = await conHistoria()
    expect((await s.versiones(PID, 'uno.ts', { origen: 'ia' })).map((v) => v.origen)).toEqual(['ia'])
    expect(await s.versiones(PID, 'no/existe.ts')).toEqual([])
    expect(await s.versiones(PID, '../fuera')).toEqual([])
  })

  it('compara versiones entre sí, con la anterior y con el archivo actual (marcando agregadas, quitadas y modificadas)', async () => {
    const { s, esc } = await conHistoria()
    const [ia, usuario] = await s.versiones(PID, 'uno.ts')
    const cambio = await s.comparar(PID, 'uno.ts', 'anterior', ia!.id)
    expect(cambio).toMatchObject({ desde: { id: usuario!.id }, hasta: { id: ia!.id, origen: 'ia' } })
    expect(cambio.diff).toMatchObject({ agregadas: 1, quitadas: 0, modificadas: 0 })
    const primera = await s.comparar(PID, 'uno.ts', 'anterior', usuario!.id)
    expect(primera.desde).toBe('vacio')
    await esc('uno.ts', 'a\nCAMBIADA\nextra\n')
    const alActual = await s.comparar(PID, 'uno.ts', ia!.id, 'actual')
    expect(alActual.hasta).toBe('actual')
    expect(alActual.diff).toMatchObject({ modificadas: 1, agregadas: 1, quitadas: 0 })
    await expect(s.comparar(PID, 'uno.ts', 'inventada', 'actual')).rejects.toThrow(/ya no existe/)
  })

  it('leer devuelve el texto de una versión o del archivo actual, y avisa si es un borrado o no es texto', async () => {
    const { s, raiz, esc } = await conHistoria()
    const [ia, usuario] = await s.versiones(PID, 'uno.ts')
    expect(await s.leer(PID, 'uno.ts', usuario!.id)).toEqual({ texto: 'a\n' })
    expect(await s.leer(PID, 'uno.ts', 'actual')).toEqual({ texto: 'a\nb\n' })
    await rm(join(raiz, 'uno.ts'))
    const borrado = (await s.registrarRuta(PID, 'uno.ts', 'externo'))!
    expect(await s.leer(PID, 'uno.ts', borrado.id)).toEqual({ omitido: 'borrada' })
    expect((await s.comparar(PID, 'uno.ts', ia!.id, 'actual')).hasta).toBe('vacio')
    await esc('uno.ts', Buffer.from([0, 1, 2]))
    expect(await s.leer(PID, 'uno.ts', 'actual')).toEqual({ omitido: 'binario' })
    expect(await s.comparar(PID, 'uno.ts', ia!.id, 'actual')).toMatchObject({ omitido: 'binario' })
  })
})

describe('restaurar', () => {
  it('restaura una versión entera tal cual, guardando antes el estado actual como red de seguridad', async () => {
    const { s, raiz, esc } = await nuevo()
    await esc('a.txt', 'versión 1\n')
    const v1 = (await s.registrarRuta(PID, 'a.txt', 'usuario'))!
    await esc('a.txt', 'versión 2\n')
    await s.registrarRuta(PID, 'a.txt', 'ia')
    await esc('a.txt', 'cambio sin registrar\n') // otro programa, aún no visto
    const r = await s.restaurar(PID, 'a.txt', v1.id)
    expect(await readFile(join(raiz, 'a.txt'), 'utf8')).toBe('versión 1\n')
    expect(r).toMatchObject({ origen: 'restauracion', nota: expect.stringContaining('Restaurado desde la versión del') })
    const vs = await s.versiones(PID, 'a.txt')
    expect(vs.map((v) => v.origen)).toEqual(['restauracion', 'externo', 'ia', 'usuario'])
    expect(vs[1]).toMatchObject({ nota: 'Estado justo antes de restaurar' })
    // el cambio que no estaba registrado se puede recuperar
    expect(await s.leer(PID, 'a.txt', vs[1]!.id)).toEqual({ texto: 'cambio sin registrar\n' })
  })

  it('restaura un archivo borrado desde una versión anterior', async () => {
    const { s, raiz, esc } = await nuevo()
    await esc('src/a.ts', 'contenido\n')
    const v1 = (await s.registrarRuta(PID, 'src/a.ts', 'usuario'))!
    await rm(join(raiz, 'src'), { recursive: true })
    await s.registrarRuta(PID, 'src/a.ts', 'externo')
    await s.restaurar(PID, 'src/a.ts', v1.id)
    expect(await readFile(join(raiz, 'src/a.ts'), 'utf8')).toBe('contenido\n')
  })

  it('restaura solo los bloques elegidos y deja el resto como está', async () => {
    const { s, raiz, esc } = await nuevo()
    const base = Array.from({ length: 40 }, (_, i) => `l${i + 1}`)
    await esc('f.txt', base.join('\n'))
    const v1 = (await s.registrarRuta(PID, 'f.txt', 'usuario'))!
    const nuevoTexto = [...base]
    nuevoTexto[2] = 'CAMBIO A'
    nuevoTexto[30] = 'CAMBIO B'
    await esc('f.txt', nuevoTexto.join('\n'))
    await s.registrarRuta(PID, 'f.txt', 'ia')
    const d = await s.comparar(PID, 'f.txt', 'actual', v1.id)
    expect(d.diff.bloques).toHaveLength(2)
    const r = await s.restaurar(PID, 'f.txt', v1.id, [0])
    expect(r.nota).toContain('Restaurados 1 bloque')
    const lineas = (await readFile(join(raiz, 'f.txt'), 'utf8')).split('\n')
    expect(lineas[2]).toBe('l3') // restaurado
    expect(lineas[30]).toBe('CAMBIO B') // intacto
  })

  it('conserva los permisos del archivo', async () => {
    const { s, raiz, esc } = await nuevo()
    await esc('run.sh', '#!/bin/sh\necho 1\n')
    const v1 = (await s.registrarRuta(PID, 'run.sh', 'usuario'))!
    await esc('run.sh', '#!/bin/sh\necho 2\n')
    await chmod(join(raiz, 'run.sh'), 0o755)
    await s.registrarRuta(PID, 'run.sh', 'usuario')
    await s.restaurar(PID, 'run.sh', v1.id)
    expect((await stat(join(raiz, 'run.sh'))).mode & 0o777).toBe(0o755)
  })

  it('rechaza lo que no se puede restaurar, con mensajes claros', async () => {
    const { s, raiz, esc } = await nuevo()
    await esc('a.txt', 'uno\n')
    const v1 = (await s.registrarRuta(PID, 'a.txt', 'usuario'))!
    await rm(join(raiz, 'a.txt'))
    const borrado = (await s.registrarRuta(PID, 'a.txt', 'externo'))!
    await expect(s.restaurar(PID, 'a.txt', borrado.id)).rejects.toThrow(/momento en que se borró/)
    await expect(s.restaurar(PID, 'a.txt', 'inventada')).rejects.toThrow(/ya no existe/)
    await expect(s.restaurar(PID, '../fuera.txt', v1.id)).rejects.toThrow(/Ruta no válida/)
    await expect(s.restaurar(PID, 'a.txt', v1.id, [0])).rejects.toThrow(/tiene que existir/) // por bloques hace falta el archivo
    await esc('b.txt', 'igual\n')
    const b1 = (await s.registrarRuta(PID, 'b.txt', 'usuario'))!
    await expect(s.restaurar(PID, 'b.txt', b1.id)).rejects.toThrow(/ya es igual/)
    await expect(s.restaurar('otro', 'a.txt', v1.id)).rejects.toThrow(/no está en este equipo/)
    // un enlace simbólico que escapa del proyecto no se sigue
    const fuera = await carpeta('hs-fuera-')
    await symlink(fuera, join(raiz, 'enlace'))
    await esc('enlace/x.txt', 'x')
    await expect(s.restaurar(PID, 'enlace/x.txt', v1.id)).rejects.toThrow()
    expect(await stat(join(fuera, 'x.txt')).then(() => true, () => false)).toBe(true) // lo escrito por el test; nada más
  })
})

describe('ajustes, estado y mantenimiento', () => {
  it('el estado cuenta archivos, versiones y espacio; apagar no borra nada; olvidar sí', async () => {
    const { s, esc } = await nuevo()
    await esc('a.txt', 'a\n')
    await esc('b.txt', 'b\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    await s.registrarRuta(PID, 'b.txt', 'usuario')
    await esc('a.txt', 'a2\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    const e = await s.estado(PID)
    expect(e).toMatchObject({ activo: true, archivos: 2, versiones: 3, diasCompletos: 30, limiteBytes: 500 * 1024 * 1024 })
    expect(e.bytes).toBeGreaterThan(0)
    expect(await s.ajustar(PID, false)).toMatchObject({ activo: false, vigilancia: 'apagada', versiones: 3 })
    expect((await s.estado(PID)).versiones).toBe(3)
    expect(await s.olvidar(PID, 'a.txt')).toMatchObject({ archivos: 1, versiones: 1 })
    expect(await s.olvidar(PID)).toMatchObject({ archivos: 0, versiones: 0 })
  })

  it('los ajustes se recuerdan al volver a abrir la app', async () => {
    const { s, raiz } = await nuevo()
    await s.ajustar(PID, false)
    const dir = (s as unknown as { d: DepsHistorial }).d.dir
    const otro = new ServicioHistorial({ dir, identidad: async () => ANA, cadaLimpiezaMs: 0 })
    abiertos.push(otro)
    await otro.sincronizarProyectos([{ id: PID, ruta: raiz }])
    expect((await otro.estado(PID)).activo).toBe(false)
  })

  it('el resumen para otros equipos solo lleva nombres, número de versiones y fecha', async () => {
    const { s, esc } = await nuevo()
    await esc('a.txt', 'secreto-del-contenido\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    await esc('a.txt', 'otro\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    const r = await s.resumen(PID)
    expect(r).toMatchObject({ total: 2, archivos: [{ ruta: 'a.txt', versiones: 2 }] })
    expect(JSON.stringify(r)).not.toContain('secreto')
    await s.ajustar(PID, false)
    expect(await s.resumen(PID)).toEqual({ total: 0, archivos: [] })
  })

  it('recortar no falla y respeta lo reciente', async () => {
    const { s, esc } = await nuevo()
    await esc('a.txt', 'a\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    await s.recortar()
    expect((await s.estado(PID)).versiones).toBe(1)
  })
})

describe('por la interfaz', () => {
  it('valida las entradas y rechaza operaciones desconocidas', async () => {
    const { s, esc } = await nuevo()
    await esc('a.txt', 'a\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario')
    await expect(ejecutarOperacionHistorial(s, 'estado', {})).rejects.toThrow(/Falta el proyecto/)
    await expect(ejecutarOperacionHistorial(s, 'versiones', { proyectoId: PID })).rejects.toThrow(/Falta el archivo/)
    await expect(ejecutarOperacionHistorial(s, 'inventada', {})).rejects.toThrow(/desconocida/)
    expect(await ejecutarOperacionHistorial(s, 'archivos', { proyectoId: PID, filtro: { origen: 'invalido', desde: 'ayer' } })).toMatchObject({ archivos: [{ ruta: 'a.txt' }] })
    const v = (await ejecutarOperacionHistorial(s, 'versiones', { proyectoId: PID, ruta: 'a.txt' })) as { id: string }[]
    await expect(ejecutarOperacionHistorial(s, 'restaurar', { proyectoId: PID, ruta: 'a.txt', version: v[0]!.id, bloques: ['x', -1, 1.5] })).rejects.toThrow(/ya es igual/)
  })
})

describe('vigilante de archivos (cambios hechos fuera de la app)', () => {
  it('detecta archivos nuevos, cambios y borrados de otros programas, y marca su origen como «externo»', async () => {
    const { s, raiz, esc } = await nuevo({ vigilar: true })
    await esc('src/a.ts', 'uno\n')
    await esperar(async () => (await s.versiones(PID, 'src/a.ts')).length === 1)
    expect((await s.versiones(PID, 'src/a.ts'))[0]).toMatchObject({ origen: 'externo', mas: 1 })
    await esc('src/a.ts', 'uno\ndos\n')
    await esperar(async () => (await s.versiones(PID, 'src/a.ts')).length === 2)
    await rm(join(raiz, 'src/a.ts'))
    await esperar(async () => (await s.versiones(PID, 'src/a.ts')).length === 3)
    expect((await s.versiones(PID, 'src/a.ts'))[0]).toMatchObject({ eliminada: true })
    expect((await s.estado(PID)).vigilancia).toBe('completa')
    expect((await s.estado(PID)).carpetasVigiladas).toBeGreaterThanOrEqual(2)
  }, 15000)

  it('ve las carpetas nuevas (y los archivos que ya traen) y no mira node_modules, ocultas ni lo ignorado por git', async () => {
    const { s, raiz, esc } = await nuevo({ vigilar: true }, true)
    await esc('.gitignore', 'generado/\n')
    await mkdir(join(raiz, 'generado'))
    await mkdir(join(raiz, 'node_modules'))
    await mkdir(join(raiz, '.cache'))
    await new Promise((r) => setTimeout(r, 150))
    await s.sincronizarProyectos([]) // reinicia: ahora arranca con esas carpetas ya presentes
    await s.sincronizarProyectos([{ id: PID, ruta: raiz }])
    await esperar(async () => (await s.estado(PID)).vigilancia === 'completa')
    await esc('generado/a.js', 'x')
    await esc('node_modules/m/i.js', 'x')
    await esc('.cache/c.json', 'x')
    await mkdir(join(raiz, 'nueva/sub'), { recursive: true })
    await esc('nueva/sub/dentro.ts', 'ya estaba') // creada junto con la carpeta
    await esperar(async () => (await s.versiones(PID, 'nueva/sub/dentro.ts')).length === 1)
    await new Promise((r) => setTimeout(r, 300))
    expect((await s.archivos(PID)).archivos.map((f) => f.ruta).sort()).toEqual(['.gitignore', 'nueva/sub/dentro.ts'].sort())
  }, 15000)

  it('un cambio masivo (cambio de rama, pull) se marca como de git', async () => {
    const { s, raiz, esc } = await nuevo({ masivoArchivos: 10, vigilar: true })
    for (let i = 0; i < 12; i++) await esc(`lote/f${i}.txt`, `inicial ${i}\n`)
    await esperar(async () => (await s.archivos(PID)).archivos.length === 12)
    for (let i = 0; i < 12; i++) await writeFile(join(raiz, `lote/f${i}.txt`), `cambiado por git ${i}\n`)
    await esperar(async () => (await s.versiones(PID, 'lote/f11.txt')).length === 2)
    const origenes = await Promise.all(Array.from({ length: 12 }, async (_, i) => (await s.versiones(PID, `lote/f${i}.txt`))[0]!.origen))
    expect(origenes.filter((o) => o === 'git').length).toBeGreaterThanOrEqual(3) // los que llegaron tras pasar el umbral
  }, 15000)

  it('cuando git cambia de rama (cambia HEAD), lo que se modifique a continuación es de git', async () => {
    const { s, raiz, esc } = await nuevo({ vigilar: true }, true)
    await esc('a.txt', 'en main\n')
    sh(raiz, 'add', '-A')
    sh(raiz, 'commit', '-q', '-m', 'c1')
    sh(raiz, 'checkout', '-q', '-b', 'otra')
    await esc('a.txt', 'en otra\n')
    sh(raiz, 'commit', '-q', '-am', 'c2')
    await esc('a.txt', 'trabajo en curso\n')
    await s.registrarRuta(PID, 'a.txt', 'usuario') // ya hay historial del archivo
    await esperar(async () => (await s.estado(PID)).vigilancia === 'completa')
    sh(raiz, 'stash', '-q') // deja el árbol limpio para poder cambiar de rama
    await esperar(async () => (await s.versiones(PID, 'a.txt')).length >= 3) // el stash revirtió el archivo
    sh(raiz, 'checkout', '-q', 'main')
    const ultimaVersion = async () => (await s.versiones(PID, 'a.txt'))[0]!
    await esperar(async () => {
      const u = await ultimaVersion()
      return !u.eliminada && (await s.leer(PID, 'a.txt', u.id).catch(() => ({}))) !== undefined && JSON.stringify(await s.leer(PID, 'a.txt', u.id)) === JSON.stringify({ texto: 'en main\n' })
    })
    const ultima = await ultimaVersion()
    expect(ultima).toMatchObject({ origen: 'git', nota: 'Cambio de git (rama, pull o fusión)' })
    expect(await s.leer(PID, 'a.txt', ultima.id)).toEqual({ texto: 'en main\n' })
  }, 20000)

  it('si no puede vigilar todo el proyecto (demasiadas carpetas) lo dice y vigila las más cercanas', async () => {
    const { s, raiz } = await nuevo({ maxCarpetas: 3, vigilar: true })
    for (const d of ['a/x', 'b/y', 'c/z', 'd/w']) await mkdir(join(raiz, d), { recursive: true })
    await s.sincronizarProyectos([])
    await s.sincronizarProyectos([{ id: PID, ruta: raiz }])
    await esperar(async () => (await s.estado(PID)).vigilancia !== 'apagada')
    expect(await s.estado(PID)).toMatchObject({ vigilancia: 'limitada', carpetasVigiladas: 3 })
  }, 15000)
})
