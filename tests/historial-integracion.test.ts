import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { GestorArchivos } from '../src/main/archivos'
import { comandoGancho, configGanchosHistorial } from '../src/main/agentes'
import { Nucleo } from '../src/main/core'
import { iniciarServidorTareas, type ServidorTareas } from '../src/main/core/tareas/servidor'
import { ejecutarHookHistorial, peticionDeHook, rutaDeEntradaHook, type PeticionHookHistorial } from '../src/main/historial/hook'
import { ServicioHistorial } from '../src/main/historial/servicio'

const carpeta = (p = 'hi-'): Promise<string> => mkdtemp(join(tmpdir(), p))
const PID = 'proyecto-1'

beforeAll(async () => {
  const casa = await carpeta('hi-casa-')
  vi.stubEnv('HOME', casa)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(casa, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})

describe('gancho de Claude Code (terminales ✦)', () => {
  it('entiende lo que Claude Code manda: Write, Edit, MultiEdit y NotebookEdit; ignora lo demás', () => {
    const entrada = (tool: string, input: object) => JSON.stringify({ session_id: 's-1', tool_name: tool, tool_input: input, hook_event_name: 'PreToolUse' })
    expect(peticionDeHook('antes', entrada('Write', { file_path: '/p/a.ts', content: 'x' }))).toEqual({ momento: 'antes', ruta: '/p/a.ts', herramienta: 'Write', sesion: 's-1' })
    expect(peticionDeHook('despues', entrada('Edit', { file_path: 'src/b.ts', old_string: 'a', new_string: 'b' }))).toMatchObject({ momento: 'despues', ruta: 'src/b.ts', herramienta: 'Edit' })
    expect(peticionDeHook('antes', entrada('MultiEdit', { file_path: 'c.ts', edits: [] }))?.ruta).toBe('c.ts')
    expect(peticionDeHook('antes', entrada('NotebookEdit', { notebook_path: 'n.ipynb' }))?.ruta).toBe('n.ipynb')
    expect(peticionDeHook('antes', entrada('Bash', { command: 'ls' }))).toBeUndefined()
    expect(peticionDeHook('antes', 'no es json')).toBeUndefined()
    expect(peticionDeHook('antes', JSON.stringify({ tool_input: { file_path: 'a' } }))).toBeUndefined() // sin nombre de herramienta
    expect(rutaDeEntradaHook(undefined)).toBeUndefined()
  })

  describe('por el socket de la app', () => {
    let servidor: ServidorTareas | undefined
    afterEach(async () => {
      await servidor?.cerrar()
      servidor = undefined
    })

    it('el gancho llega a la app con el proyecto, el archivo, la herramienta y la sesión; las herramientas normales siguen su camino', async () => {
      const dir = await carpeta('hg-')
      const recibidas: { p: PeticionHookHistorial; proyectoId: string }[] = []
      const ejecutar = vi.fn(async () => ({ texto: 'herramienta normal' }))
      servidor = await iniciarServidorTareas(dir, ejecutar, async (p, proyectoId) => void recibidas.push({ p, proyectoId }))
      const json = JSON.stringify({ session_id: 'sesion-9', tool_name: 'Write', tool_input: { file_path: '/p/src/a.ts' } })
      await ejecutarHookHistorial('antes', Readable.from([json]), dir, PID)
      await ejecutarHookHistorial('despues', Readable.from([json.slice(0, 20), json.slice(20)]), dir, PID) // llega en trozos
      expect(recibidas).toEqual([
        { proyectoId: PID, p: { momento: 'antes', ruta: '/p/src/a.ts', herramienta: 'Write', sesion: 'sesion-9' } },
        { proyectoId: PID, p: { momento: 'despues', ruta: '/p/src/a.ts', herramienta: 'Write', sesion: 'sesion-9' } }
      ])
      expect(ejecutar).not.toHaveBeenCalled() // el gancho no es una herramienta de la IA
      // lo que no es una escritura, o no trae proyecto, no llega
      await ejecutarHookHistorial('antes', Readable.from([JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })]), dir, PID)
      await ejecutarHookHistorial('antes', Readable.from([json]), dir, undefined)
      expect(recibidas).toHaveLength(2)
    })

    it('si la app no está abierta, el gancho no falla ni bloquea a Claude', async () => {
      const dir = await carpeta('hg-')
      const json = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.ts' } })
      await expect(ejecutarHookHistorial('antes', Readable.from([json]), dir, PID)).resolves.toBeUndefined()
    })
  })

  it('el plugin lleva los ganchos para las herramientas de escribir, antes y después', () => {
    const mcp = { mcpServers: { odesk: { command: '/usr/bin/electron', args: ['/app/out/main/mcp-tareas.js'], env: { ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: "/home/ana/.odesk-agent", ODESK_PROYECTO_ID: PID } } } }
    const config = JSON.parse(configGanchosHistorial(mcp)!) as { hooks: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]> }
    expect(Object.keys(config.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse'])
    for (const [evento, momento] of [['PreToolUse', 'pre'], ['PostToolUse', 'post']] as const) {
      const g = config.hooks[evento]![0]!
      expect(g.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit')
      expect(g.hooks[0]).toMatchObject({ type: 'command', command: comandoGancho(mcp, momento) })
      expect(g.hooks[0]!.command).toContain(`hook-historial`)
      expect(g.hooks[0]!.command).toContain(PID)
    }
  })

  it('en Windows el gancho cita las variables y no se genera si una ruta lleva caracteres de cmd (& % ^ …)', () => {
    const mcp = (cmd: string) => ({ mcpServers: { odesk: { command: cmd, args: ['C:\\app\\mcp.js'], env: { ODESK_DIR: 'C:\\Users\\Ana Perez\\.odesk', ODESK_PROYECTO_ID: PID } } } })
    expect(comandoGancho(mcp('C:\\Program Files\\electron.exe'), 'pre', 'win32')).toBe(
      `cmd /c "set "ODESK_DIR=C:\\Users\\Ana Perez\\.odesk"&& set "ODESK_PROYECTO_ID=${PID}"&& "C:\\Program Files\\electron.exe" "C:\\app\\mcp.js" "hook-historial" "pre""`
    )
    for (const malo of ['C:\\a&b\\e.exe', 'C:\\100%\\e.exe', 'C:\\a^b\\e.exe']) expect(comandoGancho(mcp(malo), 'pre', 'win32')).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('el comando del gancho se ejecuta de verdad en un shell (comillas, variables de entorno y argumentos correctos), incluso con espacios y comillas en las rutas', async () => {
    const dir = await carpeta('hg-con espacios y \'comilla\' ')
    const salida = join(dir, 'salida.json')
    const script = join(dir, 'sonda.js')
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(salida)}, JSON.stringify({ args: process.argv.slice(2), env: { a: process.env.ELECTRON_RUN_AS_NODE, d: process.env.ODESK_DIR, p: process.env.ODESK_PROYECTO_ID } }))`)
    const mcp = { mcpServers: { odesk: { command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: dir, ODESK_PROYECTO_ID: PID } } } }
    const comando = comandoGancho(mcp, 'pre')!
    execFileSync('sh', ['-c', comando], { input: '{}' })
    expect(JSON.parse(await readFile(salida, 'utf8'))).toEqual({ args: ['hook-historial', 'pre'], env: { a: '1', d: dir, p: PID } })
  })
})

describe('el editor y la IA alimentan el historial', () => {
  async function entorno() {
    const raiz = await carpeta('hi-proy-')
    const historial = new ServicioHistorial({ dir: await carpeta('hi-dir-'), identidad: async () => ({ usuario: 'ana', equipo: 'Portátil' }), cadaLimpiezaMs: 0, vigilar: false })
    await historial.sincronizarProyectos([{ id: PID, ruta: raiz }])
    const gestor = new GestorArchivos({
      raiz: async () => raiz,
      papelera: async (ruta) => rm(ruta, { recursive: true }),
      historial: { antes: (id, ruta) => historial.antesDeEscribir(id, ruta), despues: (id, ruta) => historial.despuesDeEscribir(id, ruta, 'usuario') }
    })
    return { raiz, historial, gestor }
  }

  it('cada guardado del editor queda como versión «a mano»; si el archivo cambió fuera, también se guarda lo que había', async () => {
    const { raiz, historial, gestor } = await entorno()
    await gestor.guardar(PID, 'src/a.ts', 'uno\n')
    await gestor.guardar(PID, 'src/a.ts', 'uno\ndos\n')
    await writeFile(join(raiz, 'src/a.ts'), 'cambio de otro programa\n')
    await gestor.guardar(PID, 'src/a.ts', 'mi versión\n')
    const vs = await historial.versiones(PID, 'src/a.ts')
    expect(vs.map((v) => v.origen)).toEqual(['usuario', 'externo', 'usuario', 'usuario'])
    expect(vs[0]!.autor).toMatchObject({ usuario: 'ana', equipo: 'Portátil' })
    expect(await historial.leer(PID, 'src/a.ts', vs[1]!.id)).toEqual({ texto: 'cambio de otro programa\n' })
  })

  it('crear, renombrar y borrar desde el editor quedan registrados', async () => {
    const { historial, gestor } = await entorno()
    await gestor.guardar(PID, 'a.txt', 'contenido\n')
    await gestor.renombrar(PID, 'a.txt', 'b.txt')
    expect((await historial.versiones(PID, 'a.txt'))[0]).toMatchObject({ eliminada: true, origen: 'usuario' })
    expect((await historial.versiones(PID, 'b.txt'))[0]).toMatchObject({ eliminada: false, origen: 'usuario' })
    await gestor.borrar(PID, 'b.txt')
    expect((await historial.versiones(PID, 'b.txt'))[0]).toMatchObject({ eliminada: true })
    await gestor.crear(PID, 'vacio.txt', 'archivo')
    expect(await historial.versiones(PID, 'vacio.txt')).toHaveLength(1)
  })

  it('si el historial falla, el editor guarda igual', async () => {
    const raiz = await carpeta('hi-proy-')
    const gestor = new GestorArchivos({
      raiz: async () => raiz,
      papelera: async () => undefined,
      historial: { antes: async () => { throw new Error('boom') }, despues: async () => { throw new Error('boom') } }
    })
    expect(await gestor.guardar(PID, 'a.txt', 'ok\n')).toMatchObject({ ok: true })
    expect(await readFile(join(raiz, 'a.txt'), 'utf8')).toBe('ok\n')
  })

  it('las escrituras de la IA avisan antes y después (herramientas propias y de Claude Code) y nada más', () => {
    const avisos: unknown[][] = []
    const nucleo = { alEscribirIA: (...a: unknown[]) => void avisos.push(a), sync: { evento: vi.fn() } }
    const ev = (tipo: 'herramienta_inicio' | 'herramienta_fin', nombre: string, entrada: Record<string, unknown>, error = false): EventoAgente =>
      ({ ejecucionId: 'ej-1', agente: 'a', profundidad: 0, tipo, llamada: { id: 'l1', nombre, entrada }, ...(tipo === 'herramienta_fin' ? { resultado: { texto: '', ...(error ? { error: true } : {}) } } : {}) }) as unknown as EventoAgente
    const registrar = (e: EventoAgente): void => Nucleo.prototype.registrarArchivoTocado.call(nucleo as unknown as Nucleo, PID, e)
    registrar(ev('herramienta_inicio', 'Write', { file_path: '/p/a.ts' }))
    registrar(ev('herramienta_fin', 'Write', { file_path: '/p/a.ts' }))
    registrar(ev('herramienta_inicio', 'escribir_archivo', { ruta: 'src/b.ts' }))
    registrar(ev('herramienta_fin', 'escribir_archivo', { ruta: 'src/b.ts' }, true)) // falló: no hay nada nuevo que registrar
    registrar(ev('herramienta_inicio', 'Read', { file_path: '/p/a.ts' })) // no escribe
    registrar(ev('herramienta_inicio', 'Edit', {})) // sin ruta
    expect(avisos).toEqual([
      ['antes', PID, '/p/a.ts', { herramienta: 'Write', ejecucionId: 'ej-1' }],
      ['despues', PID, '/p/a.ts', { herramienta: 'Write', ejecucionId: 'ej-1' }],
      ['antes', PID, 'src/b.ts', { herramienta: 'escribir_archivo', ejecucionId: 'ej-1' }]
    ])
  })

  it('de punta a punta: la IA escribe, la versión queda como «IA» y se puede restaurar lo anterior', async () => {
    const { raiz, historial } = await entorno()
    await mkdir(join(raiz, 'src'), { recursive: true })
    await writeFile(join(raiz, 'src/a.ts'), 'original\n')
    await historial.registrarRuta(PID, 'src/a.ts', 'usuario')
    await historial.antesDeEscribir(PID, 'src/a.ts')
    await writeFile(join(raiz, 'src/a.ts'), 'reescrito por la IA\n')
    await historial.despuesDeEscribir(PID, 'src/a.ts', 'ia', { herramienta: 'Write', ejecucionId: 'ej-7' })
    const [ia, usuario] = await historial.versiones(PID, 'src/a.ts')
    expect(ia).toMatchObject({ origen: 'ia', herramienta: 'Write', ejecucionId: 'ej-7' })
    await historial.restaurar(PID, 'src/a.ts', usuario!.id)
    expect(await readFile(join(raiz, 'src/a.ts'), 'utf8')).toBe('original\n')
  })
})
