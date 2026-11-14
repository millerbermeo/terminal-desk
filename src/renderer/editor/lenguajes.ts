import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { LanguageDescription, LanguageSupport } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Extension } from '@codemirror/state'


const ext = (ruta: string): string => ruta.split('/').pop()!.split('.').slice(1).pop()?.toLowerCase() ?? ''
const base = (ruta: string): string => ruta.split(/[\\/]/).pop() ?? ruta

export interface Lenguaje {
  nombre: string
  extension?: Extension
}

/** Los más usados van incluidos (sin parpadeo al abrir). */
function incluido(ruta: string): Lenguaje | null {
  switch (ext(ruta)) {
    case 'ts':
    case 'mts':
    case 'cts':
      return { nombre: 'TypeScript', extension: javascript({ typescript: true }) }
    case 'tsx':
      return { nombre: 'TypeScript React', extension: javascript({ typescript: true, jsx: true }) }
    case 'js':
    case 'mjs':
    case 'cjs':
      return { nombre: 'JavaScript', extension: javascript() }
    case 'jsx':
      return { nombre: 'JavaScript React', extension: javascript({ jsx: true }) }
    case 'json':
    case 'jsonc':
    case 'json5':
      return { nombre: 'JSON', extension: json() }
    case 'css':
      return { nombre: 'CSS', extension: css() }
    case 'html':
    case 'htm':
    case 'svelte':
    case 'astro':
      return { nombre: 'HTML', extension: html() }
    case 'md':
    case 'markdown':
    case 'mdx':
      return { nombre: 'Markdown', extension: markdown() }
    case 'py':
    case 'pyw':
    case 'pyi':
      return { nombre: 'Python', extension: python() }
    default:
      return null
  }
}

/** Nombres y extensiones que `language-data` no conoce, apuntados a un lenguaje parecido. */
const ALIAS_NOMBRE: Record<string, string> = { makefile: 'Shell', gnumakefile: 'Shell', '.env': 'Properties files', '.bashrc': 'Shell', '.zshrc': 'Shell', '.profile': 'Shell', 'containerfile': 'Dockerfile' }
const ALIAS_EXT: Record<string, string> = {
  env: 'Properties files', conf: 'Properties files', cfg: 'Properties files', twig: 'Jinja2', njk: 'Jinja2', j2: 'Jinja2',
  zsh: 'Shell', bash: 'Shell', fish: 'Shell', mk: 'Shell', gradle: 'Groovy', kts: 'Kotlin', h: 'C', hpp: 'C++', ino: 'C++',
  graphql: 'JavaScript', gql: 'JavaScript', prisma: 'JavaScript', tf: 'Properties files', hcl: 'Properties files', ex: 'Ruby', exs: 'Ruby', lock: 'TOML'
}
/** Primera línea con `#!` o `<?php` cuando el archivo no tiene extensión reconocible. */
const SHEBANG: [RegExp, string][] = [
  [/^<\?php/, 'PHP'],
  [/^#!.*\b(ba|z|da|k)?sh\b/, 'Shell'],
  [/^#!.*\bpython/, 'Python'],
  [/^#!.*\bnode\b/, 'JavaScript'],
  [/^#!.*\bruby\b/, 'Ruby'],
  [/^#!.*\bperl\b/, 'Perl'],
  [/^#!.*\bphp\b/, 'PHP'],
  [/^#!.*\blua\b/, 'Lua']
]

/** Descripción de `language-data` para el archivo (sin cargar el resaltado). */
function descripcion(ruta: string, primeraLinea = ''): LanguageDescription | null {
  const nombre = base(ruta)
  const porNombre = ALIAS_NOMBRE[nombre.toLowerCase()]
  if (porNombre) return LanguageDescription.matchLanguageName(languages, porNombre, false)
  const d = LanguageDescription.matchFilename(languages, nombre)
  if (d) return d
  const alias = ALIAS_EXT[ext(ruta)]
  if (alias) return LanguageDescription.matchLanguageName(languages, alias, false)
  const linea = primeraLinea.trimStart().slice(0, 200)
  for (const [re, n] of SHEBANG) if (re.test(linea)) return LanguageDescription.matchLanguageName(languages, n, false)
  return null
}

/** Nombre y resaltado inmediato; si el lenguaje se carga aparte, `cargarLenguaje` trae el resaltado. */
export function lenguajeDe(ruta: string, primeraLinea = ''): Lenguaje {
  const i = incluido(ruta)
  if (i) return i
  const d = descripcion(ruta, primeraLinea)
  return { nombre: d?.name ?? 'Texto' }
}

/** Resaltado de cualquier lenguaje conocido (~150: PHP, Java, Go, Rust, C/C++, C#, SQL, YAML, Kotlin, Ruby, Shell…), cargado al abrirlo. */
export async function cargarLenguaje(ruta: string, primeraLinea = ''): Promise<LanguageSupport | null> {
  if (incluido(ruta)) return null
  const d = descripcion(ruta, primeraLinea)
  return d ? d.load().catch(() => null) : null
}

/** Insignia de texto para el árbol (sin dependencias de iconos). */
export function insigniaDe(nombre: string): { txt: string; color: string } {
  switch (ext(nombre)) {
    case 'ts':
    case 'tsx':
      return { txt: 'TS', color: '#818cf8' }
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { txt: 'JS', color: '#fbbf24' }
    case 'json':
    case 'jsonc':
      return { txt: '{}', color: '#34d399' }
    case 'css':
    case 'scss':
      return { txt: '#', color: '#c084fc' }
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return { txt: '<>', color: '#f87171' }
    case 'md':
    case 'markdown':
      return { txt: 'M↓', color: '#67e8f9' }
    case 'py':
      return { txt: 'PY', color: '#fbbf24' }
    case 'php':
      return { txt: 'PHP', color: '#a78bfa' }
    case 'java':
    case 'kt':
    case 'kts':
      return { txt: 'JV', color: '#fb923c' }
    case 'go':
      return { txt: 'GO', color: '#22d3ee' }
    case 'rs':
      return { txt: 'RS', color: '#fb923c' }
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
      return { txt: 'C', color: '#60a5fa' }
    case 'cs':
      return { txt: 'C#', color: '#a3e635' }
    case 'rb':
      return { txt: 'RB', color: '#f87171' }
    case 'sql':
      return { txt: 'SQL', color: '#fcd34d' }
    case 'yml':
    case 'yaml':
    case 'toml':
      return { txt: 'Y', color: '#f472b6' }
    case 'sh':
    case 'bash':
    case 'zsh':
      return { txt: '$', color: '#4ade80' }
    case 'scss':
    case 'sass':
    case 'less':
      return { txt: '#', color: '#f472b6' }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return { txt: '▣', color: '#5eead4' }
    default:
      return { txt: '·', color: '#a0a0ad' }
  }
}
