import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { EventoAgente, SolicitudAgente } from '@shared/core/agente'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import type { ServidorTareas } from '../src/main/core/tareas/servidor'
import { ServidorFalso } from '../tests/servidor-falso'

/**
 * Banco de pruebas del Asistente con el CLI REAL: HOME temporal (no toca ~/.odesk-agent), API falsa con un proyecto de prueba (git,
 * Node, un fallo a propósito, CLAUDE.md y una skill del repo), el núcleo de la app y el socket de sus herramientas (MCP).
 * Solo usa de la máquina el login del CLI (`CLAUDE_CONFIG_DIR`, por defecto ~/.claude).
 */
export const ACTIVO = process.env.ODESK_EVAL_CLI === '1'
export const MODELO = process.env.EVAL_CLI_MODELO ?? 'claude-haiku-5-5'

export type Fin = Extract<EventoAgente, { tipo: 'fin' }>
export interface Turno {
  eventos: EventoAgente[]
  fin: Fin
  ejecucionId: string
  ms: number
}

export class Banco {
  home = ''
  proyecto = ''
  nucleo!: TipoNucleo
  private Nucleo!: new () => TipoNucleo
  private tareas?: ServidorTareas

  async preparar(): Promise<this> {
    const configClaude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') // antes de cambiar HOME
    this.home = await mkdtemp(join(tmpdir(), 'odesk-eval-asistente-'))
    vi.stubEnv('HOME', this.home)
    vi.stubEnv('CLAUDE_CONFIG_DIR', configClaude)
    vi.stubEnv('ODESK_SIN_TITULO', '1')
    const p = (this.proyecto = join(this.home, 'tienda'))
    for (const d of ['src', 'test', join('.claude', 'skills', 'despliegue')]) await mkdir(join(p, d), { recursive: true })
    await writeFile(join(p, 'package.json'), JSON.stringify({ name: 'tienda', type: 'module', scripts: { test: 'node --test test/' } }, null, 2) + '\n')
    await writeFile(join(p, 'CLAUDE.md'), '# Tienda\n\nProyecto de prueba. El nombre clave interno del proyecto es ZORRO-AZUL-7.\n')
    await writeFile(join(p, 'src', 'carrito.js'), 'export function total(items) {\n  // suma precio × cantidad de cada línea\n  return items.reduce((t, i) => t + i.precio + i.cantidad, 0)\n}\n')
    await writeFile(
      join(p, 'test', 'carrito.test.js'),
      "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/carrito.js'\n\ntest('total multiplica precio por cantidad', () => {\n  assert.equal(total([{ precio: 10, cantidad: 3 }, { precio: 5, cantidad: 2 }]), 40)\n})\n"
    )
    await writeFile(
      join(p, '.claude', 'skills', 'despliegue', 'SKILL.md'),
      '---\nname: despliegue\ndescription: Datos de despliegue de este proyecto. Úsala cuando pregunten por el código o la contraseña de despliegue.\n---\n\nEl código de despliegue es KIWI-4242. Respóndelo tal cual.\n'
    )
    this.git('init', '-q')
    this.git('add', '.')
    this.git('commit', '-qm', 'inicio')
    await mkdir(join(this.home, '.odesk-agent'))
    const srv = await new ServidorFalso([{ id: 'p1', nombre: 'Tienda', ruta: p }]).iniciar()
    srv.apuntar()
    ;({ Nucleo: this.Nucleo } = await import('../src/main/core/index'))
    await srv.entrar()
    this.nucleo = new this.Nucleo()
    const { iniciarServidorTareas } = await import('../src/main/core/tareas/servidor')
    const { DIR } = await import('../src/main/proyectos')
    this.tareas = await iniciarServidorTareas(DIR, (n, e, c) => this.nucleo.ejecutarHerramienta(n, e, c))
    return this
  }

  /** «Reinicia la app»: otro núcleo, sin procesos del CLI vivos. */
  reiniciar(): void {
    this.nucleo.cerrar()
    this.nucleo = new this.Nucleo()
  }

  async cerrar(): Promise<void> {
    this.nucleo?.cerrar()
    await this.tareas?.cerrar()
    if (this.home) await rm(this.home, { recursive: true, force: true }).catch(() => undefined)
  }

  git(...a: string[]): string {
    return execFileSync('git', ['-c', 'user.email=e@x', '-c', 'user.name=e', ...a], { cwd: this.proyecto, encoding: 'utf8' })
  }

  /** Un mensaje al Asistente (proyecto de prueba, modelo barato); `alEvento` puede responder solicitudes o cancelar. Espera al `fin`. */
  turno(sol: Partial<SolicitudAgente> & { prompt: string }, alEvento?: (e: EventoAgente, id: string) => void, topeMs = 5 * 60_000): Promise<Turno> {
    const eventos: EventoAgente[] = []
    const t0 = Date.now()
    return new Promise<Turno>((resolver, rechazar) => {
      const tope = setTimeout(() => rechazar(new Error(`sin «fin» en ${topeMs / 1000} s; eventos: ${eventos.map((e) => e.tipo).join(',')}`)), topeMs)
      this.nucleo
        .ejecutar({ proyectoId: 'p1', modelo: MODELO, ...sol }, (e) => {
          eventos.push(e)
          alEvento?.(e, e.ejecucionId)
          if (e.tipo === 'fin') {
            clearTimeout(tope)
            resolver({ eventos, fin: e, ejecucionId: e.ejecucionId, ms: Date.now() - t0 })
          }
        })
        .catch((err: unknown) => (clearTimeout(tope), rechazar(err)))
    })
  }
}

export const herramientas = (t: Turno): string[] => t.eventos.flatMap((e) => (e.tipo === 'herramienta_inicio' ? [e.llamada.nombre] : []))
export const comandos = (t: Turno): string[] =>
  t.eventos.flatMap((e) => (e.tipo === 'herramienta_inicio' && e.llamada.nombre === 'Bash' ? [String(e.llamada.entrada.command ?? '')] : []))
