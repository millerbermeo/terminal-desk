import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificarPassword, type ResultadoAuth } from '../../autenticacion'

/**
 * Comandos con `sudo` del Asistente. El CLI ejecuta `Bash` sin terminal, así que `sudo` no puede preguntar la contraseña: la app
 * la pide en un modal, la verifica (`sudo -S -k -v`) y reescribe el comando a `sudo -A` con un `SUDO_ASKPASS` propio. Ese ayudante
 * la recoge por un socket local (carpeta 0700) con un token de un solo comando que caduca: la contraseña nunca va en el comando,
 * ni en el entorno, ni en disco, ni en la conversación.
 */

const TTL_VERIFICADA = 2 * 60_000 // del modal a la respuesta del CLI
const TTL_TOKEN = 10 * 60_000 // lo que puede tardar el comando (un `apt install` largo pide la contraseña al principio)

/** `sudo` como programa (al inicio, tras `;`, `&&`, `|`, `(`, `$(` o un envoltorio con espacio), no dentro de otra palabra. */
const SUDO = /(^|[\s;&|(`])sudo(?=\s|$)/g

export const usaSudo = (linea: string): boolean => new RegExp(SUDO.source).test(linea)

/** El comando sin `sudo` ni sus opciones: lo que de verdad se ejecuta (para los guardrails). */
export const sinSudo = (linea: string): string =>
  linea.replace(/(^|[\s;&|(`])sudo((\s+-[ugpCDhrtTU](\s*(?!-)\S+))|(\s+--?[A-Za-z][\w-]*(=\S+)?))*(?=\s|$)/g, '$1').replace(/\s{2,}/g, ' ').trim()

const citar = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** `sudo` -> `sudo -A`, con el ayudante y el token exportados delante (sirven a todos los `sudo` del comando compuesto). */
export function reescribirSudo(linea: string, askpass: string, token: string): string {
  return `export SUDO_ASKPASS=${citar(askpass)} ODESK_SUDO_TOKEN=${citar(token)}; ${linea.replace(SUDO, '$1sudo -A')}`
}

// --- Contraseñas que el usuario acaba de escribir en el modal (por solicitud) ---

const esperando = new Set<string>()
const verificadas = new Map<string, { password: string; expira: number }>()

export function registrarSolicitudSudo(solicitudId: string): void {
  esperando.add(solicitudId)
}

/** La solicitud terminó (aprobada, rechazada o cancelada): se olvida todo lo suyo. */
export function olvidarSolicitudSudo(solicitudId: string): void {
  esperando.delete(solicitudId)
  verificadas.delete(solicitudId)
}

export type ResultadoSudo = ResultadoAuth | { ok: false; motivo: 'expirada' }

/** Lo llama el modal: verifica la contraseña y, si vale, la deja lista para esa solicitud. */
export async function verificarSudo(solicitudId: string, password: string): Promise<ResultadoSudo> {
  if (!esperando.has(solicitudId)) return { ok: false, motivo: 'expirada' }
  if (typeof password !== 'string' || !password || password.length > 1024) return { ok: false, motivo: 'incorrecta' }
  const r = await verificarPassword(password)
  if (r.ok && esperando.has(solicitudId)) verificadas.set(solicitudId, { password, expira: Date.now() + TTL_VERIFICADA })
  return r
}

/** Entrega (una sola vez) la contraseña verificada de la solicitud. */
export function tomarPasswordSudo(solicitudId: string): string | undefined {
  const v = verificadas.get(solicitudId)
  olvidarSolicitudSudo(solicitudId)
  return v && v.expira > Date.now() ? v.password : undefined
}

// --- Ayudante SUDO_ASKPASS + socket local ---

const AYUDANTE_JS = String.raw`'use strict'
const net = require('net')
const fin = (c) => process.exit(c)
setTimeout(() => fin(1), 10000)
const s = net.connect(process.env.ODESK_SUDO_SOCKET)
let r = ''
s.on('connect', () => s.write((process.env.ODESK_SUDO_TOKEN || '') + '\n'))
s.on('data', (d) => (r += d))
s.on('end', () => {
  if (!r) return fin(1)
  process.stdout.write(r + '\n', () => fin(0))
})
s.on('error', () => fin(1))
`

interface Askpass {
  servidor: Server
  dir: string
  script: string
}

const tokens = new Map<string, { password: string; expira: number }>()
let askpass: Promise<Askpass> | undefined

function iniciarAskpass(): Promise<Askpass> {
  askpass ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'odesk-sudo-')) // 0700: solo este usuario llega al socket
    const socket = join(dir, 's.sock')
    const js = join(dir, 'askpass.cjs')
    const script = join(dir, 'askpass.sh')
    await writeFile(js, AYUDANTE_JS, { mode: 0o600 })
    await writeFile(script, `#!/bin/sh\nODESK_SUDO_SOCKET=${citar(socket)} ELECTRON_RUN_AS_NODE=1 exec ${citar(process.execPath)} ${citar(js)}\n`, { mode: 0o700 })
    await chmod(script, 0o700)
    const servidor = createServer((c) => {
      let buf = ''
      c.setTimeout(5000, () => c.destroy())
      c.on('error', () => undefined)
      c.on('data', (d) => {
        buf += d.toString()
        if (buf.length > 256) return c.destroy()
        const n = buf.indexOf('\n')
        if (n < 0) return
        const t = tokens.get(buf.slice(0, n))
        if (t && t.expira > Date.now()) c.end(t.password)
        else c.end()
      })
    })
    await new Promise<void>((res, rej) => {
      servidor.once('error', rej)
      servidor.listen(socket, () => res())
    })
    servidor.unref()
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }))
    return { servidor, dir, script }
  })().catch((e) => {
    askpass = undefined
    throw e
  })
  return askpass
}

/** Deja la contraseña disponible para el ayudante durante un comando. Se olvida al caducar o al cancelar la ejecución. */
export async function armarSudo(password: string, senal?: AbortSignal): Promise<{ askpass: string; token: string }> {
  const { script } = await iniciarAskpass()
  const token = randomBytes(24).toString('hex')
  tokens.set(token, { password, expira: Date.now() + TTL_TOKEN })
  const quitar = (): void => void tokens.delete(token)
  setTimeout(quitar, TTL_TOKEN).unref()
  senal?.addEventListener('abort', quitar, { once: true })
  return { askpass: script, token }
}
