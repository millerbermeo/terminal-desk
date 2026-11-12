import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AccionIa } from '@shared/control-app'
import { confirmacionApp, HERRAMIENTAS_APP } from '@shared/app-herramientas'
import { HERRAMIENTAS_ODESK } from '@shared/herramientas-odesk'
import { ControlApp, textoTerminal, type DependenciasApp } from '../src/main/control-app'
import { crearEjecutorOdesk, type ServiciosOdesk } from '../src/main/core/herramientas-odesk'
import { clientesMcp, estadoMcpExterno, instalarMcpExterno } from '../src/main/mcp-externo'

function falso(extra: Partial<DependenciasApp> = {}) {
  const acciones: AccionIa[] = []
  const escrito: string[] = []
  const cerradas: string[] = []
  let enShell = true
  const d: DependenciasApp = {
    proyectos: async () => ({ grupos: [{ id: 'g1', nombre: 'Web' }], proyectos: [{ id: 'p1', nombre: 'Tienda', ruta: '/src/tienda', grupo: 'g1' }] }),
    pendientes: async () => [{ id: 'p2', nombre: 'Api', repo: 'yo/api' }],
    quitarProyecto: async () => undefined,
    clonar: async () => ({ ruta: '/dev/api' }),
    terminales: {
      vivas: () => ['pty1'],
      meta: () => ({ proyectoId: 'p1', titulo: 'Tienda', creada: 0 }),
      historial: () => '\u001b[32m$ npm test\u001b[0m\r\nprogreso 10%\rprogreso 100%\r\nok\r\n',
      enShell: () => enShell,
      escribir: (_id, x) => void escrito.push(x),
      cerrar: (id) => void cerradas.push(id),
      crear: async () => 'pty-nueva'
    },
    arranque: {
      listar: async () => [{ id: 'web', nombre: 'Vite', comando: 'pnpm dev', puerto: 5173, orden: 0, esperar: 'puerto', esperaMs: 1000 } as never],
      estados: async () => [{ proyectoId: 'p1', comandoId: 'web', estado: 'listo', ptyId: 'pty1', desde: 0 }],
      revisar: async () => [],
      arrancar: async () => ({ ok: true, comandos: 1 }),
      detener: async () => []
    },
    sesiones: { listar: async () => [], transcripcion: async () => undefined },
    ajustes: { leer: async () => ({}), fijar: async (_c, x) => x },
    cuentas: { estado: async () => ({}), activar: async () => undefined },
    consumo: async () => ({}),
    historial: async () => ({}),
    interfaz: (a) => void acciones.push(a),
    esperar: async () => undefined,
    ...extra
  }
  return { d, acciones, escrito, cerradas, fijarShell: (v: boolean) => (enShell = v) }
}

describe('herramientas de la app por MCP', () => {
  it('están en el servidor «odesk» con nombres únicos', () => {
    const nombres = HERRAMIENTAS_ODESK.map((h) => h.nombre)
    expect(new Set(nombres).size).toBe(nombres.length)
    for (const h of HERRAMIENTAS_APP) expect(nombres).toContain(h.nombre)
  })

  it('el texto de la terminal sale sin colores y con los \\r resueltos', () => {
    expect(textoTerminal('\u001b[32m$ npm test\u001b[0m\r\nprogreso 10%\rprogreso 100%\r\nok\r\n', 10)).toBe('$ npm test\nprogreso 100%\nok')
  })

  it('terminal_escribir manda el texto con Enter y bloquea lo catastrófico en el shell', async () => {
    const f = falso()
    const c = new ControlApp(f.d)
    expect((await c.ejecutar('terminal_escribir', { terminal: 'pty1', texto: 'npm test' }, {})).error).toBeUndefined()
    expect(f.escrito).toEqual(['npm test\r'])
    const r = await c.ejecutar('terminal_escribir', { terminal: 'pty1', texto: 'sudo rm -rf /' }, {})
    expect(r.error).toBe(true)
    expect(f.escrito).toHaveLength(1)
    expect((await c.ejecutar('terminal_escribir', { terminal: 'pty1', tecla: 'ctrl+c' }, {})).texto).toMatch(/ctrl\+c/)
    expect(f.escrito[1]).toBe('\u0003')
    expect((await c.ejecutar('terminal_escribir', { terminal: 'otra', texto: 'ls' }, {})).error).toBe(true)
  })

  it('terminal_esperar vuelve cuando el comando termina, cuando aparece el texto o al agotarse el tiempo', async () => {
    let salida = '$ pnpm test\r\n'
    let vueltas = 0
    const f = falso({
      esperar: async () => {
        vueltas++
        if (vueltas === 3) salida += 'corriendo…\r\n'
        if (vueltas === 5) {
          salida += 'Tests 4 passed\r\n$ '
          f.fijarShell(true)
        }
      }
    })
    f.d.terminales.historial = () => salida
    f.fijarShell(false)
    const c = new ControlApp(f.d)
    const fin = await c.ejecutar('terminal_esperar', { terminal: 'pty1' }, {})
    expect(fin.texto).toMatch(/terminó/)
    expect(fin.texto).toContain('Tests 4 passed')
    expect(vueltas).toBe(7) // en el shell y sin salida nueva dos sondeos seguidos

    // Un servidor no termina: se espera a un texto de la salida NUEVA (lo que ya estaba no cuenta).
    f.fijarShell(false)
    salida = 'ready de antes\r\n'
    vueltas = 0
    f.d.esperar = async () => {
      vueltas++
      if (vueltas === 2) salida += 'Local: http://localhost:5173 READY\r\n'
    }
    const listo = await c.ejecutar('terminal_esperar', { terminal: 'pty1', texto: 'ready' }, {})
    expect(listo.texto).toMatch(/apareció «ready»/)
    expect(vueltas).toBe(2)

    vueltas = 0
    f.d.esperar = async () => void vueltas++
    const agotado = await c.ejecutar('terminal_esperar', { terminal: 'pty1', max_s: 1 }, {})
    expect(agotado.texto).toMatch(/tiempo agotado/)
    expect(agotado.error).toBeUndefined()
    expect(vueltas).toBe(4)
    expect((await c.ejecutar('terminal_esperar', { terminal: 'otra' }, {})).error).toBe(true)
    expect(confirmacionApp('terminal_esperar', {})).toBeUndefined()
  })

  it('terminal_abrir crea el pty y lo muestra en la celda del proyecto de la conversación', async () => {
    const f = falso()
    const r = await new ControlApp(f.d).ejecutar('terminal_abrir', { claude: true }, { proyectoId: 'p1' })
    expect(r.texto).toContain('pty-nueva')
    expect(f.acciones).toEqual([{ tipo: 'terminal', proyectoId: 'p1', ptyId: 'pty-nueva', titulo: 'Tienda · Claude · IA' }])
  })

  it('servicio_logs lee la terminal del comando y asistente_enviar avisa a la interfaz', async () => {
    const f = falso()
    const c = new ControlApp(f.d)
    expect((await c.ejecutar('servicio_logs', { id: 'web' }, { proyectoId: 'p1' })).texto).toContain('progreso 100%')
    await c.ejecutar('asistente_enviar', { mensaje: 'arregla el test' }, { proyectoId: 'p1' })
    expect(f.acciones.at(-1)).toEqual({ tipo: 'asistente-enviar', proyectoId: 'p1', mensaje: 'arregla el test' })
  })

  it('servicios_arrancar no toca puertos ocupados: devuelve el conflicto', async () => {
    const arrancar = vi.fn()
    const f = falso()
    f.d.arranque = { ...f.d.arranque, revisar: async () => [{ comandoId: 'web', puerto: 5173 } as never], arrancar }
    const r = await new ControlApp(f.d).ejecutar('servicios_arrancar', {}, { proyectoId: 'p1' })
    expect(r.texto).toContain('conflictos')
    expect(arrancar).not.toHaveBeenCalled()
  })

  it('sin proyecto en la conversación ni proyecto_id, lo pide', async () => {
    const r = await new ControlApp(falso().d).ejecutar('servicios_listar', {}, {})
    expect(r.error).toBe(true)
    expect(r.texto).toMatch(/proyecto_id/)
  })
})

describe('confirmación en Odesk', () => {
  const ejecutor = (confirmar?: ServiciosOdesk['confirmar']) => {
    const f = falso()
    const control = new ControlApp(f.d)
    return { f, ej: crearEjecutorOdesk({ tareas: {} as never, github: {} as never, carpetaDe: async () => '/', app: () => control, ...(confirmar ? { confirmar } : {}) }) }
  }

  it('lo destructivo se pregunta; rechazado no se hace', async () => {
    const preguntar = vi.fn(async () => false)
    const { f, ej } = ejecutor(preguntar)
    const r = await ej('terminal_cerrar', { terminal: 'pty1' }, { cliente: 'Claude Desktop' })
    expect(preguntar).toHaveBeenCalledWith(expect.stringContaining('pty1'), 'Claude Desktop')
    expect(r.error).toBe(true)
    expect(f.cerradas).toEqual([])
  })

  it('aprobado se hace; sin forma de preguntar se deniega', async () => {
    const { f, ej } = ejecutor(async () => true)
    expect((await ej('terminal_cerrar', { terminal: 'pty1' })).error).toBeUndefined()
    expect(f.cerradas).toEqual(['pty1'])
    const sinPregunta = ejecutor()
    expect((await sinPregunta.ej('terminal_cerrar', { terminal: 'pty1' })).error).toBe(true)
  })

  it('leer no pregunta; subir a «autonomo» sí', async () => {
    expect(confirmacionApp('terminal_leer', {})).toBeUndefined()
    expect(confirmacionApp('ajustes_fijar', { modelo: 'opus' })).toBeUndefined()
    expect(confirmacionApp('ajustes_fijar', { autonomia: 'autonomo' })).toMatch(/Autónomo/)
  })

  it('sin la app abierta responde con un error legible', async () => {
    const ej = crearEjecutorOdesk({ tareas: {} as never, github: {} as never, carpetaDe: async () => '/' })
    expect((await ej('odesk_proyectos', {})).texto).toMatch(/Odesk Agent abierto/)
  })
})

describe('MCP «odesk» en clientes externos', () => {
  it('instala y quita solo la entrada «odesk», conservando el resto', async () => {
    const h = await mkdtemp(join(tmpdir(), 'clientes-'))
    const defs = clientesMcp(h, join(h, 'config'))
    const { configurarMcpTareas } = await import('../src/main/core/tareas/mcp-config')
    await mkdir(join(h, 'out', 'main'), { recursive: true })
    await writeFile(join(h, 'out', 'main', 'mcp-tareas.js'), '')
    configurarMcpTareas({ raizApp: h, dirDatos: join(h, '.odesk-agent') })
    const cursor = defs.find((c) => c.id === 'cursor')!
    await mkdir(join(h, '.cursor'), { recursive: true })
    await writeFile(cursor.archivo, JSON.stringify({ mcpServers: { otro: { command: 'x' } }, extra: 1 }))
    const e = await instalarMcpExterno('cursor', true, defs)
    const d = JSON.parse(await readFile(cursor.archivo, 'utf8'))
    expect(d.extra).toBe(1)
    expect(d.mcpServers.otro).toEqual({ command: 'x' })
    expect(d.mcpServers.odesk.args[0]).toContain('mcp-tareas.js')
    expect(d.mcpServers.odesk.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', ODESK_DIR: join(h, '.odesk-agent') })
    expect(e.clientes.find((c) => c.id === 'cursor')).toMatchObject({ instalado: true, disponible: true })
    await instalarMcpExterno('vscode', true, defs)
    expect(JSON.parse(await readFile(defs.find((c) => c.id === 'vscode')!.archivo, 'utf8')).servers.odesk.type).toBe('stdio')
    await instalarMcpExterno('cursor', false, defs)
    expect(JSON.parse(await readFile(cursor.archivo, 'utf8')).mcpServers).toEqual({ otro: { command: 'x' } })
    expect((await estadoMcpExterno(defs)).clientes.find((c) => c.id === 'cursor')!.instalado).toBe(false)
  })

  it('no pisa un archivo de configuración que no se entiende', async () => {
    const h = await mkdtemp(join(tmpdir(), 'clientes-'))
    const defs = clientesMcp(h, join(h, 'config'))
    await mkdir(join(h, '.cursor'), { recursive: true })
    await writeFile(defs.find((c) => c.id === 'cursor')!.archivo, '{roto')
    await expect(instalarMcpExterno('cursor', true, defs)).rejects.toThrow(/No se puede leer/)
  })
})
