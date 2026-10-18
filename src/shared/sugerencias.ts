/** Lógica pura de las sugerencias de historial de la terminal (la comparten el proceso principal y la interfaz). */

export const MAX_COMANDO = 500

/** ¿El texto que hay antes del cursor termina en el indicador de un prompt de shell (`$`, `#`, `%`, `>`, `❯`, `➜`, `»` y un espacio)? */
export function terminaEnPrompt(antesDelCursor: string): boolean {
  return /[$#%>❯➜»]\s$/.test(antesDelCursor)
}

const SECRETO = /(pass(?:word|wd)?|passphrase|token|secret|api[_-]?key|auth(?:orization)?|bearer|credential)s?\s*[=:]|--?(?:password|passwd|pwd)\b|:\/\/[^\s/@:]+:[^\s/@]+@/i

/**
 * ¿Se puede guardar este comando como sugerencia? No se guardan los que empiezan por espacio (convención de `HISTCONTROL=ignorespace`),
 * los de varias líneas, los demasiado largos ni los que llevan contraseñas, tokens o claves a la vista.
 */
export function comandoRegistrable(comando: string): boolean {
  if (!comando || comando.length > MAX_COMANDO) return false
  if (/^\s/.test(comando) || /[\r\n]/.test(comando)) return false
  if (!comando.trim()) return false
  return !SECRETO.test(comando)
}

/** El comando más reciente (la lista va de más nuevo a más viejo) que empieza por `texto` y lo alarga. */
export function buscarSugerencia(historial: readonly string[], texto: string): string | undefined {
  if (!texto || /^\s/.test(texto)) return undefined
  for (const c of historial) if (c.length > texto.length && c.startsWith(texto)) return c
  return undefined
}

/** Primera palabra del trozo que falta (con los espacios que la rodean): lo que acepta Ctrl+→. */
export function primeraPalabra(sufijo: string): string {
  return /^\s*\S+\s*/.exec(sufijo)?.[0] ?? sufijo
}

/** Quita los duplicados conservando la primera aparición (la lista va de más nuevo a más viejo). */
export function sinRepetidos(comandos: readonly string[], max = Infinity): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const c of comandos) {
    if (vistos.has(c)) continue
    vistos.add(c)
    salida.push(c)
    if (salida.length >= max) break
  }
  return salida
}

/**
 * Comandos de un archivo de historial de bash (uno por línea, con marcas `#<fecha>` opcionales), zsh (`: <fecha>:0;comando`) o fish
 * (`- cmd: comando`), del más viejo al más nuevo. Los de varias líneas se descartan.
 */
export function analizarHistorialShell(contenido: string): string[] {
  const salida: string[] = []
  let continuacion = false
  for (const cruda of contenido.split('\n')) {
    let linea = cruda.replace(/\r$/, '')
    if (continuacion) {
      continuacion = linea.endsWith('\\')
      continue
    }
    const zsh = /^: \d+:\d+;(.*)$/.exec(linea)
    const fish = /^- cmd: (.*)$/.exec(linea)
    if (zsh) linea = zsh[1]!
    else if (fish) linea = fish[1]!
    else if (/^#\d+$/.test(linea) || /^\s+(when|paths):/.test(linea) || /^\s+- /.test(linea)) continue
    if (linea.endsWith('\\')) {
      continuacion = true
      continue
    }
    if (comandoRegistrable(linea)) salida.push(linea)
  }
  return salida
}

/**
 * Lo que el usuario lleva escrito en la línea del prompt, leído de la pantalla: de `inicioPrompt` al cursor, solo si el cursor está
 * al final de la línea (lo que queda a su derecha está vacío). `undefined` si no se puede asegurar.
 */
export function escritoEnLinea(linea: { antesDelCursor: string; despuesDelCursor: string }, columnasPrompt: number): string | undefined {
  if (linea.despuesDelCursor.trim() !== '') return undefined
  if (linea.antesDelCursor.length < columnasPrompt) return undefined
  return linea.antesDelCursor.slice(columnasPrompt)
}
