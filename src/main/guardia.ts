import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DIR } from './proyectos'

/**
 * Plugin de Claude Code «guardia de consumo»: un gancho `PreToolUse` sobre `Read` que acota lo que más infla el contexto sin que
 * se note, las imágenes. Cada captura que lee la IA se queda en el contexto y se reenvía en TODAS las llamadas siguientes: una
 * sesión de pruebas en el teléfono acumuló 147 capturas (79 MB, ~350 k tokens por llamada). El gancho:
 *  - reduce las capturas grandes (ImageMagick, ffmpeg, sips o Python+Pillow, lo que haya) antes de que entren;
 *  - limita las capturas por sesión y, pasado el tope, explica cómo seguir con texto (volcado de la UI, logs…).
 * Vive en `sesiones/` (compartida entre cuentas, plugins derivados e inmutables por contenido). Sin `node` en el PATH no hace nada.
 */

/** Script del gancho (CommonJS, sin dependencias). Lee el evento por stdin y contesta con JSON. Un fallo nunca bloquea la lectura. */
export const SCRIPT_IMAGENES = String.raw`'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')

const MAX_IMAGENES = Number(process.env.ODESK_MAX_IMAGENES) || 25
const LADO = Number(process.env.ODESK_IMAGEN_LADO) || 1280
const GRANDE = 120 * 1024
const DURO = 2 * 1024 * 1024
const ES_IMAGEN = /\.(png|jpe?g|webp|gif|bmp)$/i

const PY = [
  'import sys',
  'from PIL import Image',
  'im = Image.open(sys.argv[1])',
  'im.thumbnail((int(sys.argv[3]), int(sys.argv[3])))',
  "im.convert('RGB').save(sys.argv[2], 'JPEG', quality=70)"
].join('\n')

function responder(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj))
  process.exit(0)
}

function decidir(decision, motivo, extra) {
  responder({ hookSpecificOutput: Object.assign({ hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: motivo }, extra || {}) })
}

function reducir(origen, destino) {
  const l = String(LADO)
  const intentos = [
    ['magick', [origen + '[0]', '-resize', l + 'x' + l + '>', '-quality', '70', destino]],
    ['convert', [origen + '[0]', '-resize', l + 'x' + l + '>', '-quality', '70', destino]],
    ['ffmpeg', ['-v', 'error', '-y', '-i', origen, '-vf', "scale='min(" + l + ",iw)':-2", '-frames:v', '1', '-q:v', '5', destino]],
    ['sips', ['-Z', l, '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', origen, '--out', destino]],
    ['python3', ['-c', PY, origen, destino, l]],
    ['python', ['-c', PY, origen, destino, l]]
  ]
  const tamanoOrigen = fs.statSync(origen).size
  for (const [cmd, args] of intentos) {
    try {
      const r = cp.spawnSync(cmd, args, { timeout: 10000, stdio: 'ignore', windowsHide: true })
      if (r.status === 0 && fs.existsSync(destino) && fs.statSync(destino).size > 0 && fs.statSync(destino).size < tamanoOrigen) return true
    } catch (e) {
      /* herramienta no disponible: se prueba la siguiente */
    }
  }
  return false
}

function principal(ev) {
  if (ev.tool_name !== 'Read') return responder()
  const entrada = ev.tool_input || {}
  if (typeof entrada.file_path !== 'string' || !ES_IMAGEN.test(entrada.file_path)) return responder()
  const origen = path.resolve(ev.cwd || process.cwd(), entrada.file_path)
  let tamano
  try {
    tamano = fs.statSync(origen).size
  } catch (e) {
    return responder() // no existe: que Read dé su propio error
  }

  const dir = path.join(os.tmpdir(), 'odesk-guardia')
  fs.mkdirSync(dir, { recursive: true })
  try {
    // Las reducciones y contadores de más de un día no sirven a nadie.
    for (const f of fs.readdirSync(dir).slice(0, 500)) {
      const p = path.join(dir, f)
      if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.unlinkSync(p)
    }
  } catch (e) {
    /* limpieza best-effort */
  }
  const sesion = String(ev.session_id || 'sin-sesion').replace(/[^\w-]/g, '_')
  const contador = path.join(dir, sesion + '.json')
  let n = 0
  try {
    n = JSON.parse(fs.readFileSync(contador, 'utf8')).n || 0
  } catch (e) {
    /* primera imagen de la sesión */
  }
  if (n >= MAX_IMAGENES) {
    return decidir(
      'deny',
      'Odesk: límite de ' + MAX_IMAGENES + ' imágenes por sesión. Cada imagen leída se queda en el contexto y se reenvía en todas las llamadas, y multiplica el consumo de tokens. ' +
        'Sigue con texto: volcado de la interfaz (p. ej. adb shell uiautomator dump), logs, o el árbol de accesibilidad / DOM. Si de verdad necesitas otra captura, pide al usuario abrir una conversación nueva.'
    )
  }

  let destino = origen
  if (tamano > GRANDE) {
    const reducida = path.join(dir, sesion + '-' + (n + 1) + '-' + Date.now() + '.jpg')
    if (reducir(origen, reducida)) destino = reducida
    else if (tamano > DURO) {
      return decidir('deny', 'Odesk: la imagen pesa ' + Math.round(tamano / 1024) + ' KB y no hay herramienta para reducirla (ImageMagick, ffmpeg, sips o Python con Pillow). Redúcela a ' + LADO + ' px de lado mayor y vuelve a leerla, o describe lo que necesitas con texto.')
    }
  }
  fs.writeFileSync(contador, JSON.stringify({ n: n + 1 }))
  if (destino === origen) return responder()
  return decidir('allow', 'Odesk redujo la imagen (' + Math.round(tamano / 1024) + ' KB) para gastar menos contexto.', { updatedInput: Object.assign({}, entrada, { file_path: destino }) })
}

let crudo = ''
process.stdin.on('data', (d) => (crudo += d))
process.stdin.on('end', () => {
  try {
    principal(JSON.parse(crudo))
  } catch (e) {
    responder() // ante cualquier fallo, no se interfiere
  }
})
`

const COMANDO = 'command -v node >/dev/null 2>&1 || exit 0; HOOK_ROOT=$(printf %s "${CLAUDE_PLUGIN_ROOT}" | sed \'s|^/\\([a-zA-Z]\\)/|\\1:/|\'); node "$HOOK_ROOT/hooks/imagenes.cjs"'

/** Archivos del plugin (ruta relativa -> contenido). Exportado para probarlo. */
export function archivosGuardia(): Record<string, string> {
  return {
    '.claude-plugin/plugin.json':
      JSON.stringify({ name: 'odesk-guardia', version: '1.0.0', description: 'Acota las imágenes que entran al contexto (menos tokens por llamada)', author: { name: 'Odesk Agent' } }, null, 2) + '\n',
    'hooks/hooks.json':
      JSON.stringify(
        { description: 'Guardia de consumo de Odesk Agent', hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: COMANDO, timeout: 20 }] }] } },
        null,
        2
      ) + '\n',
    'hooks/imagenes.cjs': SCRIPT_IMAGENES
  }
}

/** Carpeta del plugin (la crea si hace falta, inmutable por contenido). `ODESK_SIN_GUARDIA=1` lo apaga. Nunca lanza. */
export async function pluginGuardia(base: string = join(DIR, 'sesiones')): Promise<string | undefined> {
  if (process.env.ODESK_SIN_GUARDIA === '1') return undefined
  try {
    const archivos = archivosGuardia()
    const hash = createHash('sha1').update(JSON.stringify(archivos)).digest('hex').slice(0, 10)
    const dir = join(base, `guardia-${hash}`)
    try {
      await stat(join(dir, '.claude-plugin', 'plugin.json'))
      return dir
    } catch {
      /* hay que generarlo */
    }
    const tmp = `${dir}.tmp-${process.pid}-${randomUUID().slice(0, 6)}`
    for (const [ruta, texto] of Object.entries(archivos)) {
      const destino = join(tmp, ruta)
      await mkdir(join(destino, '..'), { recursive: true })
      await writeFile(destino, texto, 'utf8')
    }
    try {
      await rename(tmp, dir)
    } catch {
      await rm(tmp, { recursive: true, force: true }) // otro proceso lo creó a la vez: vale el suyo
    }
    return dir
  } catch (err) {
    console.error('No se pudo preparar la guardia de consumo:', err)
    return undefined
  }
}
