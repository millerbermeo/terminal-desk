/**
 * Modo «Autónomo» del Asistente (suscripción): nadie confirma los comandos, así que se aprueban solos SALVO lo catastrófico o
 * irreversible fuera del proyecto. Las reglas de prefijo del CLI (`Bash(git push --force:*)`) no bastan: cambiar el orden de los
 * argumentos (`git push origin main --force`), encadenar (`cd x && sudo …`) o envolver (`bash -c "…"`) las saltaba.
 * Aquí se analiza la línea entera: cada tramo de una cadena, lo que va dentro de `bash -c`/`eval`, y las opciones en cualquier orden.
 */

/** Separa en palabras respetando comillas simples y dobles (suficiente para decidir; no es un intérprete de shell). */
function palabras(tramo: string): string[] {
  const r: string[] = []
  let actual = ''
  let comilla: '"' | "'" | null = null
  let hay = false
  for (let i = 0; i < tramo.length; i++) {
    const c = tramo[i]!
    if (comilla) {
      if (c === comilla) comilla = null
      else if (c === '\\' && comilla === '"' && i + 1 < tramo.length) actual += tramo[++i]
      else actual += c
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      hay = true
    } else if (/\s/.test(c)) {
      if (hay || actual) r.push(actual)
      actual = ''
      hay = false
    } else {
      actual += c
      hay = true
    }
  }
  if (hay || actual) r.push(actual)
  return r
}

/** Tramos de una línea: `a && b || c; d | e`, subshells `$( … )` y `( … )`, y saltos de línea. */
function tramos(linea: string): string[] {
  const fuera: string[] = []
  let actual = ''
  let comilla: '"' | "'" | null = null
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!
    if (comilla) {
      if (c === comilla) comilla = null
      actual += c
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      actual += c
      continue
    }
    const dos = linea.slice(i, i + 2)
    if (dos === '${') {
      // `${VAR}` es una variable, no un bloque
      const fin = linea.indexOf('}', i)
      const hasta = fin < 0 ? linea.length : fin + 1
      actual += linea.slice(i, hasta)
      i = hasta - 1
      continue
    }
    if (dos === '&&' || dos === '||' || dos === '$(') {
      fuera.push(actual)
      actual = ''
      i++
      continue
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')' || c === '`' || c === '{' || c === '}') {
      fuera.push(actual)
      actual = ''
      continue
    }
    actual += c
  }
  fuera.push(actual)
  return fuera.map((t) => t.trim()).filter(Boolean)
}

const ENVOLTORIOS = new Set(['env', 'nohup', 'time', 'nice', 'ionice', 'timeout', 'command', 'builtin', 'exec', 'xargs', 'stdbuf', 'unbuffer'])
const PRIVILEGIOS = new Set(['sudo', 'su', 'doas', 'pkexec', 'run0'])
const APAGAR = new Set(['shutdown', 'reboot', 'poweroff', 'halt'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])

/** Quita asignaciones (`FOO=1 cmd`) y envoltorios (`env`, `nohup`, `timeout 5`…) para llegar al programa de verdad. */
function programa(p: string[]): string[] {
  let i = 0
  for (;;) {
    while (i < p.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p[i]!)) i++
    const nombre = (p[i] ?? '').split('/').pop() ?? ''
    if (!ENVOLTORIOS.has(nombre)) break
    i++
    // opciones y argumentos del envoltorio (`timeout 10`, `nice -n 5`, `env -i`)
    while (i < p.length && (/^-/.test(p[i]!) || /^\d+[smhd]?$/.test(p[i]!))) i++
  }
  return p.slice(i)
}

/** Destino de un borrado que no es del proyecto: la raíz, el HOME o una carpeta del sistema de primer nivel. */
function destinoCatastrofico(arg: string): boolean {
  const a = arg.replace(/\/+$/, '') || '/'
  if (/^(~|\$HOME|\$\{HOME\})(\/\*?)?$/.test(arg) || a === '~' || a === '$HOME' || a === '${HOME}') return true
  if (a === '/' || a === '/*' || arg === '/*' || /^\/\.\.?$/.test(a)) return true
  if (/^\/[^/]+\/?\*?$/.test(arg)) return true // /usr, /etc, /home, /var/* …
  if (/^\.\.(\/\.\.)*\/?$/.test(arg)) return true // fuera del proyecto hacia arriba
  return false
}

function motivoDe(p: string[], profundidad: number): string | null {
  const q = programa(p)
  const nombre = (q[0] ?? '').split('/').pop() ?? ''
  const args = q.slice(1)
  if (!nombre) return null
  if (PRIVILEGIOS.has(nombre)) return 'se ejecuta con privilegios de administrador (sudo/su)'
  if (APAGAR.has(nombre) || (nombre === 'init' && /^[06]$/.test(args[0] ?? '')) || (nombre === 'systemctl' && /^(poweroff|reboot|halt)$/.test(args[0] ?? ''))) return 'apaga o reinicia el equipo'
  if (/^mkfs(\.|$)/.test(nombre) || nombre === 'fdisk' || nombre === 'parted' || nombre === 'wipefs') return 'formatea o reparticiona un disco'
  if (nombre === 'dd' && args.some((a) => /^of=\/dev\//.test(a))) return 'escribe directamente sobre un dispositivo'
  if (nombre === 'rm' || nombre === 'rmdir' || nombre === 'shred') {
    const opciones = args.filter((a) => a.startsWith('-')).join(' ')
    const recursivo = /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(opciones) || nombre === 'shred'
    if (recursivo && args.filter((a) => !a.startsWith('-')).some(destinoCatastrofico)) return 'borra la raíz, el HOME o una carpeta del sistema'
    if (args.includes('--no-preserve-root')) return 'borra sin proteger la raíz'
  }
  if ((nombre === 'chmod' || nombre === 'chown') && args.some((a) => /^-[a-zA-Z]*R/.test(a) || a === '--recursive') && args.some((a) => !a.startsWith('-') && destinoCatastrofico(a)))
    return 'cambia permisos de todo el sistema o del HOME'
  if (nombre === 'git') {
    // Opciones globales con valor (`git -C dir push`, `git -c k=v push`): su valor no es el subcomando.
    let sub = 0
    while (sub < args.length && args[sub]!.startsWith('-')) sub += /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path)$/.test(args[sub]!) ? 2 : 1
    if (args[sub] === 'push') {
      const resto = args.slice(sub + 1)
      if (resto.some((a) => a === '--force' || a === '-f' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || a === '--mirror' || (a.startsWith('+') && a.length > 1)))
        return 'reescribe el historial del remoto (push forzado)'
    }
  }
  if ((SHELLS.has(nombre) || nombre === 'eval') && profundidad < 3) {
    const i = args.indexOf('-c')
    const codigo = nombre === 'eval' ? args.join(' ') : i >= 0 ? args[i + 1] : undefined
    if (codigo) return motivoBloqueoAutonomo(codigo, profundidad + 1)
  }
  return null
}

/** Motivo por el que un comando NO se ejecuta solo en modo autónomo (null = se aprueba). */
export function motivoBloqueoAutonomo(linea: string, profundidad = 0): string | null {
  const texto = String(linea ?? '')
  if (/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/.test(texto)) return 'bomba de procesos'
  // Descargar y ejecutar a ciegas: `curl … | sh`, `wget -O- … | bash`.
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(texto)) return 'descarga y ejecuta código de internet sin revisarlo'
  if (/>\s*\/dev\/(sd|nvme|hd|mmcblk|disk)/.test(texto)) return 'escribe directamente sobre un disco'
  for (const t of tramos(texto)) {
    const m = motivoDe(palabras(t), profundidad)
    if (m) return m
  }
  return null
}

/**
 * Gancho `PreToolUse` de Bash para las terminales ✦ que trabajan sin confirmar (grupos: `--allowedTools Bash`). Allí no hay canal de
 * permisos con la app, así que el propio Claude Code pregunta al gancho. Solo actúa con `ODESK_GUARDIA_AUTONOMA=1` (lo pone la app
 * en esas terminales): si la persona está aprobando cada comando, no se le bloquea nada. Devuelve el JSON de respuesta o nada.
 */
export function respuestaGanchoBash(entrada: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.ODESK_GUARDIA_AUTONOMA !== '1') return undefined
  let j: { tool_name?: unknown; tool_input?: { command?: unknown } }
  try {
    j = JSON.parse(entrada) as typeof j
  } catch {
    return undefined
  }
  if (j.tool_name !== 'Bash' || typeof j.tool_input?.command !== 'string') return undefined
  const motivo = motivoBloqueoAutonomo(j.tool_input.command)
  if (!motivo) return undefined
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Odesk lo bloquea en modo sin confirmación: ${motivo}. Si de verdad hace falta, explica al usuario qué comando debe ejecutar él.`
    }
  })
}
