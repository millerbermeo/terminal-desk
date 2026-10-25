import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACTIVO, Banco, herramientas, type Turno } from './banco-asistente'

/**
 * El Asistente de punta a punta con el CLI REAL (suscripción, proceso persistente como en la app) sobre un proyecto de prueba:
 * contexto del proyecto, streaming, generar/editar/depurar código con comandos reales, continuidad de la conversación (también tras
 * «reiniciar» la app), permisos, cancelación, errores, herramientas de la app por MCP, skills del repo y consumo.
 * Consume de la suscripción (Haiku por defecto): `ODESK_EVAL_CLI=1 pnpm evals -- asistente-real` (`EVAL_CLI_MODELO` para otro).
 */

const b = new Banco()
let proyecto = ''
const turno = (...a: Parameters<Banco['turno']>): Promise<Turno> => b.turno(...a)

beforeAll(async () => {
  if (!ACTIVO) return
  await b.preparar()
  proyecto = b.proyecto
}, 120_000)
afterAll(() => (ACTIVO ? b.cerrar() : undefined))

describe.skipIf(!ACTIVO)('Asistente con el CLI real', () => {
  it('sesión del CLI disponible', async () => {
    const c = await b.nucleo.cuentaEstado()
    expect(c.proveedor).toBe('suscripcion')
    expect(existsSync(join(proyecto, 'package.json'))).toBe(true)
  })

  it('usa el contexto del proyecto (CLAUDE.md) y responde en streaming con uso de tokens', async () => {
    const t = await turno({ prompt: '¿Cuál es el nombre clave interno del proyecto? Responde solo el nombre.' })
    console.log('[contexto]', t.ms, 'ms', JSON.stringify(t.fin.resultado.texto), t.fin.resultado.uso)
    expect(t.fin.resultado.estado).toBe('completado')
    expect(t.fin.resultado.texto).toContain('ZORRO-AZUL-7')
    expect(t.eventos.filter((e) => e.tipo === 'texto_delta').length).toBeGreaterThan(0)
    expect(t.eventos.some((e) => e.tipo === 'inicio')).toBe(true)
    expect(t.eventos.find((e) => e.tipo === 'uso_contexto')).toBeTruthy()
    expect(t.fin.resultado.uso.tokensSalida).toBeGreaterThan(0)
  })

  it('genera código nuevo que funciona (ediciones)', async () => {
    const t = await turno({
      prompt: 'Crea el archivo src/saludo.js que exporte `function saludar(nombre)` y devuelva exactamente `Hola, ${nombre}!`. Solo crea ese archivo; no ejecutes comandos.',
      autonomia: 'ediciones',
      sesionId: 'conv-codigo'
    })
    console.log('[generar]', t.ms, 'ms', herramientas(t))
    expect(t.fin.resultado.estado).toBe('completado')
    expect(existsSync(join(proyecto, 'src', 'saludo.js'))).toBe(true)
    const mod = await import(pathToFileURL(join(proyecto, 'src', 'saludo.js')).href + `?t=${Date.now()}`)
    expect(mod.saludar('Ana')).toBe('Hola, Ana!')
  })

  it('depura: ejecuta los tests, encuentra el fallo y lo corrige sin tocar los tests (autónomo)', async () => {
    const testAntes = await readFile(join(proyecto, 'test', 'carrito.test.js'), 'utf8')
    expect(spawnSync('npm', ['test'], { cwd: proyecto }).status).not.toBe(0)
    const t = await turno({
      prompt: 'Los tests del proyecto fallan. Ejecuta `npm test`, encuentra la causa y corrige el código (no modifiques los tests). Vuelve a ejecutar los tests para confirmarlo.',
      autonomia: 'autonomo',
      sesionId: 'conv-codigo'
    })
    console.log('[depurar]', t.ms, 'ms', herramientas(t), t.fin.resultado.uso)
    expect(t.fin.resultado.estado).toBe('completado')
    expect(herramientas(t)).toContain('Bash')
    expect(spawnSync('npm', ['test'], { cwd: proyecto }).status).toBe(0)
    expect(await readFile(join(proyecto, 'test', 'carrito.test.js'), 'utf8')).toBe(testAntes)
    // El resultado de los comandos llega como herramienta_fin (lo que la UI muestra)
    expect(t.eventos.some((e) => e.tipo === 'herramienta_fin' && e.llamada.nombre === 'Bash' && /pass|ok|✔/i.test(e.resultado.texto))).toBe(true)
  })

  it('la conversación sigue (proceso persistente) y también tras reiniciar la app', async () => {
    const t1 = await turno({ prompt: '¿Qué archivo creaste al principio de esta conversación? Responde solo la ruta.', sesionId: 'conv-codigo' })
    console.log('[continuidad]', t1.ms, 'ms', JSON.stringify(t1.fin.resultado.texto))
    expect(t1.fin.resultado.texto).toContain('saludo.js')
    // «Reinicio»: otro núcleo, sin procesos vivos; la conversación del CLI se reanuda desde lo guardado.
    b.reiniciar()
    const t2 = await turno({ prompt: '¿Y qué archivo corregiste para que pasaran los tests? Responde solo la ruta.', sesionId: 'conv-codigo' })
    console.log('[tras reinicio]', t2.ms, 'ms', JSON.stringify(t2.fin.resultado.texto))
    expect(t2.fin.resultado.estado).toBe('completado')
    expect(t2.fin.resultado.texto).toContain('carrito.js')
  })

  it('en «Preguntar» pide permiso: denegado no escribe; aprobado sí', async () => {
    const pedir = 'Crea el archivo nota.txt en la raíz del proyecto con el texto hola. Usa la herramienta de escribir archivos.'
    const solicitudes: string[] = []
    const d = await turno({ prompt: pedir, autonomia: 'preguntar' }, (e) => {
      if (e.tipo === 'solicitud_humana') {
        solicitudes.push(e.clase)
        b.nucleo.responder(e.solicitudId, { aprobado: false, comentario: 'no' })
      }
    })
    console.log('[permiso denegado]', d.ms, 'ms', solicitudes, d.fin.resultado.estado)
    expect(solicitudes.length).toBeGreaterThan(0)
    expect(existsSync(join(proyecto, 'nota.txt'))).toBe(false)
    expect(d.fin.resultado.estado).toBe('completado')

    const a = await turno({ prompt: pedir, autonomia: 'preguntar' }, (e) => {
      if (e.tipo === 'solicitud_humana') b.nucleo.responder(e.solicitudId, { aprobado: true })
    })
    console.log('[permiso aprobado]', a.ms, 'ms', herramientas(a))
    expect((await readFile(join(proyecto, 'nota.txt'), 'utf8')).trim()).toBe('hola')
  })

  it('cancelar a mitad de un comando largo corta la ejecución y no deja procesos colgados; la conversación sigue usable', async () => {
    let cancelado = 0
    const t = await turno(
      { prompt: 'Ejecuta exactamente este comando en la terminal y espera a que termine: sleep 97. Después responde «listo».', autonomia: 'autonomo', sesionId: 'conv-cancelar' },
      (e, id) => {
        if (e.tipo === 'herramienta_inicio' && e.llamada.nombre === 'Bash' && !cancelado) {
          cancelado = Date.now()
          setTimeout(() => b.nucleo.cancelar(id), 1500)
        }
      },
      120_000
    )
    const tardo = Date.now() - cancelado
    console.log('[cancelar]', t.fin.resultado.estado, 'fin', tardo, 'ms tras empezar el comando')
    expect(cancelado).toBeGreaterThan(0)
    expect(t.fin.resultado.estado).toBe('cancelado')
    expect(tardo).toBeLessThan(15_000)
    await new Promise((r) => setTimeout(r, 1500))
    expect(spawnSync('pgrep', ['-f', 'sleep 97']).status).not.toBe(0) // sin `sleep` huérfano
    const sigue = await turno({ prompt: 'Responde solo: sigo aquí', sesionId: 'conv-cancelar' })
    console.log('[tras cancelar]', sigue.ms, 'ms', JSON.stringify(sigue.fin.resultado.texto))
    expect(sigue.fin.resultado.estado).toBe('completado')
  })

  it('usa las herramientas de la app por MCP (tareas) y las skills del repo', async () => {
    const t = await turno({ prompt: 'Crea una tarea titulada «Revisar el cálculo del carrito» con las herramientas de tareas de Odesk. Responde «hecho» al terminar.', autonomia: 'ediciones' })
    console.log('[mcp tareas]', t.ms, 'ms', herramientas(t), t.fin.resultado.error ?? '')
    expect(herramientas(t).some((h) => h === 'mcp__odesk__crear_tarea')).toBe(true)
    const lista = await b.nucleo.tareas.listar({ proyectoId: 'p1' } as never).catch(() => undefined)
    console.log('[mcp tareas] en el tablero:', JSON.stringify(lista)?.slice(0, 200))
    expect(JSON.stringify(lista)).toContain('Revisar el cálculo del carrito')

    const s = await turno({ prompt: '¿Cuál es el código de despliegue de este proyecto?' })
    console.log('[skill]', s.ms, 'ms', herramientas(s), JSON.stringify(s.fin.resultado.texto).slice(0, 200))
    expect(s.fin.resultado.texto).toContain('KIWI-4242')
  })

  it('errores: modelo inexistente y proyecto inexistente se informan sin colgarse', async () => {
    const t = await turno({ prompt: 'hola', modelo: 'claude-no-existe-9' }, undefined, 120_000)
    console.log('[modelo malo]', t.ms, 'ms', t.fin.resultado.estado, t.fin.resultado.error?.slice(0, 200))
    expect(t.fin.resultado.estado).toBe('error')
    expect(t.fin.resultado.error).toBeTruthy()
    await expect(b.nucleo.ejecutar({ prompt: 'x', proyectoId: 'no-existe' }, () => undefined)).rejects.toThrow(/Proyecto no encontrado/)
    const ok = await turno({ prompt: 'Responde solo: ok' })
    expect(ok.fin.resultado.estado).toBe('completado')
  })

  it('consumo: el medidor registra lo gastado por modelo', async () => {
    const r = await b.nucleo.medidor.resumen()
    console.log('[consumo]', JSON.stringify(r).slice(0, 600))
    expect(JSON.stringify(r)).toMatch(/haiku|sonnet|opus/i)
  })
})
