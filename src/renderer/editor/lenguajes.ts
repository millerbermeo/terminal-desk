import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import type { Extension } from '@codemirror/state'

const ext = (ruta: string): string => ruta.split('/').pop()!.split('.').slice(1).pop()?.toLowerCase() ?? ''

export interface Lenguaje {
  nombre: string
  extension?: Extension
}

/** Resaltado según la extensión; el resto se muestra como texto plano. */
export function lenguajeDe(ruta: string): Lenguaje {
  switch (ext(ruta)) {
    case 'ts':
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
      return { nombre: 'JSON', extension: json() }
    case 'css':
    case 'scss':
      return { nombre: 'CSS', extension: css() }
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return { nombre: 'HTML', extension: html() }
    case 'md':
    case 'markdown':
      return { nombre: 'Markdown', extension: markdown() }
    case 'py':
      return { nombre: 'Python', extension: python() }
    default:
      return { nombre: 'Texto' }
  }
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
