/**
 * Markdown de las respuestas del Asistente → árbol de datos (sin HTML: la vista lo pinta con elementos de React, así nada de lo que
 * escriba el modelo se interpreta como marcado). Cubre lo que usan los modelos: bloques de código, títulos, listas (con sangría),
 * citas, tablas, reglas, y en línea código, negrita, cursiva, tachado y enlaces.
 */

export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'codigo'; v: string }
  | { t: 'negrita' | 'cursiva' | 'tachado'; hijos: Inline[] }
  | { t: 'enlace'; url: string; hijos: Inline[] }

export interface ItemLista {
  texto: string
  nivel: number
  /** `- [ ]` / `- [x]`: casilla de una lista de tareas. */
  marcado?: boolean
}

export type Bloque =
  | { t: 'codigo'; lenguaje: string; codigo: string }
  | { t: 'titulo'; nivel: number; texto: string }
  | { t: 'parrafo'; texto: string }
  | { t: 'lista'; ordenada: boolean; inicio: number; items: ItemLista[] }
  | { t: 'cita'; texto: string }
  | { t: 'regla' }
  | { t: 'tabla'; cabecera: string[]; alineacion: ('izq' | 'centro' | 'der' | undefined)[]; filas: string[][] }

const VALLA = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/
const TITULO = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/
const REGLA = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const SEPARADOR_TABLA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const celdas = (linea: string): string[] => {
  const s = linea.trim().replace(/^\|/, '').replace(/\|$/, '')
  // `\|` dentro de una celda es una barra literal
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

export function parsearMarkdown(md: string): Bloque[] {
  const lineas = md.replace(/\r\n?/g, '\n').split('\n')
  const bloques: Bloque[] = []
  let parrafo: string[] = []
  const cerrarParrafo = (): void => {
    if (parrafo.length) bloques.push({ t: 'parrafo', texto: parrafo.join('\n') })
    parrafo = []
  }

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!
    const valla = VALLA.exec(l)
    if (valla) {
      cerrarParrafo()
      const marca = valla[1]!
      const codigo: string[] = []
      i++
      // Sin cierre (respuesta cortada): el resto es código.
      while (i < lineas.length && !new RegExp(`^ {0,3}${marca[0] === '`' ? '`' : '~'}{${marca.length},}\\s*$`).test(lineas[i]!)) codigo.push(lineas[i++]!)
      bloques.push({ t: 'codigo', lenguaje: (valla[2] ?? '').toLowerCase(), codigo: codigo.join('\n') })
      continue
    }
    if (!l.trim()) {
      cerrarParrafo()
      continue
    }
    const titulo = TITULO.exec(l)
    if (titulo) {
      cerrarParrafo()
      bloques.push({ t: 'titulo', nivel: titulo[1]!.length, texto: titulo[2]! })
      continue
    }
    if (REGLA.test(l) && !parrafo.length) {
      bloques.push({ t: 'regla' })
      continue
    }
    if (/^ {0,3}>/.test(l)) {
      cerrarParrafo()
      const cita: string[] = []
      while (i < lineas.length && /^ {0,3}>/.test(lineas[i]!)) cita.push(lineas[i++]!.replace(/^ {0,3}> ?/, ''))
      i--
      bloques.push({ t: 'cita', texto: cita.join('\n') })
      continue
    }
    if (l.includes('|') && i + 1 < lineas.length && SEPARADOR_TABLA.test(lineas[i + 1]!) && lineas[i + 1]!.includes('-')) {
      cerrarParrafo()
      const cabecera = celdas(l)
      const alineacion = celdas(lineas[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'centro' : c.endsWith(':') ? 'der' : c.startsWith(':') ? 'izq' : undefined))
      const filas: string[][] = []
      i += 2
      while (i < lineas.length && lineas[i]!.includes('|') && lineas[i]!.trim()) filas.push(celdas(lineas[i++]!))
      i--
      bloques.push({ t: 'tabla', cabecera, alineacion, filas })
      continue
    }
    const item = ITEM.exec(l)
    if (item && !parrafo.length) {
      const ordenada = item[3] !== undefined
      const lista: Extract<Bloque, { t: 'lista' }> = { t: 'lista', ordenada, inicio: ordenada ? Number(item[3]) : 1, items: [] }
      const base = item[1]!.length
      while (i < lineas.length) {
        const m = ITEM.exec(lineas[i]!)
        if (m) {
          const nivel = Math.min(4, Math.max(0, Math.floor((m[1]!.length - base) / 2)))
          const tarea = /^\[([ xX])\]\s+(.*)$/.exec(m[4]!)
          lista.items.push({ texto: tarea ? tarea[2]! : m[4]!, nivel, ...(tarea ? { marcado: tarea[1] !== ' ' } : {}) })
          i++
          continue
        }
        // Continuación de un elemento (línea con sangría, sin viñeta)
        if (lineas[i]!.trim() && /^\s{2,}/.test(lineas[i]!) && lista.items.length) {
          lista.items[lista.items.length - 1]!.texto += `\n${lineas[i]!.trim()}`
          i++
          continue
        }
        break
      }
      i--
      bloques.push(lista)
      continue
    }
    parrafo.push(l)
  }
  cerrarParrafo()
  return bloques
}

/** Solo enlaces web y de correo: un `javascript:` o `file:` del modelo se queda como texto. */
export const urlSegura = (url: string): boolean => /^(https?:\/\/|mailto:)/i.test(url.trim())

export function parsearInline(texto: string): Inline[] {
  const salida: Inline[] = []
  let buffer = ''
  const vaciar = (): void => {
    if (buffer) salida.push({ t: 'texto', v: buffer })
    buffer = ''
  }
  let i = 0
  while (i < texto.length) {
    const c = texto[i]!
    const resto = texto.slice(i)
    if (c === '\\' && i + 1 < texto.length && /[\\`*_~[\]()#|>-]/.test(texto[i + 1]!)) {
      buffer += texto[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const n = /^`+/.exec(resto)![0].length
      const fin = texto.indexOf('`'.repeat(n), i + n)
      if (fin > i) {
        vaciar()
        salida.push({ t: 'codigo', v: texto.slice(i + n, fin).replace(/^ (.+) $/, '$1') })
        i = fin + n
        continue
      }
    }
    const fuerte = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(resto)
    if (fuerte) {
      vaciar()
      salida.push({ t: 'negrita', hijos: parsearInline(fuerte[2]!) })
      i += fuerte[0].length
      continue
    }
    const tachado = /^~~(?=\S)([\s\S]*?\S)~~/.exec(resto)
    if (tachado) {
      vaciar()
      salida.push({ t: 'tachado', hijos: parsearInline(tachado[1]!) })
      i += tachado[0].length
      continue
    }
    // `_` solo cuenta fuera de palabras (rutas como mi_archivo_nuevo no son cursiva)
    const previo = i > 0 ? texto[i - 1]! : ' '
    const cursiva = c === '*' ? /^\*(?=\S)([^*\n]*?\S)\*(?!\*)/.exec(resto) : c === '_' && !/\w/.test(previo) ? /^_(?=\S)([^_\n]*?\S)_(?!\w)/.exec(resto) : null
    if (cursiva) {
      vaciar()
      salida.push({ t: 'cursiva', hijos: parsearInline(cursiva[1]!) })
      i += cursiva[0].length
      continue
    }
    if (c === '[') {
      const enlace = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(resto)
      if (enlace) {
        vaciar()
        if (urlSegura(enlace[2]!)) salida.push({ t: 'enlace', url: enlace[2]!, hijos: parsearInline(enlace[1]!) })
        else salida.push(...parsearInline(enlace[1]!))
        i += enlace[0].length
        continue
      }
    }
    if (c === 'h' && /^https?:\/\//.test(resto) && !/\w/.test(previo)) {
      const url = /^https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/.exec(resto)
      if (url) {
        vaciar()
        salida.push({ t: 'enlace', url: url[0], hijos: [{ t: 'texto', v: url[0] }] })
        i += url[0].length
        continue
      }
    }
    buffer += c
    i++
  }
  vaciar()
  return salida
}

const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'fish', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat'])

/** ¿Es un bloque de comandos para pegar en una terminal? */
export const esBloqueShell = (lenguaje: string): boolean => SHELL.has(lenguaje)

/**
 * Comandos de un bloque de shell listos para escribir en la terminal: quita los `$ ` / `PS> ` de los ejemplos de consola, las líneas de
 * salida que los acompañan (en bloques `console`), los comentarios y las líneas vacías.
 */
export function comandosDeBloque(lenguaje: string, codigo: string): string {
  const lineas = codigo.replace(/\r\n?/g, '\n').split('\n')
  // `$ ` (Unix) o `PS C:\…> ` (PowerShell); un `> ` suelto suele ser salida, no un prompt.
  const PROMPT = /^\s*(\$|PS[^>\n]*>) /
  const conPrompt = lineas.some((l) => PROMPT.test(l))
  const comandos = conPrompt || lenguaje === 'console' ? lineas.filter((l) => PROMPT.test(l)).map((l) => l.replace(PROMPT, '')) : lineas
  return comandos
    .filter((l) => l.trim() && !/^\s*#(?!!)/.test(l))
    .join('\n')
    .trim()
}

const PELIGROSOS: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive)\b/i, 'borra archivos de forma recursiva'],
  [/\bsudo\b|\bsu\s+-?\b/, 'pide privilegios de administrador'],
  [/\bgit\s+(push\s+.*(--force|-f\b)|reset\s+--hard|clean\s+-[a-z]*f)/i, 'reescribe o descarta trabajo de git'],
  [/\b(mkfs|dd\s+if=|shutdown|reboot|format)\b/i, 'toca discos o el sistema'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, 'ejecuta un script descargado de internet'],
  [/\bdrop\s+(table|database)\b|\btruncate\s+table\b/i, 'borra datos de una base de datos'],
  [/\bchmod\s+(-R\s+)?777\b/, 'abre los permisos de archivos a todos']
]

/** Motivos por los que conviene mirar dos veces un comando antes de ejecutarlo (vacío = nada llamativo). */
export const avisosComando = (comando: string): string[] => [...new Set(PELIGROSOS.filter(([re]) => re.test(comando)).map(([, motivo]) => motivo))]

/** Botón de acción que el modelo propone al final de una respuesta (bloque ```acciones). */
export interface AccionChat {
  etiqueta: string
  mensaje: string
}

export const MAX_ACCIONES = 4

/** Lee el JSON de un bloque ```acciones; `null` si no es válido (entonces se pinta como código normal). Solo texto, con tope de tamaño. */
export function parsearAcciones(codigo: string): AccionChat[] | null {
  let datos: unknown
  try {
    datos = JSON.parse(codigo)
  } catch {
    return null
  }
  if (!Array.isArray(datos) || datos.length === 0) return null
  const salida: AccionChat[] = []
  for (const x of datos.slice(0, MAX_ACCIONES)) {
    if (!x || typeof x !== 'object') return null
    const { etiqueta, mensaje } = x as Record<string, unknown>
    if (typeof etiqueta !== 'string' || typeof mensaje !== 'string') return null
    const e = etiqueta.trim()
    const m = mensaje.trim()
    if (!e || !m || e.length > 60 || m.length > 500) return null
    salida.push({ etiqueta: e, mensaje: m })
  }
  return salida
}
