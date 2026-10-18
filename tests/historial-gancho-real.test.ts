import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { comandoGancho } from '../src/main/agentes'
import { iniciarServidorTareas, type ServidorTareas } from '../src/main/core/tareas/servidor'
import { ServicioHistorial } from '../src/main/historial/servicio'

/** El script real que se compila (`out/main/mcp-tareas.js`): estas pruebas se saltan si aún no se hizo `pnpm build`. */
/** Ejecuta un comando de shell con una entrada; asíncrono a propósito (el servidor de la app corre en este mismo proceso y no puede quedar bloqueado). */
function correr(comando: string, entrada: string, esperaMs = 20_000): Promise<{ salida: string; codigo: number | null }> {
  return new Promise((ok, no) => {
    const h = spawn('sh', ['-c', comando], { stdio: ['pipe', 'pipe', 'pipe'] })
    let salida = ''
    h.stdout.on('data', (d: Buffer) => (salida += d.toString()))
    h.stderr.on('data', (d: Buffer) => (salida += d.toString()))
    const t = setTimeout(() => (h.kill(), no(new Error('el gancho no terminó'))), esperaMs)
    h.on('close', (codigo) => (clearTimeout(t), ok({ salida, codigo })))
    h.stdin.end(entrada)
  })
}

const SCRIPT = resolve(__dirname, '..', 'out', 'main', 'mcp-tareas.js')
const hayScript = existsSync(SCRIPT)
const PID = 'proyecto-1'

let servidor: ServidorTareas | undefined
afterEach(async () => {
  await servidor?.cerrar()
  servidor = undefined
})

describe.skipIf(!hayScript || process.platform === 'win32')('gancho de Claude Code con el programa real compilado', () => {
  it('cadena completa: el comando del plugin → el programa del gancho → el socket de la app → el historial (antes y después, origen IA)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gr-'))
    const raiz = await mkdtemp(join(tmpdir(), 'gr-proy-'))
    const historial = new ServicioHistorial({ dir: join(dir, 'historial'), identidad: async () => ({ usuario: 'ana', equipo: 'Portátil' }), cadaLimpiezaMs: 0, vigilar: false })
    await historial.sincronizarProyectos([{ id: PID, ruta: raiz }])
    servidor = await iniciarServidorTareas(
      dir,
      async () => ({ texto: 'no se usa' }),
      async (p, proyectoId) => {
        await (p.momento === 'antes' ? historial.antesDeEscribir(proyectoId, p.ruta) : historial.despuesDeEscribir(proyectoId, p.ruta, 'ia', { herramienta: p.herramienta, ...(p.sesion ? { ejecucionId: p.sesion } : {}) }))
      }
    )

    const mcp = { mcpServers: { odesk: { command: process.execPath, args: [SCRIPT], env: { ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: dir, ODESK_PROYECTO_ID: PID } } } }
    const ejecutar = async (momento: 'pre' | 'post', herramienta: string, input: object): Promise<void> => {
      const r = await correr(comandoGancho(mcp, momento)!, JSON.stringify({ session_id: 'sesion-real', tool_name: herramienta, tool_input: input }))
      expect(r).toEqual({ salida: '', codigo: 0 }) // termina bien y sin ruido
    }

    await mkdir(join(raiz, 'src'), { recursive: true })
    await writeFile(join(raiz, 'src/a.ts'), 'lo que había\n')
    await historial.registrarRuta(PID, 'src/a.ts', 'usuario')
    // Alguien cambia el archivo por fuera; Claude Code va a escribir: el gancho «pre» guarda lo que había
    await writeFile(join(raiz, 'src/a.ts'), 'editado por otro programa\n')
    await ejecutar('pre', 'Write', { file_path: join(raiz, 'src/a.ts'), content: 'x' })
    await writeFile(join(raiz, 'src/a.ts'), 'escrito por Claude\n')
    await ejecutar('post', 'Write', { file_path: join(raiz, 'src/a.ts'), content: 'x' })

    const vs = await historial.versiones(PID, 'src/a.ts')
    expect(vs.map((v) => v.origen)).toEqual(['ia', 'externo', 'usuario'])
    expect(vs[0]).toMatchObject({ herramienta: 'Write', ejecucionId: 'sesion-real', autor: { usuario: 'ana' } })
    expect(await historial.leer(PID, 'src/a.ts', vs[1]!.id)).toEqual({ texto: 'editado por otro programa\n' })

    // un archivo nuevo, y una herramienta que no escribe (no deja rastro)
    await writeFile(join(raiz, 'nuevo.md'), '# hola\n')
    await ejecutar('post', 'Edit', { file_path: 'nuevo.md' })
    await ejecutar('post', 'Bash', { command: 'ls' })
    expect((await historial.versiones(PID, 'nuevo.md'))[0]).toMatchObject({ origen: 'ia', herramienta: 'Edit' })
    expect((await historial.archivos(PID)).archivos.map((f) => f.ruta).sort()).toEqual(['nuevo.md', 'src/a.ts'])
  }, 60_000)

  it('con la app cerrada el gancho termina bien y sin ruido (no bloquea a Claude)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gr-'))
    const mcp = { mcpServers: { odesk: { command: process.execPath, args: [SCRIPT], env: { ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: dir, ODESK_PROYECTO_ID: PID } } } }
    const t = Date.now()
    const r = await correr(comandoGancho(mcp, 'post')!, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.ts' } }))
    expect(r).toEqual({ salida: '', codigo: 0 })
    expect(Date.now() - t).toBeLessThan(10_000)
  })
})
