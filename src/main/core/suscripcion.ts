import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventoAgente, ResultadoAgente } from '@shared/core/agente'
import type { InfoModelo } from '@shared/core/uso'
import { HERRAMIENTAS_ODESK, PREFIJO_MCP } from '@shared/herramientas-odesk'
import type { CuentaSuscripcion, EstadoCuenta, ProveedorModelo } from '@shared/core/cuenta'
import type { ModoAutonomia } from '@shared/core/permisos'

/**
 * Modo «suscripción»: el modelo lo pone el CLI `claude` con la sesión de la cuenta de Claude (la misma que usa VSCode).
 * La app no toca tokens ni OAuth: el inicio de sesión lo hace el propio CLI en el navegador (correo, Google o SSO).
 */

const WINDOWS = process.platform === 'win32'

/** Sin estas variables el CLI usaría la clave de API (y se cobraría por tokens) en vez de la suscripción. */
function entornoSuscripcion(carpeta?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
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

async function correrCli(args: string[], opciones: { timeoutMs?: number; senal?: AbortSignal; carpeta?: string } = {}): Promise<SalidaCli> {
  const bin = await rutaClaude()
  if (!bin) throw new Error('No encuentro el CLI «claude». Instálalo (https://claude.com/claude-code) y vuelve a intentarlo.')
  return new Promise((res, rej) => {
    const hijo = spawn(bin, args, { env: entornoSuscripcion(opciones.carpeta), stdio: ['ignore', 'pipe', 'pipe'], ...(WINDOWS ? { shell: true } : {}) })
    let salida = ''
    let error = ''
    hijo.stdout.on('data', (d: Buffer) => (salida += d))
    hijo.stderr.on('data', (d: Buffer) => (error += d))
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

export function permisosCli(autonomia: ModoAutonomia, verificaciones: string[], conHerramientas = false): string[] {
  const permitidas = [...LECTURA]
  // Herramientas de la app (servidor MCP: tareas, git y GitHub). Consultar siempre; cambiar, como las ediciones de archivos, desde
  // «Aceptar ediciones»; lo que sale de la máquina (enviar, publicar en GitHub) solo en modo «Autónomo»: aquí no hay quien confirme.
  if (conHerramientas) {
    for (const h of HERRAMIENTAS_ODESK) {
      const permitida = h.riesgo === 'lectura' || (h.riesgo === 'escritura' && autonomia !== 'preguntar') || (h.riesgo === 'ejecucion' && autonomia === 'autonomo')
      if (permitida) permitidas.push(PREFIJO_MCP + h.nombre)
    }
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
  /** Carpetas de plugins (`--plugin-dir`): la de los agentes y skills activos del proyecto y la de Caveman. */
  pluginDirs?: string[]
  /** Carpeta de configuración de la cuenta con la que se ejecuta (ausente = la principal). */
  carpetaCuenta?: string
  /** No emitir `inicio` (reintento con otra cuenta: el turno ya lo mostró). */
  omitirInicio?: boolean
  /** No emitir `fin`: lo emite quien llama (puede decidir reintentar con otra cuenta). */
  retenerFin?: boolean
  /** Recibe los eventos sin `ejecucionId`, `agente` ni `profundidad` (los pone quien llama). */
  alEvento: (e: Record<string, unknown> & { tipo: EventoAgente['tipo'] }) => void
}

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

interface MensajeCli {
  type?: string
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
  modelUsage?: Record<string, { contextWindow?: number }>
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

/** Ejecuta `claude -p` con salida stream-json y la traduce a los eventos del Asistente. */
export async function ejecutarSuscripcion(o: OpcionesEjecucion): Promise<{ sesionCli?: string; resultado: ResultadoAgente; limite?: LimiteUso; herramientas: number }> {
  const bin = await rutaClaude()
  if (!bin) throw new Error('No encuentro el CLI «claude».')
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...permisosCli(o.autonomia, o.verificaciones, Boolean(o.mcpTareas)),
    ...(o.mcpTareas ? ['--mcp-config', o.mcpTareas] : []),
    ...(o.pluginDirs ?? []).flatMap((d) => ['--plugin-dir', d]),
    ...(o.modelo ? ['--model', o.modelo] : []),
    ...(o.reanudar ? ['--resume', o.reanudar] : []),
    ...(o.sistemaExtra ? ['--append-system-prompt', o.sistemaExtra] : []),
    ...(o.carpetasExtra?.length ? ['--add-dir', ...o.carpetasExtra] : [])
  ]
  const hijo = spawn(bin, args, { cwd: o.cwd, env: entornoSuscripcion(o.carpetaCuenta), stdio: ['pipe', 'pipe', 'pipe'], ...(WINDOWS ? { shell: true } : {}) })
  const abortar = (): void => void hijo.kill()
  o.senal.addEventListener('abort', abortar, { once: true })

  const llamadas = new Map<string, { id: string; nombre: string; entrada: Record<string, unknown> }>()
  let sesionCli: string | undefined
  let pasos = 0
  let ultimoTexto = ''
  let ultimoUso: UsoCli = {}
  let modelo: string | undefined
  let ventana: number | undefined
  let limite: LimiteUso | undefined
  let herramientas = 0
  let final: { error?: string; texto?: string; uso?: UsoCli; esError: boolean } | undefined
  let errores = ''

  if (!o.omitirInicio) o.alEvento({ tipo: 'inicio', prompt: o.prompt })

  const procesar = (m: MensajeCli): void => {
    if (typeof m.session_id === 'string') sesionCli = m.session_id
    const propio = m.parent_tool_use_id == null
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init' && typeof m.model === 'string') modelo = m.model
        return
      case 'rate_limit_event': {
        const i = m.rate_limit_info
        if (i?.status === 'rejected' && propio) limite = { ...(typeof i.resetsAt === 'number' && i.resetsAt > 0 ? { hasta: i.resetsAt < 1e12 ? i.resetsAt * 1000 : i.resetsAt } : {}) }
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
        if (m.message?.usage) ultimoUso = m.message.usage
        if (typeof m.message?.model === 'string') modelo = m.message.model
        o.alEvento({ tipo: 'paso', numero: ++pasos })
        const texto = bloques.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
        if (texto) {
          ultimoTexto = texto
          o.alEvento({ tipo: 'texto', texto })
        }
        for (const b of bloques) {
          if (b.type !== 'tool_use' || !b.id) continue
          const llamada = { id: b.id, nombre: b.name ?? 'herramienta', entrada: b.input ?? {} }
          llamadas.set(b.id, llamada)
          herramientas++
          o.alEvento({ tipo: 'herramienta_inicio', llamada })
        }
        return
      }
      case 'user': {
        if (!propio) return
        for (const b of m.message?.content ?? []) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const llamada = llamadas.get(b.tool_use_id)
          if (llamada) o.alEvento({ tipo: 'herramienta_fin', llamada, resultado: { texto: textoDe(b.content), ...(b.is_error ? { error: true } : {}) } })
        }
        return
      }
      case 'result': {
        // El CLI informa la ventana real de cada modelo usado (p. ej. 200000 o 1000000).
        const ventanas = Object.entries(m.modelUsage ?? {}).filter(([, u]) => typeof u.contextWindow === 'number' && u.contextWindow > 0)
        const propia = ventanas.find(([id]) => modelo && (id === modelo || id.startsWith(modelo) || modelo.startsWith(id))) ?? ventanas[0]
        if (!limite && (m.api_error_status === 429 || (m.is_error === true && typeof m.result === 'string' && esErrorDeLimite(m.result)))) limite = {}
        for (const [id, u] of ventanas) ventanasObservadas.set(id, u.contextWindow!)
        if (propia) ventana = propia[1].contextWindow
        final = { esError: m.is_error === true || (typeof m.subtype === 'string' && m.subtype.startsWith('error')), texto: typeof m.result === 'string' ? m.result : '', ...(m.usage ? { uso: m.usage } : {}), ...(typeof m.result === 'string' && m.is_error ? { error: m.result } : {}) }
        return
      }
    }
  }

  let pendiente = ''
  hijo.stdout.on('data', (d: Buffer) => {
    pendiente += d.toString('utf8')
    let i: number
    while ((i = pendiente.indexOf('\n')) >= 0) {
      const linea = pendiente.slice(0, i).trim()
      pendiente = pendiente.slice(i + 1)
      if (!linea) continue
      try {
        procesar(JSON.parse(linea) as MensajeCli)
      } catch {
        /* línea que no es JSON: se ignora */
      }
    }
  })
  hijo.stderr.on('data', (d: Buffer) => (errores = (errores + d.toString('utf8')).slice(-2000)))

  hijo.stdin.on('error', () => undefined)
  hijo.stdin.end(o.prompt)

  const codigo = await new Promise<number | null>((res, rej) => {
    hijo.on('error', rej)
    hijo.on('close', res)
  }).finally(() => o.senal.removeEventListener('abort', abortar))

  const cancelado = o.senal.aborted
  const contexto = (ultimoUso.input_tokens ?? 0) + (ultimoUso.cache_read_input_tokens ?? 0) + (ultimoUso.cache_creation_input_tokens ?? 0)
  if (contexto > 0) o.alEvento({ tipo: 'uso_contexto', tokens: contexto, ...(modelo ? { modelo } : {}), ...(ventana ? { ventana } : {}) })

  const uso = final?.uso ?? ultimoUso
  const fallo = final ? final.esError : codigo !== 0
  const mensaje = cancelado ? undefined : fallo ? (final?.error || errores.trim() || `El CLI terminó con código ${codigo}`) : undefined
  const resultado: ResultadoAgente = {
    estado: cancelado ? 'cancelado' : fallo ? 'error' : 'completado',
    texto: final?.texto || ultimoTexto,
    mensajes: [],
    uso: { tokensEntrada: (uso.input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0) + (uso.cache_creation_input_tokens ?? 0), tokensSalida: uso.output_tokens ?? 0 },
    pasos,
    ...(mensaje ? { error: mensaje } : {})
  }
  if (!o.retenerFin) o.alEvento({ tipo: 'fin', resultado })
  return { ...(sesionCli ? { sesionCli } : {}), resultado, ...(limite && resultado.estado === 'error' ? { limite } : {}), herramientas }
}

export async function estadoCuenta(proveedor: ProveedorModelo, claveApi: boolean, cuentas: CuentaSuscripcion[], activaId: string, cambioAutomatico: boolean): Promise<EstadoCuenta> {
  const activa = cuentas.find((c) => c.id === activaId)
  const s: SesionCli = { cli: Boolean(await rutaClaude()), sesion: activa?.sesion ?? false, ...(activa?.email ? { email: activa.email } : {}), ...(activa?.sesion ? { metodo: 'claude.ai' } : {}) }
  if (!s.cli) s.aviso = 'No encuentro el CLI «claude». Instálalo para usar tu suscripción.'
  else if (!s.sesion) s.aviso = activa?.aviso ?? `Inicia sesión con tu cuenta de Claude${activa && !activa.principal ? ` en «${activa.nombre}»` : ''} para usar tu suscripción.`
  return { proveedor, claveApi, cuentas, cuentaActivaId: activaId, cambioAutomatico, cli: s.cli, sesion: s.sesion, ...(s.email ? { email: s.email } : {}), ...(s.metodo ? { metodo: s.metodo } : {}), ...(s.aviso ? { aviso: s.aviso } : {}) }
}
