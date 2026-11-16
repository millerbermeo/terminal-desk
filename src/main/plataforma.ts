import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
  type ExecFileOptions,
  type SpawnOptions,
  type SpawnOptionsWithStdioTuple,
  type SpawnOptionsWithoutStdio,
  type StdioNull,
  type StdioPipe
} from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'

/**
 * Lanzar programas igual en Linux, macOS y Windows.
 *
 * En Windows muchos CLIs (`claude`, `npx`, `pnpm`, `code`…) son guiones `.cmd`/`.bat`. Node no los ejecuta sin shell (EINVAL desde
 * Node 20.12) y con `shell: true` NO cita los argumentos: una ruta con espacios (`C:\Users\Ana María\…`) o un texto con comillas o
 * saltos de línea se rompe, y matar el hijo solo mata `cmd.exe` (el programa real queda huérfano). Aquí se resuelve el ejecutable
 * por el PATH (con `PATHEXT`); si es un guion de npm/pnpm se lanza directamente lo que envuelve (el `.exe` o `node script.js`) y,
 * si no, se pasa por `cmd.exe` con el escapado de `cross-spawn`. En Linux/macOS no cambia nada.
 */

export const WINDOWS = process.platform === 'win32'

type Entorno = NodeJS.ProcessEnv

/** Valor de una variable sin importar mayúsculas (en Windows el PATH suele llamarse `Path`). */
function variable(env: Entorno, nombre: string): string | undefined {
  if (env[nombre] !== undefined) return env[nombre]
  const clave = Object.keys(env).find((k) => k.toUpperCase() === nombre)
  return clave ? env[clave] : undefined
}

function esArchivo(ruta: string): boolean {
  try {
    return statSync(ruta).isFile()
  } catch {
    return false
  }
}

/** Extensiones ejecutables de Windows en el orden de `PATHEXT`. */
function extensiones(env: Entorno): string[] {
  return (variable(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Ruta absoluta de `bin` buscando en el PATH (en Windows con `PATHEXT`: `claude` → `claude.exe` o `claude.cmd`, nunca el guion
 * sin extensión que npm deja para bash). `undefined` si no está.
 */
export function buscarEnPath(bin: string, env: Entorno = process.env, windows = WINDOWS): string | undefined {
  const exts = windows ? extensiones(env) : []
  const candidatos = (base: string): string[] => {
    if (!windows) return [base]
    // Con extensión ejecutable conocida se prueba tal cual; si no, con cada una de PATHEXT.
    return exts.includes(extname(base).toLowerCase()) ? [base] : exts.map((e) => base + e)
  }
  if (isAbsolute(bin) || bin.includes('/') || (windows && bin.includes('\\'))) {
    return candidatos(resolve(bin)).find(esArchivo)
  }
  const dirs = (variable(env, 'PATH') ?? '').split(windows ? ';' : delimiter).filter(Boolean)
  for (const dir of dirs) {
    const hallado = candidatos(join(dir.replace(/^"|"$/g, ''), bin)).find(esArchivo)
    if (hallado) return hallado
  }
  return undefined
}

/** Lugares donde suelen quedar instalados los CLIs cuando la app se abre desde el menú y no hereda el PATH del shell. */
export function rutasHabituales(bin: string, windows = WINDOWS, casa = homedir()): string[] {
  if (windows) {
    const appData = process.env.APPDATA ?? join(casa, 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA ?? join(casa, 'AppData', 'Local')
    return [
      join(casa, '.local', 'bin', `${bin}.exe`),
      join(appData, 'npm', `${bin}.cmd`),
      join(local, 'pnpm', `${bin}.cmd`),
      join(local, 'Volta', 'bin', `${bin}.exe`),
      join(casa, 'scoop', 'shims', `${bin}.exe`)
    ]
  }
  return [
    join(casa, '.local', 'bin', bin),
    join(casa, '.claude', 'local', bin),
    join(casa, '.npm-global', 'bin', bin),
    join(casa, '.volta', 'bin', bin),
    join(casa, '.bun', 'bin', bin),
    join(casa, 'Library', 'pnpm', bin),
    join(casa, '.local', 'share', 'pnpm', bin),
    '/opt/homebrew/bin/' + bin,
    '/usr/local/bin/' + bin,
    '/usr/bin/' + bin
  ]
}

/** Primera ruta habitual que exista. */
export function buscarHabitual(bin: string, windows = WINDOWS): string | undefined {
  return rutasHabituales(bin, windows).find(esArchivo)
}

/**
 * Programa real detrás de un guion `.cmd` de npm, pnpm o yarn (`"%dp0%\node_modules\…\cli.js" %*`, `"%~dp0\…\claude.exe" %*`).
 * `undefined` si no tiene ese formato o el destino no existe.
 */
export function destinoDeGuion(ruta: string, contenido?: string): string | undefined {
  let texto = contenido
  if (texto === undefined) {
    try {
      texto = readFileSync(ruta, 'utf8')
    } catch {
      return undefined
    }
  }
  const destinos = [...texto.matchAll(/"%~?dp0%?\\?([^"%*]+)"/gi)]
    .map((m) => m[1]!.trim())
    .filter((r) => !/(^|\\)node(\.exe)?$/i.test(r))
    // Solo guiones de gestores de paquetes: otros `.cmd` (p. ej. el `code.cmd` de VS Code) preparan su propio entorno.
    .filter((r) => /node_modules[\\/]/i.test(r))
  const ultimo = destinos.at(-1)
  if (!ultimo) return undefined
  const absoluta = resolve(dirname(ruta), ...ultimo.split(/[\\/]+/))
  return contenido !== undefined || esArchivo(absoluta) ? absoluta : undefined
}

const METACARACTERES = /([()\][%!^"`<>&|;, *?])/g

/** Escapa un argumento para `cmd.exe /d /s /c "…"` (mismo algoritmo que `cross-spawn`). */
export function escaparArgumentoCmd(arg: string, dobleEscape: boolean): string {
  let a = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
  a = a.replace(/(?=(\\+?)?)\1$/, '$1$1')
  a = `"${a}"`.replace(METACARACTERES, '^$1')
  return dobleEscape ? a.replace(METACARACTERES, '^$1') : a
}

export interface ComandoPreparado {
  archivo: string
  args: string[]
  /** `true` cuando los argumentos ya van escapados para `cmd.exe` (`windowsVerbatimArguments`). */
  literal: boolean
  /** Variables extra que necesita el hijo (p. ej. `ELECTRON_RUN_AS_NODE` si se usa el Node de Electron). */
  env?: Entorno
}

/** Cómo lanzar `bin args` en este sistema sin `shell: true`. En Linux/macOS devuelve lo mismo. */
export function prepararComando(bin: string, args: readonly string[], env: Entorno = process.env, windows = WINDOWS): ComandoPreparado {
  if (!windows) return { archivo: bin, args: [...args], literal: false }
  const ruta = buscarEnPath(bin, env, true) ?? bin
  const ext = extname(ruta).toLowerCase()
  if (ext !== '.cmd' && ext !== '.bat') return { archivo: ruta, args: [...args], literal: false }

  // Guion de npm/pnpm: se lanza lo que envuelve, con los argumentos intactos (saltos de línea incluidos).
  const destino = destinoDeGuion(ruta)
  if (destino) {
    const extDestino = extname(destino).toLowerCase()
    if (extDestino === '.exe' || extDestino === '.com') return { archivo: destino, args: [...args], literal: false }
    if (['.js', '.cjs', '.mjs'].includes(extDestino)) {
      const nodoJunto = join(dirname(ruta), 'node.exe')
      const node = esArchivo(nodoJunto) ? nodoJunto : buscarEnPath('node', env, true)
      if (node) return { archivo: node, args: [destino, ...args], literal: false }
      // Sin Node instalado: el Electron de la app hace de Node.
      return { archivo: process.execPath, args: [destino, ...args], literal: false, env: { ELECTRON_RUN_AS_NODE: '1' } }
    }
  }

  // Cualquier otro .cmd/.bat: por cmd.exe con todo escapado. Un salto de línea no se puede pasar por cmd.
  if (args.some((a) => /[\r\n]/.test(a))) {
    throw new Error(`No se puede pasar un texto con saltos de línea a «${bin}» en Windows (es un guion .cmd).`)
  }
  const dobleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(ruta)
  const linea = [ruta.replace(METACARACTERES, '^$1'), ...args.map((a) => escaparArgumentoCmd(a, dobleEscape))].join(' ')
  return { archivo: variable(env, 'COMSPEC') || 'cmd.exe', args: ['/d', '/s', '/c', `"${linea}"`], literal: true }
}

function opcionesDe<T extends SpawnOptions | ExecFileOptions>(c: ComandoPreparado, opciones: T): T {
  const { shell: _shell, ...resto } = opciones as T & { shell?: unknown }
  return {
    windowsHide: true,
    ...resto,
    ...(c.env ? { env: { ...(opciones.env ?? process.env), ...c.env } } : {}),
    ...(c.literal ? { windowsVerbatimArguments: true } : {})
  } as T
}

/**
 * `spawn` que funciona igual en los tres sistemas (sin `shell`: ignora esa opción). Lanza (como `spawn` con argumentos no válidos)
 * si en Windows hay que pasar un salto de línea a un guion `.cmd` que no envuelve a un programa conocido.
 */
export function lanzar<I extends StdioNull | StdioPipe, O extends StdioNull | StdioPipe, E extends StdioNull | StdioPipe>(
  bin: string,
  args: readonly string[],
  opciones: SpawnOptionsWithStdioTuple<I, O, E>
): ChildProcessByStdio<I extends StdioPipe ? Writable : null, O extends StdioPipe ? Readable : null, E extends StdioPipe ? Readable : null>
export function lanzar(bin: string, args: readonly string[], opciones?: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams
export function lanzar(bin: string, args: readonly string[], opciones?: SpawnOptions): ChildProcess
export function lanzar(bin: string, args: readonly string[], opciones: SpawnOptions = {}): ChildProcess {
  const c = prepararComando(bin, args, opciones.env ?? process.env)
  return spawn(c.archivo, c.args, opcionesDe(c, opciones))
}

/** `execFile` (salida como texto) que funciona igual en los tres sistemas. */
export function ejecutarArchivo(
  bin: string,
  args: readonly string[],
  opciones: ExecFileOptions,
  alTerminar: (err: ExecFileException | null, stdout: string, stderr: string) => void
): ChildProcess | undefined {
  let c: ComandoPreparado
  try {
    c = prepararComando(bin, args, opciones.env ?? process.env)
  } catch (err) {
    queueMicrotask(() => alTerminar(err as ExecFileException, '', ''))
    return undefined
  }
  return execFile(c.archivo, c.args, { ...opcionesDe(c, opciones), encoding: 'utf8' }, (err, stdout, stderr) => alTerminar(err, String(stdout), String(stderr)))
}
