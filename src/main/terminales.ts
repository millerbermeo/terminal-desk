import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { OpcionesTerminal } from '@shared/ipc'

interface Callbacks {
  onDatos(id: string, datos: string): void
  onSalida(id: string, codigo: number): void
}

function shellPorDefecto(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: process.env.COMSPEC ?? 'powershell.exe', args: [] }
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { shell, args: ['-l'] }
}

export class GestorTerminales {
  private terminales = new Map<string, pty.IPty>()

  constructor(private cb: Callbacks) {}

  crear({ cwd, cols, rows }: OpcionesTerminal, extra?: { comando: string; env: Record<string, string> }): string {
    const id = randomUUID()
    const { shell, args } = shellPorDefecto()
    const dir = cwd && existsSync(cwd) ? cwd : homedir()
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 1),
      cwd: dir,
      env: { ...process.env, ...extra?.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    })
    this.terminales.set(id, proc)
    // Se escribe en el shell interactivo (no se hace spawn directo) para heredar PATH/nvm/etc. y que la terminal siga viva al salir del CLI.
    if (extra?.comando) proc.write(extra.comando + '\r')
    proc.onData((d) => this.cb.onDatos(id, d))
    proc.onExit(({ exitCode }) => {
      if (this.terminales.delete(id)) this.cb.onSalida(id, exitCode)
    })
    return id
  }

  escribir(id: string, datos: string): void {
    this.terminales.get(id)?.write(datos)
  }

  redimensionar(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1) return
    try {
      this.terminales.get(id)?.resize(cols, rows)
    } catch {
      // el proceso ya terminó
    }
  }

  cerrar(id: string): void {
    const proc = this.terminales.get(id)
    if (!proc) return
    this.terminales.delete(id)
    this.matar(proc)
  }

  cerrarTodas(): void {
    for (const proc of this.terminales.values()) this.matar(proc)
    this.terminales.clear()
  }

  private matar(proc: pty.IPty): void {
    try {
      proc.kill() // SIGHUP al grupo de sesión del pty en POSIX
    } catch {
      // ya terminado
    }
    if (process.platform === 'win32') return
    // Si el shell ignora SIGHUP, asegurar con SIGKILL.
    const pid = proc.pid
    setTimeout(() => {
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGKILL')
      } catch {
        // ya no existe
      }
    }, 1000).unref()
  }
}
