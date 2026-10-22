import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventoAgente, ResultadoAgente } from '@shared/core/agente'
import type { InfoModelo } from '@shared/core/uso'
import { HERRAMIENTAS_ODESK, PREFIJO_MCP } from '@shared/herramientas-odesk'
import type { CuentaSuscripcion, EstadoCuenta, ProveedorModelo } from '@shared/core/cuenta'
import type { ModoAutonomia } from '@shared/core/permisos'
import { aAcumulado, diferenciaUso, type AcumuladoModelo } from './consumo'

/**
 * Modo «suscripción»: el modelo lo pone el CLI `claude` con la sesión de la cuenta de Claude (la misma que usa VSCode).
 * La app no toca tokens ni OAuth: el inicio de sesión lo hace el propio CLI en el navegador (correo, Google o SSO).
 */

const WINDOWS = process.platform === 'win32'

/**
 * Ajustes del CLI que acotan el contexto (lo que más tokens consume: se reenvía entero en cada llamada). Sin ellos los modelos de
 * 1 M de ventana solo compactan al 95 % de 1 M, es decir, casi nunca. Con una ventana de 200 k y el 70 % el CLI compacta solo a
 * los ~140 k, y las salidas gigantes de comandos y de servidores MCP se recortan antes de entrar al contexto. El entorno del
 * usuario manda: solo se fijan las que no estén ya definidas.
 */
export const AJUSTES_CONSUMO: Readonly<Record<string, string>> = {
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000',
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '70',
  BASH_MAX_OUTPUT_LENGTH: '20000',
  MAX_MCP_OUTPUT_TOKENS: '12000'
}

/** Sin estas variables el CLI usaría la clave de API (y se cobraría por tokens) en vez de la suscripción. */
export function entornoSuscripcion(carpeta?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const [k, v] of Object.entries(AJUSTES_CONSUMO)) env[k] ??= v
  // App lanzada desde el menú: su PATH no trae nvm/pnpm/node. Se usa el del shell de login (ver `cargarPathShell`).
  if (pathShell) env.PATH = pathShell
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ELECTRON_RUN_AS_NODE
  // Otra cuenta = otra carpeta de configuración: el CLI guarda ahí su propio inicio de sesión y sus sesiones.
  if (carpeta) env.CLAUDE_CONFIG_DIR = carpeta
  return env
}

let rutaCache: string | undefined
let pathShell: string | undefined
let pathShellCargado: Promise<void> | undefined

/** PATH del shell de login del usuario (con nvm, pnpm, volta…), unido al de la app. Una sola vez; en Windows no hace falta. */
export function cargarPathShell(): Promise<void> {
  if (WINDOWS) return Promise.resolve()
  pathShellCargado ??= new Promise<void>((res) => {
    execFile(process.env.SHELL || '/bin/bash', ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { timeout: 8000 }, (err, out) => {
      const m = err ? null : /__PATH__(.*)__PATH__/s.exec(String(out))
      if (m?.[1]) pathShell = [...new Set([...m[1].split(':'), ...(process.env.PATH ?? '').split(':')])].filter(Boolean).join(':')
      res()
    })
  })
  return pathShellCargado
}

/** Localiza `claude`: primero el PATH de la app y, si no está (lanzada desde el menú), el del shell de login. */
export async function rutaClaude(): Promise<string | undefined> {
  await cargarPathShell()
  if (rutaCache) return rutaCache
  const probar = (cmd: string, args: string[]): Promise<string | undefined> =>
    new Promise((res) =>
      execFile(cmd, args, { timeout: 8000, env: process.env, ...(WINDOWS ? { shell: true } : {}) }, (err, out) => res(err ? undefined : String(out).split(/\r?\n/).find((l) => l.trim())?.trim()))
    )
  let ruta = await probar(WINDOWS ? 'where' : 'which', ['claude'])
  if (!ruta && !WINDOWS) ruta = await probar(process.env.SHELL || '/bin/bash', ['-ilc', 'command -v claude'])
  if (ruta) rutaCache = ruta
  return ruta
}

interface SalidaCli {
  codigo: number | null
  salida: string
  error: string
}

async function correrCli(args: string[], opciones: { timeoutMs?: number; senal?: AbortSignal; carpeta?: string; entrada?: string; cwd?: string } = {}): Promise<SalidaCli> {
  const bin = await rutaClaude()
  if (!bin) throw new Error('No encuentro el CLI «claude». Instálalo (https://claude.com/claude-code) y vuelve a intentarlo.')
  return new Promise((res, rej) => {
    const hijo = spawn(bin, args, { env: entornoSuscripcion(opciones.carpeta), stdio: [opciones.entrada === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(opciones.cwd ? { cwd: opciones.cwd } : {}), ...(WINDOWS ? { shell: true } : {}) })
    let salida = ''
    let error = ''
    if (opciones.entrada !== undefined) {
      hijo.stdin?.on('error', () => undefined)
      hijo.stdin?.end(opciones.entrada) // por stdin: un texto largo como argumento supera el límite del sistema
    }
    hijo.stdout!.on('data', (d: Buffer) => (salida += d))
    hijo.stderr!.on('data', (d: Buffer) => (error += d))
    const timer = opciones.timeoutMs ? setTimeout(() => hijo.kill(), opciones.timeoutMs) : undefined
    const abortar = (): void => void hijo.kill()
    opciones.senal?.addEventListener('abort', abortar, { once: true })
    hijo.on('error', rej)
    hijo.on('close', (codigo) => {
      if (timer) clearTimeout(timer)
      opciones.senal?.removeEventListener('abort', abortar)
      res({ codigo, salida, error })
    })
  })
}

/** Modelo barato para resumir conversaciones y para las preguntas laterales. */
export const MODELO_RESUMEN = 'haiku'

/**
 * Una consulta de una sola vuelta, sin herramientas, sin plugins ni conectores y sin guardar sesión (modelo barato). Sirve para
 * resumir una conversación antes de abrir una sesión nueva. Devuelve el texto y el consumo real por modelo (sesión nueva: no acumula).
 */
export async function consultarCli(
  prompt: string,
  entrada: string,
  opciones: { modelo?: string; carpeta?: string; cwd?: string; senal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ texto: string; uso: UsoPorModelo[] }> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', opciones.modelo ?? MODELO_RESUMEN,
    '--tools', '',
    '--no-session-persistence',
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-budget-usd', '1',
    '--exclude-dynamic-system-prompt-sections',
    '--append-system-prompt', prompt
  ]
  const r = await correrCli(args, { timeoutMs: opciones.timeoutMs ?? 120_000, entrada, ...(opciones.carpeta ? { carpeta: opciones.carpeta } : {}), ...(opciones.cwd ? { cwd: opciones.cwd } : {}), ...(opciones.senal ? { senal: opciones.senal } : {}) })
  const j = JSON.parse(r.salida.trim() || '{}') as { is_error?: boolean; result?: unknown; modelUsage?: Record<string, UsoModeloCli> }
  if (r.codigo !== 0 || j.is_error || typeof j.result !== 'string' || !j.result.trim()) throw new Error((r.error || String(j.result ?? 'sin respuesta')).trim().slice(-300))
  return { texto: j.result.trim(), uso: Object.entries(j.modelUsage ?? {}).map(([modelo, u]) => usoPorModelo(modelo, aAcumulado(u))) }
}

const usoPorModelo = (modelo: string, a: AcumuladoModelo): UsoPorModelo => ({ modelo, uso: { tokensEntrada: a.entrada, tokensSalida: a.salida }, cache: a.cache, costo: a.costo })

export interface SesionCli {
  cli: boolean
  sesion: boolean
  email?: string
  metodo?: string
  aviso?: string
}

/** Estado de la sesión del CLI. Solo cuenta como «suscripción» una sesión de claude.ai. */
export async function estadoSesion(carpeta?: string): Promise<SesionCli> {
  if (!(await rutaClaude())) return { cli: false, sesion: false, aviso: 'No encuentro el CLI «claude». Instálalo para usar tu suscripción.' }
  try {
    const r = await correrCli(['auth', 'status', '--json'], { timeoutMs: 15_000, ...(carpeta ? { carpeta } : {}) })
    const j = JSON.parse(r.salida.trim() || '{}') as { loggedIn?: boolean; authMethod?: string; email?: string }
    if (!j.loggedIn) return { cli: true, sesion: false, aviso: 'Inicia sesión con tu cuenta de Claude para usar tu suscripción.' }
    if (j.authMethod && j.authMethod !== 'claude.ai')
      return { cli: true, sesion: false, metodo: j.authMethod, ...(j.email ? { email: j.email } : {}), aviso: `La sesión del CLI es de tipo «${j.authMethod}», no de suscripción. Cierra sesión e inicia de nuevo con tu cuenta de Claude.` }
    return { cli: true, sesion: true, metodo: j.authMethod ?? 'claude.ai', ...(j.email ? { email: j.email } : {}) }
  } catch (err) {
    return { cli: true, sesion: false, aviso: `No pude comprobar la sesión: ${(err as Error).message}` }
  }
}

const iniciosEnCurso = new Map<string, Promise<void>>()

/** `claude auth login`: abre el navegador y espera a que se complete (hasta 5 minutos). Uno a la vez por cuenta. */
export function iniciarSesion(carpeta?: string): Promise<void> {
  const clave = carpeta ?? ''
  let p = iniciosEnCurso.get(clave)
  if (!p) {
    p = (async () => {
      const r = await correrCli(['auth', 'login', '--claudeai'], { timeoutMs: 5 * 60_000, ...(carpeta ? { carpeta } : {}) })
      if (r.codigo !== 0) throw new Error((r.error || r.salida).trim().split('\n').at(-1) || 'No se completó el inicio de sesión')
    })().finally(() => void iniciosEnCurso.delete(clave))
    iniciosEnCurso.set(clave, p)
  }
  return p
}

export async function cerrarSesion(carpeta?: string): Promise<void> {
  await correrCli(['auth', 'logout'], { timeoutMs: 15_000, ...(carpeta ? { carpeta } : {}) })
}

/** Preferencia de proveedor (por defecto, la suscripción). */
export class Preferencias {
  private cache?: ProveedorModelo
  constructor(private readonly archivo: string) {}

  async proveedor(): Promise<ProveedorModelo> {
    if (this.cache) return this.cache
    try {
      const j = JSON.parse(await readFile(this.archivo, 'utf8')) as { proveedor?: string }
      this.cache = j.proveedor === 'api' ? 'api' : 'suscripcion'
    } catch {
      this.cache = 'suscripcion'
    }
    return this.cache
  }

  /** El archivo cambió por fuera (llegó de otra computadora): la próxima lectura lo vuelve a leer. */
  olvidarCache(): void {
    this.cache = undefined
  }

  async fijar(p: ProveedorModelo): Promise<void> {
    this.cache = p
    await mkdir(join(this.archivo, '..'), { recursive: true })
    const tmp = `${this.archivo}.tmp`
    await writeFile(tmp, JSON.stringify({ proveedor: p }, null, 2), { mode: 0o600 })
    await rename(tmp, this.archivo)
  }
}

/** Conversación de la app -> sesión del CLI (para continuarla con `--resume`). */
export class SesionesCli {
  constructor(private readonly archivo: string) {}

  private async leer(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.archivo, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  async obtener(sesionId: string): Promise<string | undefined> {
    return (await this.leer())[sesionId]
  }

  async guardar(sesionId: string, claudeId: string): Promise<void> {
    const datos = await this.leer()
    if (datos[sesionId] === claudeId) return
    datos[sesionId] = claudeId
    await mkdir(join(this.archivo, '..'), { recursive: true })
    const tmp = `${this.archivo}.tmp`
    await writeFile(tmp, JSON.stringify(datos), { mode: 0o600 })
    await rename(tmp, this.archivo)
  }
}

const LECTURA = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']

/** Autonomía -> permisos del CLI. En modo `-p` no hay forma de preguntar: lo que no está permitido se deniega. */
/** Comandos que ni el modo autónomo puede ejecutar. */
export const COMANDOS_BLOQUEADOS = ['Bash(sudo:*)', 'Bash(rm -rf /:*)', 'Bash(rm -rf ~:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(mkfs:*)', 'Bash(dd:*)']

/** Servidor MCP externo (Playwright, los de `mcp.json`): su riesgo decide desde qué autonomía se permiten sus herramientas. */
export interface McpExterno {
  nombre: string
  riesgo: 'lectura' | 'escritura' | 'ejecucion'
}

/** Subagentes que trae el CLI de serie: el Asistente solo delega en los del proyecto (los de su plugin), no en estos. */
export const SUBAGENTES_INTEGRADOS = ['Explore', 'general-purpose', 'Plan', 'claude-code-guide', 'statusline-setup', 'claude'].map((n) => `Agent(${n})`)

/** Añade el bloqueo de los subagentes integrados a la lista `--disallowedTools` (que en modo autónomo ya existe y va al final). */
export const sinSubagentesIntegrados = (permisos: string[]): string[] => [...permisos, ...(permisos.includes('--disallowedTools') ? [] : ['--disallowedTools']), ...SUBAGENTES_INTEGRADOS]

export function permisosCli(autonomia: ModoAutonomia, verificaciones: string[], conHerramientas = false, externos: McpExterno[] = []): string[] {
  const permitidas = [...LECTURA]
  // Herramientas de la app (servidor MCP: tareas, git y GitHub). Consultar siempre; cambiar, como las ediciones de archivos, desde
  // «Aceptar ediciones»; lo que sale de la máquina (enviar, publicar en GitHub) solo en modo «Autónomo»: aquí no hay quien confirme.
  if (conHerramientas) {
    for (const h of HERRAMIENTAS_ODESK) {
      const permitida = h.riesgo === 'lectura' || (h.riesgo === 'escritura' && autonomia !== 'preguntar') || (h.riesgo === 'ejecucion' && autonomia === 'autonomo')
      if (permitida) permitidas.push(PREFIJO_MCP + h.nombre)
    }
  }
  // Servidores externos: mismas reglas que las herramientas de la app (`mcp__<servidor>` permite todas las del servidor).
  for (const e of externos) {
    if (e.riesgo === 'lectura' || (e.riesgo === 'escritura' && autonomia !== 'preguntar') || (e.riesgo === 'ejecucion' && autonomia === 'autonomo')) permitidas.push(`mcp__${e.nombre}`)
  }
  if (autonomia === 'autonomo') {
    // Autónomo = sin nadie que apruebe: terminal y ediciones libres. Los archivos quedan limitados a la carpeta del proyecto y a las
    // de su grupo (`--add-dir`); lo irreversible o que sale de la máquina sin control se bloquea aunque todo lo demás esté permitido.
    permitidas.push('Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit')
    return ['--permission-mode', 'acceptEdits', '--allowedTools', ...permitidas, '--disallowedTools', ...COMANDOS_BLOQUEADOS]
  }
  return ['--permission-mode', autonomia === 'preguntar' ? 'default' : 'acceptEdits', '--allowedTools', ...permitidas]
}

export interface OpcionesEjecucion {
  prompt: string
  cwd: string
  modelo?: string
  /** Sesión del CLI que se continúa. */
  reanudar?: string
  autonomia: ModoAutonomia
  verificaciones: string[]
  sistemaExtra?: string
  carpetasExtra?: string[]
  senal: AbortSignal
  /** Archivo `--mcp-config` con el servidor MCP de tareas de la app (y se permiten sus herramientas según la autonomía). */
  mcpTareas?: string
  /** Servidores MCP externos incluidos en `mcpTareas` (para permitir sus herramientas según la autonomía). */
  mcpExternos?: McpExterno[]
  /** Carpetas de plugins (`--plugin-dir`): la de los agentes y skills activos del proyecto y la de Caveman. */
  pluginDirs?: string[]
  /** Carpeta de configuración de la cuenta con la que se ejecuta (ausente = la principal). */
  carpetaCuenta?: string
  /** Acumulado que el CLI informó en la ejecución anterior de la misma sesión: se resta para anotar solo lo de esta (`diferenciaUso`). */
  acumulado?: Record<string, AcumuladoModelo>
  /** Texto que se antepone al mensaje que recibe el CLI sin cambiar el `prompt` que ve el usuario (p. ej. el resumen de la sesión anterior). */
  prefijoPrompt?: string
  /** Id del mensaje del usuario (se manda al CLI como `uuid`): con él se pueden deshacer los cambios de archivos hasta ese mensaje. */
  mensajeId?: string
  /** El proyecto tiene agentes o skills activos: se ofrecen las herramientas `Agent` y `Skill`. */
  conAgentes?: boolean
  /** Esfuerzo de razonamiento (`--effort`). */
  esfuerzo?: Esfuerzo
  /** Recibe el mando sobre el proceso del CLI en cuanto se lanza (preguntas laterales, interrupciones). */
  alProceso?: (c: ControlProceso) => void
  /** Tope de gasto de esta ejecución (`--max-budget-usd`); sin valor o 0, sin tope. Corta bucles que se descontrolan. */
  presupuestoUsd?: number
  /** No emitir `inicio` (reintento con otra cuenta: el turno ya lo mostró). */
  omitirInicio?: boolean
  /** No emitir `fin`: lo emite quien llama (puede decidir reintentar con otra cuenta). */
  retenerFin?: boolean
  /**
   * Quien responde cuando el CLI pide permiso para una herramienta (o le hace una pregunta al usuario con `AskUserQuestion`).
   * Con él el CLI habla por stdio (`--input-format stream-json --permission-prompt-tool stdio`); sin él, lo no permitido se deniega.
   */
  alPermiso?: (p: PeticionPermiso) => Promise<RespuestaPermiso>
  /** Recibe el consumo real por modelo al terminar (también si falla o se cancela, si el CLI llegó a informarlo). */
  alUso?: (u: UsoPorModelo[]) => void
  /** Recibe los eventos sin `ejecucionId`, `agente` ni `profundidad` (los pone quien llama). */
  alEvento: (e: Record<string, unknown> & { tipo: EventoAgente['tipo'] }) => void
}

/** Petición de permiso del CLI (`control_request` / `can_use_tool`). */
export interface PeticionPermiso {
  herramienta: string
  entrada: Record<string, unknown>
}

export type RespuestaPermiso = { permitir: true; entrada?: Record<string, unknown> } | { permitir: false; mensaje: string }

interface BloqueCli {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface UsoCli {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Consumo de un modelo en una ejecución (`modelUsage` del resultado): incluye los subagentes, que pueden usar otro modelo. */
interface UsoModeloCli {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUSD?: number
  contextWindow?: number
}

/** Consumo real de una ejecución por modelo, tal como lo informa el CLI. */
export interface UsoPorModelo {
  modelo: string
  uso: { tokensEntrada: number; tokensSalida: number }
  cache: number
  costo: number
}

interface MensajeCli {
  type?: string
  request_id?: string
  request?: { subtype?: string; tool_name?: string; input?: Record<string, unknown> }
  subtype?: string
  session_id?: string
  model?: string
  parent_tool_use_id?: string | null
  event?: { type?: string; delta?: { type?: string; text?: string } }
  message?: { content?: BloqueCli[]; usage?: UsoCli; model?: string }
  is_error?: boolean
  result?: unknown
  usage?: UsoCli
  api_error_status?: number | null
  rate_limit_info?: { status?: string; resetsAt?: number; rateLimitType?: string }
  modelUsage?: Record<string, UsoModeloCli>
  /** Respuesta del CLI a una petición de control nuestra. */
  response?: { subtype?: string; request_id?: string; response?: unknown; error?: string }
}

const textoDe = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: BloqueCli) => (b.type === 'text' ? (b.text ?? '') : `[${b.type}]`)).join('\n') : ''

/** Ventana real de cada modelo, aprendida del CLI al usarlo (`modelUsage.contextWindow`): la lista de modelos no la trae. */
const ventanasObservadas = new Map<string, number>()

/** Modelos de la suscripción: se los pide al CLI con la petición de control `initialize` (la usa también el SDK de agentes). */
export async function listarModelosCli(carpeta?: string): Promise<InfoModelo[]> {
  const bin = await rutaClaude()
  if (!bin) return []
  return new Promise((res) => {
    const hijo = spawn(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
      cwd: tmpdir(),
      env: entornoSuscripcion(carpeta),
      stdio: ['pipe', 'pipe', 'ignore'],
      ...(WINDOWS ? { shell: true } : {})
    })
    let hecho = false
    let pendiente = ''
    const terminar = (lista: InfoModelo[]): void => {
      if (hecho) return
      hecho = true
      clearTimeout(timer)
      hijo.kill()
      res(lista)
    }
    const timer = setTimeout(() => terminar([]), 20_000)
    hijo.on('error', () => terminar([]))
    hijo.on('close', () => terminar([]))
    hijo.stdin.on('error', () => undefined)
    hijo.stdout.on('data', (d: Buffer) => {
      pendiente += d.toString('utf8')
      let i: number
      while ((i = pendiente.indexOf('\n')) >= 0) {
        const linea = pendiente.slice(0, i).trim()
        pendiente = pendiente.slice(i + 1)
        if (!linea.includes('"control_response"')) continue
        try {
          const r = JSON.parse(linea) as { response?: { request_id?: string; response?: { models?: { value?: string; resolvedModel?: string; displayName?: string }[] } } }
          if (r.response?.request_id !== 'modelos') continue
          const vistos = new Set<string>()
          const lista: InfoModelo[] = []
          // Los alias («default», «opus»…) resuelven al mismo modelo que su id completo: se deja una sola entrada por id.
          for (const m of (r.response.response?.models ?? []).filter((x) => x.value !== 'default')) {
            const id = m.resolvedModel ?? m.value
            if (!id || vistos.has(id)) continue
            vistos.add(id)
            const ventana = ventanasObservadas.get(id)
            lista.push({ id, nombre: `Claude ${m.displayName || id}`, ...(ventana ? { ventana } : {}) })
          }
          terminar(lista)
        } catch {
          /* línea no válida: se ignora */
        }
      }
    })
    hijo.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'modelos', request: { subtype: 'initialize' } }) + '\n')
  })
}

/** Límite de uso alcanzado: lo que avisa el CLI es la señal fiable; el texto del error es el respaldo. */
export interface LimiteUso {
  /** ms desde epoch en que se renueva, si el CLI lo informó. */
  hasta?: number
}

const TEXTO_LIMITE = /\b(?:usage|rate)[ _-]limit|hit your (?:\w+ )?limit|(?:5-hour|weekly|session) limit|limit reached.{0,6}resets/i

export const esErrorDeLimite = (texto: string): boolean => TEXTO_LIMITE.test(texto) && !/context limit|budget limit/i.test(texto)

export interface SalidaEjecucion {
  sesionCli?: string
  resultado: ResultadoAgente
  limite?: LimiteUso
  herramientas: number
  /** Tokens del contexto en la última llamada (lo que se reenviará en la próxima ejecución de esta sesión). */
  contexto: number
  ventana?: number
  /** Imágenes que entraron al contexto en esta ejecución. */
  imagenes: number
  /** Acumulado que informó el CLI por modelo (para restárselo la próxima vez); ausente si no llegó a informarlo. */
  acumulado?: Record<string, AcumuladoModelo>
}

/**
 * Herramientas propias del CLI que se ofrecen al Asistente. Cada herramienta que el CLI describe pesa en el contexto de TODAS las
 * llamadas: el conjunto por defecto (con Agent, Skill, Task, notebooks, cron, worktrees… y 22 k tokens más «diferidos») deja 24,7 k
 * tokens antes de escribir nada; esta lista, 11,4 k (medido con `get_context_usage`). `Agent` y `Skill` solo si el proyecto tiene
 * agentes o skills activos. `ODESK_HERRAMIENTAS=todas` vuelve al conjunto completo; con una lista separada por comas, usa esa.
 */
export const HERRAMIENTAS_BASE = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'TodoWrite']

export function herramientasCli(conAgentes: boolean, env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const v = env.ODESK_HERRAMIENTAS?.trim()
  if (v === 'todas') return undefined
  if (v) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return conAgentes ? [...HERRAMIENTAS_BASE, 'Agent', 'Skill'] : [...HERRAMIENTAS_BASE]
}

/** Esfuerzo de razonamiento del CLI (`--effort`): menos esfuerzo = menos tokens de pensamiento. */
export const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Esfuerzo = (typeof ESFUERZOS)[number]

/** Lo que fija los argumentos del proceso del CLI (si cambia, hay que lanzar otro). */
export type OpcionesProceso = Pick<
  OpcionesEjecucion,
  'autonomia' | 'verificaciones' | 'cwd' | 'modelo' | 'reanudar' | 'sistemaExtra' | 'carpetasExtra' | 'mcpTareas' | 'mcpExternos' | 'pluginDirs' | 'carpetaCuenta' | 'presupuestoUsd' | 'esfuerzo' | 'conAgentes'
>

/** Argumentos de `claude -p`. Con `entradaPorStream` el CLI habla por stdio (permisos, preguntas y peticiones de control). */
export function argumentosCli(o: OpcionesProceso, entradaPorStream: boolean): string[] {
  const herramientas = herramientasCli(Boolean(o.conAgentes))
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(entradaPorStream ? ['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio'] : []),
    ...(herramientas ? ['--tools', herramientas.join(',')] : []),
    ...sinSubagentesIntegrados(permisosCli(o.autonomia, o.verificaciones, Boolean(o.mcpTareas), o.mcpExternos)),
    // Aislado del `~/.claude` del usuario: sin sus skills, agentes, plugins ni conectores; solo lo del proyecto y lo que pasa la app.
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    // Lo propio de cada equipo (carpeta, git, memoria) va al primer mensaje y no al prompt del sistema: la caché del prefijo se reutiliza.
    '--exclude-dynamic-system-prompt-sections',
    ...(o.presupuestoUsd && o.presupuestoUsd > 0 ? ['--max-budget-usd', String(o.presupuestoUsd)] : []),
    ...(o.esfuerzo ? ['--effort', o.esfuerzo] : []),
    ...(o.mcpTareas ? ['--mcp-config', o.mcpTareas] : []),
    ...(o.pluginDirs ?? []).flatMap((d) => ['--plugin-dir', d]),
    ...(o.modelo ? ['--model', o.modelo] : []),
    ...(o.reanudar ? ['--resume', o.reanudar] : []),
    ...(o.sistemaExtra ? ['--append-system-prompt', o.sistemaExtra] : []),
    ...(o.carpetasExtra?.length ? ['--add-dir', ...o.carpetasExtra] : [])
  ]
}

/** Entorno de una ejecución: el de la suscripción más los puntos de control de archivos (permiten deshacer lo que edite la IA). */
export function entornoEjecucion(carpeta?: string): NodeJS.ProcessEnv {
  const env = entornoSuscripcion(carpeta)
  env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING ??= 'true'
  return env
}

/** Pasos (llamadas al modelo) de una sola ejecución a partir de los cuales se corta: un bucle descontrolado gasta sin parar. */
export const MAX_PASOS_EJECUCION = Number(process.env.ODESK_MAX_PASOS) > 0 ? Number(process.env.ODESK_MAX_PASOS) : 200

/** Canal de peticiones de control (`control_request` / `control_response`) con el CLI: interrumpir, preguntas laterales, uso del contexto… */
export class CanalControl {
  private readonly pendientes = new Map<string, (r: NonNullable<MensajeCli['response']>) => void>()
  private n = 0
  constructor(private readonly escribir: (linea: string) => boolean) {}

  /** `true` si el mensaje era la respuesta a una petición nuestra. */
  recibir(m: MensajeCli): boolean {
    if (m.type !== 'control_response' || !m.response?.request_id) return false
    const r = this.pendientes.get(m.response.request_id)
    if (!r) return false
    this.pendientes.delete(m.response.request_id)
    r(m.response)
    return true
  }

  enviar<T = unknown>(request: Record<string, unknown>, esperaMs = 5000): Promise<T> {
    return new Promise<T>((res, rej) => {
      const id = `odesk-${++this.n}`
      const timer = setTimeout(() => {
        this.pendientes.delete(id)
        rej(new Error('El CLI no respondió a la petición de control'))
      }, esperaMs)
      this.pendientes.set(id, (r) => {
        clearTimeout(timer)
        if (r.subtype === 'error') rej(new Error(String(r.error ?? 'Petición de control rechazada')))
        else res(r.response as T)
      })
      if (!this.escribir(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n')) {
        clearTimeout(timer)
        this.pendientes.delete(id)
        rej(new Error('El CLI ya no está en marcha'))
      }
    })
  }

  /** El proceso terminó: lo pendiente no se va a responder. */
  cerrar(): void {
    for (const r of this.pendientes.values()) r({ subtype: 'error', error: 'El CLI terminó' })
    this.pendientes.clear()
  }
}

/** Mando sobre el proceso del CLI que atiende una ejecución (para preguntas laterales, interrupciones y consultas). */
export interface ControlProceso {
  control<T = unknown>(request: Record<string, unknown>, esperaMs?: number): Promise<T>
  /** Interrumpe el turno en marcha sin matar el proceso. */
  interrumpir(): void
}

/** Lo que necesita un turno para leer el stream del CLI y traducirlo (lo comparten el proceso por turno y el persistente). */
export type EntradaTurno = Pick<
  OpcionesEjecucion,
  'prompt' | 'prefijoPrompt' | 'mensajeId' | 'alPermiso' | 'alEvento' | 'alUso' | 'omitirInicio' | 'retenerFin' | 'acumulado' | 'senal'
>

/** Lee los mensajes stream-json de UN turno (petición → resultado) y los traduce a eventos del Asistente. */
export class LectorTurno {
  private readonly llamadas = new Map<string, { id: string; nombre: string; entrada: Record<string, unknown> }>()
  private sesionCli: string | undefined
  private pasos = 0
  private ultimoTexto = ''
  private ultimoUso: UsoCli = {}
  private modelo: string | undefined
  private ventana: number | undefined
  private limite: LimiteUso | undefined
  private usoModelos: UsoPorModelo[] = []
  private herramientas = 0
  private imagenes = 0
  private acumulado: Record<string, AcumuladoModelo> | undefined
  private final: { error?: string; texto?: string; uso?: UsoCli; esError: boolean } | undefined
  private cortado: string | undefined

  /**
   * @param responder escribe una línea en el stdin del CLI (respuestas a permisos)
   * @param alResultado el CLI informó el resultado del turno
   * @param alExceso demasiados pasos en un solo turno: quien llama interrumpe o mata el proceso
   */
  constructor(
    private readonly o: EntradaTurno,
    private readonly responder: (linea: string) => void,
    private readonly alResultado: () => void,
    private readonly alExceso: () => void = () => undefined
  ) {}

  get listo(): boolean {
    return this.final !== undefined
  }

  iniciar(): void {
    if (!this.o.omitirInicio) this.o.alEvento({ tipo: 'inicio', prompt: this.o.prompt, ...(this.o.mensajeId ? { mensajeId: this.o.mensajeId } : {}) })
  }

  procesar(m: MensajeCli): void {
    if (typeof m.session_id === 'string') this.sesionCli = m.session_id
    const o = this.o
    const propio = m.parent_tool_use_id == null
    switch (m.type) {
      case 'control_request': {
        const r = m.request
        if (!o.alPermiso || r?.subtype !== 'can_use_tool' || !m.request_id) return
        const id = m.request_id
        const entrada = r.input ?? {}
        const responder = (response: Record<string, unknown>): void =>
          this.responder(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } }) + '\n')
        o.alPermiso({ herramienta: r.tool_name ?? '', entrada }).then(
          (d) => responder(d.permitir ? { behavior: 'allow', updatedInput: d.entrada ?? entrada } : { behavior: 'deny', message: d.mensaje }),
          () => responder({ behavior: 'deny', message: 'El usuario no respondió.' })
        )
        return
      }
      case 'system':
        if (m.subtype === 'init' && typeof m.model === 'string') this.modelo = m.model
        return
      case 'rate_limit_event': {
        const i = m.rate_limit_info
        if (i?.status === 'rejected' && propio) this.limite = { ...(typeof i.resetsAt === 'number' && i.resetsAt > 0 ? { hasta: i.resetsAt < 1e12 ? i.resetsAt * 1000 : i.resetsAt } : {}) }
        return
      }
      case 'stream_event': {
        const d = m.event?.delta
        if (propio && m.event?.type === 'content_block_delta' && d?.type === 'text_delta' && d.text) o.alEvento({ tipo: 'texto_delta', texto: String(d.text) })
        return
      }
      case 'assistant': {
        if (!propio) return
        const bloques = m.message?.content ?? []
        if (m.message?.usage) this.ultimoUso = m.message.usage
        if (typeof m.message?.model === 'string') this.modelo = m.message.model
        o.alEvento({ tipo: 'paso', numero: ++this.pasos })
        if (this.pasos === MAX_PASOS_EJECUCION + 1 && !this.cortado) {
          this.cortado = `Se detuvo la ejecución: pasó de ${MAX_PASOS_EJECUCION} pasos en una sola respuesta (posible bucle). Puedes pedirle que continúe.`
          this.alExceso()
        }
        const texto = bloques.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
        if (texto) {
          this.ultimoTexto = texto
          o.alEvento({ tipo: 'texto', texto })
        }
        for (const b of bloques) {
          if (b.type !== 'tool_use' || !b.id) continue
          const llamada = { id: b.id, nombre: b.name ?? 'herramienta', entrada: b.input ?? {} }
          this.llamadas.set(b.id, llamada)
          this.herramientas++
          o.alEvento({ tipo: 'herramienta_inicio', llamada })
        }
        return
      }
      case 'user': {
        if (!propio || !Array.isArray(m.message?.content)) return // (el eco de los mensajes del usuario trae el texto como cadena)
        for (const b of m.message.content) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const llamada = this.llamadas.get(b.tool_use_id)
          // Los valores de las credenciales de prueba llegan al modelo, pero no se guardan en la transcripción (que se sincroniza con la cuenta).
          const texto = llamada?.nombre.endsWith('credenciales_obtener') && !b.is_error ? '[valores de la credencial entregados al asistente]' : textoDe(b.content)
          if (Array.isArray(b.content)) this.imagenes += (b.content as BloqueCli[]).filter((x) => x.type === 'image').length
          if (llamada) o.alEvento({ tipo: 'herramienta_fin', llamada, resultado: { texto, ...(b.is_error ? { error: true } : {}) } })
        }
        return
      }
      case 'result': {
        // El CLI informa la ventana real de cada modelo usado (p. ej. 200000 o 1000000).
        const ventanas = Object.entries(m.modelUsage ?? {}).filter(([, u]) => typeof u.contextWindow === 'number' && u.contextWindow > 0)
        const propia = ventanas.find(([id]) => this.modelo && (id === this.modelo || id.startsWith(this.modelo) || this.modelo.startsWith(id))) ?? ventanas[0]
        if (!this.limite && (m.api_error_status === 429 || (m.is_error === true && typeof m.result === 'string' && esErrorDeLimite(m.result)))) this.limite = {}
        for (const [id, u] of ventanas) ventanasObservadas.set(id, u.contextWindow!)
        // El CLI acumula `modelUsage` en toda la sesión reanudada: se anota solo la diferencia con la ejecución anterior.
        this.acumulado = Object.fromEntries(Object.entries(m.modelUsage ?? {}).map(([id, u]) => [id, aAcumulado(u)]))
        this.usoModelos = Object.entries(this.acumulado).map(([id, a]) => usoPorModelo(id, diferenciaUso(a, o.acumulado?.[id])))
        if (propia) this.ventana = propia[1].contextWindow
        this.final = { esError: m.is_error === true || (typeof m.subtype === 'string' && m.subtype.startsWith('error')), texto: typeof m.result === 'string' ? m.result : '', ...(m.usage ? { uso: m.usage } : {}), ...(typeof m.result === 'string' && m.is_error ? { error: m.result } : {}) }
        this.alResultado()
        return
      }
    }
  }

  /** Cierra el turno (el CLI informó su resultado o el proceso terminó) y arma lo que se devuelve. */
  finalizar(codigo: number | null, errores: string): SalidaEjecucion {
    const o = this.o
    const cancelado = o.senal.aborted
    if (this.usoModelos.length) o.alUso?.(this.usoModelos)
    const contexto = (this.ultimoUso.input_tokens ?? 0) + (this.ultimoUso.cache_read_input_tokens ?? 0) + (this.ultimoUso.cache_creation_input_tokens ?? 0)
    if (contexto > 0) o.alEvento({ tipo: 'uso_contexto', tokens: contexto, ...(this.modelo ? { modelo: this.modelo } : {}), ...(this.ventana ? { ventana: this.ventana } : {}) })

    const uso = this.final?.uso ?? this.ultimoUso
    const fallo = this.cortado ? true : this.final ? this.final.esError : codigo !== 0
    const mensaje = cancelado ? undefined : this.cortado ? this.cortado : fallo ? (this.final?.error || errores.trim() || `El CLI terminó con código ${codigo}`) : undefined
    const resultado: ResultadoAgente = {
      estado: cancelado ? 'cancelado' : fallo ? 'error' : 'completado',
      texto: this.final?.texto || this.ultimoTexto,
      mensajes: [],
      // El total de la ejecución es la suma de lo consumido por todos los modelos (subagentes incluidos); sin eso, la última llamada.
      uso: this.usoModelos.length
        ? { tokensEntrada: this.usoModelos.reduce((t, u) => t + u.uso.tokensEntrada, 0), tokensSalida: this.usoModelos.reduce((t, u) => t + u.uso.tokensSalida, 0) }
        : { tokensEntrada: (uso.input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0) + (uso.cache_creation_input_tokens ?? 0), tokensSalida: uso.output_tokens ?? 0 },
      pasos: this.pasos,
      ...(mensaje ? { error: mensaje } : {})
    }
    if (!o.retenerFin) o.alEvento({ tipo: 'fin', resultado })
    return {
      ...(this.sesionCli ? { sesionCli: this.sesionCli } : {}),
      resultado,
      ...(this.limite && resultado.estado === 'error' ? { limite: this.limite } : {}),
      herramientas: this.herramientas,
      contexto,
      ...(this.ventana ? { ventana: this.ventana } : {}),
      imagenes: this.imagenes,
      ...(this.acumulado ? { acumulado: this.acumulado } : {})
    }
  }
}

/** Parte un flujo de bytes en líneas JSON y entrega cada mensaje (las líneas que no son JSON se ignoran). */
export function lectorDeLineas(alMensaje: (m: MensajeCli) => void): (d: Buffer) => void {
  let pendiente = ''
  return (d) => {
    pendiente += d.toString('utf8')
    let i: number
    while ((i = pendiente.indexOf('\n')) >= 0) {
      const linea = pendiente.slice(0, i).trim()
      pendiente = pendiente.slice(i + 1)
      if (!linea) continue
      try {
        alMensaje(JSON.parse(linea) as MensajeCli)
      } catch {
        /* línea que no es JSON: se ignora */
      }
    }
  }
}

/** Resultado de `rewind_files` del CLI. */
export interface ResultadoRebobinado {
  puede: boolean
  /** Archivos que cambiarían (o cambiaron). */
  archivos: string[]
  error?: string
}

/**
 * Deshace los cambios de archivos que hizo la IA con sus herramientas de edición desde un mensaje del usuario (`rewind_files`): los
 * archivos vuelven a como estaban justo antes de ese mensaje y los creados después se borran. No cubre lo que hizo `Bash`. Con
 * `soloVer` solo informa qué cambiaría. Si hay un proceso vivo de la conversación se usa ese; si no, se reanuda la sesión en uno de
 * un solo uso (sin llamadas al modelo).
 */
export async function rebobinarArchivos(o: { claudeId: string; mensajeId: string; cwd: string; soloVer?: boolean; carpetaCuenta?: string; vivo?: ControlProceso }): Promise<ResultadoRebobinado> {
  const peticion = { subtype: 'rewind_files', user_message_id: o.mensajeId, ...(o.soloVer ? { dry_run: true } : {}) }
  const leer = (r: { canRewind?: boolean; filesChanged?: string[]; error?: string }): ResultadoRebobinado => ({ puede: r.canRewind === true, archivos: r.filesChanged ?? [], ...(r.error ? { error: r.error } : {}) })
  if (o.vivo) return leer(await o.vivo.control<{ canRewind?: boolean; filesChanged?: string[]; error?: string }>(peticion, 30_000))
  const bin = await rutaClaude()
  if (!bin) throw new Error('No encuentro el CLI «claude».')
  const hijo = spawn(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', o.claudeId, '--setting-sources', 'project,local', '--strict-mcp-config'], {
    cwd: o.cwd,
    env: entornoEjecucion(o.carpetaCuenta),
    stdio: ['pipe', 'pipe', 'ignore'],
    ...(WINDOWS ? { shell: true } : {})
  })
  hijo.stdin.on('error', () => undefined)
  const canal = new CanalControl((l) => (hijo.stdin.writable ? (hijo.stdin.write(l), true) : false))
  hijo.stdout.on('data', lectorDeLineas((m) => void canal.recibir(m)))
  const fin = new Promise<void>((res) => hijo.on('close', () => res()))
  try {
    return leer(await canal.enviar<{ canRewind?: boolean; filesChanged?: string[]; error?: string }>(peticion, 60_000))
  } finally {
    hijo.stdin.end()
    setTimeout(() => hijo.kill(), 3000).unref()
    await Promise.race([fin, new Promise((r) => setTimeout(r, 4000).unref())])
  }
}

/** Ejecuta `claude -p` con salida stream-json (un proceso por ejecución) y la traduce a los eventos del Asistente. */
export async function ejecutarSuscripcion(o: OpcionesEjecucion): Promise<SalidaEjecucion> {
  const bin = await rutaClaude()
  if (!bin) throw new Error('No encuentro el CLI «claude».')
  const args = argumentosCli(o, Boolean(o.alPermiso))
  const hijo = spawn(bin, args, { cwd: o.cwd, env: entornoEjecucion(o.carpetaCuenta), stdio: ['pipe', 'pipe', 'pipe'], ...(WINDOWS ? { shell: true } : {}) })
  const abortar = (): void => void hijo.kill()
  o.senal.addEventListener('abort', abortar, { once: true })

  const escribir = (linea: string): boolean => {
    if (!hijo.stdin.writable) return false
    hijo.stdin.write(linea)
    return true
  }
  const canal = new CanalControl(escribir)
  // Con entrada por stream el CLI espera más mensajes tras el resultado: no hay más, se cierra la entrada.
  const lector = new LectorTurno(o, (l) => void escribir(l), () => { if (o.alPermiso) hijo.stdin.end() }, () => hijo.kill())
  o.alProceso?.({ control: (r, t) => canal.enviar(r, t), interrumpir: () => void canal.enviar({ subtype: 'interrupt' }, 2000).catch(() => hijo.kill()) })
  let errores = ''
  lector.iniciar()

  hijo.stdout.on('data', lectorDeLineas((m) => void (canal.recibir(m) || lector.procesar(m))))
  hijo.stderr.on('data', (d: Buffer) => (errores = (errores + d.toString('utf8')).slice(-2000)))

  hijo.stdin.on('error', () => undefined)
  const entradaCli = o.prefijoPrompt ? `${o.prefijoPrompt}\n\n${o.prompt}` : o.prompt
  if (o.alPermiso) hijo.stdin.write(JSON.stringify({ type: 'user', ...(o.mensajeId ? { uuid: o.mensajeId } : {}), message: { role: 'user', content: entradaCli } }) + '\n')
  else hijo.stdin.end(entradaCli)

  const codigo = await new Promise<number | null>((res, rej) => {
    hijo.on('error', rej)
    hijo.on('close', res)
  }).finally(() => o.senal.removeEventListener('abort', abortar))
  canal.cerrar()
  return lector.finalizar(codigo, errores)
}

export async function estadoCuenta(proveedor: ProveedorModelo, claveApi: boolean, cuentas: CuentaSuscripcion[], activaId: string, cambioAutomatico: boolean): Promise<EstadoCuenta> {
  const activa = cuentas.find((c) => c.id === activaId)
  const s: SesionCli = { cli: Boolean(await rutaClaude()), sesion: activa?.sesion ?? false, ...(activa?.email ? { email: activa.email } : {}), ...(activa?.sesion ? { metodo: 'claude.ai' } : {}) }
  if (!s.cli) s.aviso = 'No encuentro el CLI «claude». Instálalo para usar tu suscripción.'
  else if (!s.sesion) s.aviso = activa?.aviso ?? `Inicia sesión con tu cuenta de Claude${activa && !activa.principal ? ` en «${activa.nombre}»` : ''} para usar tu suscripción.`
  return { proveedor, claveApi, cuentas, cuentaActivaId: activaId, cambioAutomatico, cli: s.cli, sesion: s.sesion, ...(s.email ? { email: s.email } : {}), ...(s.metodo ? { metodo: s.metodo } : {}), ...(s.aviso ? { aviso: s.aviso } : {}) }
}
