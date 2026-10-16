import { execFile } from 'node:child_process'
import type { Riesgo } from '@shared/core/herramientas'
import type { Herramienta } from '../registro'

const MAX_SALIDA = 20_000
const TIEMPO_MAX_MS = 30_000

// Comandos que no modifican nada: se consideran de lectura y no piden aprobación.
const SOLO_LECTURA = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'git status', 'git log', 'git diff', 'git show', 'git branch'])
// «find» y «git branch» pueden borrar/crear con ciertas opciones: se excluyen si aparecen.
const ARGS_PELIGROSOS = /^(-delete|-exec|-execdir|-fprint.*|-d|-D|-m|-M|-c|-C|--delete|--force)$/

export function clasificarComando(comando: string, args: string[]): Riesgo {
  const clave = comando === 'git' ? `git ${args[0] ?? ''}` : comando
  if (!SOLO_LECTURA.has(clave)) return 'ejecucion'
  return args.some((a) => ARGS_PELIGROSOS.test(a)) ? 'ejecucion' : 'lectura'
}

const argsDe = (entrada: Record<string, unknown>): string[] => (Array.isArray(entrada.args) ? entrada.args.map(String) : [])

export const ejecutarComando: Herramienta = {
  nombre: 'ejecutar_comando',
  descripcion:
    'Ejecuta un programa en la raíz del proyecto SIN shell (sin pipes ni redirecciones). Pasa los argumentos por separado en «args».',
  esquema: {
    type: 'object',
    properties: {
      comando: { type: 'string', description: 'Programa, ej. «git»' },
      args: { type: 'array', items: { type: 'string' }, description: 'Argumentos' }
    },
    required: ['comando']
  },
  riesgo: 'ejecucion',
  clasificar: (entrada) => clasificarComando(String(entrada.comando), argsDe(entrada)),
  ejecutar(entrada, ctx) {
    return new Promise((res) => {
      execFile(
        String(entrada.comando),
        argsDe(entrada),
        { cwd: ctx.cwd, timeout: TIEMPO_MAX_MS, maxBuffer: 4 * 1024 * 1024, signal: ctx.senal },
        (err, stdout, stderr) => {
          const salida = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim()
          const texto = salida.length > MAX_SALIDA ? salida.slice(0, MAX_SALIDA) + '\n[… truncado]' : salida
          if (err) res({ texto: `${texto}\n[${err.message}]`.trim(), error: true })
          else res({ texto: texto || '(sin salida)' })
        }
      )
    })
  }
}
